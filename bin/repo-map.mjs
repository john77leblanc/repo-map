#!/usr/bin/env node
/**
 * repo-map: an interactive architecture map of a repo, with process tracing
 * through the Claude Code CLI. Each repo keeps its own .repo-map/ folder.
 *
 *   repo-map init       create .repo-map/config.json for this repo
 *   repo-map generate   draft .repo-map/map.json with Claude Code
 *   repo-map validate   check map.json for broken ids, groups and paths
 *   repo-map serve      open the map on http://localhost:4477
 */
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runClaude, extractJson } from '../lib/claude.mjs';
import { MAP_DIR, findRepoRoot, loadConfig, loadMap } from '../lib/config.mjs';
import { generatePrompt } from '../lib/prompts.mjs';
import { git, githubFromRemote } from '../lib/repo.mjs';
import { startServer } from '../lib/server.mjs';
import { validateMap } from '../lib/validate.mjs';

const PKG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELP = `repo-map <command> [options]

Commands
  init        Create .repo-map/ with a starter config.json for this repo
  generate    Draft .repo-map/map.json with Claude Code (writes map.draft.json if a map exists)
  validate    Check map.json for unknown ids, groups, kinds and missing paths
  serve       Start the map on http://localhost:<port> (default)

Options
  --dir <path>    Repo root (default: nearest folder with .repo-map/, else the current folder)
  --port <n>      Port for serve (default 4477, or REPO_MAP_PORT)
  --force         generate: overwrite map.json instead of writing map.draft.json
  --model <id>    Claude Code model for generate / traces (overrides config)
  -v, --version   Print the version
  -h, --help      Show this help`;

function parseArgs(argv) {
    const opts = { cmd: 'serve' };
    const rest = [...argv];
    if (rest[0] && !rest[0].startsWith('-')) {
        opts.cmd = rest.shift();
    }
    while (rest.length) {
        const a = rest.shift();
        if (a === '--dir') {
            opts.dir = rest.shift();
        } else if (a === '--port') {
            opts.port = Number(rest.shift());
        } else if (a === '--force') {
            opts.force = true;
        } else if (a === '--model') {
            opts.model = rest.shift();
        } else if (a === '-v' || a === '--version') {
            opts.cmd = 'version';
        } else if (a === '-h' || a === '--help') {
            opts.cmd = 'help';
        } else {
            throw new Error(`Unknown option ${a}`);
        }
    }
    return opts;
}

function resolveRoot(opts, { mustExist = true } = {}) {
    if (opts.dir) {
        return path.resolve(opts.dir);
    }
    const found = findRepoRoot(process.cwd());
    if (!found && mustExist) {
        throw new Error(`No ${MAP_DIR}/ folder found here or above. Run \`repo-map init\` in the repo root first.`);
    }
    return found || process.cwd();
}

async function cmdInit(opts) {
    const root = resolveRoot(opts, { mustExist: false });
    const dir = path.join(root, MAP_DIR);
    const cfgFile = path.join(dir, 'config.json');
    if (existsSync(cfgFile)) {
        console.log(`${path.relative(process.cwd(), cfgFile) || cfgFile} already exists; leaving it alone.`);
        return;
    }
    const template = JSON.parse(await fs.readFile(path.join(PKG_DIR, 'templates', 'config.json'), 'utf8'));
    const remote = await git(root, 'remote', 'get-url', 'origin');
    const guesses = ['src', 'app', 'apps', 'pages', 'components', 'lib', 'services', 'packages', 'server', 'client']
        .filter((d) => existsSync(path.join(root, d)));
    template.name = `${path.basename(root)} map`;
    template.github = githubFromRemote(remote);
    if (guesses.length) {
        template.codeRoots = guesses.map((d) => `${d}/`);
    }
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(cfgFile, JSON.stringify(template, null, 4) + '\n');
    await fs.writeFile(path.join(dir, '.gitignore'), 'traces/\nmap.draft.json\nmap.raw.txt\n');
    console.log(`Created ${MAP_DIR}/config.json (code roots: ${template.codeRoots.join(', ')}).
Next:
  1. Edit ${MAP_DIR}/config.json: name, codeRoots, columns, prompt.context.
  2. repo-map generate     # drafts ${MAP_DIR}/map.json with Claude Code
  3. repo-map validate
  4. repo-map serve`);
}

