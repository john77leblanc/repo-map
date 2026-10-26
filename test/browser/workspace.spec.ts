import { test as base, expect, type Page } from '@playwright/test';

// examples/shop links ../shop-api in .repo-map/workspace.json; the e2e server copies both side by side.
const test = base.extend<{ browserErrors: void }>({
    browserErrors: [async ({ page }, use) => {
        await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await use();
        expect(errors, 'Browser console errors and uncaught exceptions').toEqual([]);
    }, { auto: true }],
});

test.use({ reducedMotion: 'reduce' });

async function openWorkspace(page: Page) {
    await page.goto('/');
    await expect(page.locator('.node[data-id="shopper"] .nh')).toBeVisible();
    await page.locator('#arch-scope-ws').click();
    await expect(page.locator('.node[data-id="api:orders-route"]')).toBeVisible();
}

test('the workspace view joins the linked API where the shop calls it, and switches back', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.node[data-id="shopper"] .nh')).toBeVisible();
    await expect(page.locator('.node[data-id="api:orders-route"]')).toHaveCount(0);
    await openWorkspace(page);
    await expect(page.locator('#arch-scope-ws')).toHaveAttribute('aria-pressed', 'true');
    // the shop's "Orders API" placeholder became the API's real route
    await expect(page.locator('.node[data-id="orders-api"]')).toHaveCount(0);
    await expect(page.locator('.node[data-id="payments-api"]')).toBeVisible();
    await expect(page.locator('details.grp[data-g="api:g-routes"] .repo-tag')).toHaveText('Shop API');
    await expect.poll(() => page.locator('#wires path.w.seam').count()).toBe(1);
    await expect(page.locator('#workspace-bar [data-repo="api"] .fresh')).toHaveCount(1);
    await expect(page.locator('#ws-seam-count')).toHaveText('1 seam');

    await page.locator('.node[data-id="orders-client"] .nh').click();
    const seam = page.locator('#arch-details .seams [data-seam="orders-client>api:orders-route"]');
    await expect(seam).toContainText('orders route (Shop API)');
    await expect(seam).toContainText('matched contract');
    await seam.locator('.cl').click();
    await expect(page.locator('#arch-details-title')).toHaveText('orders route');
    await expect(page.locator('#arch-details .repo-of')).toHaveText('From Shop API');

    // a card away from the seam dims it, like any other unrelated wire
    await page.locator('.node[data-id="cart-page"] .nh').click();
    await expect.poll(() => page.locator('#wires path.w.seam').evaluate((p) => Number(getComputedStyle(p).opacity))).toBeLessThan(0.2);
    await page.locator('.node[data-id="orders-client"] .nh').click();
    await expect.poll(() => page.locator('#wires path.w.seam').evaluate((p) => Number(getComputedStyle(p).opacity))).toBe(1);

    // the choice is remembered
    await page.reload();
    await expect(page.locator('.node[data-id="api:orders-route"]')).toBeVisible();
    await page.locator('#arch-scope-repo').click();
    await expect(page.locator('.node[data-id="api:orders-route"]')).toHaveCount(0);
    await expect(page.locator('.node[data-id="orders-api"]')).toBeVisible();
    await expect(page.locator('#workspace-bar')).toHaveCount(0);
});

test('a linked repo collapses into one card that keeps its seam, and expands from its side panel', async ({ page }) => {
    await openWorkspace(page);
    await page.locator('[data-repo-fold="api"]').click();
    const card = page.locator('.node[data-id="c:repo:api"]');
    await expect(card).toBeVisible();
    await expect(card).toContainText('5 cards');
    await expect(page.locator('.node[data-id="api:orders-route"]')).toHaveCount(0);
    await expect.poll(() => page.locator('#wires path.w.seam').count()).toBe(1);
    await card.locator('.nh').click();
    await expect(page.locator('#arch-details')).toContainText('5 cards from Shop API are folded into this card');
    await expect(page.locator('#arch-details .seams')).toContainText('orders client');
    await page.locator('#arch-details [data-member="api:receipts"]').click();
    await expect(page.locator('.node[data-id="c:repo:api"]')).toHaveCount(0);
    await expect(page.locator('#arch-details-title')).toHaveText('receipt mailer');
    await expect(page.locator('[data-repo-fold="api"]')).toHaveText('Collapse');
});

test('settings list linked repos and refuse a bad link name', async ({ page }) => {
    await page.goto('/');
    await page.locator('#tab-map').click();
    const section = page.locator('#linked-repos');
    await expect(section.locator('[data-link="api"]')).toContainText('Shop API');
    await expect(section.locator('[data-link="api"]')).toContainText('../shop-api');
    await page.locator('#link-name').fill('home');
    await page.locator('#link-dir').fill('../elsewhere');
    await expect(page.locator('#link-add button[type="submit"]')).toBeDisabled();
    await page.locator('#link-name').fill('missing');
    await page.locator('#link-add button[type="submit"]').click();
    await expect(section.locator('[data-link="missing"]')).toContainText('unavailable');
    await section.locator('[data-link="missing"] button').click();
    await expect(section.locator('[data-link]')).toHaveCount(1);
});

