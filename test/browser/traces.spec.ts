import { test, expect } from '@playwright/test';

const flow = { nodes: [{ id: 'start', type: 'start', label: 'Begin checkout', step: 1 }, { id: 'end', type: 'end', label: 'Order placed', step: 2 }], edges: [{ from: 'start', to: 'end' }] };
const trace = { key: 'trace-12345678', intent: 'description', title: 'Checkout test', prompt: 'How does checkout work?', summary: 'The checkout calls the orders client.', steps: [{ id: 'checkout-page', note: 'Start checkout.' }, { id: 'orders-client', note: 'Place the order.' }], edges: [['checkout-page', 'orders-client']], refs: [{ step: 'checkout-page', path: 'src/pages/checkout/index.js', start: 1, end: 3 }], outputs: { architecture: true, flowchart: true }, flow };

test.beforeEach(async ({ page }) => {
    await page.route('**/api/traces', route => route.fulfill({ json: { traces: [trace] } }));
    await page.route('**/api/map/status', route => route.fulfill({ json: { state: 'current', docs: { linked: true } } }));
});

test('deleting a saved trace accepts an empty 204 response and removes its sidebar entry', async ({ page }) => {
    let deleted = false;
    await page.route('**/api/traces', route => route.fulfill({ json: { traces: deleted ? [] : [trace] } }));
    await page.route('**/api/traces/trace-12345678', route => {
        expect(route.request().method()).toBe('DELETE');
        deleted = true;
        return route.fulfill({ status: 204 });
    });
    await page.goto('/');
    await page.locator('.trace-open').click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Delete trace and all outputs?', exact: true }).click();
    await expect(page.locator('#sidebar-home')).toBeVisible();
    await expect(page.locator('#trace-list li')).toHaveCount(0);
    await expect(page.locator('#saved-empty')).toBeVisible();
    await expect(page.getByText("Couldn't delete that trace.")).toHaveCount(0);
    expect(deleted).toBe(true);
});
test('saved trace switches outputs, selects flow details, exports and restores the map', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/');
    await page.getByRole('button', { name: 'Checkout test How does checkout work?' }).click();
    await expect(page.locator('#trace-title')).toHaveText('Checkout test');
    await expect(page.locator('.node.trn')).toHaveCount(2);
    await page.getByRole('tab', { name: 'Flowchart', exact: true }).click();
    await expect(page.locator('#fl-svgbox svg')).toBeVisible();
    await page.locator('#fl-svgbox .fn').first().click();
    await expect(page.locator('#flowdlg #fl-side h3')).toHaveText('Begin checkout');
    await expect(page.locator('#sidebar-trace #fl-side')).toHaveCount(0);
    await page.locator('#fl-side-close').click();
    await expect(page.locator('#fl-side')).toHaveCount(0);
    await expect(page.locator('#trace-walkthrough .steps')).toHaveCount(0);
    const initial = await page.locator('#fl-svgbox svg').getAttribute('width');
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    expect(Number(await page.locator('#fl-svgbox svg').getAttribute('width'))).toBeLessThan(Number(initial));
    const download = page.waitForEvent('download');
    await page.locator('#fl-export').click();
    await page.getByRole('button', { name: 'Download SVG' }).click();
    expect((await download).suggestedFilename()).toContain('.svg');
    await page.getByRole('button', { name: 'Back to all traces' }).click();
    await expect(page.locator('.node.trn')).toHaveCount(0);
    await expect(page.locator('#sidebar-home')).toBeVisible();
    await expect(page.locator('#trace-list li')).toHaveCount(1);
    expect(errors).toEqual([]);
});
test('legacy trace codes import, survive failed persistence, and remain retryable', async ({ page }) => {
    await page.route('**/api/traces', route => route.request().method() === 'POST' ? route.fulfill({ status: 500, json: { error: 'disk full' } }) : route.fulfill({ json: { traces: [] } }));
    await page.goto('/');
    await page.getByRole('button', { name: 'New trace', exact: true }).click();
    await page.locator('#trace-dialog details.imp summary').click();
    const { outputs, key, ...legacy } = trace;
    await page.locator('#importbox').fill('rmap1:' + Buffer.from(JSON.stringify(legacy)).toString('base64'));
    await page.getByRole('button', { name: 'Add trace' }).click();
    await expect(page.locator('#trace-title')).toHaveText(trace.title);
    await expect(page.getByRole('button', { name: 'Retry saving' })).toBeVisible();
    await page.getByRole('tab', { name: 'Flowchart', exact: true }).click();
    await expect(page.locator('#fl-svgbox svg')).toBeVisible();
});
test('proposal cards and cached plans are disposable and travel with a trace', async ({ page }) => {
    const proposal = { ...trace, intent: 'proposal', title: 'Coupons', proposal: { rationale: 'Validate coupon codes.', assumptions: [], questions: [], nodes: [{ id: 'proposal:coupons', title: 'Coupons', group: 'g-pages', kind: 'service', status: 'new', rationale: 'Validate coupons' }], edges: [{ from: 'checkout-page', to: 'proposal:coupons', type: 'sync', status: 'new' }] }, plan: { summary: 'Add coupons', tasks: [{ title: 'Validate', detail: 'Check expiry', files: ['new: coupons.mjs'] }], interfaces: [], tests: [], risks: [], questions: [] } };
    await page.route('**/api/traces', route => route.fulfill({ json: { traces: [proposal] } }));
    await page.goto('/');
    await expect(page.locator('.trace-card .trace-badge')).toHaveText('Plan');
    await page.locator('.trace-open').click();
    await expect(page.locator('.node.change-new')).toHaveCount(1);
    await page.getByRole('button', { name: 'View implementation plan', exact: true }).click();
    await expect(page.locator('#plan-dialog')).toBeVisible();
    await expect(page.locator('#plan-body')).toContainText('Check expiry');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'Back to all traces' }).click();
    await expect(page.locator('.node.change-new')).toHaveCount(0);
    await expect(page.locator('.node')).toHaveCount(8);
});
test('a streamed trace displays progress and preserves the prompt after cancellation', async ({ page }) => {
    await page.route('**/api/config', async route => { const response = await route.fetch(); const data = await response.json(); await route.fulfill({ json: { ...data, ai: { available: true, label: 'Test AI' } } }); });
    await page.route('**/api/agents', route => route.fulfill({ json: { agents: [{ id: 'api', label: 'Test AI', available: true, defaultModel: 'test', models: [], efforts: [] }], default: { agent: 'api' } } }));
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/trace', async route => { await blocked; await route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'result', trace }) + '\n' }).catch(() => {}); });
    await page.goto('/');
    await page.getByRole('button', { name: 'New trace', exact: true }).click();
    await page.locator('#prompt').fill('How does checkout work?');
    await page.getByRole('button', { name: 'Create trace' }).click();
    await expect(page.locator('#status')).toContainText('Starting');
    await page.locator('#stop').click();
    await expect(page.locator('#status')).toHaveText('Stopped.');
    await expect(page.locator('#prompt')).toHaveValue('How does checkout work?');
    release();
});

