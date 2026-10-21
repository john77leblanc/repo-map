/**
 * Local-only HTTP server: serves the map UI, the repo's config and map, live
 * file reads from the checkout, Claude Code traces, and saved traces on disk.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerSummary, runAi } from './ai/index.mjs';
import { loadConfig, loadMap } from './config.mjs';
import { mapStatus, markCurrent } from './freshness.mjs';
import { extractJson } from './json.mjs';
import { tracePrompt } from './prompts.mjs';
import { readLines, repoInfo } from './repo.mjs';
import { updateMap } from './update.mjs';

const APP_HTML = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'index.html');
const HOST = '127.0.0.1';
const MAX_BODY_BYTES = 256 * 1024;
const MAX_LINES_PER_READ = 400;

function send(res, status, body, type = 'application/json; charset=utf-8') {
    res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            throw Object.assign(new Error('Request too large'), { status: 413 });
        }
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/** Drop refs to files that don't exist and clamp line ranges to the real file. */
async function validateRefs(root, config, trace) {
    for (const step of Array.isArray(trace.steps) ? trace.steps : []) {
        const kept = [];
        for (const ref of Array.isArray(step.refs) ? step.refs : []) {
            try {
                const { clean, lines } = await readLines(root, config, ref.path);
                const start = Math.max(1, Math.min(lines.length, parseInt(ref.start, 10) || 1));
                const end = Math.max(start, Math.min(lines.length, parseInt(ref.end, 10) || start));
                kept.push({ ...ref, path: clean, start, end });
            } catch {
                // missing or outside codeRoots: leave it out
            }
        }
        step.refs = kept.slice(0, 3);
    }
    return trace;
}

/**
 * Start listening. With `findFreePort`, tries the next ports when one is taken.
 * Resolves { server, port }.
 */
