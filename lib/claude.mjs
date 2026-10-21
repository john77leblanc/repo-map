/**
 * Runs the Claude Code CLI headless (`claude -p`) with read-only tools and
 * streams what it does. Shared by `serve` (traces) and `generate` (map drafts).
 */
import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'];
const BLOCKED_TOOLS = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task'];

async function hasClaude(bin) {
    try {
        await execFileAsync(bin, ['--version'], { timeout: 15000 });
        return true;
    } catch {
        return false;
    }
}

function describeToolUse(block, root) {
    const input = block.input || {};
    const rel = (p) => String(p || '').replace(root + path.sep, '');
    switch (block.name) {
        case 'Read': return `Reading ${rel(input.file_path)}`;
        case 'Grep': return `Searching for “${input.pattern}”${input.path ? ` in ${rel(input.path)}` : ''}`;
        case 'Glob': return `Listing ${input.pattern}${input.path ? ` in ${rel(input.path)}` : ''}`;
        default: return `Using ${block.name}`;
    }
}

/** Parse a JSON object out of a model reply: whole text, a code fence, or first { to last }. */
function extractJson(text) {
    const s = String(text || '').trim();
    const attempts = [s];
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
        attempts.push(fence[1]);
    }
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first >= 0 && last > first) {
        attempts.push(s.slice(first, last + 1));
    }
    for (const attempt of attempts) {
        try {
            return JSON.parse(attempt);
        } catch {
            // try the next shape
        }
    }
    return null;
}

/**
 * Start a run. Calls onProgress(text) for each tool use and resolves with
 * { text, cost, turns } or rejects with a readable Error. Returns { promise, kill }.
 */
function runClaude({ root, prompt, claude, onProgress = () => {} }) {
    const args = [
        '-p',
        '--output-format', 'stream-json',
        '--verbose',
        '--allowedTools', ...READ_ONLY_TOOLS,
        '--disallowedTools', ...BLOCKED_TOOLS,
        '--max-turns', String(claude.maxTurns || 40),
    ];
    if (claude.model) {
        args.push('--model', claude.model);
    }
    const child = spawn(claude.bin || 'claude', args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false;
    let stderr = '';
    let buffer = '';

    const promise = new Promise((resolve, reject) => {
        const done = (fn, value) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                fn(value);
            }
        };
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            done(reject, new Error('Claude Code took too long and was stopped.'));
        }, claude.timeoutMs || 600000);

        child.on('error', (err) => done(reject, new Error(err.code === 'ENOENT'
            ? `Claude Code CLI (${claude.bin || 'claude'}) not found. Install it and sign in.`
            : `Couldn't start Claude Code: ${err.message}`)));
        child.stderr.on('data', (d) => {
            stderr = (stderr + d.toString()).slice(-4000);
        });
        child.stdout.on('data', (chunk) => {
            buffer += chunk.toString();
            let i;
            while ((i = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, i).trim();
                buffer = buffer.slice(i + 1);
                if (!line) {
                    continue;
                }
                let msg;
                try {
                    msg = JSON.parse(line);
                } catch {
                    continue;
                }
                if (msg.type === 'assistant') {
                    for (const block of msg.message?.content || []) {
                        if (block.type === 'tool_use') {
                            onProgress(describeToolUse(block, root));
                        }
                    }
                } else if (msg.type === 'result') {
                    if (msg.is_error || msg.subtype !== 'success') {
                        done(reject, new Error(`Claude Code stopped early (${msg.subtype || 'error'}). Try a narrower request.`));
                    } else {
                        done(resolve, { text: msg.result, cost: msg.total_cost_usd || null, turns: msg.num_turns || null });
                    }
                }
            }
        });
        child.on('close', (code) => {
            const hint = /login|auth|credential/i.test(stderr) ? ' Run `claude` once in a terminal to sign in.' : '';
            done(reject, new Error(`Claude Code exited (code ${code}) without an answer.${hint}`));
        });
    });
    child.stdin.end(prompt);
    return {
        promise,
        kill: () => {
            if (!settled) {
                child.kill('SIGTERM');
            }
        },
    };
}

export { extractJson, hasClaude, runClaude };
