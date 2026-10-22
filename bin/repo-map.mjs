#!/usr/bin/env node
/**
 * repo-map: an interactive architecture map of a repo, with process tracing
 * through an AI tool of your choice (Claude Code, Codex, Gemini, or any
 * OpenAI-compatible API including local models). Each repo keeps its own .repo-map/ folder.
 *
 *   repo-map init       create .repo-map/config.json for this repo
 *   repo-map generate   draft .repo-map/map.json with your AI tool
 *   repo-map doctor     check which AI tool will be used and whether it works
 *   repo-map validate   check map.json for broken ids, groups and paths
 *   repo-map serve      open the map on http://localhost:4477
 */
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentsSummary, checkApi, detectProvider } from '../lib/ai/index.mjs';
import { MAP_DIR, globalAiFile, findRepoRoot, loadConfig, loadMap, withDefaults } from '../lib/config.mjs';
import { AI_PRESETS, aiPatch, writeAiSettings } from '../lib/settings.mjs';
import { describeLinks, docsStatus, linkDocs, loadDocs } from '../lib/docs.mjs';
import { generateMap } from '../lib/generate.mjs';
import { writeConfig } from '../lib/scaffold.mjs';
import { startServer } from '../lib/server.mjs';
import { runStart } from '../lib/start.mjs';
import { mapStatus, markCurrent } from '../lib/freshness.mjs';
import { updateMap } from '../lib/update.mjs';
import { validateMap } from '../lib/validate.mjs';

const PKG_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HELP = `repo-map [command] [options]

Just run  repo-map  (or npx @whitemane/repo-map). It sets up whatever is missing,
asking a few questions the first time, and opens the map.

Commands
  start       The default: set up anything missing, then open the map
  init        Create .repo-map/ with a starter config.json (re-run with flags to update it)
  ai <tool>   Choose the AI tool: claude, openai, api, ollama, lmstudio, codex, gemini,
              command, auto or none.  \`repo-map ai show\` prints the effective settings
  doctor      List the AI tools found, with their models and effort levels, and check
              the ones traces and the map will use
  generate    Draft .repo-map/map.json with your AI tool (writes map.draft.json if a map exists),
              then link the repo's documentation to its cards
  update      Bring map.json up to date with the code changed since it was last evaluated
  docs        Link the repo's documentation (docs, agent guidance, code comments) to the
              map's cards again (.repo-map/docs.json)
  validate    Check map.json for unknown ids, groups, kinds and missing paths
  serve       Start the map on http://localhost:<port> (default)

Common options
  --dir <path>        Repo root (default: nearest folder with .repo-map/, else the current folder)
  --provider <p>      AI tool for this run only: auto, claude, codex, gemini, api, ollama,
                      lmstudio, command or none
  --model <id>        Model for this run (with \`ai\`: the model to save)
  --effort <level>    Effort for this run, in the tool's own terms, e.g. high (with \`ai\`: to save)
  -v, --version       Print the version
  -h, --help          Show this help

init
  --name <text>       Page title
  --roots <a,b>       Code folders, comma-separated (e.g. src,lib)
  --context <text>    What the repo is and where code lives (given to the AI tool)
  --github <o/r|false> GitHub repo for links, or false to turn links off

ai
  --global            Save for every repo (~/.config/repo-map/ai.json)  [default]
  --local             Save for this repo, just for you (.repo-map/local.json, git-ignored)
  --repo              Save as the team default (.repo-map/config.json, committed)
  --base-url <url>    API base URL (api/openai/ollama/lmstudio)
  --key-env <VAR>     Environment variable holding the API key (default REPO_MAP_API_KEY)
  --bin <path>        CLI to run (claude/codex/gemini/command)
  --for generate      Save as the tool/model/effort for drawing and updating the map,
                      instead of the default for traces

generate
  --force             Overwrite map.json instead of writing map.draft.json
  --if-missing        Do nothing when map.json already has nodes (safe to re-run)
  --no-docs           Don't link documentation afterwards

update
  --check             Only report whether the map is out of date (exit code 1 if it is)
  --mark              Record the current commit as evaluated, without changing the map
  --force             Update even when very many files changed
  --no-docs           Don't relink documentation, even when documents changed

docs
  --check             Only report whether documents changed since they were linked
                      (exit code 1 if they did, or were never linked)

doctor
  --json              Print the result as JSON, with every tool found (exit code 1 when tracing is off)

start / serve
  --port <n>          Port (default 4477, or REPO_MAP_PORT; start moves on if it's taken)
  --no-open           start: don't open the browser
  --yes               start: don't ask questions; use defaults

Scripted setup examples are in SETUP.md.`;

