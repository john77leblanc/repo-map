import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const sitemap = {
    version: 1, applicability: 'applicable', summary: 'Storefront screens and navigation, with an administration application.', gaps: [],
    applications: [{ id: 'admin', label: 'Administration' }, { id: 'shop', label: 'Storefront' }],
    screens: [
        { id: 'admin', app: 'admin', label: 'Dashboard', route: '/admin', detail: 'Manage orders and products.', refs: [] },
        { id: 'cart', app: 'shop', label: 'Cart', route: '/cart', detail: 'Review items before checkout.', refs: [] },
        { id: 'checkout', app: 'shop', label: 'Checkout', route: '/checkout/:cart', detail: 'Payment and delivery details.', refs: [{ path: 'src/pages/checkout/CheckoutPage.jsx', start: 1, end: 3 }] },
        { id: 'receipt', app: 'shop', label: 'Confirmation', route: '', detail: 'Confirmation workspace without a separate URL.', refs: [] },
    ], navigation: [
        { from: 'admin', to: 'cart', label: 'Open storefront', condition: '', refs: [] },
        { from: 'cart', to: 'checkout', label: 'Checkout', condition: 'Cart has items', refs: [] },
        { from: 'checkout', to: 'receipt', label: 'Order placed', condition: 'Payment accepted', refs: [] },
        { from: 'checkout', to: 'cart', label: 'Edit cart', condition: '', refs: [] },
    ],
};
const flow = {
    lanes: [{ id: 'web', label: 'Frontend' }, { id: 'api', label: 'Backend' }, { id: 'worker', label: 'Payment worker' }],
    nodes: [
        { id: 'start', type: 'start', label: 'Submit checkout', lane: 'web', step: 1 },
        { id: 'check', type: 'decision', label: 'Cart valid?', lane: 'api', step: 2 },
        { id: 'charge', type: 'process', label: 'Process payment', lane: 'worker', step: 2 },
        { id: 'done', type: 'end', label: 'Show confirmation', lane: 'web', step: 1 },
        { id: 'error', type: 'error', label: 'Report invalid cart' },
    ], edges: [
        { from: 'start', to: 'check' }, { from: 'check', to: 'charge', label: 'yes' },
        { from: 'charge', to: 'done' }, { from: 'check', to: 'error', label: 'no' },
        { from: 'error', to: 'start', label: 'retry' },
    ],
};
const trace = { key: 'trace-sitemap-test', intent: 'description', title: 'Checkout lanes', prompt: 'How does checkout work?', summary: 'Validate and pay.', steps: [{ id: 'checkout-page', note: 'Submit.' }, { id: 'orders-client', note: 'Order.' }], edges: [], refs: [], outputs: { architecture: true, flowchart: true }, flow };

test.beforeEach(async ({ page }) => {
    await page.route('**/api/traces', (route) => route.fulfill({ json: { traces: [trace] } }));
    await page.route('**/api/map/status', (route) => route.fulfill({ json: { state: 'current', docs: { linked: true } } }));
});

