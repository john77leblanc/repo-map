import { test, expect } from '@playwright/test';

test('traces run concurrently behind closed modals, receive early titles and never overwrite a new draft', async ({ page }, testInfo) => {
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
    const saved: Record<string, unknown>[] = [];
    await page.route('**/api/traces', route => {
        if (route.request().method() === 'POST') {
            const key = 'saved-trace-' + saved.length;
            saved.push({ ...route.request().postDataJSON(), key });
            return route.fulfill({ json: { key } });
        }
        return route.fulfill({ json: { traces: saved } });
    });
    // Control genuine NDJSON chunks independently: the API client must deliver titles before results.
    await page.addInitScript(() => {
        const originalFetch = window.fetch;
        const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
        const requests: unknown[] = [];
        Object.assign(window, { traceTestStreams: streams, traceTestRequests: requests });
        window.fetch = async (input, init) => {
            if (input === '/api/trace') {
                requests.push(JSON.parse(String(init?.body)));
                return new Response(new ReadableStream({
                    start(controller) {
                        streams.push(controller);
                        init?.signal?.addEventListener('abort', () => controller.error(new DOMException('Stopped', 'AbortError')));
                    },
                }), { headers: { 'content-type': 'application/x-ndjson' } });
            }
            return originalFetch(input, init);
        };
    });
    const emit = (index: number, event: Record<string, unknown>, end = false) => page.evaluate(({ index, event, end }) => {
        const streams = (window as unknown as { traceTestStreams: ReadableStreamDefaultController<Uint8Array>[] }).traceTestStreams;
        streams[index].enqueue(new TextEncoder().encode(JSON.stringify(event) + '\n'));
        if (end) streams[index].close();
    }, { index, event, end });
    const trace = (title: string) => ({ title, summary: 'Checkout explained',
        steps: [{ id: 'checkout-page', note: 'Place an order' }], edges: [], refs: [] });
    await page.goto('/');
    await page.getByRole('button', { name: 'New trace', exact: true }).click();
    await page.locator('#prompt').fill('Explain checkout');
    await page.locator('#trace-outputs > summary').click();
    await page.locator('#withflow').uncheck();
    await page.getByRole('button', { name: 'Create trace', exact: true }).click();
    await page.locator('#trace-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    const first = page.locator('.trace-job').filter({ hasText: 'Explain checkout' });
    await expect(first.locator('.trace-title-skeleton')).toBeVisible();
    await expect(first.locator('.status.busy')).toHaveText('Agent working');
    await emit(0, { type: 'title', title: 'Checkout journey' });
    await expect(first.locator('.trace-card-title')).toHaveText('Checkout journey');
    await expect(first.locator('.trace-title-skeleton')).toHaveCount(0);
    await expect(first.locator('.status.busy')).toBeVisible();
    // a running job opens on its progress screen: the question, the progress line, each output, Stop
    await first.getByRole('button').click();
    await expect(page.locator('#new-trace-title')).toHaveText('Checkout journey');
    await expect(page.locator('.composer-prompt')).toHaveText('Explain checkout');
    await expect(page.locator('#prompt')).toHaveCount(0);
    await expect(page.getByRole('tablist', { name: 'What to trace' })).toHaveCount(0);
    await expect(page.locator('.output-progress li')).toHaveText([/Code architecture\s*Waiting/]);
    const longProgress = 'Reading a very long repository path and following callers through many related services and shared modules';
    await emit(0, { type: 'progress', text: longProgress });
    await expect(page.locator('#status')).toContainText(longProgress);
    // the history of progress messages opens from the line
    await page.locator('.progress-line summary').click();
    await expect(page.locator('.progress-history li')).toHaveCount(2);
    await page.locator('.progress-line summary').click();
    await page.setViewportSize({ width: 390, height: 844 });
    const [progress, outputs, stop] = await Promise.all(['#status', '.output-progress', '#stop'].map(selector => page.locator(selector).boundingBox()));
    // progress on one line, then the outputs, then Stop
    expect(outputs!.y).toBeGreaterThanOrEqual(progress!.y + progress!.height);
    expect(stop!.y).toBeGreaterThanOrEqual(outputs!.y + outputs!.height);
    const style = await page.locator('#status').evaluate(element => ({
        whiteSpace: getComputedStyle(element).whiteSpace, overflow: getComputedStyle(element).overflow,
        textOverflow: getComputedStyle(element).textOverflow, clipped: element.scrollWidth > element.clientWidth,
    }));
    expect(style).toEqual({ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', clipped: true });
    await page.screenshot({ path: testInfo.outputPath('trace-progress-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#trace-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'New trace', exact: true }).click();
    await expect(page.locator('#prompt')).toHaveValue('');
    await expect(page.locator('#prompt')).toBeEnabled();
    await page.locator('#prompt').fill('Explain refunds');
    await page.getByRole('button', { name: 'Create trace', exact: true }).click();
    await page.locator('#trace-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('.trace-job .status.busy')).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath('concurrent-traces-skeleton.png') });
    await emit(1, { type: 'title', title: 'Refund journey' });
    await expect(page.locator('.trace-job').filter({ hasText: 'Explain refunds' }).locator('.trace-card-title')).toHaveText('Refund journey');
    await page.getByRole('button', { name: 'New trace', exact: true }).click();
    await page.locator('#prompt').fill('A third unfinished draft');
    await emit(1, { type: 'result', trace: trace('Refunds complete') }, true);
    await expect.poll(() => saved.length).toBe(1);
    await expect(page.locator('#prompt')).toHaveValue('A third unfinished draft');
    await expect(page.locator('#trace-dialog')).toBeVisible();
    await emit(0, { type: 'result', trace: trace('Checkout complete') }, true);
    await expect.poll(() => saved.length).toBe(2);
    await expect(page.locator('#prompt')).toHaveValue('A third unfinished draft');
    await page.locator('#trace-dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('.trace-job')).toHaveCount(0);
    await expect(page.locator('.trace-open')).toHaveCount(2);
    await page.locator('.trace-open').filter({ hasText: 'Refunds complete' }).click();
    await expect(page.locator('#trace-title')).toHaveText('Refunds complete');
    expect(saved.map(item => item.prompt)).toEqual(['Explain refunds', 'Explain checkout']);
    expect(errors).toEqual([]);
});