const VALUE_FLAGS = {
    '--dir': 'dir', '--port': 'port', '--model': 'model', '--provider': 'provider',
    '--name': 'name', '--roots': 'roots', '--context': 'context', '--github': 'github',
    '--base-url': 'baseUrl', '--key-env': 'keyEnv', '--bin': 'bin', '--effort': 'effort', '--for': 'for',
};
const BOOL_FLAGS = {
    '--force': 'force', '--if-missing': 'ifMissing', '--json': 'json', '--yes': 'yes',
    '--global': 'global', '--local': 'local', '--repo': 'repo', '--check': 'check', '--mark': 'mark',
};

function parseArgs(argv) {
    const opts = { cmd: 'start', args: [] };
    const rest = [...argv];
    if (rest[0] && !rest[0].startsWith('-')) {
        opts.cmd = rest.shift();
    }
    while (rest.length) {
        const raw = rest.shift();
        const [a, inline] = raw.startsWith('--') && raw.includes('=') ? [raw.slice(0, raw.indexOf('=')), raw.slice(raw.indexOf('=') + 1)] : [raw, undefined];
        if (VALUE_FLAGS[a]) {
            const v = inline !== undefined ? inline : rest.shift();
            if (v === undefined || (inline === undefined && v.startsWith('--'))) {
                throw new Error(`${a} needs a value`);
            }
            opts[VALUE_FLAGS[a]] = v;
        } else if (BOOL_FLAGS[a]) {
            opts[BOOL_FLAGS[a]] = true;
        } else if (a === '--no-open') {
            opts.open = false;
        } else if (a === '--no-docs') {
            opts.docs = false;
        } else if (a === '-v' || a === '--version') {
            opts.cmd = 'version';
        } else if (a === '-h' || a === '--help') {
            opts.cmd = 'help';
        } else if (!a.startsWith('-')) {
            opts.args.push(a);
        } else {
            throw new Error(`Unknown option ${a}. Run \`repo-map --help\`.`);
        }
    }
    if (opts.port !== undefined) {
        opts.port = Number(opts.port);
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

function initPatch(opts) {
    const patch = {};
    if (opts.name !== undefined) {
        patch.name = opts.name;
    }
    if (opts.roots !== undefined) {
        patch.codeRoots = opts.roots.split(',').map((r) => r.trim()).filter(Boolean).map((r) => r.replace(/^\.?\/+/, '').replace(/\/?$/, '/'));
    }
    if (opts.context !== undefined) {
        patch.prompt = { context: opts.context };
    }
    if (opts.github !== undefined) {
        patch.github = opts.github === 'false' ? false : opts.github;
    }
    return patch;
}

async function cmdInit(opts) {
    const root = resolveRoot(opts, { mustExist: false });
    const patch = initPatch(opts);
    const { created, updated, config } = await writeConfig(root, patch);
    if (created) {
        console.log(`Created ${MAP_DIR}/config.json (code roots: ${config.codeRoots.join(', ')}).`);
        console.log('Next: run `repo-map` to finish setup and open the map.');
    } else if (updated) {
        console.log(`Updated ${MAP_DIR}/config.json: ${Object.keys(patch).join(', ')}.`);
    } else {
        console.log(`${MAP_DIR}/config.json already exists; leaving it alone. (Pass --name, --roots, --context or --github to update it.)`);
    }
}

async function cmdAi(opts) {
    const tool = opts.args[0];
    if (!tool || tool === 'show') {
        const root = resolveRoot(opts, { mustExist: false });
        const config = existsSync(path.join(root, MAP_DIR, 'config.json')) ? await loadConfig(root) : withDefaults({}, { globalAi: await readGlobalAi() });
        const [p, g] = await Promise.all([detectProvider(config), detectProvider(config, 'generate')]);
        const summary = (x) => ({ resolved: x.available ? x.id : 'none', label: x.label, available: x.available, model: x.model || undefined, effort: x.effort || undefined, reason: x.reason || undefined });
        const { provider, effort, generate, claude, codex, gemini, api, ollama, lmstudio, command, timeoutMs } = config.ai;
        console.log(JSON.stringify({ provider, effort, generate, traces: summary(p), map: summary(g), claude, codex, gemini, api, ollama, lmstudio, command, timeoutMs }, null, 2));
        return;
    }
    if (!AI_PRESETS[tool]) {
        throw new Error(`Unknown AI tool "${tool}". Use one of: ${Object.keys(AI_PRESETS).join(', ')}.`);
    }
    if (['api', 'openai'].includes(tool) && !opts.model) {
        throw new Error(`repo-map ai ${tool} needs --model <id>.`);
    }
    if (tool === 'command' && !opts.bin) {
        throw new Error('repo-map ai command needs --bin <cli>.');
    }
    const task = opts.for || 'trace';
    if (!['trace', 'generate'].includes(task)) {
        throw new Error('--for takes "generate" (drawing and updating the map) or "trace".');
    }
    const scope = opts.repo ? 'repo' : opts.local ? 'local' : 'global';
    const root = scope === 'global' ? null : resolveRoot(opts);
    const { file } = await writeAiSettings({ root, scope, patch: aiPatch(tool, opts, task) });
    console.log(`Saved AI settings (${tool}${task === 'generate' ? ', for drawing and updating the map' : ''}) to ${file}`);
    if (['api', 'openai'].includes(tool) && !opts.baseUrl?.match(/localhost|127\.0\.0\.1/)) {
        console.log(`The API key is read from $${opts.keyEnv || 'REPO_MAP_API_KEY'} (never stored in files).`);
    }
    console.log('Check it with: repo-map doctor');
}

/** --effort is passed through settings, where one a tool doesn't offer is dropped quietly. Say so instead. */
function checkRunFlags(p, opts) {
    if (p.available && opts.effort && p.effort !== opts.effort) {
        throw new Error(`${p.label} doesn’t offer effort "${opts.effort}". \`repo-map doctor\` lists each tool’s levels.`);
    }
}

async function readGlobalAi() {
    try {
        return JSON.parse(await fs.readFile(globalAiFile(), 'utf8'));
    } catch {
        return undefined;
    }
}

async function cmdGenerate(opts) {
    const root = resolveRoot(opts);
    const config = await loadConfig(root);
    const existing = await loadMap(root);
    if (opts.ifMissing && existing.nodes.length && !existing.starter) {
        console.log(`${MAP_DIR}/map.json already has ${existing.nodes.length} nodes; skipping (--if-missing).`);
        return;
    }
    const provider = await detectProvider(config, 'generate');
    checkRunFlags(provider, opts);
    if (provider.available) {
        console.log(`Exploring ${root} with ${provider.label} (read-only). This can take several minutes…`);
    }
    const result = await generateMap({
        root,
        config,
        force: opts.force,
        docs: opts.docs !== false,
        onProgress: (text) => process.stdout.write(`  ${text}\n`),
        onStart: stopOnSigint,
    });
    const { counts, errors, warnings } = result.check;
    console.log(`\nWrote ${path.relative(root, result.target)}: ${counts.groups} groups, ${counts.nodes} nodes, ${counts.edges} edges in ${result.seconds}s${result.spend ? ` (${result.spend})` : ''}.`);
    if (errors.length || warnings.length) {
        console.log(`${errors.length} errors, ${warnings.length} warnings. Run \`repo-map validate\` for details.`);
    }
    reportDocs(result);
    if (result.draft) {
        console.log('Review it against map.json, then rename it to map.json (or rerun with --force). Then link its docs with `repo-map docs`.');
    }
}

/** Ctrl+C stops the AI run in progress. */
function stopOnSigint(run) {
    process.on('SIGINT', () => {
        run.kill();
        process.exit(130);
    });
}

function reportDocs(result) {
    if (result.docs) {
        console.log(describeLinks(result.docs));
    } else if (result.docsError) {
        console.log(`Couldn’t link documentation: ${result.docsError} Try again with \`repo-map docs\`.`);
    }
}

async function cmdDocs(opts) {
    const root = resolveRoot(opts);
    const config = await loadConfig(root);
    const st = await docsStatus(root, config);
    if (opts.check) {
        if (!st.linked) {
            console.log('Documentation isn’t linked to the map yet. Run `repo-map docs`.');
        } else if (st.changed) {
            console.log(`${st.changed} document${st.changed === 1 ? '' : 's'} changed since the docs were linked${st.commit ? ` at ${st.commit.slice(0, 9)}` : ''}:`);
            st.files.slice(0, 20).forEach((f) => console.log(`  ${f}`));
        } else {
            console.log('Doc links are up to date.');
        }
        process.exitCode = st.linked && !st.changed ? 0 : 1;
        return;
    }
    const provider = await detectProvider(config, 'generate');
    checkRunFlags(provider, opts);
    if (provider.available) {
        console.log(`Linking documentation to the map's cards with ${provider.label} (read-only)…`);
    }
    const result = await linkDocs({
        root,
        config,
        map: await loadMap(root),
        onProgress: (text) => process.stdout.write(`  ${text}\n`),
        onStart: stopOnSigint,
    });
    console.log(`\n${describeLinks(result)}`);
    console.log(`Saved to ${MAP_DIR}/docs.json. Commit it with map.json.`);
}

function describeStatus(st) {
    switch (st.state) {
        case 'current': return `Map is up to date${st.commit ? ` (evaluated at ${st.commit.slice(0, 9)})` : ''}.`;
        case 'stale': return `Map is out of date: ${st.changed} file${st.changed === 1 ? '' : 's'} under the code folders changed since it was evaluated at ${st.commit.slice(0, 9)}${st.commitsSince ? ` (${st.commitsSince} commit${st.commitsSince === 1 ? '' : 's'} ago)` : ''}.`;
        case 'unrecorded': return 'Map has no recorded commit, so repo-map can’t tell whether it’s current. `repo-map update --mark` records the current one.';
        case 'unknown': return st.reason;
        case 'starter': return 'Map is a folder-based starter. Draft a full one with `repo-map generate`.';
        case 'empty': return 'There is no map yet.';
        default: return 'Not a git repository; map freshness isn’t tracked.';
    }
}

async function cmdUpdate(opts) {
    const root = resolveRoot(opts);
    const config = await loadConfig(root);
    if (opts.mark) {
        const sha = await markCurrent(root);
        console.log(`Recorded ${sha.slice(0, 9)} as the commit this map describes.`);
        return;
    }
    const st = await mapStatus(root, config, await loadMap(root));
    if (opts.check) {
        console.log(describeStatus(st));
        st.files?.slice(0, 20).forEach((f) => console.log(`  ${f}`));
        process.exitCode = st.state === 'current' ? 0 : 1;
        return;
    }
    if (st.state === 'current') {
        console.log(describeStatus(st));
        return;
    }
    console.log(describeStatus(st));
    checkRunFlags(await detectProvider(config, 'generate'), opts);
    const result = await updateMap({
        root,
        config,
        force: opts.force,
        docs: opts.docs !== false,
        onProgress: (text) => process.stdout.write(`  ${text}\n`),
        onStart: stopOnSigint,
    });
    const c = result.counts;
    console.log(`\nUpdated ${MAP_DIR}/map.json in ${result.seconds}s${result.spend ? ` (${result.spend})` : ''}: ${c.added} added, ${c.updated} changed, ${c.removed} removed.`);
    if (result.summary) {
        console.log(result.summary);
    }
    reportDocs(result);
    console.log(`Previous version saved as ${MAP_DIR}/map.prev.json. Review the change with \`git diff ${MAP_DIR}/map.json\`.`);
}

async function cmdDoctor(opts) {
    const root = resolveRoot(opts);
    const config = await loadConfig(root);
    const ai = config.ai;
    const ok = (b) => (b ? 'ok  ' : 'no  ');
    const [p, g, found] = await Promise.all([detectProvider(config), detectProvider(config, 'generate'), agentsSummary(config, { refresh: true })]);
    // API-style agents can be checked without spending tokens (GET /models)
    const check = async (x) => (x.available && x.settings ? checkApi(x.settings) : undefined);
    const [api, mapApi] = await Promise.all([check(p), g.id === p.id && g.model === p.model ? undefined : check(g)]);
    if (opts.json) {
        const ready = p.available && (!api || api.ok);
        const map = { provider: g.id, label: g.label, model: g.model || undefined, effort: g.effort || undefined, available: g.available, reason: g.reason || undefined, api: mapApi };
        console.log(JSON.stringify({ ready, provider: p.id, label: p.label, model: p.model || undefined, effort: p.effort || undefined, auto: Boolean(p.auto), reason: p.reason || undefined, api, map, agents: found.agents }, null, 2));
        process.exitCode = ready ? 0 : 1;
        return;
    }
    console.log(`repo-map doctor · ${root}\n`);
    console.log(`Node ${process.versions.node}`);
    console.log(`Settings: provider "${ai.provider}"${ai.generate.provider ? `, map: "${ai.generate.provider}"` : ''}  (sources: .repo-map/config.json, ${globalAiFile()}, .repo-map/local.json, REPO_MAP_* env vars)\n`);

    console.log('AI tools found:');
    if (!found.agents.length) {
        console.log('    none');
    }
    for (const a of found.agents) {
        console.log(`${ok(a.available)}${a.available ? a.label : a.reason}`);
        if (a.available && a.models.length) {
            const ids = a.models.map((m) => m.id);
            console.log(`      models: ${ids.slice(0, 12).join(', ')}${ids.length > 12 ? ` and ${ids.length - 12} more` : ''}`);
        }
        const efforts = [...new Set([...a.efforts, ...a.models.flatMap((m) => m.efforts || [])])];
        if (a.available && efforts.length) {
            console.log(`      effort: ${efforts.join(', ')}${a.models.some((m) => m.efforts) ? ' (depends on the model)' : ''}`);
        }
    }
    console.log('');

    if (p.available) {
        console.log(`${ok(true)}Traces will use ${p.label}${p.auto ? ' (picked automatically)' : ''}${p.detail ? `: ${p.detail}` : ''}`);
        if (api) {
            console.log(`${ok(api.ok)}API ${api.detail}`);
            if (!api.ok) {
                process.exitCode = 1;
            }
        } else {
            console.log('    Installed. Sign-in and usage limits are checked on the first trace.');
        }
        console.log(g.available
            ? `${ok(true)}The map will be drawn and updated with ${g.label}`
            : `${ok(false)}Drawing the map: ${g.reason}`);
        if (mapApi) {
            console.log(`${ok(mapApi.ok)}API ${mapApi.detail}`);
        }
        console.log('    In the browser, the menu beside the Trace button switches tool, model and effort per trace.');
    } else {
        console.log(`${ok(false)}${p.reason}`);
        (p.tried || []).slice(1).forEach((t) => console.log(`    also: ${t}`));
        console.log(`
You can still browse the map and open trace codes from teammates.
To enable tracing, set up any one of these (details in SETUP.md):
  • Claude Code:   install it and run \`claude\` once to sign in
  • Codex/Gemini:  install it and sign in, then  repo-map ai codex   (or gemini)
  • OpenAI API:    export REPO_MAP_API_KEY=sk-...   then  repo-map ai openai --model <id>
  • Local model:   run Ollama or LM Studio, then  repo-map ai ollama   (or lmstudio)`);
        process.exitCode = 1;
    }
}

async function cmdValidate(opts) {
    const root = resolveRoot(opts);
    const config = await loadConfig(root);
    const { errors, warnings, counts } = validateMap(root, config, await loadMap(root), await loadDocs(root));
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
    await startServer({ root, port });
    const p = await detectProvider(config);
    console.log(`${config.name} → http://localhost:${port}`);
    console.log(`Reading ${root}`);
    console.log(p.available ? `Traces use ${p.label}` : `Tracing is off: ${p.reason} Run \`repo-map doctor\` for options.`);
}

async function main() {
    const opts = parseArgs(process.argv.slice(2));
    // Flags become env overrides so every layer (and serve's per-request config reads) sees them
    if (opts.model) {
        process.env.REPO_MAP_MODEL = opts.model;
    }
    if (opts.effort) {
        process.env.REPO_MAP_EFFORT = opts.effort;
    }
    if (opts.provider) {
        process.env.REPO_MAP_AI_PROVIDER = opts.provider;
    }
    const commands = { start: runStart, init: cmdInit, ai: cmdAi, update: cmdUpdate, generate: cmdGenerate, docs: cmdDocs, validate: cmdValidate, doctor: cmdDoctor, serve: cmdServe };
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
