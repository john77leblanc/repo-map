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

/** Open (or close) every group with the one groups button, whatever state it starts in. */
async function setAllGroups(page: Page, open: boolean) {
    const button = page.locator('#groups-toggle');
    if ((await button.textContent())?.trim() === 'Expand all') await button.click();
    await expect(button).toHaveText('Collapse all');
    if (!open) {
        await button.click();
        await expect(button).toHaveText('Expand all');
    }
}

async function openMap(page: Page) {
    await page.goto('/');
    await expect(page.locator('#architecture-workspace')).toBeVisible();
    await expect(page.locator('.node[data-id="shopper"] .nh')).toBeVisible();
    await expect.poll(() => page.locator('.wires path.w').count()).toBeGreaterThan(0);
}

test('desktop architecture keeps its header inset beneath the view tabs', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMap(page);
    const header = page.locator('#architecture-workspace > header.top');
    await expect(header.locator('.canvas-controls > .controls')).toBeVisible();
    const main = await page.locator('#architecture-workspace').boundingBox();
    const tabs = await page.locator('.view-tabs').boundingBox();
    // The groups button comes first; Search sits last, against the right edge.
    const first = await header.locator('.controls > *').first().boundingBox();
    const search = await page.locator('#arch-search-toggle').boundingBox();
    expect(main).not.toBeNull(); expect(first).not.toBeNull(); expect(search).not.toBeNull();
    await expect(header.locator('.controls > *').first()).toHaveAttribute('id', 'groups-toggle');
    // The scope switch leads the view row, before a divider and the view tabs.
    await expect(page.locator('.view-tabs > *').first()).toHaveAttribute('aria-label', 'Map scope');
    await expect(page.locator('.view-tabs > .view-divider + .view-tablist')).toHaveCount(1);
    expect(main!.y).toBeCloseTo(tabs!.y + tabs!.height, 0);
    expect(first!.x - main!.x).toBeCloseTo(16, 0);
    expect(first!.y - main!.y).toBeCloseTo(12, 0);
    expect(main!.x + main!.width - (search!.x + search!.width)).toBeCloseTo(16, 0);
});

test('node details open in a side panel beside the map and close with the button or Escape', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMap(page);
    const node = page.locator('.node[data-id="shopper"] .nh');
    const panel = page.locator('#arch-details');
    await expect(panel).toHaveCount(0);
    for (const close of ['button', 'escape'] as const) {
        await node.click();
        await expect(panel).toBeVisible();
        await expect(page.locator('dialog#arch-details, .arch-details-shade')).toHaveCount(0);
        await expect(node).toHaveAttribute('aria-expanded', 'true');
        await expect(panel.getByRole('heading', { name: 'Shopper', exact: true })).toBeVisible();
        // The panel sits to the right of the map and never covers the selected card.
        const card = await node.boundingBox();
        const side = await panel.boundingBox();
        const map = await page.locator('#scroller').boundingBox();
        expect(side!.x).toBeGreaterThanOrEqual(map!.x + map!.width - 1);
        expect(card!.x + card!.width).toBeLessThanOrEqual(side!.x);
        if (close === 'button') await panel.getByRole('button', { name: 'Close' }).click();
        else await page.keyboard.press('Escape');
        await expect(panel).toHaveCount(0);
        await expect(node).toHaveAttribute('aria-expanded', 'false');
    }
    // Library controls stay usable while the panel is open.
    await node.click();
    await page.getByRole('button', { name: 'Collapse panel', exact: true }).click();
    await expect(page.locator('.app')).toHaveClass(/collapsed/);
    await expect(panel).toBeVisible();
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

test('search lists matches in the side panel; picking one opens it and Results goes back', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await openMap(page);
    const groups = page.locator('#cols details.grp');
    const panel = page.locator('#arch-details');
    await setAllGroups(page, false);
    await expect(page.locator('#cols details.grp[open]')).toHaveCount(0);
    await page.locator('#arch-search-toggle').click();
    const search = panel.getByRole('combobox', { name: 'Find a node' });
    await expect(search).toBeFocused();
    // Empty query: every card, by column then group.
    await expect(panel.locator('[role=option]')).toHaveCount(await page.locator('.node').count());
    await search.fill('CART STORE');
    await expect(page.locator('details[data-g="g-state"]')).toHaveAttribute('open', '');
    await expect(page.locator('.node.match')).toHaveCount(1);
    await expect(page.locator('.node[data-id="cart-store"]')).toHaveClass(/match/);
    await expect(panel.locator('[role=option]')).toHaveText(['cart store']);
    await search.press('Enter');
    await expect(page.locator('#arch-details-title')).toHaveText('cart store');
    await panel.getByRole('button', { name: '← Results' }).click();
    await expect(search).toHaveValue('CART STORE');
    await search.fill('cart');
    await search.press('ArrowDown');
    const second = panel.locator('[role=option][aria-selected=true]');
    const id = await second.getAttribute('data-hit');
    await search.press('Enter');
    await expect(panel).toHaveAttribute('data-id', id!);
    await page.keyboard.press('Escape');
    await expect(search).toBeVisible();
    await search.fill('no-such-component');
    await expect(page.locator('.node.match')).toHaveCount(0);
    await expect(panel.getByText('No nodes match.')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await page.keyboard.press('/');
    await expect(panel.getByRole('combobox', { name: 'Find a node' })).toBeFocused();
    await page.keyboard.press('Escape');
    // Search opened some groups, so the button offers Expand all again.
    await expect(page.locator('#groups-toggle')).toHaveText('Expand all');
    await page.locator('#groups-toggle').click();
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
        await setAllGroups(page, true);
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

test('node details panel stays on screen and scrolls on a short viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 420 });
    await openMap(page);
    await page.locator('.node[data-id="shopper"] .nh').click();
    const panel = page.locator('#arch-details');
    await expect(panel).toBeVisible();
    // pad the content so it must scroll
    await panel.locator('.arch-details-body').evaluate((body) => {
        const filler = document.createElement('div');
        filler.style.height = '2000px';
        body.append(filler);
    });
    const box = await panel.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(420);
    const scrolled = await panel.evaluate((aside) => { aside.scrollTop = 500; return aside.scrollTop; });
    expect(scrolled).toBe(500);
});
