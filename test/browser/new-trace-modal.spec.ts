import { test, expect } from '@playwright/test';

test('New trace opens a modal with stacked outputs, accessible tooltips and a retained draft', async ({ page }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    await page.route('**/api/config', async route => {
        const response = await route.fetch();
        await route.fulfill({ json: { ...await response.json(), ai: { available: true, label: 'Test AI' } } });
    });
    await page.route('**/api/agents', route => route.fulfill({ json: {
        agents: [{ id: 'api', label: 'Test AI', available: true, models: [], efforts: [] }], default: { agent: 'api' },
    } }));
    await page.route('**/api/traces', route => route.fulfill({ json: { traces: [] } }));
    await page.goto('/');
    const trigger = page.getByRole('button', { name: 'New trace', exact: true });
    const modal = page.getByRole('dialog', { name: 'New trace' });
    await trigger.click();
    await expect(modal).toBeVisible();
    await expect(page.locator('#prompt')).toBeFocused();
    await page.locator('#prompt').fill('How does checkout handle failures?');
    const boxes = await modal.getByRole('checkbox').all();
    expect(boxes).toHaveLength(3);
    const bounds = await Promise.all(boxes.map(box => box.boundingBox()));
    for (let i = 1; i < bounds.length; i++) {
        expect(bounds[i]!.x).toBeCloseTo(bounds[0]!.x, 0);
        expect(bounds[i]!.y).toBeGreaterThan(bounds[i - 1]!.y + bounds[i - 1]!.height);
    }
    await expect(modal.getByRole('tooltip')).toHaveCount(0);
    await modal.getByRole('button', { name: 'About Flowchart', exact: true }).hover();
    await expect(modal.getByRole('tooltip')).toHaveText('Shows decisions and outcomes in the process.');
    await modal.getByRole('button', { name: 'About Flowchart', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(modal.getByRole('tooltip')).toHaveCount(0);
    await expect(modal).toBeVisible();
    for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab');
        const focus = await modal.evaluate(element => ({ inside: element.contains(document.activeElement), tag: document.activeElement?.tagName, id: document.activeElement?.id }));
        expect(focus.inside || focus.tag === 'BODY', JSON.stringify(focus)).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath('new-trace-modal.png') });
    await modal.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(modal).toBeHidden();
    await expect(trigger).toBeFocused();
    await trigger.click();
    await expect(page.locator('#prompt')).toHaveValue('How does checkout handle failures?');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(modal).toBeVisible();
    const mobileBounds = await modal.boundingBox();
    expect(mobileBounds!.x).toBeGreaterThanOrEqual(0);
    expect(mobileBounds!.x + mobileBounds!.width).toBeLessThanOrEqual(390);
    await page.screenshot({ path: testInfo.outputPath('new-trace-modal-mobile.png') });
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    expect(errors).toEqual([]);
});
