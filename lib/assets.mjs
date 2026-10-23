import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon' };

/** Serve only the compiled app shell and Vite's flat, hashed asset directory. */
async function serveAsset(req, res, pathname) {
    const shell = pathname === '/' || pathname === '/index.html';
    if (!shell && !pathname.startsWith('/assets/')) return false;
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return true; }
    const relative = shell ? 'index.html' : pathname.slice(1);
    if (!shell && !/^assets\/[a-zA-Z0-9_.-]+$/.test(relative)) { res.writeHead(404); res.end(); return true; }
    const type = TYPES[path.extname(relative)];
    if (!type) { res.writeHead(404); res.end(); return true; }
    try {
        const body = await fs.readFile(path.join(DIST, relative));
        res.writeHead(200, { 'content-type': type, 'cache-control': shell ? 'no-cache' : 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
        res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        res.writeHead(shell ? 503 : 404, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(shell ? 'Frontend assets are missing. In a source checkout, run npm ci and npm run build, then reload. For an installed package, reinstall with npm lifecycle scripts enabled.' : 'Not found');
    }
    return true;
}

export { serveAsset };
