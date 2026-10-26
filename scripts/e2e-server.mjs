import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startServer } from '../lib/server.mjs';

// The shop and its linked API sit side by side, as examples/ has them (workspace.json links ../shop-api).
const base = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-map-browser-'));
const root = path.join(base, 'shop');
await fs.cp(new URL('../examples/shop/', import.meta.url), root, { recursive: true });
await fs.cp(new URL('../examples/shop-api/', import.meta.url), path.join(base, 'shop-api'), { recursive: true });
process.env.REPO_MAP_AI_PROVIDER = 'none';
const { server } = await startServer({ root, port: 4499 });
let closing = false;
async function close() {
    if (closing) return;
    closing = true;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(base, { recursive: true, force: true });
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