test('repository sitemap generates, navigates, survives trace exploration, and fits a narrow canvas', async ({ page, context }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let saved = false;
    await page.route('**/api/sitemap', (route) => route.fulfill({ json: { sitemap: saved ? sitemap : null, status: { state: saved ? 'current' : 'missing' } } }));
    await page.route('**/api/sitemap/generate', (route) => {
        saved = true;
        return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'result', sitemap, status: { state: 'current' } }) + '\n' });
    });
    await page.goto('/');
    await page.getByRole('tab', { name: 'Architecture', exact: true }).focus();
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: 'Sitemap', exact: true })).toBeFocused();
    await expect(page.getByText('Not generated', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Generate sitemap', exact: true }).click();
    await expect(page.locator('#sitemap-status')).toHaveText('Sitemap saved.');
    await page.getByLabel('Application', { exact: true }).selectOption('shop');
    await expect(page.locator('#sitemap-svgbox .fn')).toHaveCount(4);
    await page.locator('#sitemap-svgbox [data-id="checkout"]').focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible();
    await expect(page.getByText('When: Payment accepted')).toBeVisible();
    await expect(page.locator('#sitemap-info')).toBeHidden();
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Show info', exact: true }).click();
    await expect(page.getByText(sitemap.summary, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Hide info', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Refresh status', exact: true })).toBeHidden();
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Refresh status', exact: true }).click();
    await expect(page.locator('#sitemap-actions')).toBeHidden();
    await page.locator('#sitemap-svgbox [data-id="checkout"]').press('Enter');
    const withDetails = await page.locator('#sitemap-canvas').boundingBox();
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Hide details', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Screen details' })).toBeHidden();
    const withoutDetails = await page.locator('#sitemap-canvas').boundingBox();
    expect(withoutDetails!.width).toBeGreaterThan(withDetails!.width);
    await page.locator('#sitemap-svgbox [data-id="checkout"]').press('Enter');
    await expect(page.getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Diagram key', exact: true }).click();
    await expect(page.locator('#sitemap-key')).toBeVisible();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy Mermaid', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('flowchart TD');
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download SVG', exact: true }).click();
    const download = await downloadEvent;
    expect(download.suggestedFilename()).toBe('shop-map-sitemap.svg');
    const svg = await readFile((await download.path())!, 'utf8');
    expect(svg).toContain('Checkout');
    expect(svg).not.toContain('var(--');
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Show info', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'More', exact: true })).toBeFocused();
    await expect(page.locator('#sitemap-actions')).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('sitemap-desktop.png') });
    await page.getByRole('button', { name: 'Checkout lanes How does checkout work?' }).click();
    await expect(page.getByRole('tab', { name: 'Sitemap', exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Flowchart', exact: true }).click();
    await expect(page.locator('#fl-svgbox .execution-lane')).toHaveCount(4);
    await page.getByRole('button', { name: 'Back to all traces', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Sitemap', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#sitemap-svgbox svg')).toBeVisible();
    await page.setViewportSize({ width: 680, height: 900 });
    await page.getByRole('button', { name: 'Collapse panel', exact: true }).click();
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    const canvas = await page.locator('#sitemap-canvas').boundingBox();
    expect(canvas!.height).toBeGreaterThan(100);
    expect(canvas!.x + canvas!.width).toBeLessThanOrEqual(680);
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('button', { name: 'Hide details', exact: true }).click();
    await expect(page.getByRole('complementary', { name: 'Screen details' })).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath('sitemap-narrow.png') });
    expect(errors).toEqual([]);
});

test('execution lanes toggle, keep selection, export, and persist across reload', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Checkout lanes How does checkout work?' }).click();
    await page.getByRole('tab', { name: 'Flowchart', exact: true }).click();
    await expect(page.locator('#fl-svgbox .execution-lane')).toHaveCount(4);
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await page.locator('#fl-svgbox [data-id="check"]').click();
    await expect(page.getByText('Executes in: Backend')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('flow-lanes.png') });
    const downloaded = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download SVG' }).click();
    expect((await downloaded).suggestedFilename()).toBe('checkout-lanes.svg');
    await page.getByLabel('Flowchart layout', { exact: true }).selectOption('compact');
    await expect(page.locator('#fl-svgbox .execution-lane')).toHaveCount(0);
    await expect(page.locator('#fl-svgbox .fn.sel')).toHaveAttribute('data-id', 'check');
    await page.reload();
    await page.getByRole('button', { name: 'Checkout lanes How does checkout work?' }).click();
    await page.getByRole('tab', { name: 'Flowchart', exact: true }).click();
    await expect(page.getByLabel('Flowchart layout')).toHaveValue('compact');
    await page.getByLabel('Flowchart layout').selectOption('lanes');
    await expect(page.locator('#fl-svgbox .execution-lane')).toHaveCount(4);
});

