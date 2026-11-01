import { test, expect } from '@playwright/test';

const sitemap = {
    version: 1, applicability: 'applicable', summary: 'Storefront screens.', gaps: [],
    applications: [{ id: 'shop', label: 'Storefront' }],
    screens: [{ id: 'cart', app: 'shop', label: 'Cart', route: '/cart', detail: '', refs: [] }],
    navigation: [],
};
const base = {
    version: 1, applicability: 'applicable', summary: 'The cart and its parts.', gaps: [],
    components: [
        { id: 'cart-page', label: 'CartPage', detail: 'Cart items.', tags: ['state'], refs: [] },
        { id: 'price-line', label: 'PriceLine', detail: 'A formatted price.', tags: [], refs: [] },
        { id: 'footer', label: 'Footer', detail: 'Links.', tags: [], refs: [] },
    ],
    uses: [{ from: 'cart-page', to: 'price-line' }],
    screens: [{ screen: 'cart', root: 'cart-page' }],
};
const components = {
    version: 1, base, applicability: 'relevant', summary: 'A coupon field on the cart.', gaps: [],
    involved: [{ id: 'cart-page', note: 'Shows the cart total.', refs: [] }, { id: 'price-line', note: 'Formats the discount.', refs: [] }],
    changes: {
        components: [{ id: 'proposal-coupon', label: 'CouponField', detail: 'Enter a code.', tags: ['form'], refs: [], status: 'new', rationale: 'Let people apply a code.' }],
        uses: [{ from: 'cart-page', to: 'proposal-coupon', status: 'new', rationale: 'Under the total.' }],
    },
};
const trace = { key: 'component-trace-1234', title: 'Coupon field', prompt: 'Add a coupon field', intent: 'proposal', summary: 'Coupons on the cart.',
    steps: [], edges: [], refs: [], outputs: { architecture: false, flowchart: false, components: true }, components };

test('a Components trace output: its components, marked changes, and steps in the panel', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route('**/api/traces', (route) => route.fulfill({ json: { traces: [trace] } }));
    await page.route('**/api/sitemap', (route) => route.fulfill({ json: { sitemap, status: { state: 'current' } } }));
    await page.route('**/api/components', (route) => route.fulfill({ json: { components: base, status: { state: 'current' } } }));
    await page.goto('/');
    await page.locator('.trace-open').click();
    await page.getByRole('tab', { name: 'Components', exact: true }).click();
    await expect(page.getByRole('tab', { name: 'Components', exact: true })).toHaveAttribute('aria-selected', 'true');
    // This trace: the involved and changed components only
    await expect(page.getByLabel('Show', { exact: true })).toHaveValue('trace');
    await expect(page.locator('#components-svgbox .fn')).toHaveCount(3);
    await expect(page.locator('#components-svgbox [data-id="footer"]')).toHaveCount(0);
    await expect(page.locator('#components-svgbox .change-new.fn')).toHaveCount(1);
    await expect(page.locator('#components-svgbox .change-new.fe')).toHaveCount(1);
    await page.locator('#components-svgbox [data-id="cart-page"]').press('Enter');
    const panel = page.getByRole('complementary', { name: 'Component details' });
    await expect(panel.locator('.trace-step')).toContainText('1 of 2');
    await expect(panel.getByRole('region', { name: 'Proposed render links' })).toContainText('CartPage renders CouponField');
    await panel.locator('#components-step-next').click();
    await expect(panel.getByRole('heading', { name: 'PriceLine', exact: true })).toBeVisible();
    // All roots: the whole snapshot with the change
    await page.getByLabel('Show', { exact: true }).selectOption('*');
    await expect(page.locator('#components-svgbox [data-id="footer"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Diagram key' }).click();
    await expect(page.locator('#components-key [data-proposal-key]')).toBeVisible();
    expect(errors).toEqual([]);
});
