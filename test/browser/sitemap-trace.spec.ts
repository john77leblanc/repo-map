import { test, expect } from '@playwright/test';

const base = { version: 1, applicability: 'applicable', summary: 'Shop screens', gaps: [], generatedAt: '2026-10-23T10:00:00Z',
    applications: [{ id: 'shop', label: 'Shop' }],
    screens: ['cart', 'checkout', 'receipt', 'account'].map((id) => ({ id, app: 'shop', label: id, route: '/' + id, detail: id, refs: [] })),
    navigation: [{ from: 'cart', to: 'checkout', label: 'Continue', condition: 'Signed in', refs: [] },
        { from: 'checkout', to: 'receipt', label: 'Pay', condition: '', refs: [] }] };
const sitemap = { version: 1, base, applicability: 'relevant', summary: 'Add guest details before payment.', gaps: [],
    steps: [{ screen: 'cart', note: 'Review items', refs: [] }, { screen: 'proposal-guest', note: 'Enter guest details', refs: [] }, { screen: 'cart', note: 'Return to edit items', refs: [] }], navigation: [],
    changes: { screens: [{ id: 'proposal-guest', app: 'shop', label: 'Guest details', route: '/guest', detail: 'Collect guest contact information', refs: [], status: 'new', rationale: 'Allow guest orders' },
        { ...base.screens[1], status: 'modified', detail: 'Accept guest details', rationale: 'Guests can pay' }],
    navigation: [{ from: 'cart', to: 'proposal-guest', label: 'Guest checkout', condition: '', refs: [], status: 'new', rationale: 'Start guest journey' },
        { index: 0, from: 'cart', to: 'checkout', label: 'Continue', condition: 'Signed in', refs: [], status: 'removed', rationale: 'Replaced navigation' }] } };
const trace = { key: 'screen-trace-1234', title: 'Guest checkout', prompt: 'Add guest checkout', intent: 'proposal', summary: 'Allow guest orders',
    steps: [], edges: [], refs: [], outputs: { architecture: false, flowchart: false, sitemap: true }, sitemap };

