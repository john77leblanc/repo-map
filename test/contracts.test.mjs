import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadMap } from '../lib/config.mjs';
import { cleanMapContracts, contractLabel, contractsMatch, matchContracts, normalizeContract, normalizeContracts } from '../lib/contracts.mjs';
import { generatePrompt, mapText, updatePrompt } from '../lib/prompts.mjs';
import { RESPONSE_SCHEMAS, schemaErrors } from '../lib/response-contracts.mjs';
import { applyPatch } from '../lib/update.mjs';
import { validateMap } from '../lib/validate.mjs';

const EXAMPLE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'examples', 'shop');

test('normalizeContract canonicalizes each kind and rejects junk', () => {
    const cases = {
        'http:post /orders/': 'http:POST /orders',
        'HTTP: GET https://api.example.com/orders/:id?x=1': 'http:GET /orders/{}',
        'http:/v1/orders/{orderId}/items/[itemId]': 'http:ANY /v1/orders/{}/items/{}',
        'http:* /files/**': 'http:ANY /files/{}',
        'http:GET /users/<id>': 'http:GET /users/{}',
        'http:GET /users/${id}': 'http:GET /users/{}',
        'event:Order.Placed': 'event:order.placed',
        'pkg:@Shop/Client': 'pkg:@shop/client',
        'grpc:orders.OrderService/PlaceOrder': 'grpc:orders.OrderService/PlaceOrder',
        'env:orders_api_url': 'env:ORDERS_API_URL',
    };
    for (const [raw, want] of Object.entries(cases)) assert.equal(normalizeContract(raw), want, raw);
    for (const bad of ['', 'orders', 'ftp:/x', 'http:FETCH /x', 'event:two words', 'env:1BAD', null, 42]) {
        assert.equal(normalizeContract(bad), '', String(bad));
    }
    assert.deepEqual(normalizeContracts(['http:POST /orders', 'http:post /orders/', 'nope', 'event:a']), ['http:POST /orders', 'event:a']);
    assert.equal(normalizeContracts(Array.from({ length: 20 }, (_, i) => `event:e${i}`)).length, 12);
});

test('contractsMatch pairs methods, params and wildcards but never env hints', () => {
    assert.ok(contractsMatch('http:POST /orders', 'http:post /orders/'));
    assert.ok(contractsMatch('http:GET /orders/123', 'http:GET /orders/:id'));
    assert.ok(contractsMatch('http:ANY /orders', 'http:DELETE /orders'));
    assert.ok(!contractsMatch('http:GET /orders', 'http:POST /orders'));
    assert.ok(!contractsMatch('http:GET /orders/1/items', 'http:GET /orders/{}'));
    assert.ok(contractsMatch('event:order.placed', 'event:Order.Placed'));
    assert.ok(!contractsMatch('event:order.placed', 'http:POST /order.placed'));
    assert.ok(!contractsMatch('env:ORDERS_API_URL', 'env:ORDERS_API_URL'));
});

test('matchContracts joins consumers to providers once per node pair', () => {
    const web = [{ id: 'orders-client', consumes: ['http:POST /orders', 'http:GET /orders/{}', 'env:ORDERS_API_URL'] }, { id: 'ui' }];
    const api = [{ id: 'orders-route', provides: ['http:POST /orders', 'http:GET /orders/:id'] }, { id: 'health', provides: ['http:GET /health'] }];
    assert.deepEqual(matchContracts(web, api), [
        { from: 'orders-client', to: 'orders-route', via: 'contract', keys: ['http:POST /orders', 'http:GET /orders/{}'] },
    ]);
    assert.deepEqual(matchContracts(api, web), []);
});

test('cleanMapContracts normalizes lists and drops empty ones', () => {
    const map = { groups: [], edges: [], nodes: [{ id: 'a', provides: ['http:get /x/'], consumes: ['junk'] }, { id: 'b' }] };
    const out = cleanMapContracts(map);
    assert.deepEqual(out.nodes, [{ id: 'a', provides: ['http:GET /x'] }, { id: 'b' }]);
    assert.deepEqual(map.nodes[0].consumes, ['junk'], 'input unchanged');
    assert.equal(contractLabel('http:ANY /x'), '/x');
    assert.equal(contractLabel('http:POST /orders'), 'POST /orders');
    assert.equal(contractLabel('event:order.placed'), 'event order.placed');
});

test('validateMap warns on unreadable contracts; the example map has clean ones', async () => {
    const config = await loadConfig(EXAMPLE);
    const map = await loadMap(EXAMPLE);
    assert.deepEqual(map.nodes.find((n) => n.id === 'orders-client').consumes, ['http:POST /orders', 'env:ORDERS_API_URL']);
    assert.equal(validateMap(EXAMPLE, config, map).warnings.filter((w) => w.includes('consumes')).length, 0);
    const bad = { ...map, nodes: map.nodes.map((n) => n.id === 'cart-page' ? { ...n, provides: ['GET /cart'] } : n.id === 'shopper' ? { ...n, consumes: 'http:GET /' } : n) };
    const { errors, warnings } = validateMap(EXAMPLE, config, bad);
    assert.ok(warnings.some((w) => w.includes('cart-page provides has unreadable entry "GET /cart"')));
    assert.ok(errors.some((e) => e.includes('shopper consumes must be a list')));
});

test('map schemas accept contracts; flow schema accepts chunks', () => {
    const node = { id: 'a', group: 'g', kind: 'service', path: 'src', desc: 'x', provides: ['http:GET /a'], consumes: [] };
    assert.deepEqual(schemaErrors({ groups: [], nodes: [node], edges: [] }, RESPONSE_SCHEMAS.generate), []);
    assert.deepEqual(schemaErrors({ summary: '', nodes: { update: [{ id: 'a', consumes: ['event:x'] }] } }, RESPONSE_SCHEMAS.update), []);
    const flow = { nodes: [{ id: 'a', type: 'start', label: 'A' }, { id: 'b', type: 'end', label: 'B' }], edges: [{ from: 'a', to: 'b' }],
        chunks: [{ label: 'All', nodes: ['a', 'b'] }] };
    assert.deepEqual(schemaErrors({ flow }, RESPONSE_SCHEMAS.flow), []);
});

test('applyPatch normalizes contract updates and clears emptied lists', () => {
    const map = { groups: [{ id: 'g', col: 0 }], nodes: [{ id: 'a', group: 'g', provides: ['http:GET /a'] }], edges: [] };
    const { map: out } = applyPatch(map, { nodes: {
        update: [{ id: 'a', provides: [] , consumes: ['http:post /b/'] }],
        add: [{ id: 'c', group: 'g', provides: ['event:Ready', 'bad'] }],
    } });
    assert.deepEqual(out.nodes, [{ id: 'a', group: 'g', consumes: ['http:POST /b'] }, { id: 'c', group: 'g', provides: ['event:ready'] }]);
});

test('prompts ask for contracts and show existing ones', async () => {
    const config = await loadConfig(EXAMPLE);
    const map = await loadMap(EXAMPLE);
    assert.match(generatePrompt(config, null), /"provides":\["http:POST \/orders"\]/);
    assert.match(generatePrompt(config, null), /env:VAR_NAME/);
    assert.match(updatePrompt(config, map, { commit: 'a'.repeat(40), head: 'b'.repeat(40) }, { files: [], skipped: [], patch: '' }), /replaces the whole list/);
    assert.match(mapText(config, map), /consumes http:POST \/orders/);
});
