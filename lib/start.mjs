/**
 * `repo-map` with no command: the one-step path. It asks nothing in the
 * terminal; setup happens in the browser.
 *
 *   1. No .repo-map/config.json → write one with detected defaults
 *   2. Serve on a free port and open the browser
 *
 * With no map yet, the browser opens on the onboarding screen: project
 * details, AI tools, then building the map (and sitemap). A stale map is
 * offered for update from the banner in the browser.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { detectProvider } from './ai/index.mjs';
import { MAP_DIR, findRepoRoot, loadConfig, loadMap } from './config.mjs';
import { mapStatus } from './freshness.mjs';
import { openBrowser } from './open.mjs';
import { git } from './repo.mjs';
import { writeConfig } from './scaffold.mjs';
import { startServer } from './server.mjs';

const dim = (s) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s);

async function repoRoot(dir) {
    if (dir) {
        return path.resolve(dir);
    }
    return findRepoRoot(process.cwd()) || (await git(process.cwd(), 'rev-parse', '--show-toplevel')) || process.cwd();
}

async function runStart(opts = {}) {
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY);
    const root = await repoRoot(opts.dir);
    if (!existsSync(path.join(root, MAP_DIR, 'config.json'))) {
        const { file } = await writeConfig(root, {});
        console.log(`Created ${(path.relative(process.cwd(), file) || file).replace(/\\/g, '/')}`);
    }

    const config = await loadConfig(root);
    const provider = await detectProvider(config);
    const requested = opts.port || Number(process.env.REPO_MAP_PORT) || 4477;
    const { port } = await startServer({ root, port: requested, findFreePort: !opts.port });
    const url = `http://localhost:${port}`;
    console.log(`\n${bold(config.name)} → ${url}`);
    const current = await loadMap(root);
    const st = await mapStatus(root, config, current);
    if (!current.nodes.length) {
        console.log('No map yet. Finish setup in the browser: check the project details, pick AI tools and press Build.');
    } else if (st.state === 'stale') {
        console.log(`Map is out of date (${st.changed} file${st.changed === 1 ? '' : 's'} changed). Update it from the banner in the browser, or with \`repo-map update\`.`);
    }
    if (current.nodes.length) {
        console.log(provider.available
            ? dim(`Traces use ${provider.label} by default; pick another tool or model beside the Trace button.`)
            : dim('Tracing is off. Pick an AI tool in the browser, or run `repo-map ai <tool>` (see `repo-map doctor`).'));
    }
    console.log(dim('Press Ctrl+C to stop.'));
    if (opts.open !== false && interactive && !opts.yes) {
        openBrowser(url);
    }
}

export { runStart };
