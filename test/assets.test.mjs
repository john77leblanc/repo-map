import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serveAsset } from '../lib/assets.mjs';

function response() {
    return { status: 0, headers: {}, body: null, writeHead(status, headers = {}) { this.status = status; this.headers = headers; }, end(body) { this.body = body; } };
}
test('asset handler rejects traversal, source files and unknown asset types', async () => {
    for (const url of ['/assets/../package.json', '/assets/%2e%2e/package.json', '/assets/a\\b.js', '/assets/app.map', '/assets/nested/app.js']) {
        const res = response();
        assert.equal(await serveAsset({ method: 'GET' }, res, url), true);
        assert.equal(res.status, 404, url);
    }
    assert.equal(await serveAsset({ method: 'GET' }, response(), '/app/src/main.tsx'), false);
});
test('asset handler restricts methods and reports missing assets', async () => {
    const res = response();
    await serveAsset({ method: 'POST' }, res, '/');
    assert.equal(res.status, 405);
    await serveAsset({ method: 'GET' }, res, '/assets/nonexistent.js');
    assert.equal(res.status, 404);
});