test('one view row serves the map and traces: Flowchart on the map explains, a trace keeps the view, Back leaves Flowchart', async ({ page }) => {
    await page.goto('/');
    const tab = (name: string) => page.getByRole('tab', { name, exact: true });
    await expect(page.locator('.view-context')).toHaveText('Map');
    await expect(tab('Flowchart')).toHaveClass(/missing/);
    await tab('Flowchart').click();
    await expect(page.locator('#view-missing h2')).toHaveText('Flowcharts only exist for traces');
    await page.locator('#view-missing').getByRole('button', { name: 'New trace', exact: true }).click();
    await expect(page.locator('#composer')).toBeVisible();
    await page.keyboard.press('Escape');
    // Opening a trace keeps Flowchart, which this trace has.
    await page.getByRole('button', { name: 'Checkout test How does checkout work?' }).click();
    await expect(page.locator('.view-context')).toHaveText('Trace · Checkout test');
    await expect(tab('Flowchart')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#fl-svgbox svg')).toBeVisible();
    await expect(page.locator('#sidebar-trace [role=tab]')).toHaveCount(0);
    // Back to the map from Flowchart lands on the last map view.
    await page.getByRole('button', { name: 'Back to all traces', exact: true }).click();
    await expect(tab('Architecture')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.view-context')).toHaveText('Map');
});
