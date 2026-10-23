import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSpinner } from '../lib/spinner.mjs';

function capture(isTTY) {
    const chunks = [];
    return { isTTY, write: (text) => chunks.push(text), chunks };
}

test('spinner draws immediately and rotates through ASCII frames every 100ms', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const output = capture(true);
    const spinner = createSpinner('Drafting map...', output);
    try {
        assert.deepEqual(output.chunks, ['\r  | Drafting map...']);
        t.mock.timers.tick(99);
        assert.equal(output.chunks.length, 1);
        for (const ms of [1, 100, 100, 100]) {
            t.mock.timers.tick(ms);
        }
        assert.deepEqual(output.chunks, ['|', '/', '-', '\\', '|'].map((frame) => `\r  ${frame} Drafting map...`));
    } finally {
        spinner.stop();
    }
});

test('progress clears the spinner, logs a permanent line, and resumes animation', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const output = capture(true);
    const spinner = createSpinner('Updating map...', output);
    try {
        spinner.progress('  Linking documentation...');
        assert.deepEqual(output.chunks.slice(1), [
            '\r\x1b[2K',
            '  Linking documentation...\n',
            '\r  / Updating map...',
        ]);
        t.mock.timers.tick(100);
        assert.equal(output.chunks.at(-1), '\r  - Updating map...');
    } finally {
        spinner.stop();
    }
});

test('stop clears the line once and prevents animation or progress from restarting it', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const output = capture(true);
    const spinner = createSpinner('Drafting map...', output);
    spinner.stop();
    spinner.stop();
    t.mock.timers.tick(1000);
    assert.deepEqual(output.chunks, ['\r  | Drafting map...', '\r\x1b[2K']);
    spinner.progress('  Stopped drafting.');
    t.mock.timers.tick(1000);
    assert.equal(output.chunks.at(-1), '  Stopped drafting.\n');
    assert.equal(output.chunks.length, 3);
});

test('non-TTY output contains only plain progress lines', (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const output = capture(false);
    const spinner = createSpinner('Drafting map...', output);
    t.mock.timers.tick(1000);
    assert.deepEqual(output.chunks, []);
    spinner.progress('  Reading files...');
    spinner.stop();
    spinner.stop();
    t.mock.timers.tick(1000);
    assert.deepEqual(output.chunks, ['  Reading files...\n']);
});
