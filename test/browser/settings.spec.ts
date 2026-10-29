import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const pick = { agent: 'codex', model: 'gpt-6.1-sol', effort: 'low' };
const namespace = 'repomap:settings-fixture:';
const initialStatus = () => ({
    state: 'stale', head: 'bbbbbbbbbbbb', commit: 'aaaaaaaaaaaa', changed: 1,
    files: ['src/checkout.ts'], commitsSince: 1, tooBig: false, job: null as string | null, updating: false,
    docs: { linked: true, changed: 0, files: [] as string[], commit: 'aaaaaaaaaaaa', generatedAt: '2026-01-02T00:00:00Z' },
});
async function mockSettings(page: Page) {
    const state = {
        off: false, status: initialStatus(), generate: null as Record<string, string> | null,
        saves: [] as Record<string, string>[], traceDefaults: [] as Record<string, string>[], jobs: [] as string[], unexpected: [] as string[],
    };
    // One API gate keeps this suite independent of local tools, saved traces, and AI services.
    await page.route('**/api/**', async route => {
        const request = route.request(), path = new URL(request.url()).pathname;
        const json = (value: unknown) => route.fulfill({ json: value });
        if (path === '/api/config') return json({ config: { name: 'settings-fixture', columns: [{ title: 'Code' }], kinds: { service: 'service' } }, repo: { branch: 'main', sha: 'bbbbbbbbbbbb' }, ai: { available: true, label: 'Codex CLI' } });
        if (path === '/api/map') return json({ groups: [{ id: 'code', col: 0, title: 'Code', open: true }], nodes: [{ id: 'checkout', group: 'code', kind: 'service', title: 'Checkout', path: 'src/checkout.ts' }], edges: [] });
        if (path === '/api/docs') return json({ links: {} });
        if (path === '/api/traces') return json([]);
        if (path === '/api/agents') return json({
            off: state.off, default: state.off ? null : pick, generate: state.off ? null : state.generate || pick,
            generateSet: !!state.generate, generateReason: state.off ? 'AI is disabled' : '',
            agents: [{ id: 'codex', label: 'Codex CLI', available: true, defaultModel: pick.model, models: [{ id: pick.model, efforts: ['low', 'high'] }], efforts: ['low', 'high'] }],
        });
        if (path === '/api/map/status') return json(state.status);
        if (path === '/api/workspace') return json({ workspace: { links: [], seams: [] }, repos: [], map: { groups: [], nodes: [], edges: [], repos: [], seams: [], replaced: {} } });
        if (path === '/api/settings/generate' && request.method() === 'PUT') {
            const body = request.postDataJSON() as Record<string, string>;
            state.saves.push(body); state.generate = body.agent ? body : null;
            return json({ ok: true });
        }
        if (path === '/api/settings/trace' && request.method() === 'PUT') {
            state.traceDefaults.push(request.postDataJSON() as Record<string, string>);
            return json({ ok: true });
        }
        if (['/api/map/generate', '/api/map/update', '/api/docs/link'].includes(path)) {
            state.jobs.push(path);
            return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'progress', text: 'Reading fixture code' }) + '\n' });
        }
        state.unexpected.push(request.method() + ' ' + path);
        return route.abort('blockedbyclient');
    });
    return state;
}
/** Show one Settings tab. */
async function show(page: Page, tab: 'map' | 'agents' | 'links') {
    const button = page.locator(`#settings-${tab}-tab`);
    await button.click();
    await expect(button).toHaveAttribute('aria-selected', 'true');
}
async function openSettings(page: Page) {
    await page.goto('/');
    await page.locator('#tab-map').click();
    await expect(page.getByRole('dialog', { name: 'Settings', exact: true })).toBeVisible();
    await show(page, 'agents');
    await expect(page.locator('#mpick-agent')).toContainText('Codex CLI');
    await show(page, 'map');
}

