import { test as base, expect, type Page } from '@playwright/test';

// Every scenario reports browser failures, including errors during initial bootstrap.
const test = base.extend<{ browserErrors: void }>({
    browserErrors: [async ({ page }, use) => {
        // Layout tests must also run without access to the optional web fonts.
        await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        await use();
        expect(errors, 'Browser console errors and uncaught exceptions').toEqual([]);
    }, { auto: true }],
});

test.use({ reducedMotion: 'reduce' });

async function openMap(page: Page) {
    await page.goto('/');
    await expect(page.locator('#architecture-workspace')).toBeVisible();
    await expect(page.locator('.node[data-id="shopper"] .nh')).toBeVisible();
    await expect.poll(() => page.locator('.wires path.w').count()).toBeGreaterThan(0);
}

test('desktop architecture keeps its header inset beneath the repository tabs', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMap(page);
    const header = page.locator('#architecture-workspace > header.top');
    await expect(header.locator('.canvas-controls > .controls')).toBeVisible();
    const main = await page.locator('#architecture-workspace').boundingBox();
    const tabs = await page.getByRole('tablist', { name: 'Repository views' }).boundingBox();
    const search = await page.getByRole('searchbox', { name: 'Find a node' }).boundingBox();
    expect(main).not.toBeNull(); expect(search).not.toBeNull();
    expect(main!.y).toBeCloseTo(tabs!.y + tabs!.height, 0);
    expect(search!.x - main!.x).toBeCloseTo(28, 0);
    expect(search!.y - main!.y).toBeCloseTo(24, 0);
});

test('node inspector closes with its button, Escape and the scoped backdrop', async ({ page }) => {
    await openMap(page);
    const node = page.locator('.node[data-id="shopper"] .nh');
    const inspector = page.locator('#arch-details');
    const shade = page.locator('.arch-details-shade');
    for (const close of ['button', 'escape', 'backdrop'] as const) {
        await node.click();
        await expect(inspector).toBeVisible();
        await expect(inspector).toHaveAttribute('open', '');
        await expect(inspector).toHaveAttribute('aria-modal', 'false');
        await expect(node).toHaveAttribute('aria-expanded', 'true');
        await expect(inspector.getByRole('heading', { name: 'Shopper', exact: true })).toBeVisible();
        await expect(inspector.getByRole('button', { name: 'Close details' })).toBeFocused();
        await expect(shade).toBeVisible();
        if (close === 'button') await inspector.getByRole('button', { name: 'Close details' }).click();
        else if (close === 'escape') await page.keyboard.press('Escape');
        else await shade.click({ position: { x: 4, y: 4 } });
        await expect(inspector).toBeHidden();
        await expect(inspector).not.toHaveAttribute('open');
        await expect(node).toHaveAttribute('aria-expanded', 'false');
        await expect(shade).toBeHidden();
    }
    // The overlay stays inside architecture and leaves library controls usable.
    await node.click();
    await page.getByRole('button', { name: 'Collapse panel', exact: true }).click();
    await expect(page.locator('.app')).toHaveClass(/collapsed/);
    await expect(inspector).toBeVisible();
});

test('diagram key controls each connection type and remains independent of the inspector', async ({ page }) => {
    await openMap(page);
    const toggle = page.locator('#architecture-key-toggle');
    const key = page.locator('#architecture-key');
    await expect(key).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await expect(key).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    for (const type of ['http', 'event', 'sync']) {
        const chip = key.locator(`[data-type="${type}"]`);
        const wires = page.locator(`.wires path.w.${type}`);
        await expect(chip).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => wires.count()).toBeGreaterThan(0);
        await chip.click();
        await expect(chip).toHaveAttribute('aria-pressed', 'false');
        await expect(wires).toHaveCount(0);
        await chip.click();
        await expect(chip).toHaveAttribute('aria-pressed', 'true');
        await expect.poll(() => wires.count()).toBeGreaterThan(0);
    }
    await toggle.click();
    await expect(key).toBeHidden();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('#arch-details')).toBeHidden();
});

test('search expands matching groups and Enter opens the matching node', async ({ page }) => {
    await openMap(page);
    const groups = page.locator('#cols details.grp');
    await page.getByRole('button', { name: 'Collapse groups', exact: true }).click();
    await expect(page.locator('#cols details.grp[open]')).toHaveCount(0);
    const search = page.getByRole('searchbox', { name: 'Find a node' });
    await search.fill('CART STORE');
    await expect(page.locator('details[data-g="g-state"]')).toHaveAttribute('open', '');
    await expect(page.locator('.node.match')).toHaveCount(1);
    await expect(page.locator('.node[data-id="cart-store"]')).toHaveClass(/match/);
    await search.press('Enter');
    await expect(page.locator('#arch-details')).toBeVisible();
    await expect(page.locator('#arch-details-title')).toHaveText('cart store');
    await page.keyboard.press('Escape');
    await search.fill('no-such-component');
    await expect(page.locator('.node.match')).toHaveCount(0);
    await search.press('Enter');
    await expect(page.locator('#arch-details')).toBeHidden();
    await search.clear();
    await page.getByRole('button', { name: 'Expand groups', exact: true }).click();
    await expect(page.locator('#cols details.grp[open]')).toHaveCount(await groups.count());
});