function startServer({ root, port: requestedPort, findFreePort = false }) {
    let port = requestedPort;
    const tracesDir = async () => {
        const config = await loadConfig(root);
        const dir = path.resolve(root, config.tracesDir);
        await fs.mkdir(dir, { recursive: true });
        return dir;
    };
    const traceFile = (dir, key) => (/^[a-z0-9-]{8,64}$/i.test(key) ? path.join(dir, `${key}.json`) : null);

    async function handleTrace(req, res) {
        // Config and map are re-read per request so edits show up without a restart.
        const [config, map, body] = await Promise.all([loadConfig(root), loadMap(root), readBody(req)]);
        if (!body.prompt) {
            return send(res, 400, { error: 'prompt is required' });
        }
        res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
        const emit = (event) => {
            if (!res.writableEnded) {
                res.write(JSON.stringify(event) + '\n');
            }
        };
        const run = await runAi({
            root,
            config,
            prompt: tracePrompt(config, map, String(body.prompt).slice(0, 4000)),
            onProgress: (text) => emit({ type: 'progress', text }),
        });
        emit({ type: 'progress', text: `Starting ${run.label}…` });
        // The browser's Stop button closes the request: stop the AI run with it.
        res.on('close', run.kill);
        try {
            const out = await run.promise;
            const trace = extractJson(out.text);
            if (!trace) {
                throw new Error(`${run.label} answered, but not in the expected JSON shape. Try again, or try a stronger model.`);
            }
            emit({ type: 'progress', text: 'Checking file references…' });
            emit({ type: 'result', trace: await validateRefs(root, config, trace), cost: out.cost, turns: out.turns, tokens: out.tokens || null, label: run.label });
        } catch (err) {
            emit({ type: 'error', message: err.message, code: err.code || 'failed' });
        }
        res.end();
        return undefined;
    }

    let updating = false;
    async function handleUpdate(req, res) {
        if (updating) {
            return send(res, 409, { error: 'An update is already running.' });
        }
        const config = await loadConfig(root);
        res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
        const emit = (event) => {
            if (!res.writableEnded) {
                res.write(JSON.stringify(event) + '\n');
            }
        };
        updating = true;
        let run = null;
        res.on('close', () => run?.kill());
        try {
            const result = await updateMap({
                root,
                config,
                onStart: (r) => {
                    run = r;
                },
                onProgress: (text) => emit({ type: 'progress', text }),
            });
            emit({ type: 'result', ...result });
        } catch (err) {
            emit({ type: 'error', message: err.message, code: err.code || 'failed' });
        } finally {
            updating = false;
        }
        res.end();
        return undefined;
    }

    async function handle(req, res) {
        const url = new URL(req.url, `http://${HOST}:${port}`);
        // Only answer requests addressed to this local server (blocks DNS rebinding).
        const host = String(req.headers.host || '');
        if (host !== `${HOST}:${port}` && host !== `localhost:${port}`) {
            return send(res, 403, { error: 'Forbidden host' });
        }
        if (url.pathname === '/' || url.pathname === '/index.html') {
            return send(res, 200, await fs.readFile(APP_HTML), 'text/html; charset=utf-8');
        }
        if (!url.pathname.startsWith('/api/')) {
            return send(res, 404, { error: 'Not found' });
        }
        // A custom header forces a CORS preflight that this server never approves,
        // so other websites open in the browser can't call the API.
        if (req.headers['x-map'] !== '1') {
            return send(res, 403, { error: 'Missing x-map header' });
        }
        if (req.method === 'GET' && url.pathname === '/api/config') {
            const config = await loadConfig(root);
            const { ai, ...publicConfig } = config;
            const [repo, provider] = await Promise.all([repoInfo(root, config), providerSummary(config)]);
            return send(res, 200, { config: publicConfig, repo, ai: provider });
        }
        if (req.method === 'GET' && url.pathname === '/api/map/status') {
            const config = await loadConfig(root);
            return send(res, 200, { ...(await mapStatus(root, config, await loadMap(root))), updating });
        }
        if (req.method === 'POST' && url.pathname === '/api/map/update') {
            return handleUpdate(req, res);
        }
        if (req.method === 'POST' && url.pathname === '/api/map/mark') {
            return send(res, 200, { commit: await markCurrent(root) });
        }
        if (req.method === 'GET' && url.pathname === '/api/map') {
            return send(res, 200, await loadMap(root));
        }
        if (req.method === 'GET' && url.pathname === '/api/file') {
            const config = await loadConfig(root);
            const { lines } = await readLines(root, config, url.searchParams.get('path'));
            const start = Math.max(1, parseInt(url.searchParams.get('start'), 10) || 1);
            const end = Math.min(lines.length, Math.max(start, parseInt(url.searchParams.get('end'), 10) || start), start + MAX_LINES_PER_READ - 1);
            return send(res, 200, { start, end, total: lines.length, lines: lines.slice(start - 1, end) });
        }
        if (req.method === 'POST' && url.pathname === '/api/trace') {
            return handleTrace(req, res);
        }
        if (url.pathname === '/api/traces' && req.method === 'GET') {
            const dir = await tracesDir();
            const items = [];
            for (const name of (await fs.readdir(dir)).filter((n) => n.endsWith('.json'))) {
                try {
                    items.push({ ...JSON.parse(await fs.readFile(path.join(dir, name), 'utf8')), key: name.slice(0, -5) });
                } catch {
                    // skip unreadable files
                }
            }
            return send(res, 200, { traces: items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)) });
        }
        if (url.pathname === '/api/traces' && req.method === 'POST') {
            const body = await readBody(req);
            const key = randomUUID();
            await fs.writeFile(traceFile(await tracesDir(), key), JSON.stringify({ ...body, createdAt: body.createdAt || Date.now() }, null, 2));
            return send(res, 201, { key });
        }
        const del = url.pathname.match(/^\/api\/traces\/([^/]+)$/);
        if (del && req.method === 'DELETE') {
            const file = traceFile(await tracesDir(), decodeURIComponent(del[1]));
            if (!file) {
                return send(res, 400, { error: 'Bad id' });
            }
            await fs.rm(file, { force: true });
            return send(res, 204, '');
        }
        return send(res, 404, { error: 'Not found' });
    }

    const server = createServer((req, res) => {
        handle(req, res).catch((err) => {
            if (!res.headersSent) {
                send(res, err.status || 500, { error: err.message || 'Server error' });
            } else {
                res.end();
            }
        });
    });
    const tryListen = (attempt) => new Promise((resolve, reject) => {
        const onError = (err) => {
            server.off('listening', onListening);
            if (err.code === 'EADDRINUSE' && findFreePort && attempt < 20) {
                port += 1;
                resolve(tryListen(attempt + 1));
            } else {
                reject(err.code === 'EADDRINUSE' ? new Error(`Port ${port} is already in use. Pick another with --port, or stop the other server.`) : err);
            }
        };
        const onListening = () => {
            server.off('error', onError);
            resolve({ server, port });
        };
        server.once('error', onError);
        server.once('listening', onListening);
        server.listen(port, HOST);
    });
    return tryListen(0);
}

export { startServer };