const crossTrace = {
    key: 'workspace-trace-1234', title: 'Placing an order', prompt: 'How is an order placed?', intent: 'description', summary: 'Checkout posts the order to the API.',
    gaps: '', scope: 'workspace', repos: ['home', 'api', 'gone'],
    outputs: { architecture: true, flowchart: true },
    steps: [{ id: 'orders-client', note: 'posts the order' }, { id: 'orders-api', note: 'the API placeholder' }, { id: 'gone:worker', note: 'a repo that was unlinked' }],
    edges: [['orders-client', 'orders-api']],
    refs: [{ step: 'orders-api', path: 'api:src/routes/orders.js', start: 1, end: 3, why: 'the route' }],
    flow: {
        repos: [{ id: 'home', label: 'Shop' }, { id: 'api', label: 'Shop API' }],
        lanes: [{ id: 'web', label: 'Frontend', repo: 'home' }, { id: 'route', label: 'Orders route', repo: 'api' }, { id: 'worker', label: 'Worker', repo: 'api' }],
        nodes: [
            { id: 'f1', type: 'start', label: 'Shopper places order', lane: 'web' },
            { id: 'f2', type: 'process', label: 'Save the order', lane: 'route' },
            { id: 'f3', type: 'process', label: 'Queue the receipt', lane: 'worker' },
            { id: 'f4', type: 'end', label: 'Order confirmed', lane: 'web' },
        ],
        edges: [{ from: 'f1', to: 'f2' }, { from: 'f2', to: 'f3' }, { from: 'f3', to: 'f4' }],
    },
};

test('a workspace trace follows the order into the linked API, in repo bands that fold', async ({ page }) => {
    await page.route('**/api/traces', (route) => route.fulfill({ json: { traces: [crossTrace] } }));
    // a slow workspace load: the trace waits for the merged map before reading its steps
    await page.route('**/api/workspace', async (route) => {
        await new Promise((r) => setTimeout(r, 1200));
        await route.continue();
    });
    await page.goto('/');
    await expect(page.locator('.node[data-id="shopper"] .nh')).toBeVisible();
    await page.locator('.trace-open').click();
    await page.getByRole('tab', { name: 'Architecture', exact: true }).click();
    // the workspace map is shown for a workspace trace, and the placeholder step is the API's real route
    await expect(page.locator('.node[data-id="api:orders-route"]')).toHaveClass(/trn/);
    await expect(page.locator('.node[data-id="api:orders-route"] .stepn')).toHaveText('2');
    const steps = page.locator('ol.steps > li');
    // the trace needs the workspace map, so the scope switch is locked to it
    await expect(page.locator('#arch-scope-ws')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#arch-scope-repo')).toBeDisabled();
    await expect(page.getByRole('group', { name: 'Map scope' })).toHaveAttribute('title', 'This trace spans linked repos');
    await expect(steps.nth(1)).toContainText('orders route (Shop API)');
    await expect(steps.nth(2)).toContainText('worker (from gone, not linked)');
    await expect(page.locator('#trace-unlinked')).toContainText('gone');
    await steps.nth(1).locator('details.ref summary').click();
    await expect(steps.nth(1).locator('.code .cl2')).toHaveCount(3);

    await page.getByRole('tab', { name: 'Flowchart', exact: true }).click();
    await expect(page.locator('#fl-svgbox .repo-band')).toHaveCount(2);
    await expect(page.locator('[data-repo-band="api"]')).toContainText('Shop API');
    await page.locator('[data-repo-band-fold="api"]').click();
    const box = page.locator('#fl-svgbox .fn[data-id="c:repo:api"]');
    await expect(box).toBeVisible();
    await expect(page.locator('#fl-svgbox .fn[data-id="f2"]')).toHaveCount(0);
    await page.locator('[data-repo-band-fold="api"]').click();
    await expect(page.locator('#fl-svgbox .fn[data-id="f2"]')).toBeVisible();
});

test('search in the workspace view tags linked-repo groups and keeps results across a scope switch', async ({ page }) => {
    await openWorkspace(page);
    await page.locator('#arch-search-toggle').click();
    const panel = page.locator('#arch-details');
    await panel.getByRole('combobox', { name: 'Find a node' }).fill('orders route');
    await expect(panel.locator('.search-grp h5 .repo-tag')).toHaveText('Shop API');
    await panel.locator('[role=option][data-hit="api:orders-route"]').click();
    await expect(page.locator('#arch-details-title')).toHaveText('orders route');
    await page.locator('#arch-scope-repo').click();
    await expect(panel.getByRole('combobox', { name: 'Find a node' })).toHaveValue('orders route');
    await expect(panel.locator('[role=option][data-hit="api:orders-route"]')).toHaveCount(0);
});

test('the scope switch is disabled away from the Architecture view', async ({ page }) => {
    await openWorkspace(page);
    await page.getByRole('tab', { name: 'Sitemap', exact: true }).click();
    await expect(page.locator('#arch-scope-repo')).toBeDisabled();
    await expect(page.locator('#arch-scope-ws')).toBeDisabled();
    await page.getByRole('tab', { name: 'Flowchart', exact: true }).click();
    await expect(page.locator('#arch-scope-ws')).toBeDisabled();
    await page.getByRole('tab', { name: 'Architecture', exact: true }).click();
    await expect(page.locator('#arch-scope-repo')).toBeEnabled();
    await expect(page.locator('#arch-scope-ws')).toHaveAttribute('aria-pressed', 'true');
});
