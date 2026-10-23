import { createServer } from 'vite';
import { startServer } from '../lib/server.mjs';
import path from 'node:path';

const backend = await startServer({ root: path.resolve('examples/shop'), port: 4477, findFreePort: true });
const frontend = await createServer({
    server: { proxy: { '/api': { target: `http://127.0.0.1:${backend.port}`, changeOrigin: true } } },
});
try {
    await frontend.listen();
    frontend.printUrls();
} catch (error) {
    backend.server.close();
    throw error;
}
let closing = false;
async function close() {
    if (closing) return;
    closing = true;
    await frontend.close();
    backend.server.closeAllConnections();
    backend.server.close();
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
