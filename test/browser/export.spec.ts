import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const sitemap = {
    version: 1, applicability: 'applicable', summary: 'Storefront screens.', gaps: [],
    applications: [{ id: 'shop', label: 'Storefront' }],
    screens: [
        { id: 'cart', app: 'shop', label: 'Cart', route: '/cart', detail: 'Review items.', refs: [] },
        { id: 'checkout', app: 'shop', label: 'Checkout', route: '/checkout', detail: 'Pay.', refs: [] },
    ],
    navigation: [{ from: 'cart', to: 'checkout', label: 'Checkout', condition: '', refs: [] }],
};

test.beforeEach(async ({ page }) => {
    await page.route('**/api/traces', (route) => route.fulfill({ json: { traces: [] } }));
    await page.route('**/api/map/status', (route) => route.fulfill({ json: { state: 'current', docs: { linked: true } } }));
    await page.route('**/api/sitemap', (route) => route.fulfill({ json: { sitemap, status: { state: 'current' } } }));
});

async function exportAs(page: Page, label: string) {
    const downloadEvent = page.waitForEvent('download');
    await page.locator('#sitemap-export').click();
    await page.getByRole('button', { name: label, exact: true }).click();
    const download = await downloadEvent;
    return { name: download.suggestedFilename(), data: await readFile((await download.path())!) };
}

test('sitemap exports PNG, PDF and offline HTML', async ({ page, browser }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page.getByRole('tab', { name: 'Sitemap', exact: true }).click();
    await expect(page.locator('#sitemap-svgbox .fn')).toHaveCount(2);
    const width = Number(await page.locator('#sitemap-svgbox svg.fc').getAttribute('width'));

    const png = await exportAs(page, 'Download PNG');
    expect(png.name).toBe('shop-map-sitemap.png');
    expect(png.data.subarray(0, 4).toString('hex')).toBe('89504e47');
    // IHDR width, rendered at 2x.
    expect(png.data.readUInt32BE(16)).toBe(Math.round(width * 2));

    const pdf = await exportAs(page, 'Download PDF');
    expect(pdf.name).toBe('shop-map-sitemap.pdf');
    const text = pdf.data.toString('latin1');
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toContain('/BaseFont /IBM#20Plex#20Sans');
    expect(text).toContain('/FontFile2');
    const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(text);
    expect(Number(box?.[1])).toBeCloseTo(width * 0.75, 0);

    const html = await exportAs(page, 'Download HTML');
    expect(html.name).toBe('shop-map-sitemap.html');
    const offline = await browser.newContext({ offline: true });
    const view = await offline.newPage();
    const requests: string[] = [];
    view.on('request', (request) => { if (!request.url().startsWith('data:')) requests.push(request.url()); });
    await view.setContent(html.data.toString('utf8'));
    await expect(view.locator('#stage svg.fc')).toBeVisible();
    await expect(view.locator('#stage')).toContainText('Checkout');
    const before = await view.locator('#zoom').textContent();
    await view.getByRole('button', { name: 'Zoom in' }).click();
    await expect(view.locator('#zoom')).not.toHaveText(before!);
    // The embedded font loads from its data URL with no network.
    expect(await view.evaluate(async () => (await document.fonts.load('600 12px "IBM Plex Sans"')).length)).toBeGreaterThan(0);
    expect(requests).toEqual([]);
    await offline.close();
    expect(errors).toEqual([]);
});
