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
