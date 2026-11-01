import { test, expect } from '@playwright/test';

const sitemap = {
    version: 1, applicability: 'applicable', summary: 'Storefront screens.', gaps: [],
    applications: [{ id: 'shop', label: 'Storefront' }],
    screens: [
        { id: 'cart', app: 'shop', label: 'Cart', route: '/cart', detail: 'Review items.', refs: [] },
        { id: 'checkout', app: 'shop', label: 'Checkout', route: '/checkout', detail: 'Pay.', refs: [] },
    ],
    navigation: [{ from: 'cart', to: 'checkout', label: 'Check out', condition: '', refs: [] }],
};
const ref = { path: 'src/pages/cart/CartPage.jsx', start: 1, end: 12, why: 'Declares it' };
const components = {
    version: 1, applicability: 'applicable', summary: 'Two pages sharing a price line.', gaps: [],
    components: [
        { id: 'cart-page', label: 'CartPage', detail: 'Cart items.', tags: ['state'], refs: [ref] },
        { id: 'checkout-page', label: 'CheckoutPage', detail: 'Order form.', tags: ['form'], refs: [ref] },
        { id: 'price-line', label: 'PriceLine', detail: 'A formatted price.', tags: [], refs: [ref] },
    ],
    uses: [{ from: 'cart-page', to: 'price-line' }, { from: 'checkout-page', to: 'price-line' }],
    screens: [{ screen: 'cart', root: 'cart-page' }, { screen: 'checkout', root: 'checkout-page' }],
};

test.beforeEach(async ({ page }) => {
    await page.route('**/api/traces', (route) => route.fulfill({ json: { traces: [] } }));
    await page.route('**/api/map/status', (route) => route.fulfill({ json: { state: 'current', docs: { linked: true } } }));
    await page.route('**/api/sitemap', (route) => route.fulfill({ json: { sitemap, status: { state: 'current' } } }));
});

test('Components is its own view: generate, narrow to a screen, and move between screens and components', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let saved = false;
    await page.route('**/api/components', (route) => route.fulfill({ json: { components: saved ? components : null, status: { state: saved ? 'current' : 'missing' } } }));
    await page.route('**/api/components/generate', (route) => {
        saved = true;
        return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'result', components, status: { state: 'current' } }) + '\n' });
    });
    await page.goto('/');
    await page.getByRole('tab', { name: 'Components', exact: true }).click();
    await expect(page.locator('#view-missing h2')).toHaveText("The components view doesn't exist for this map");
    await page.locator('#view-missing').getByRole('button', { name: 'Generate', exact: true }).click();
    await expect(page.locator('#components-status')).toHaveText('Component map saved.');
    // All roots: both pages on top, no screen boxes
    await expect(page.locator('#components-svgbox .fn')).toHaveCount(3);
    await expect(page.locator('#components-svgbox [data-id="cart"]')).toHaveCount(0);
    await page.getByLabel('Show', { exact: true }).selectOption('cart');
    await expect(page.locator('#components-svgbox .fn')).toHaveCount(2);
    await page.locator('#components-svgbox [data-id="price-line"]').press('Enter');
    const panel = page.getByRole('complementary', { name: 'Component details' });
    await expect(panel.getByRole('heading', { name: 'PriceLine', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: /^Used in/ }).click();
    await panel.getByRole('region', { name: 'Screens using this component' }).getByRole('button', { name: 'Checkout /checkout' }).click();
    // Used in → the screen on the Sitemap view
    await expect(page.getByRole('tab', { name: 'Sitemap', exact: true })).toHaveAttribute('aria-selected', 'true');
    const details = page.getByRole('complementary', { name: 'Screen details' });
    await expect(details.getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible();
    // the screen's root components → back to the Components view, scoped to it
    await details.getByRole('button', { name: /^Components/ }).click();
    await details.getByRole('region', { name: 'Root components' }).getByRole('button', { name: /CheckoutPage/ }).click();
    await expect(page.getByRole('tab', { name: 'Components', exact: true })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Show', { exact: true })).toHaveValue('checkout');
    await expect(page.getByRole('complementary', { name: 'Component details' }).getByRole('heading', { name: 'CheckoutPage', exact: true })).toBeVisible();
    expect(errors).toEqual([]);
});

test('search finds screens on the Sitemap and components on Components, in the side panel', async ({ page }) => {
    await page.route('**/api/components', (route) => route.fulfill({ json: { components, status: { state: 'current' } } }));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByRole('tab', { name: 'Sitemap', exact: true }).click();
    await page.locator('#sitemap-search-toggle').click();
    const sitemapSearch = page.getByRole('combobox', { name: 'Find a screen' });
    await expect(sitemapSearch).toBeFocused();
    await sitemapSearch.fill('/checkout');
    await expect(page.locator('#sitemap-svgbox .fn.match')).toHaveCount(1);
    await sitemapSearch.press('Enter');
    await expect(page.getByRole('complementary', { name: 'Screen details' }).getByRole('heading', { name: 'Checkout', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Matching screens' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#sitemap-details')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Components', exact: true }).click();
    await page.getByLabel('Show', { exact: true }).selectOption('cart');
    await page.keyboard.press('Control+k');
    const search = page.getByRole('combobox', { name: 'Find a component' });
    await expect(search).toBeFocused();
    await expect(page.getByRole('listbox', { name: 'Matching components' }).locator('h4')).toHaveText(['Roots', 'Other components']);
    await search.fill('order form');
    await search.press('Enter');
    // CheckoutPage is not on the Cart screen, so the diagram widens to show it
    await expect(page.getByRole('complementary', { name: 'Component details' }).getByRole('heading', { name: 'CheckoutPage', exact: true })).toBeVisible();
    await expect(page.locator('#components-svgbox [data-id="checkout-page"]')).toHaveCount(1);
    await page.getByRole('button', { name: '← Results' }).click();
    await expect(search).toHaveValue('order form');
});

test('regenerating the sitemap from Settings shows progress in the diagram area until Stop', async ({ page }) => {
    await page.route('**/api/components', (route) => route.fulfill({ json: { components, status: { state: 'current' } } }));
    // The job never answers, so it is still running when we look.
    await page.route('**/api/sitemap/generate', () => {});
    await page.goto('/');
    await page.getByRole('tab', { name: 'Sitemap', exact: true }).click();
    await expect(page.locator('#sitemap-svgbox .fn')).toHaveCount(2);
    // no generation button on the toolbar; Search is last on the right
    await expect(page.locator('#sitemap-redraw')).toHaveCount(0);
    await expect(page.locator('#sitemap-workspace .flow-actions > :last-child')).toHaveId('sitemap-search-toggle');
    await page.locator('#tab-map').click();
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    const row = settings.getByRole('region', { name: 'Sitemap' });
    await row.getByRole('button', { name: 'Regenerate sitemap' }).click();
    await row.getByRole('button', { name: 'Confirm regenerate' }).click();
    await expect(row.getByRole('button', { name: 'Stop' })).toBeVisible();
    await settings.locator('#settings-close').click();
    const progress = page.locator('#view-generating');
    await expect(progress.getByRole('heading', { name: 'Regenerating the sitemap…' })).toBeVisible();
    await expect(page.locator('#sitemap-workspace')).toHaveCount(0);
    await progress.getByRole('button', { name: 'Stop' }).click();
    await expect(page.locator('#sitemap-svgbox .fn')).toHaveCount(2);
});