test('frontend validation retry stays inside its lane', async ({ page }, testInfo) => {
    const retryTrace = { ...trace, flow: {
        lanes: [{ id: 'web', label: 'Frontend (browser)' }, { id: 'api', label: 'Payments API' }],
        nodes: [
            { id: 'start', type: 'start', label: 'Open checkout', lane: 'web' },
            { id: 'email', type: 'action', label: 'Enter email and place order', lane: 'web' },
            { id: 'valid', type: 'decision', label: 'Is the email valid?', lane: 'web' },
            { id: 'pay', type: 'process', label: 'Process payment', lane: 'api' },
            { id: 'done', type: 'end', label: 'Show confirmation', lane: 'web' },
        ],
        edges: [{ from: 'start', to: 'email' }, { from: 'email', to: 'valid' },
            { from: 'valid', to: 'pay', label: 'yes' }, { from: 'valid', to: 'email', label: 'no' },
            { from: 'pay', to: 'done' }],
    } };
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.route('**/api/traces', (route) => route.fulfill({ json: { traces: [retryTrace] } }));
    await page.goto('/');
    await page.getByRole('button', { name: 'Checkout lanes How does checkout work?' }).click();
    await page.getByRole('tab', { name: 'Flowchart', exact: true }).click();
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    const lane = (await page.locator('#fl-svgbox .execution-lane rect').first().boundingBox())!;
    const back = page.locator('#fl-svgbox .fe.back');
    await expect(back).toHaveCount(1);
    const arrow = (await back.boundingBox())!;
    expect(arrow.x).toBeGreaterThan(lane.x);
    expect(arrow.x + arrow.width).toBeLessThan(lane.x + lane.width);
    const label = (await page.locator('#fl-svgbox .fl').filter({ hasText: 'no' }).boundingBox())!;
    expect(label.x + label.width).toBeLessThan(lane.x + lane.width);
    await page.screenshot({ path: testInfo.outputPath('frontend-retry.png') });
});