test('custom trace model and effort persist, and map settings use the generate API', async ({ page }) => {
    const state = await mockSettings(page); await openSettings(page);
    await expect(page.locator('#sidebar-home #repo-name, #sidebar-home #stat, #sidebar-home #repoinfo')).toHaveCount(0);
    await expect(page.locator('#settings-dialog #repo-name')).toHaveText('local repo');
    await expect(page.locator('#settings-dialog #stat')).toContainText('1 service');
    await expect(page.locator('#settings-dialog #repoinfo')).toHaveText('reading main @ bbbbbbbbb');
    // the library divider follows the sidebar's New trace button
    const button = await page.locator('#new-trace').boundingBox();
    const divider = await page.locator('.trace-library-divider').boundingBox();
    const library = await page.locator('#pane-traces').boundingBox();
    expect(divider!.y - button!.y - button!.height).toBeLessThanOrEqual(12);
    expect(library!.y - divider!.y - divider!.height).toBeLessThanOrEqual(12);
    await show(page, 'agents');
    await page.locator('#tpick-agent').selectOption(JSON.stringify(['codex', '*']));
    await page.locator('#tpick-custom').fill('gpt-custom');
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null')?.model, namespace + 'pick')).toBe('gpt-custom');
    await page.locator('#tpick-effort').selectOption('high');
    await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) || 'null'), namespace + 'pick')).toEqual({ agent: 'codex', model: 'gpt-custom', effort: 'high' });
    await page.reload(); await page.locator('#tab-map').click(); await show(page, 'agents');
    await expect(page.locator('#tpick-custom')).toHaveValue('gpt-custom');
    await expect(page.locator('#tpick-effort')).toHaveValue('high');
    await page.locator('#mpick-agent').selectOption(JSON.stringify(['codex', '*']));
    await page.locator('#mpick-custom').fill('map-custom');
    await expect.poll(() => state.saves.at(-1)?.model).toBe('map-custom');
    await expect(page.locator('#mpick-status')).toContainText('Saved for you');
    await page.locator('#mpick-effort').selectOption('low');
    await expect.poll(() => state.saves.at(-1)).toEqual({ agent: 'codex', model: 'map-custom', effort: 'low' });
    await expect(page.locator('#mpick-status')).toContainText('Saved for you');
    await page.reload(); await page.locator('#tab-map').click(); await show(page, 'agents');
    await expect(page.locator('#mpick-custom')).toHaveValue('map-custom');
    await expect(page.locator('#mpick-effort')).toHaveValue('low');
    await page.locator('#mpick-agent').selectOption('');
    await expect.poll(() => state.saves.at(-1)).toEqual({});
    expect(state.jobs).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('notice dismissal preserves the legacy key and a new issue notifies again', async ({ page }) => {
    const state = await mockSettings(page); await openSettings(page);
    await expect(page.locator('#tab-map-dot')).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss notification' }).click();
    const key = JSON.stringify({ state: 'stale', commit: 'aaaaaaaaaaaa', reason: '', changed: 1, files: ['src/checkout.ts'], docs: null });
    await expect.poll(() => page.evaluate(key => localStorage.getItem(key), namespace + 'dismissed-map-notice')).toBe(key);
    await expect(page.locator('#tab-map-dot')).toBeHidden();
    await page.reload(); await page.locator('#tab-map').click(); await show(page, 'map');
    await expect(page.locator('#tab-map-dot')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Dismiss notification' })).toBeHidden();
    state.status.changed = 2; state.status.files.push('src/payment.ts');
    await page.reload(); await page.locator('#tab-map').click(); await show(page, 'map');
    await expect(page.locator('#tab-map-dot')).toBeVisible();
    await expect(page.locator('#tab-map')).toHaveAttribute('aria-label', 'Settings: map needs attention');
    await expect(page.locator('#ms-text')).toContainText('2 files');
    expect(state.unexpected).toEqual([]);
});

test('redraw requires confirmation and Stop aborts an open NDJSON stream', async ({ page }) => {
    const state = await mockSettings(page);
    // Route.fulfill buffers a response. Keep the routed progress fixture's body open
    // after its bytes arrive, matching a server waiting on AI, and honor fetch's signal.
    await page.addInitScript(() => {
        const original = window.fetch.bind(window);
        window.fetch = async (input, options) => {
            const response = await original(input, options);
            if (String(input) !== '/api/map/generate') return response;
            const bytes = new Uint8Array(await response.arrayBuffer());
            const stream = new ReadableStream<Uint8Array>({ start(controller) {
                controller.enqueue(bytes);
                options?.signal?.addEventListener('abort', () => {
                    document.documentElement.dataset.fixtureStreamAborted = 'true';
                    controller.error(new DOMException('Stopped', 'AbortError'));
                }, { once: true });
            } });
            return new Response(stream, { status: response.status, headers: response.headers });
        };
    });
    await openSettings(page);
    await page.getByRole('button', { name: 'Redraw map', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Confirm redraw' })).toBeVisible();
    expect(state.jobs).toEqual([]);
    await page.getByRole('button', { name: 'Confirm redraw' }).click();
    await expect(page.locator('#job-status')).toContainText('Reading fixture code');
    await expect(page.locator('#ms-update')).toBeDisabled();
    await expect(page.locator('#ms-redraw')).toBeDisabled();
    await expect(page.locator('#ms-docs-go')).toBeDisabled();
    await page.locator('#job-stop').click();
    await expect(page.locator('#job-status')).toHaveText('Stopped.');
    await expect(page.locator('html')).toHaveAttribute('data-fixture-stream-aborted', 'true');
    await expect(page.locator('#job-stop')).toBeHidden();
    await expect(page.locator('#ms-redraw')).toBeEnabled();
    expect(state.jobs).toEqual(['/api/map/generate']); expect(state.unexpected).toEqual([]);
});

test('catalog off disables tracing even after a tool was available', async ({ page }) => {
    const state = await mockSettings(page); await openSettings(page);
    await page.locator('#settings-close').click(); await page.locator('#new-trace').click();
    await expect(page.locator('#prompt')).toBeEnabled();
    await page.locator('#trace-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('#tab-map').click(); await show(page, 'agents'); state.off = true;
    await page.locator('#tpick-refresh').click();
    await expect(page.locator('#tpick')).toBeHidden();
    await page.locator('#settings-close').click();
    await page.locator('#new-trace').click();
    await expect(page.locator('#prompt')).toBeDisabled();
    await expect(page.locator('#run')).toBeDisabled();
    expect(state.jobs).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('server jobs block map actions for every active job kind', async ({ page }) => {
    const state = await mockSettings(page);
    for (const job of ['update', 'generate', 'docs', 'sitemap']) {
        state.status.job = job; state.status.updating = job === 'update';
        await openSettings(page);
        await expect(page.locator('#ms-update')).toBeDisabled();
        await expect(page.locator('#ms-redraw')).toBeDisabled();
        await expect(page.locator('#ms-docs-go')).toBeDisabled();
        await expect(page.locator('#job-stop')).toBeHidden();
    }
    state.status.job = null; state.status.updating = true;
    await openSettings(page); await expect(page.locator('#ms-redraw')).toBeDisabled();
    state.status.updating = false;
    await openSettings(page); await expect(page.locator('#ms-redraw')).toBeEnabled();
    expect(state.jobs).toEqual([]); expect(state.unexpected).toEqual([]);
});

test('settings open on Map, remember the last tab, and the map notice opens Map', async ({ page }) => {
    const state = await mockSettings(page);
    state.status = { ...initialStatus(), state: 'current', changed: 0, files: [] };
    await page.goto('/');
    await page.locator('#tab-map').click();
    await expect(page.locator('#settings-map-tab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#mpick-agent')).toHaveCount(0);
    // fixed height across tabs; the tab row stays put while the panel scrolls
    const dialog = page.locator('#settings-dialog');
    const mapHeight = (await dialog.boundingBox())!.height;
    const tabTop = (await page.locator('#settings-map-tab').boundingBox())!.y;
    await page.locator('#settings-map').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    expect((await page.locator('#settings-map-tab').boundingBox())!.y).toBe(tabTop);
    await page.locator('#settings-map-tab').press('ArrowRight');
    expect((await dialog.boundingBox())!.height).toBe(mapHeight);
    await page.locator('#settings-agents-tab').press('ArrowLeft');
    await page.locator('#settings-map-tab').press('ArrowRight');
    await expect(page.locator('#settings-agents-tab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#mpick-agent')).toBeVisible();
    await page.locator('#settings-close').click();
    await page.locator('#tab-map').click();
    await expect(page.locator('#settings-agents-tab')).toHaveAttribute('aria-selected', 'true');
    await page.locator('#settings-close').click();
    state.status = initialStatus();
    await page.reload(); await page.locator('#tab-map').click();
    await expect(page.locator('#settings-map-tab')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#ms-update')).toBeVisible();
    expect(state.unexpected).toEqual([]);
});

test('Use in every repo saves the trace pick as the global default', async ({ page }) => {
    const state = await mockSettings(page); await openSettings(page); await show(page, 'agents');
    await page.locator('#tpick-default').click();
    await expect.poll(() => state.traceDefaults.at(-1)).toEqual(pick);
    await expect(page.locator('#tpick-default-status')).toContainText('Default for every repo');
    expect(state.unexpected).toEqual([]);
});
