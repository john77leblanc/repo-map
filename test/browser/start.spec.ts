import { test, expect } from '@playwright/test';

const catalog = {
    agents: [{ id: 'codex', label: 'Codex CLI', available: true, defaultModel: 'gpt-6.1-sol', models: [{ id: 'gpt-6.1-mini' }], efforts: ['low', 'high'] }],
    default: { agent: 'codex' },
    generate: { agent: 'codex' },
    generateSet: false,
};
const map = {
    groups: [{ id: 'g', col: 1, title: 'App', open: true }],
    nodes: [{ id: 'app', group: 'g', kind: 'service', path: 'src', title: 'App', desc: 'The app.' }],
    edges: [],
};
const sitemap = { version: 1, applicability: 'applicable', summary: 'Screens.', gaps: [], applications: [{ id: 'shop', label: 'Shop' }],
    screens: [{ id: 'home', app: 'shop', label: 'Home', route: '/', detail: '', refs: [] }], navigation: [] };
const setupInfo = { name: 'shop map', codeRoots: ['src/'], context: '', dirs: [{ path: 'scripts/', suggested: false }, { path: 'src/', suggested: true }] };
const ndjson = (...events: unknown[]) => events.map((e) => JSON.stringify(e)).join('\n') + '\n';

test('first run walks the onboarding steps, then builds the map and sitemap', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let built = false;
    const calls: string[] = [];
    await page.route('**/api/traces', (route) => route.fulfill({ json: { traces: [] } }));
    await page.route('**/api/agents*', (route) => route.fulfill({ json: catalog }));
    await page.route('**/api/map/status', (route) => route.fulfill({ json: { state: built ? 'current' : 'empty', docs: {} } }));
    await page.route('**/api/map', (route) => route.fulfill({ json: built ? map : { groups: [], nodes: [], edges: [] } }));
    await page.route('**/api/settings/generate', (route) => { calls.push('settings ' + route.request().postData()); return route.fulfill({ json: { ok: true } }); });
    await page.route('**/api/settings/trace', (route) => { calls.push('trace ' + route.request().postData()); return route.fulfill({ json: { ok: true } }); });
    await page.route('**/api/setup', (route) => {
        if (route.request().method() === 'PUT') calls.push('setup ' + route.request().postData());
        return route.fulfill({ json: setupInfo });
    });
    await page.route('**/api/map/generate', (route) => {
        calls.push('map');
        built = true;
        return route.fulfill({ contentType: 'application/x-ndjson',
            body: ndjson({ type: 'progress', text: 'Reading code' }, { type: 'result', job: 'generate', check: { counts: { nodes: 1, edges: 0 } } }) });
    });
    await page.route('**/api/sitemap/generate', (route) => {
        calls.push('sitemap');
        return route.fulfill({ contentType: 'application/x-ndjson', body: ndjson({ type: 'result', sitemap, status: { state: 'current' } }) });
    });
    await page.route('**/api/sitemap', (route) => route.fulfill({ json: { sitemap: calls.includes('sitemap') ? sitemap : null, status: { state: 'missing' } } }));

    await page.goto('/');
    // 1. project
    await expect(page.getByRole('heading', { name: 'Set up repo-map' })).toBeVisible();
    await expect(page.getByLabel('Map name')).toHaveValue('shop map');
    await page.getByRole('checkbox', { name: /^scripts\// }).check();
    await page.getByLabel(/What is this repo/).fill('A demo shop.');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect.poll(() => calls.find((c) => c.startsWith('setup'))).toContain('scripts/');
    // 2. AI tools: a separate model for the map
    await expect(page.getByRole('heading', { name: 'Choose AI tools' })).toBeVisible();
    await page.getByRole('checkbox', { name: /Use the same for the map/ }).uncheck();
    await page.getByRole('combobox', { name: 'AI tool and model for the map' }).selectOption({ label: 'Codex CLI · gpt-6.1-mini' });
    await expect.poll(() => calls.some((c) => c.startsWith('settings') && c.includes('gpt-6.1-mini'))).toBe(true);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect.poll(() => calls.some((c) => c.startsWith('trace') && c.includes('codex'))).toBe(true);
    // 3. build
    await expect(page.getByRole('heading', { name: /Build the map/ })).toBeVisible();
    const box = page.getByRole('checkbox', { name: /Also build the sitemap/ });
    await expect(box).not.toBeChecked();
    await box.check();
    await page.getByRole('button', { name: 'Build' }).click();
    // both jobs finish; the screen gives way to the map
    await expect(page.getByRole('tab', { name: 'Architecture', exact: true })).toBeVisible();
    expect(calls).toContain('map');
    expect(calls).toContain('sitemap');
    await page.getByRole('tab', { name: 'Sitemap', exact: true }).click();
    await expect(page.locator('#sitemap-workspace')).toContainText('Home');
    expect(errors).toEqual([]);
});

test('without an AI tool onboarding offers the folder map', async ({ page }) => {
    let built = false;
    await page.route('**/api/traces', (route) => route.fulfill({ json: { traces: [] } }));
    await page.route('**/api/agents*', (route) => route.fulfill({ json: { agents: [], generate: null, generateReason: 'No AI tool found.' } }));
    await page.route('**/api/map/status', (route) => route.fulfill({ json: { state: built ? 'starter' : 'empty', docs: {} } }));
    await page.route('**/api/map', (route) => route.fulfill({ json: built ? { ...map, starter: true } : { groups: [], nodes: [], edges: [] } }));
    await page.route('**/api/map/starter', (route) => { built = true; return route.fulfill({ json: { nodes: 1 } }); });
    await page.route('**/api/setup', (route) => route.fulfill({ json: setupInfo }));
    await page.goto('/');
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByText(/No AI tool found on this machine/)).toBeVisible();
    await page.getByRole('button', { name: 'Continue without AI' }).click();
    await expect(page.getByRole('button', { name: 'Build' })).toBeDisabled();
    await expect(page.getByText('No AI tool found.').first()).toBeVisible();
    await page.getByRole('button', { name: 'Start from folders instead' }).click();
    await expect(page.getByRole('tab', { name: 'Architecture', exact: true })).toBeVisible();
});
