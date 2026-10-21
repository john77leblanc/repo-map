/**
 * Any AI command-line tool that takes a prompt (on stdin or as an argument)
 * and prints its answer. Presets cover common CLIs; everything is overridable.
 */
import { spawn } from 'node:child_process';
import { classifyFailure } from './errors.mjs';

// Starting points taken from each tool's docs. CLIs change their flags between
// versions: if one doesn't work for you, set command.args yourself.
const PRESETS = {
    codex: {
        label: 'Codex CLI',
        bin: 'codex',
        args: ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '-'],
        promptVia: 'stdin',
        authHint: 'Run `codex login`.',
    },
    gemini: {
        label: 'Gemini CLI',
        bin: 'gemini',
        args: ['-p', '{prompt}'],
        promptVia: 'arg',
        authHint: 'Run `gemini` once to sign in, or set GEMINI_API_KEY.',
    },
};

function commandSettings(settings = {}) {
    const preset = PRESETS[settings.preset] || {};
    const merged = { ...preset, ...Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== '' && !(Array.isArray(v) && !v.length))) };
    merged.label = merged.label || merged.bin || 'AI command';
    merged.args = Array.isArray(merged.args) ? merged.args : [];
    return merged;
}

function runCommand({ root, prompt, settings, timeoutMs, onProgress = () => {} }) {
    const s = commandSettings(settings);
    const viaArg = s.promptVia === 'arg';
    const args = s.args.map((a) => (a === '{prompt}' ? prompt : a));
    if (viaArg && !s.args.includes('{prompt}')) {
        args.push(prompt);
    }
    const env = { ...process.env, ...(s.model ? { REPO_MAP_MODEL: s.model } : {}) };
    const child = spawn(s.bin, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false;
    let out = '';
    let err = '';
    const t0 = Date.now();

    const promise = new Promise((resolve, reject) => {
        const done = (fn, value) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                clearInterval(ticker);
                fn(value);
            }
        };
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            done(reject, Object.assign(new Error(`${s.label} took too long and was stopped.`), { code: 'timeout' }));
        }, timeoutMs);
        // CLIs without a progress stream: show their latest stderr line, or that we're still waiting
        let lastShown = '';
        const ticker = setInterval(() => {
            const line = err.trim().split('\n').filter(Boolean).slice(-1)[0] || '';
            const text = line ? line.slice(0, 120) : `Waiting for ${s.label} (${Math.round((Date.now() - t0) / 1000)}s)`;
            if (text !== lastShown) {
                lastShown = text;
                onProgress(text);
            }
        }, 2000);

        child.on('error', (e) => done(reject, Object.assign(new Error(e.code === 'ENOENT'
            ? `${s.label} isn’t installed (\`${s.bin}\` not found). See SETUP.md.`
            : `Couldn't start ${s.label}: ${e.message}`), { code: e.code === 'ENOENT' ? 'missing' : 'failed' })));
        child.stdout.on('data', (d) => {
            out += d.toString();
        });
        child.stderr.on('data', (d) => {
            err = (err + d.toString()).slice(-8000);
        });
        child.on('close', (code) => {
            if (code === 0 && out.trim()) {
                done(resolve, { text: out, cost: null, turns: null });
            } else {
                const f = classifyFailure(s.label, `${err}\n${out.slice(-2000)}`, s.authHint);
                done(reject, Object.assign(new Error(f.message), { code: f.code }));
            }
        });
    });
    onProgress(`Starting ${s.label}…`);
    // A tool that exits early (e.g. not signed in) closes stdin; that's reported via its exit, not as a crash
    child.stdin.on('error', () => {});
    child.stdin.end(viaArg ? '' : prompt);
    return {
        promise,
        kill: () => {
            if (!settled) {
                child.kill('SIGTERM');
            }
        },
    };
}

export { PRESETS, commandSettings, runCommand };