for (const colorScheme of ['light', 'dark'] as const) test(`lane headings stay opaque, pinned, and aligned through scrolling and zoom in ${colorScheme} theme`, async ({ page }, testInfo) => {
    await page.emulateMedia({ colorScheme });
    const nodes = Array.from({ length: 18 }, (_, index) => ({
        id: `step-${index}`, type: index === 0 ? 'start' : index === 17 ? 'end' : 'process',
        label: `Checkout operation ${index + 1}`, lane: flow.lanes[index % flow.lanes.length].id,
    }));
    const longTrace = { ...trace, flow: {
        lanes: flow.lanes, nodes,
        edges: nodes.slice(1).map((node, index) => ({ from: nodes[index].id, to: node.id })),
    } };
    await page.route('**/api/traces', (route) => route.fulfill({ json: { traces: [longTrace] } }));
    await page.setViewportSize({ width: 1000, height: 700 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Checkout lanes How does checkout work?' }).click();
    await page.getByRole('tab', { name: 'Flowchart', exact: true }).click();
    const canvas = page.locator('#fl-canvas');
    const headings = canvas.locator('.diagram-lane-title');
    const band = canvas.getByRole('group', { name: 'Execution lanes' });
    const backgrounds = canvas.locator('.execution-lane rect');
    await expect(headings.locator('.lane-name')).toHaveText(['Frontend', 'Backend', 'Payment worker']);
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    const aligned = async () => {
        for (let index = 0; index < 3; index++) {
            const heading = await headings.nth(index).boundingBox();
            // DOM geometry excludes the SVG stroke, unlike Playwright's SVG boundingBox.
            const background = await backgrounds.nth(index).evaluate((element) => {
                const { x, width } = element.getBoundingClientRect();
                return { x, width };
            });
            expect(heading!.x).toBeCloseTo(background!.x, 0);
            expect(heading!.width).toBeCloseTo(background!.width, 0);
        }
    };
    await aligned();
    const before = await headings.first().boundingBox();
    await canvas.evaluate((element) => { element.scrollTop = 450; element.scrollLeft = 120; });
    await expect.poll(() => canvas.evaluate((element) => element.scrollTop)).toBeGreaterThan(400);
    await expect.poll(() => canvas.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    const after = await headings.first().boundingBox();
    expect(after!.y).toBeCloseTo(before!.y, 0);
    expect(after!.x).toBeLessThan(before!.x);
    await aligned();
    const opaque = async () => {
        const bandBox = (await band.boundingBox())!;
        const canvasBox = (await canvas.boundingBox())!;
        expect(bandBox.y).toBeCloseTo(canvasBox.y, 0);
        const clip = { x: canvasBox.x, y: canvasBox.y,
            width: await canvas.evaluate((element) => element.clientWidth), height: Math.floor(bandBox.height) };
        const visibleChart = await page.screenshot({ clip });
        await page.locator('#fl-svgbox').evaluate((element) => { element.style.visibility = 'hidden'; });
        const hiddenChart = await page.screenshot({ clip });
        await page.locator('#fl-svgbox').evaluate((element) => { element.style.visibility = ''; });
        // No pixels from lane borders, arrows, or nodes may show through the band.
        expect(visibleChart.equals(hiddenChart)).toBe(true);
    };
    await opaque();
    await page.screenshot({ path: testInfo.outputPath(`sticky-lane-headings-${colorScheme}.png`) });
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await aligned();
    await opaque();
    const zoomed = await headings.first().boundingBox();
    expect(zoomed!.y).toBeGreaterThanOrEqual((await canvas.boundingBox())!.y);
    expect(zoomed!.y + zoomed!.height).toBeLessThan((await canvas.boundingBox())!.y + 100);
    await canvas.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    expect((await headings.first().boundingBox())!.y).toBeCloseTo(zoomed!.y, 0);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await aligned();
    await page.getByLabel('Flowchart layout').selectOption('compact');
    await expect(canvas.getByRole('group', { name: 'Execution lanes' })).toHaveCount(0);
    await page.getByLabel('Flowchart layout').selectOption('lanes');
    await expect(headings).toHaveCount(3);
    await aligned();
});

test('flowchart lanes and shift-selected steps collapse into one box and expand again', async ({ page }, testInfo) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Checkout lanes How does checkout work?' }).click();
    await page.getByRole('tab', { name: 'Flowchart', exact: true }).click();
    const canvas = page.locator('#fl-canvas');
    await canvas.locator('.lane-fold[data-lane="web"]').click();
    const lane = canvas.locator('.fn[data-id="c:lane:web"]');
    await expect(lane).toBeVisible();
    await expect(canvas.locator('.fn[data-id="start"]')).toHaveCount(0);
    await expect(canvas.locator('.lane-fold[data-lane="web"]')).toHaveText('Expand');
    await lane.click();
    await page.screenshot({ path: testInfo.outputPath('collapsed-lane.png') });
    const side = page.locator('#fl-side');
    await expect(side.getByRole('heading', { name: '2 hidden steps' })).toBeVisible();
    await side.locator('[data-member="done"]').click();
    await expect(canvas.locator('.fn[data-id="done"]')).toHaveClass(/sel/);
    await canvas.locator('.fn[data-id="start"]').click({ modifiers: ['Shift'] });
    await canvas.locator('.fn[data-id="done"]').click({ modifiers: ['Shift'] });
    await expect(canvas.locator('.fn.mk')).toHaveCount(2);
    await page.locator('#fl-collapse-sel').click();
    await expect(canvas.locator('.fn[data-id="c:s1"]')).toBeVisible();
    await page.getByRole('textbox', { name: 'Group name' }).fill('Shopper screens');
    await page.getByRole('textbox', { name: 'Group name' }).press('Enter');
    await page.reload();
    await page.getByRole('button', { name: 'Checkout lanes How does checkout work?' }).click();
    await page.getByRole('tab', { name: 'Flowchart', exact: true }).click();
    await expect(canvas.locator('.fn[data-id="c:s1"]')).toContainText('Shopper screens');
    await page.locator('#fl-expand-all').click();
    await expect(canvas.locator('.fn[data-id="start"]')).toBeVisible();
});
