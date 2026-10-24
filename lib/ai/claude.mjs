/**
 * Claude Code CLI (`claude -p`), headless, read-only tools, streamed progress.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { classifyFailure } from './errors.mjs';
import { responsePrompt } from '../response-contracts.mjs';

const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob'];
const BLOCKED_TOOLS = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Task'];
const LABEL = 'Claude Code';
const AUTH_HINT = 'Run `claude` once in a terminal to sign in.';

function describeToolUse(block, root) {
    const input = block.input || {};
    // repo-relative with forward slashes, whatever separators or drive-letter case the tool used
    const rel = (p) => {
        const r = path.relative(root, String(p || ''));
        return r && !r.startsWith('..') && !path.isAbsolute(r) ? r.replace(/\\/g, '/') : String(p || '').replace(/\\/g, '/');
    };
    switch (block.name) {
        case 'Read': return `Reading ${rel(input.file_path)}`;
        case 'Grep': return `Searching for “${input.pattern}”${input.path ? ` in ${rel(input.path)}` : ''}`;
        case 'Glob': return `Listing ${input.pattern}${input.path ? ` in ${rel(input.path)}` : ''}`;
        default: return `Using ${block.name}`;
    }
}

// Conditional requirements stay in local validation; Claude's output tool requires
// a plain object at the schema root.
function nativeSchema(schema) {
    const { anyOf, oneOf, allOf, ...objectSchema } = schema;
    return objectSchema;
}

function schemaRejected(output) {
    return /(?:input_schema|json.schema|structured.?output|output.?format)[\s\S]{0,240}(?:not support|unsupported|invalid|not allowed)|(?:unknown|unrecognized|unsupported|invalid) (?:option|argument)[^\n]*json-schema/i.test(output);
}

function runClaude(options) {
    const deadline = Date.now() + options.timeoutMs;
    let stopped = false;
    let active = runClaudeAttempt(options);
    const promise = active.promise.catch(error => {
        if (stopped || !options.responseSchema || !error.schemaRejected) throw error;
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw Object.assign(new Error(`${LABEL} took too long and was stopped.`), { code: 'timeout' });
        options.onProgress?.('Structured output unavailable; retrying with JSON in the prompt');
        if (stopped) throw Object.assign(new Error('Stopped.'), { code: 'stopped' });
        active = runClaudeAttempt({ ...options, responseSchema: undefined,
            prompt: responsePrompt(options.prompt, options.responseSchema), timeoutMs: remaining });
        return active.promise;
    });
    return { promise, kill: () => { stopped = true; active.kill(); } };
}

function runClaudeAttempt({ root, prompt, responseSchema, settings, timeoutMs, maxTurns, onProgress = () => {}, spawnProcess = spawn }) {
    const args = [
        '-p',
        '--output-format', 'stream-json',
        '--verbose',
        '--tools', READ_ONLY_TOOLS.join(','),
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--allowedTools', ...READ_ONLY_TOOLS,
        '--disallowedTools', ...BLOCKED_TOOLS,
        '--max-turns', String(maxTurns || settings.maxTurns || 40),
    ];
    if (settings.model) {
        args.push('--model', settings.model);
    }
    if (settings.effort) {
        args.push('--effort', settings.effort);
    }
    if (responseSchema) args.push('--json-schema', JSON.stringify(nativeSchema(responseSchema)));
    const child = spawnProcess(settings.bin || 'claude', args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false;
    let tail = '';
    let buffer = '';

    const promise = new Promise((resolve, reject) => {
        const done = (fn, value) => {
            if (!settled) {
                settled = true;
                clearTimeout(timer);
                fn(value);
            }
        };
        const fail = (output) => {
            const f = classifyFailure(LABEL, output, AUTH_HINT);
            done(reject, Object.assign(new Error(f.message), { code: f.code,
                schemaRejected: f.code === 'failed' && schemaRejected(output) }));
        };
        const timer = setTimeout(() => {
            child.kill('SIGTERM');
            done(reject, Object.assign(new Error(`${LABEL} took too long and was stopped.`), { code: 'timeout' }));
        }, timeoutMs);

        child.on('error', (err) => done(reject, Object.assign(new Error(err.code === 'ENOENT'
            ? `${LABEL} isn’t installed (\`${settings.bin || 'claude'}\` not found). See SETUP.md, or pick another AI tool.`
            : `Couldn't start ${LABEL}: ${err.message}`), { code: err.code === 'ENOENT' ? 'missing' : 'failed' })));
        child.stderr.on('data', (d) => {
            tail = (tail + d.toString()).slice(-4000);
        });
        const consume = () => {
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
                    tail = (tail + line + '\n').slice(-4000);
                    continue;
                }
                if (msg.type === 'assistant') {
                    for (const block of msg.message?.content || []) {
                        if (block.type === 'tool_use') {
                            onProgress(describeToolUse(block, root));
                        } else if (block.type === 'text' && block.text) {
                            tail = (tail + block.text + '\n').slice(-4000);
                        }
                    }
                } else if (msg.type === 'result') {
                    if (msg.is_error || msg.subtype !== 'success') {
                        if (msg.subtype === 'error_max_turns') {
                            done(reject, Object.assign(new Error(`${LABEL} ran out of turns before answering. Try a narrower question.`), { code: 'turns' }));
                        } else {
                            fail(`${tail}\n${msg.result || ''}\n${(msg.errors || []).join('\n')}`);
                        }
                    } else {
                        done(resolve, { text: responseSchema && msg.structured_output !== undefined
                            ? JSON.stringify(msg.structured_output) : msg.result,
                        cost: msg.total_cost_usd || null, turns: msg.num_turns || null });
                    }
                }
            }
        };
        child.stdout.on('data', (chunk) => {
            buffer += chunk.toString();
            consume();
        });
        child.on('close', () => {
            if (buffer.trim()) {
                buffer += '\n';
                consume();
            }
            fail(tail);
        });
    });
    // A tool that exits early (e.g. not signed in) closes stdin; that's reported via its exit, not as a crash
    child.stdin.on('error', () => {});
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

export { AUTH_HINT, LABEL, runClaude };
