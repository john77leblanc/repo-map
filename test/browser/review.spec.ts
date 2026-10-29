import { test, expect } from '@playwright/test';

const HEAD = 'b'.repeat(40), BASE = 'a'.repeat(40);
const review = {
    key: 'review-12345678', intent: 'review', title: 'Coupon codes', prompt: 'Review pull request #12: Coupons',
    summary: 'Adds coupon codes to checkout.', gaps: '',
    steps: [{ id: 'checkout-page', note: 'Shows a coupon field.' }, { id: 'orders-client', note: 'Sends the code with the order.' }],
    edges: [['checkout-page', 'orders-client']],
    refs: [{ step: 'orders-client', path: 'src/api/orders.js', start: 1, end: 3, rev: HEAD }],
    outputs: { architecture: true, flowchart: true },
    proposal: { rationale: 'Checkout and the orders client learn about coupons.', assumptions: [], questions: [],
        nodes: [{ id: 'orders-client', status: 'modified', rationale: 'sends the coupon' }, { id: 'checkout-page', status: 'modified' }], edges: [] },
    flow: { nodes: [{ id: 'f1', type: 'start', label: 'Open checkout', step: 1 }, { id: 'f2', type: 'process', label: 'Apply coupon', status: 'new', step: 2 },
        { id: 'f3', type: 'end', label: 'Order placed' }], edges: [{ from: 'f1', to: 'f2' }, { from: 'f2', to: 'f3', status: 'new' }] },
    review: { kind: 'pr', number: 12, url: 'https://github.com/o/r/pull/12', base: 'main', head: 'coupons', baseSha: BASE, headSha: HEAD, mergeBase: BASE,
        risks: ['Expired codes are not checked.'], questions: [], skipped: [],
        files: [{ path: 'src/api/orders.js', status: 'M', additions: 3, deletions: 1, cards: ['orders-client'], note: 'adds the coupon field' }] },
};

test.beforeEach(async ({ page }) => {
    await page.route('**/api/traces', (route) => route.fulfill({ json: { traces: [review] } }));
    await page.route('**/api/map/status', (route) => route.fulfill({ json: { state: 'current', docs: { linked: true } } }));
    await page.route('**/api/review/status', (route) => route.fulfill({ json: { state: 'stale', reason: 'The pull request has new commits.' } }));
});

test('a saved review shows its changes on the map and flowchart, its files open as diffs, and it can be re-run', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // an AI tool is set up, so Re-run is offered
    await page.route('**/api/config', async (route) => {
        const json = await (await route.fetch()).json();
        await route.fulfill({ json: { ...json, ai: { available: true, label: 'Test', reason: '' } } });
    });
    await page.route('**/api/agents', (route) => route.fulfill({ json: {
        agents: [{ id: 'api', label: 'Test', available: true, models: [], efforts: [] }], default: { agent: 'api' },
    } }));
    await page.route('**/api/diff?**', (route) => {
        const url = new URL(route.request().url());
        expect(url.searchParams.get('base')).toBe(BASE);
        expect(url.searchParams.get('head')).toBe(HEAD);
        return route.fulfill({ json: { path: 'src/api/orders.js', lines: ['@@ -1,3 +1,4 @@', '+const coupon = true;', ' export {};'], total: 3 } });
    });
    await page.goto('/');
    await expect(page.locator('#trace-list .trace-badge.review')).toHaveText('PR #12');
    await page.getByRole('button', { name: /Coupon codes/ }).click();
    await expect(page.locator('#trace-title')).toHaveText('Coupon codes');
    await expect(page.locator('#review-state')).toHaveText('Out of date: The pull request has new commits.');
    await expect(page.locator('[data-proposal-key]').first()).toContainText('Changes in this review');
    await expect(page.locator('#trace-review')).toContainText('Expired codes are not checked.');

    await page.locator('#trace-files summary').click();
    await page.locator('#review-files-orders-client-head').click();
    await page.locator('.review-file-list .ref').click();
    await expect(page.locator('#ref-dialog .cl2.da')).toHaveText('+const coupon = true;');
    await page.locator('#ref-close').click();

    await page.getByRole('tab', { name: 'Flowchart', exact: true }).click();
    await expect(page.locator('#fl-svgbox svg')).toBeVisible();

    let rerun: unknown = null;
    await page.route('**/api/review', async (route) => {
        rerun = route.request().postDataJSON();
        await route.fulfill({ body: JSON.stringify({ type: 'progress', text: 'Looking up the pull request…' }) + '\n', contentType: 'application/x-ndjson' });
    });
    await page.locator('#review-rerun').click();
    // a re-run asks for the outputs the review has
    await expect.poll(() => rerun).toMatchObject({ pr: '12', flow: true, sitemap: false });
    expect(errors).toEqual([]);
});

