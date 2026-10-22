/**
 * Any AI command-line tool that takes a prompt (on stdin or as an argument)
 * and prints its answer. Presets cover common CLIs; everything is overridable.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { classifyFailure } from './errors.mjs';

// Starting points taken from each tool's docs. CLIs change their flags between
// versions: if one doesn't work for you, set command.args yourself.
//   {options}   where modelArgs / effortArgs go (appended at the end when absent)
//   {prompt}    the prompt, for tools that take it as an argument
const PRESETS = {
    codex: {
        label: 'Codex CLI',
        bin: 'codex',
        args: ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '{options}', '-'],
        modelArgs: ['-m', '{model}'],
        effortArgs: ['-c', 'model_reasoning_effort={effort}'],
        promptVia: 'stdin',
        authHint: 'Run `codex login`.',
    },
    gemini: {
        label: 'Gemini CLI',
        bin: 'gemini',
        args: ['{options}', '-p', '{prompt}'],
        modelArgs: ['-m', '{model}'],
        promptVia: 'arg',
        authHint: 'Run `gemini` once to sign in, or set GEMINI_API_KEY.',
    },
};

function commandSettings(settings = {}) {
    const preset = PRESETS[settings.preset] || {};
    const merged = { ...preset, ...Object.fromEntries(Object.entries(settings).filter(([, v]) => v !== '' && v !== undefined && !(Array.isArray(v) && !v.length))) };
    merged.label = merged.label || merged.bin || 'AI command';
    merged.args = Array.isArray(merged.args) ? merged.args : [];
    return merged;
}

/** The argv for a run: model/effort flags at {options}, the prompt at {prompt}. */
function commandArgs(s, prompt) {
    const fill = (list, key, value) => (value && Array.isArray(list) ? list.map((a) => a.replaceAll(`{${key}}`, value)) : []);
    const options = [...fill(s.modelArgs, 'model', s.model), ...fill(s.effortArgs, 'effort', s.effort)];
    const args = s.args.flatMap((a) => (a === '{options}' ? options : a === '{prompt}' ? [prompt] : [a]));
    if (!s.args.includes('{options}')) {
        args.push(...options);
    }
    if (s.promptVia === 'arg' && !s.args.includes('{prompt}')) {
        args.push(prompt);
    }
    return args;
}

// Arguments cmd.exe passes through unchanged
const SHELL_SAFE = /^[\w.:/\\=@+,-]+$/;

/**
 * npm installs CLIs on Windows as .cmd scripts, which Node can only start
 * through cmd.exe. Returns the script's path when `bin` resolves to one.
 */
function windowsScript(bin, env = process.env) {
    if (process.platform !== 'win32') {
        return null;
    }
    if (/\.(cmd|bat)$/i.test(bin)) {
        return bin;
    }
    const dirs = bin.includes('/') || bin.includes('\\') ? [''] : String(env.PATH || '').split(path.delimiter).filter(Boolean);
    for (const dir of dirs) {
        for (const ext of ['.exe', '.com', '.cmd', '.bat']) {
            const file = dir ? path.join(dir, bin + ext) : bin + ext;
            if (existsSync(file)) {
                return /\.(cmd|bat)$/i.test(ext) ? file : null;
            }
        }
    }
    return null;
}

function runCommand({ root, prompt, settings, timeoutMs, onProgress = () => {} }) {
    const s = commandSettings(settings);
    const viaArg = s.promptVia === 'arg';
    const args = commandArgs(s, prompt);
    const env = { ...process.env, ...(s.model ? { REPO_MAP_MODEL: s.model } : {}), ...(s.effort ? { REPO_MAP_EFFORT: s.effort } : {}) };
    const script = windowsScript(s.bin, env);
    if (script && !args.every((a) => SHELL_SAFE.test(a))) {
        const err = new Error(`${s.label} is a Windows .cmd script, so repo-map can only pass it plain arguments. Send the prompt on stdin instead ("promptVia": "stdin").`);
        return { promise: Promise.reject(Object.assign(err, { code: 'failed' })), kill: () => {} };
    }
    const child = script
        ? spawn(`"${script}"`, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'], shell: true, windowsHide: true })
        : spawn(s.bin, args, { cwd: root, env, stdio: ['pipe', 'pipe', 'pipe'] });
    // Through cmd.exe, stopping the shell would leave the tool running: stop the whole tree
    const stop = () => (script && child.pid ? spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => {}) : child.kill('SIGTERM'));
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
            stop();
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
                stop();
            }
        },
    };
}

export { PRESETS, commandArgs, commandSettings, runCommand };