test('screen-only proposals preserve snapshots and expose journeys, context, original values and keyboard tabs', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/traces', (route) => route.fulfill({ json: { traces: [trace] } }));
    await page.route('**/api/sitemap', (route) => route.fulfill({ json: { sitemap: { ...base, screens: [] }, status: { state: 'stale' } } }));
    await page.goto('/');
    await page.locator('.trace-open').click();
    // The trace opens on the current view; it has no architecture, so that view explains and offers Generate.
    await expect(page.locator('#view-missing h2')).toHaveText("The architecture view doesn't exist for this trace");
    await page.getByRole('tab', { name: 'Sitemap', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Sitemap', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#sitemap-svgbox .change-new.fn')).toHaveCount(1);
    await expect(page.locator('#sitemap-svgbox .change-removed.fe')).toHaveCount(1);
    await expect(page.locator('#sitemap-svgbox [data-id="receipt"]')).toHaveClass(/context/);
    await expect(page.locator('#sitemap-svgbox [data-id="account"]')).toHaveCount(0);
    await page.getByLabel('Show').selectOption('trace');
    await expect(page.locator('#sitemap-svgbox [data-id="receipt"]')).toHaveCount(0);
    await page.getByLabel('Show').selectOption('nearby');
    // Pick the journey's first screen, then walk to step 3 with Next.
    await expect(page.locator('#sitemap-details')).toHaveCount(0);
    await page.locator('#sitemap-svgbox [data-id="cart"]').click();
    const panel = page.locator('#sitemap-details');
    await expect(panel.locator('.trace-step')).toContainText('1 of 3');
    await panel.locator('#sitemap-step-next').click();
    await panel.locator('#sitemap-step-next').click();
    await expect(panel.locator('.trace-step')).toContainText('Return to edit items');
    await panel.locator('#sitemap-nav-head').click();
    await expect(panel.getByRole('tab', { name: 'To (2)' })).toHaveAttribute('aria-selected', 'true');
    await panel.locator('button.cl[data-go="proposal-guest"]').hover();
    await expect(page.locator('#sitemap-svgbox svg')).toHaveClass(/hovering/);
    await expect(page.locator('#sitemap-svgbox [data-id="proposal-guest"]')).toHaveClass(/hl/);
    await expect(page.locator('#sitemap-svgbox .fe.hl')).toHaveCount(1);
    await page.mouse.move(0, 0);
    // The open step keeps its screen pinned: cart and its links stay in focus.
    await expect(page.locator('#sitemap-svgbox [data-id="cart"]')).toHaveClass(/hl/);
    await expect(page.locator('#sitemap-svgbox svg')).toHaveClass(/hovering/);
    await page.locator('#sitemap-svgbox [data-id="checkout"]').focus();
    await page.keyboard.press('Enter');
    await page.locator('#sitemap-about-head').click();
    await expect(page.getByRole('region', { name: 'Proposed screen change' })).toContainText('/checkout');
    await page.getByLabel('Show').selectOption('app');
    await expect(page.locator('#sitemap-svgbox [data-id="account"]')).toHaveCount(1);
    const captions = async () => page.locator('#sitemap-svgbox svg').evaluate((element) => {
        const svg = element as SVGSVGElement;
        const boxes = [...svg.querySelectorAll<SVGGElement>('.fl')].map((label) => ({
            rect: label.querySelector('rect')!.getBBox(), text: label.querySelector('text')!.getBBox(),
            path: svg.querySelector<SVGPathElement>(`.fe[data-i="${label.dataset.i}"]`)!,
        }));
        // A caption is on its path when some point of the path lies within a few pixels of its box.
        const onPath = ({ rect, path }: { rect: DOMRect; path: SVGPathElement }) => {
            const length = path.getTotalLength();
            for (let at = 0; at <= length; at += 2) {
                const { x, y } = path.getPointAtLength(at);
                if (x >= rect.x - 6 && x <= rect.x + rect.width + 6 && y >= rect.y - 6 && y <= rect.y + rect.height + 6) return true;
            }
            return false;
        };
        return {
            inside: boxes.every(({ rect }) => rect.x >= 0 && rect.x + rect.width <= svg.viewBox.baseVal.width),
            fits: boxes.every(({ rect, text }) => text.x >= rect.x - 0.5 && text.x + text.width <= rect.x + rect.width + 0.5),
            attached: boxes.every(onPath),
        };
    });
    expect(await captions()).toEqual({ inside: true, fits: true, attached: true });
    await page.getByLabel('Show').selectOption('nearby');
    expect(await captions()).toEqual({ inside: true, fits: true, attached: true });
    await page.getByLabel('Show').selectOption('app');
    await page.screenshot({ path: testInfo.outputPath('sitemap-proposal.png') });
    // All three tabs stay in the row; the outputs this trace lacks are marked and still reachable by keyboard.
    await expect(page.getByRole('tab', { name: 'Architecture', exact: true })).toHaveClass(/missing/);
    await expect(page.getByRole('tab', { name: 'Flowchart', exact: true })).toHaveClass(/missing/);
    await page.getByRole('tab', { name: 'Sitemap', exact: true }).focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: 'Flowchart', exact: true })).toBeFocused();
    await expect(page.locator('#view-missing h2')).toHaveText("The flowchart view doesn't exist for this trace");
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Sitemap', exact: true })).toBeFocused();
    await expect(page.locator('#sitemap-svgbox .change-new.fn')).toHaveCount(1);
    await page.setViewportSize({ width: 768, height: 900 });
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await page.screenshot({ path: testInfo.outputPath('sitemap-proposal-narrow.png') });
    await page.getByRole('button', { name: 'Back to all traces' }).click();
    await expect(page.locator('#sidebar-home')).toBeVisible();
    expect(errors).toEqual([]);
});