test('New trace has review tabs with the branch prefilled and the map output locked on', async ({ page }) => {
    await page.route('**/api/config', async (route) => {
        const json = await (await route.fetch()).json();
        await route.fulfill({ json: { ...json, ai: { available: true, label: 'Test', reason: '' } } });
    });
    await page.route('**/api/agents', (route) => route.fulfill({ json: {
        agents: [{ id: 'api', label: 'Test', available: true, models: [], efforts: [] }], default: { agent: 'api' },
    } }));
    await page.goto('/');
    await page.getByRole('button', { name: 'New trace', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'New trace' });
    await expect(modal).toBeVisible();
    await expect(page.getByRole('button', { name: 'Review changes' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Local changes' }).click();
    await expect(page.getByRole('tab', { name: 'Local changes' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByLabel('Compared with')).toHaveValue(/.+/);
    // Outputs starts collapsed and folds open like the trace sidebar sections
    await expect(page.locator('#withflow')).toBeHidden();
    await page.locator('#trace-outputs > summary').click();
    await expect(page.locator('#witharchitecture')).toBeChecked();
    await expect(page.locator('#witharchitecture')).toBeDisabled();
    await expect(page.locator('#trace-outputs .settings-section-count')).toHaveText('2');
    await page.locator('#withflow').uncheck();
    await expect(page.locator('#trace-outputs .settings-section-count')).toHaveText('1');
    await page.locator('#trace-outputs > summary').click();
    await expect(page.locator('#withflow')).toBeHidden();
    await modal.getByRole('button', { name: 'Close' }).click();
    await expect(modal).toHaveCount(0);
});

test('branch pickers filter as you type, choose with the keyboard and grey out branches with nothing to review', async ({ page }) => {
    const now = Math.floor(Date.now() / 1000);
    await page.route('**/api/config', async (route) => {
        const json = await (await route.fetch()).json();
        await route.fulfill({ json: { ...json, config: { ...json.config, defaultBranch: 'main' }, repo: { ...json.repo, branch: 'main' }, ai: { available: true, label: 'Test', reason: '' } } });
    });
    await page.route('**/api/agents', (route) => route.fulfill({ json: {
        agents: [{ id: 'api', label: 'Test', available: true, models: [], efforts: [] }], default: { agent: 'api' },
    } }));
    await page.route('**/api/review/refs**', (route) => route.fulfill({ json: { current: 'main', defaultBranch: 'main', aheadOf: 'origin/main', more: false, refs: [
        { name: 'main', kind: 'local', sha: 'm', date: now - 7200, subject: 'Release', ahead: 0, behind: 0 },
        { name: 'feature/coupons', kind: 'local', sha: 'c', date: now - 86400, subject: 'Coupons', ahead: 4, behind: 0 },
        { name: 'origin/search', kind: 'remote', sha: 's', date: now - 86400 * 9, subject: 'Search', ahead: 2, behind: 1 },
        { name: 'v1.0.0', kind: 'tag', sha: 'm', date: now - 86400 * 40, subject: 'Release' },
    ] } }));
    let sent: unknown = null;
    await page.route('**/api/review', async (route) => {
        sent = route.request().postDataJSON();
        await route.fulfill({ body: JSON.stringify({ type: 'error', message: 'stop here', code: 'failed' }) + '\n', contentType: 'application/x-ndjson' });
    });
    await page.goto('/');
    await page.getByRole('button', { name: 'New trace', exact: true }).click();
    await page.getByRole('tab', { name: 'Branches' }).click();
    const head = page.getByRole('combobox', { name: 'Changes on' });
    await head.click();
    await expect(page.getByRole('option')).toHaveCount(4);
    await expect(page.getByRole('option', { name: /● main/ })).toHaveClass(/muted/);
    await expect(page.getByRole('option', { name: /feature\/coupons/ })).toContainText('4 ahead');
    await expect(page.getByRole('group', { name: 'Remote branches' })).toBeVisible();
    await head.fill('coup');
    await expect(page.getByRole('option')).toHaveCount(1);
    await head.press('ArrowDown');
    await head.press('Enter');
    await expect(head).toHaveValue('feature/coupons');
    await expect(page.getByRole('listbox')).toHaveCount(0);
    const base = page.getByRole('combobox', { name: 'Compared with' });
    await expect(base).toHaveValue('main');
    await base.fill('v1');
    await page.getByRole('option', { name: /v1\.0\.0/ }).click();
    await page.getByRole('button', { name: 'Review', exact: true }).click();
    await expect.poll(() => sent).toMatchObject({ head: 'feature/coupons', base: 'v1.0.0', flow: true, sitemap: false });
    // the progress screen keeps the error, then Retry review / Delete; Delete drops the failed review from the list
    await expect(page.locator('#review-status')).toHaveText('stop here');
    await expect(page.locator('.output-progress li')).toHaveText([/Code architecture\s*Not made/, /Flowchart\s*Not made/]);
    const [status, retry] = await Promise.all(['#review-status', '#review-retry'].map((s) => page.locator(s).boundingBox()));
    expect(retry!.y).toBeGreaterThanOrEqual(status!.y + status!.height);
    await expect(page.locator('#review-retry')).toHaveText('Retry review');
    await expect(page.locator('.trace-job')).toHaveCount(1);
    await page.locator('#review-delete').click();
    await expect(page.locator('#trace-dialog')).not.toBeVisible();
    await expect(page.locator('.trace-job')).toHaveCount(0);
});
