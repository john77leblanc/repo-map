import { test, expect } from '@playwright/test';

test('edit replaces a saved trace only after all requested outputs arrive and preserves canceled drafts', async ({ page }) => {
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
    let saved = { key: 'editable-trace-123', createdAt: 123, title: 'Checkout', prompt: 'How does checkout work?',
        summary: 'Checkout', steps: [{ id: 'checkout-page', note: 'Place an order' }], edges: [], refs: [],
        outputs: { architecture: true, flowchart: false } };
    let replacements = 0;
    await page.route('**/api/traces', route => route.fulfill({ json: { traces: [saved] } }));
    await page.route('**/api/traces/editable-trace-123', route => {
        expect(route.request().method()).toBe('PUT');
        saved = { ...route.request().postDataJSON(), key: saved.key };
        replacements++;
        return route.fulfill({ json: { key: saved.key } });
    });
    await page.route('**/api/trace', route => {
        const body = route.request().postDataJSON();
        expect(body.previousTrace.prompt).toBe('How does checkout work?');
        expect(body.prompt).toBe('How does checkout handle failures?');
        return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'result', trace: {
            ...saved, title: 'Checkout failures', summary: 'Failures explained',
        } }) + '\n' });
    });
    await page.goto('/');
    await page.locator('.trace-open').click();
    await page.locator('#trace-prompt').click();
    await expect(page.locator('#trace-editor')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.locator('#trace-prompt')).toBeFocused();
    await page.locator('#trace-prompt').fill('How does checkout handle failures?');
    await page.locator('#withflow').check();
    await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
    await expect(page.locator('#status')).toContainText('Not all requested outputs');
    expect(replacements).toBe(0);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.locator('#trace-prompt')).toHaveText('How does checkout work?');
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.locator('#trace-prompt')).toHaveValue('How does checkout handle failures?');
    await expect(page.locator('#withflow')).toBeChecked();
    await page.locator('#withflow').uncheck();
    await page.getByRole('button', { name: 'Regenerate', exact: true }).click();
    await expect(page.locator('#trace-title')).toHaveText('Checkout failures');
    expect(replacements).toBe(1);
    expect(saved.createdAt).toBe(123);
    await page.reload();
    await page.locator('.trace-open').click();
    await expect(page.locator('#trace-prompt')).toHaveText('How does checkout handle failures?');
    expect(errors).toEqual([]);
});
