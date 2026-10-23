import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startServer } from '../lib/server.mjs';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'repo-map-browser-'));
await fs.cp(new URL('../examples/shop/', import.meta.url), root, { recursive: true });
process.env.REPO_MAP_AI_PROVIDER = 'none';
const { server } = await startServer({ root, port: 4499 });
let closing = false;
async function close() {
    if (closing) return;
    closing = true;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
