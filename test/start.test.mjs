import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { createSpinner } from '../lib/spinner.mjs';

const source = readFileSync(new URL('../lib/start.mjs', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '')
    .replace(/^export .*;\r?$/gm, '');

for (const operation of ['runUpdate']) {
    for (const outcome of ['success', 'failure', 'interrupt']) {
        test(`startup ${operation} clears its spinner on ${outcome}`, async (t) => {
            t.mock.timers.enable({ apis: ['setInterval'] });
            let output = '';
            let killed = false;
            const proc = new EventEmitter();
            proc.stdout = { isTTY: true, write: (text) => { output += text; } };
            const agent = async ({ onStart, onProgress }) => {
                assert.match(output, /\r  \| (Drafting|Updating) map\.\.\./);
                onStart({ kill: () => { killed = true; } });
                onProgress('Reading files...');
                t.mock.timers.tick(100);
                if (outcome === 'interrupt') {
                    proc.emit('SIGINT');
                    assert.equal(killed, true);
                    const stopped = output;
                    t.mock.timers.tick(1000);
                    assert.equal(output, stopped);
                    throw new Error('cancelled');
                }
                if (outcome === 'failure') {
                    throw new Error('agent failed');
                }
                onProgress('Linking documentation...');
                const before = output;
                t.mock.timers.tick(100);
                assert.notEqual(output, before);
                return {
                    state: 'updated',
                    counts: { added: 1, updated: 0, removed: 0 },
                    check: { counts: { nodes: 1, edges: 0 }, errors: [] },
                    seconds: 1,
                    docs: {},
                };
            };
            const functions = runInNewContext(`${source}\n({ runUpdate });`, {
                process: proc,
                console: { log: (text = '') => { output += `${text}\n`; } },
                createSpinner: (label) => createSpinner(label, proc.stdout),
                updateMap: agent,
            });
            await functions[operation]('/fake-repo', {});
            assert.equal(proc.listenerCount('SIGINT'), 0);
            const finished = output;
            t.mock.timers.tick(1000);
            assert.equal(output, finished);
            const message = outcome === 'success'
                ? 'Updated the map:'
                : (outcome === 'interrupt' ? 'Stopped ' : "Couldn't ");
            const messageAt = output.indexOf(message);
            assert.ok(messageAt > 0);
            assert.ok(output.lastIndexOf('\r\x1b[2K') < messageAt);
            assert.ok(output.includes('\r\x1b[2K'));
        });
    }
}