async function cmdGenerate(opts) {
    const root = resolveRoot(opts);
    const config = await loadConfig(root);
    if (opts.model) {
        config.claude.model = opts.model;
    }
    const existing = await loadMap(root);
    const target = path.join(root, MAP_DIR, existing.nodes.length && !opts.force ? 'map.draft.json' : 'map.json');
    config.claude.maxTurns = Math.max(config.claude.maxTurns, 120);
    config.claude.timeoutMs = Math.max(config.claude.timeoutMs, 30 * 60 * 1000);
    console.log(`Exploring ${root} with Claude Code (read-only). This can take several minutes…`);
    const t0 = Date.now();
    const run = runClaude({
        root,
        claude: config.claude,
        prompt: generatePrompt(config, existing.nodes.length ? existing : null),
        onProgress: (text) => process.stdout.write(`  ${text}\n`),
    });
    process.on('SIGINT', () => {
        run.kill();
        process.exit(130);
    });
    const out = await run.promise;
    const map = extractJson(out.text);
    if (!map || !Array.isArray(map.nodes)) {
        const raw = path.join(root, MAP_DIR, 'map.raw.txt');
        await fs.writeFile(raw, String(out.text || ''));
        throw new Error(`Claude Code didn't return a map in the expected shape. Its reply is in ${raw}.`);
    }
    map.generatedAt = new Date().toISOString();
    await fs.writeFile(target, JSON.stringify(map, null, 2) + '\n');
    const check = validateMap(root, config, { groups: map.groups || [], nodes: map.nodes, edges: map.edges || [] });
    console.log(`\nWrote ${path.relative(root, target)}: ${check.counts.groups} groups, ${check.counts.nodes} nodes, ${check.counts.edges} edges in ${Math.round((Date.now() - t0) / 1000)}s${out.cost ? ` ($${out.cost.toFixed(2)})` : ''}.`);
    if (check.errors.length || check.warnings.length) {
        console.log(`${check.errors.length} errors, ${check.warnings.length} warnings. Run \`repo-map validate\` for details.`);
    }
    if (target.endsWith('draft.json')) {
        console.log(`Review it against map.json, then rename it to map.json (or rerun with --force).`);
    }
}

async function cmdValidate(opts) {
    const root = resolveRoot(opts);
    const config = await loadConfig(root);
    const { errors, warnings, counts } = validateMap(root, config, await loadMap(root));
    warnings.forEach((w) => console.log(`warn   ${w}`));
    errors.forEach((e) => console.log(`error  ${e}`));
    console.log(`${counts.groups} groups, ${counts.nodes} nodes, ${counts.edges} edges · ${errors.length} errors, ${warnings.length} warnings`);
    if (errors.length) {
        process.exitCode = 1;
    }
}

async function cmdServe(opts) {
    const root = resolveRoot(opts);
    const config = await loadConfig(root);
    const port = opts.port || Number(process.env.REPO_MAP_PORT) || 4477;
    if (opts.model) {
        // serve re-reads config per request, so pass the override through the environment
        process.env.REPO_MAP_MODEL = opts.model;
    }
    await startServer({ root, port });
    console.log(`${config.name} → http://localhost:${port}`);
    console.log(`Reading ${root}`);
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    const commands = { init: cmdInit, generate: cmdGenerate, validate: cmdValidate, serve: cmdServe };
    if (opts.cmd === 'version') {
        const pkg = JSON.parse(await fs.readFile(path.join(PKG_DIR, 'package.json'), 'utf8'));
        console.log(pkg.version);
        return;
    }
    if (opts.cmd === 'help' || !commands[opts.cmd]) {
        console.log(HELP);
        process.exitCode = opts.cmd === 'help' ? 0 : 1;
        return;
    }
    await commands[opts.cmd](opts);
}

main().catch((err) => {
    console.error(`repo-map: ${err.message}`);
    process.exit(1);
});