test('creating a Sitemap-only trace requires a base and preserves the question', async ({ page }) => {
    await page.route('**/api/config', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ json: { ...await response.json(), ai: { available: true, label: 'Test AI' } } });
    });
    await page.route('**/api/agents', (route) => route.fulfill({ json: { agents: [{ id: 'api', label: 'Test AI', available: true, defaultModel: 'test', models: [], efforts: [] }], default: { agent: 'api' } } }));
    let generated = false;
    await page.route('**/api/sitemap', (route) => route.fulfill({ json: { sitemap: generated ? base : null, status: { state: generated ? 'current' : 'missing' } } }));
    await page.route('**/api/sitemap/generate', (route) => {
        generated = true;
        return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'result', sitemap: base, status: { state: 'current' } }) + '\n' });
    });
    let saved: unknown = null;
    await page.route('**/api/traces', (route) => {
        if (route.request().method() === 'POST') {
            saved = { ...route.request().postDataJSON(), key: 'screen-trace-1234' };
            return route.fulfill({ json: { key: 'screen-trace-1234' } });
        }
        return route.fulfill({ json: { traces: saved ? [saved] : [] } });
    });
    await page.route('**/api/trace', (route) => {
        expect(route.request().postDataJSON()).toMatchObject({ architecture: false, flow: false, sitemap: true });
        return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'result', trace }) + '\n' });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'New trace', exact: true }).click();
    await page.locator('#prompt').fill('Add guest checkout');
    await page.locator('#trace-outputs > summary').click();
    await page.locator('#witharchitecture').uncheck();
    await page.locator('#withflow').uncheck();
    await page.locator('#withsitemap').check();
    await page.locator('#composer').getByRole('button', { name: 'Generate sitemap', exact: true }).click();
    await expect(page.locator('#prompt')).toHaveValue('Add guest checkout');
    await page.getByRole('button', { name: 'Create trace' }).click();
    await expect(page.locator('#sitemap-svgbox .change-new.fn')).toHaveCount(1);
    expect(saved).toMatchObject({ sitemap, outputs: { sitemap: true } });
});

test('a missing Sitemap tab is marked and can be regenerated through Edit without losing the saved trace', async ({ page }) => {
    await page.route('**/api/agents', (route) => route.fulfill({ json: { agents: [{ id: 'api', label: 'Test AI', available: true, defaultModel: 'test', models: [], efforts: [] }], default: { agent: 'api' } } }));
    await page.route('**/api/config', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ json: { ...await response.json(), ai: { available: true, label: 'Test AI' } } });
    });
    await page.route('**/api/sitemap', (route) => route.fulfill({ json: { sitemap: base, status: { state: 'current' } } }));
    const pending = { ...trace, sitemap: null, steps: [{ id: 'checkout-page', note: 'Checkout UI' }],
        outputs: { architecture: true, flowchart: false, sitemap: false }, pendingSitemap: true };
    await page.route('**/api/traces', (route) => route.fulfill({ json: { traces: [pending] } }));
    let stored: unknown;
    await page.route('**/api/traces/screen-trace-1234', (route) => {
        stored = route.request().postDataJSON();
        return route.fulfill({ json: { key: 'screen-trace-1234' } });
    });
    let attempts = 0;
    await page.route('**/api/trace', (route) => route.fulfill({ contentType: 'application/x-ndjson',
        body: JSON.stringify(++attempts === 1 ? { type: 'error', message: 'Provider unavailable' } : { type: 'result', trace: { ...pending, sitemap } }) + '\n' }));
    await page.goto('/');
    await page.locator('.trace-open').click();
    await expect(page.getByRole('tab', { name: 'Sitemap', exact: true })).toHaveClass(/missing/);
    await expect(page.getByRole('tab', { name: 'Flowchart', exact: true })).toHaveClass(/missing/);
    await expect(page.getByRole('tab', { name: 'Architecture', exact: true })).not.toHaveClass(/missing/);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('#trace-outputs > summary').click();
    await expect(page.locator('#withsitemap')).toBeChecked();
    await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
    await expect(page.locator('#status')).toHaveText('Provider unavailable');
    await expect(page.locator('#trace-title')).toHaveText('Guest checkout');
    await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
    await page.getByRole('tab', { name: 'Sitemap', exact: true }).click();
    await expect(page.locator('#sitemap-svgbox .change-new.fn')).toHaveCount(1);
    expect(stored).toMatchObject({ outputs: { architecture: true, sitemap: true } });
    expect(stored).not.toHaveProperty('pendingSitemap');
});