test('sidebar supports pointer and keyboard resize, reset and persisted collapse', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMap(page);
    const resize = page.getByRole('separator', { name: 'Resize library' });
    const side = page.getByRole('complementary', { name: 'Repository library' });
    await expect(resize).toHaveAttribute('aria-valuenow', '300');
    const handle = await resize.boundingBox();
    expect(handle).not.toBeNull();
    await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + 100);
    await page.mouse.down();
    await page.mouse.move(420, handle!.y + 100, { steps: 5 });
    await page.mouse.up();
    await expect(resize).toHaveAttribute('aria-valuenow', '420');
    await expect(page.locator('body')).not.toHaveClass(/dragging/);
    await expect.poll(async () => Math.round((await side.boundingBox())!.width)).toBe(420);
    await resize.focus(); await page.keyboard.press('ArrowRight');
    await expect(resize).toHaveAttribute('aria-valuenow', '440');
    await page.keyboard.press('ArrowLeft');
    await expect(resize).toHaveAttribute('aria-valuenow', '420');
    await page.reload();
    await expect(resize).toHaveAttribute('aria-valuenow', '420');
    await resize.dblclick();
    await expect(resize).toHaveAttribute('aria-valuenow', '300');
    const collapse = page.getByRole('button', { name: 'Collapse panel', exact: true });
    await collapse.click();
    await expect(page.locator('.app')).toHaveClass(/collapsed/);
    await expect(page.getByRole('button', { name: 'Expand panel', exact: true })).toHaveAttribute('aria-expanded', 'false');
    await expect(resize).toBeHidden();
    await expect(page.locator('#sidebar-home')).toBeHidden();
    await page.reload();
    await expect(page.locator('.app')).toHaveClass(/collapsed/);
    await page.getByRole('button', { name: 'Expand panel', exact: true }).click();
    await expect(page.locator('.app')).not.toHaveClass(/collapsed/);
    await expect(page.locator('#sidebar-home')).toBeVisible();
    await expect(resize).toBeVisible();
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 900, height: 700 }, { width: 390, height: 844 }]) {
    test(`canvas scrolls to its bottom and right edge at ${viewport.width}px without escaping the viewport`, async ({ page }) => {
        await page.setViewportSize(viewport);
        // Extend the real shop map in this test only, making vertical overflow deterministic.
        await page.route('**/api/map', async route => {
            const response = await route.fetch();
            const map = await response.json();
            map.nodes.push(...Array.from({ length: 32 }, (_, i) => ({ id: `e2e-row-${i}`, title: `Scroll row ${i}`, group: 'g-people', kind: 'service', desc: 'Canvas overflow regression fixture.' })));
            await route.fulfill({ response, json: map });
        });
        await openMap(page);
        await page.getByRole('button', { name: 'Expand groups', exact: true }).click();
        const scroller = page.locator('#scroller');
        await expect.poll(() => scroller.evaluate(el => el.scrollHeight > el.clientHeight && el.scrollWidth > el.clientWidth)).toBe(true);
        const bounds = await scroller.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds!.height).toBeGreaterThan(100);
        expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height + 1);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width + 1);
        await scroller.evaluate(el => { el.scrollTop = el.scrollHeight; el.scrollLeft = 0; });
        await expect.poll(() => scroller.evaluate(el => Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop))).toBeLessThanOrEqual(1);
        const last = await page.locator('.node[data-id="e2e-row-31"]').boundingBox();
        expect(last).not.toBeNull();
        expect(last!.y).toBeGreaterThanOrEqual(bounds!.y);
        expect(last!.y + last!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
        await scroller.evaluate(el => { el.scrollLeft = el.scrollWidth; });
        await expect.poll(() => scroller.evaluate(el => Math.abs(el.scrollWidth - el.clientWidth - el.scrollLeft))).toBeLessThanOrEqual(1);
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
        if (viewport.width < 760) {
            await page.getByRole('button', { name: 'Collapse panel', exact: true }).click();
            await expect(page.locator('#sidebar-home')).toBeHidden();
            const expandedCanvas = await scroller.boundingBox();
            expect(expandedCanvas!.height).toBeGreaterThan(bounds!.height);
            await page.getByRole('button', { name: 'Expand panel', exact: true }).click();
            await expect(page.locator('#sidebar-home')).toBeVisible();
        }
    });
}

test('proposal labels target unique base wire IDs while focus overlays have no IDs', async ({ page }) => {
    await openMap(page);
    await page.getByRole('button', { name: /^Add product page under src\/pages/ }).click();
    const proposed = page.locator('.node[data-id="proposal:product-page"] .nh');
    await expect(proposed).toBeVisible();
    await expect.poll(() => page.locator('#wires-top textPath').count()).toBeGreaterThan(0);
    for (const focus of ['hover', 'selected'] as const) {
        if (focus === 'hover') await proposed.hover();
        else await proposed.click();
        await expect.poll(() => page.locator('#wires-top path.w.on').count()).toBeGreaterThan(0);
        await expect(page.locator('#wires-top path.w[id]')).toHaveCount(0);
        const invalid = await page.evaluate(() => {
            const ids = Array.from(document.querySelectorAll('[id]')).map(el => el.id);
            const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
            const brokenLabels = Array.from(document.querySelectorAll('#wires-top textPath')).filter(label => {
                const href = label.getAttribute('href');
                const target = href?.startsWith('#') ? document.getElementById(href.slice(1)) : null;
                return !target || target.parentElement?.id !== 'wires';
            }).length;
            return { duplicates, brokenLabels };
        });
        expect(invalid).toEqual({ duplicates: [], brokenLabels: 0 });
    }
});
