/**
 * `repo-map` with no command: the one-step path. Sets up whatever is missing,
 * asking only when it has to, then opens the map.
 *
 *   1. No .repo-map/config.json  → ask for a name, code folders and a one-line description
 *   2. No working AI tool        → offer the tools found on this machine (or skip)
 *   3. No map yet                → draft one with the AI tool, or start from the folder structure
 *   4. Serve on a free port and open the browser
 *
 * Without a terminal (CI, piped input) it never asks: it uses defaults, skips
 * the AI draft, and starts from the folder structure.
 */
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { effortsFor, listAgents } from './ai/agents.mjs';
import { describeLinks } from './docs.mjs';
import { detectProvider } from './ai/index.mjs';
import { which } from './ai/which.mjs';
import { MAP_DIR, deepMerge, findRepoRoot, globalAiFile, loadConfig, loadMap } from './config.mjs';
import { generateMap } from './generate.mjs';
import { mapStatus } from './freshness.mjs';
import { updateMap } from './update.mjs';
import { openBrowser } from './open.mjs';
import { git } from './repo.mjs';
import { detectDefaults, normaliseRoots, starterMap, writeConfig } from './scaffold.mjs';
import { startServer } from './server.mjs';
import { aiPatch, writeAiSettings } from './settings.mjs';
import { createSpinner } from './spinner.mjs';

const dim = (s) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s);
const bold = (s) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s);

/** Minimal prompt helper on top of readline; `hidden` masks typed input (API keys). */
function createAsker() {
    let muted = false;
    const output = new Writable({
        write(chunk, enc, cb) {
            if (!muted) {
                process.stdout.write(chunk, enc);
            }
            cb();
        },
    });
    const rl = createInterface({ input: process.stdin, output, terminal: true });
    const ask = async (question, def = '', { hidden = false } = {}) => {
        const suffix = def ? dim(` (${def})`) : '';
        // readline writes the prompt synchronously; mute after it so hidden input isn't echoed
        const pending = rl.question(`${question}${suffix} `);
        muted = hidden;
        const answer = (await pending).trim();
        muted = false;
        if (hidden) {
            process.stdout.write('\n');
        }
        return answer || def;
    };
    const confirm = async (question, def = true) => {
        const a = (await ask(`${question} ${dim(def ? '[Y/n]' : '[y/N]')}`)).toLowerCase();
        return a ? a.startsWith('y') : def;
    };
    const choose = async (question, options, defIndex = 0) => {
        console.log(question);
        options.forEach((o, i) => console.log(`  ${i + 1}. ${o.label}${o.hint ? dim(`  ${o.hint}`) : ''}`));
        for (;;) {
            const a = await ask('Choose', String(defIndex + 1));
            const n = Number(a);
            if (Number.isInteger(n) && n >= 1 && n <= options.length) {
                return options[n - 1];
            }
            console.log(`Type a number from 1 to ${options.length}.`);
        }
    };
    return { ask, confirm, choose, close: () => rl.close() };
}

const SETUP_ORDER = ['claude', 'ollama', 'lmstudio', 'codex', 'gemini', 'api'];
const SETUP_LABELS = { ollama: 'Ollama (local model, free)', lmstudio: 'LM Studio (local model, free)' };
const PREFERRED_LOCAL = /coder|qwen|llama3|mistral|deepseek/i;

/** AI tools this machine can use right now, best first. */
async function availableChoices(config) {
    const [agents, ollamaBin] = await Promise.all([listAgents(config, { refresh: true }), which('ollama')]);
    const ready = agents.filter((a) => a.available && SETUP_ORDER.includes(a.id))
        .sort((a, b) => SETUP_ORDER.indexOf(a.id) - SETUP_ORDER.indexOf(b.id));
    const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
    const choices = ready.map((a) => ({
        key: a.id,
        label: SETUP_LABELS[a.id] || a.label,
        hint: a.kind === 'api' ? `${plural(a.models.length, 'model')} available` : 'installed',
        agent: a,
    }));
    if (!ready.some((a) => a.id === 'api')) {
        const envKey = process.env.REPO_MAP_API_KEY || process.env.OPENAI_API_KEY;
        choices.push({ key: 'openai', label: 'OpenAI API', hint: envKey ? 'key found in your environment' : 'needs an API key' });
    }
    return { choices, ollamaInstalledNotRunning: Boolean(ollamaBin) && !ready.some((a) => a.id === 'ollama') };
}

/** Ask for a tool, then its model and effort. Returns { key, opts } or null for "skip". */
async function pickAgent(asker, choices, question) {
    const pick = await asker.choose(question, choices, 0);
    if (pick.key === 'skip') {
        return null;
    }
    const opts = {};
    const a = pick.agent;
    if (a && a.models.length) {
        const models = a.models.slice(0, 20);
        const label = (m) => (m.label && m.label !== m.id ? `${m.label} (${m.id})` : m.id);
        if (a.kind === 'api') {
            // local servers need a model; prefer one that's good at code
            const preferred = models.findIndex((m) => PREFERRED_LOCAL.test(m.id));
            opts.model = models.length === 1
                ? models[0].id
                : (await asker.choose('Which model?', models.map((m) => ({ label: label(m), model: m.id })), Math.max(0, preferred))).model;
        } else {
            const options = [{ label: `${a.label}’s default`, model: '' }, ...models.map((m) => ({ label: label(m), model: m.id }))];
            opts.model = (await asker.choose('Which model?', options, 0)).model;
        }
    }
    if (a) {
        const efforts = effortsFor(a, opts.model);
        if (efforts.length) {
            const options = [{ label: `${a.label}’s default`, effort: '' }, ...efforts.map((e) => ({ label: e, effort: e }))];
            opts.effort = (await asker.choose('How much effort?', options, 0)).effort;
        }
    }
    if (pick.key === 'openai') {
        opts.model = await asker.ask('Model?', 'gpt-4.1');
        if (!process.env.REPO_MAP_API_KEY && !process.env.OPENAI_API_KEY) {
            const key = await asker.ask('Paste your OpenAI API key (hidden; used for this session only):', '', { hidden: true });
            if (key) {
                process.env.REPO_MAP_API_KEY = key;
                console.log(dim('To skip this next time, add  export REPO_MAP_API_KEY=…  to your shell profile (~/.zshrc). Keys are never saved to files.'));
            }
        }
    }
    return { key: pick.key, opts };
}

/**
 * Choose the AI tool for traces and, optionally, a different one (or a
 * stronger model) for drawing and updating the map. Saved to the personal
 * settings file, so each person can use their own.
 */
async function setupAi(asker, root) {
    const config = await loadConfig(root);
    const { choices, ollamaInstalledNotRunning } = await availableChoices(config);
    console.log(`\n${bold('Plain-language tracing')} needs an AI tool to read your code (read-only). The map works without one.`);
    if (ollamaInstalledNotRunning) {
        console.log(dim('Ollama is installed but not running. Start it with `ollama serve` to use a free local model.'));
    }
    const skip = { key: 'skip', label: 'Skip for now', hint: 'map only; you can still open trace codes teammates share' };
    const trace = await pickAgent(asker, [...choices, skip], 'Which AI tool should traces use? (You can switch per trace in the browser.)');
    if (!trace) {
        await writeAiSettings({ root: null, scope: 'global', patch: { provider: 'auto', setupSkipped: true } });
        console.log(dim('Skipped. Turn tracing on any time with `repo-map ai <tool>`.'));
        return;
    }
    let patch = aiPatch(trace.key, trace.opts);
    console.log(dim('\nDrawing the map reads the whole codebase once, so a stronger model or higher effort pays off there.'));
    if (!(await asker.confirm('Use the same tool and model to draw and update the map?', true))) {
        const gen = await pickAgent(asker, choices, 'Which AI tool should draw and update the map?');
        patch = deepMerge(patch, aiPatch(gen.key, gen.opts, 'generate'));
    } else {
        patch.generate = { provider: '', model: '', effort: '' };
    }
    const { file } = await writeAiSettings({ root: null, scope: 'global', patch });
    console.log(dim(`Saved to ${file}. Change it any time with \`repo-map ai <tool>\` (add --for generate for the map).`));
}

async function repoRoot(dir) {
    if (dir) {
        return path.resolve(dir);
    }
    return findRepoRoot(process.cwd()) || (await git(process.cwd(), 'rev-parse', '--show-toplevel')) || process.cwd();
}

async function runStart(opts = {}) {
    const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !opts.yes;
    const root = await repoRoot(opts.dir);
    const asker = interactive ? createAsker() : null;
    try {
        // 1. config
        if (!existsSync(path.join(root, MAP_DIR, 'config.json'))) {
            const defaults = await detectDefaults(root);
            const patch = {};
            if (interactive) {
                console.log(`${bold('Setting up repo-map')} for ${root}\n${dim('Press Enter to accept the suggestion in brackets.')}\n`);
                patch.name = await asker.ask('Name for this map?', defaults.name);
                patch.codeRoots = normaliseRoots((await asker.ask('Which folders hold the code? (comma-separated)', defaults.codeRoots.join(', '))).split(','));
                const context = await asker.ask('In a sentence or two, what is this repo? (optional, helps the AI)');
                if (context) {
                    patch.prompt = { context };
                }
            }
            const { file } = await writeConfig(root, patch);
            console.log(`Created ${(path.relative(process.cwd(), file) || file).replace(/\\/g, '/')}`);
        }
        let config = await loadConfig(root);

        // 2. AI tool
        let provider = await detectProvider(config);
        let globalAi = {};
        try {
            globalAi = JSON.parse(await fs.readFile(globalAiFile(), 'utf8'));
        } catch {
            // none yet
        }
        if (!provider.available && interactive && config.ai.provider !== 'none' && !globalAi.setupSkipped) {
            await setupAi(asker, root);
            config = await loadConfig(root);
            provider = await detectProvider(config);
        }

        // drawing and updating the map can use its own tool/model (ai.generate)
        const mapper = await detectProvider(config, 'generate');

        // 3. map
        const map = await loadMap(root);
        if (!map.nodes.length) {
            let drafted = false;
            if (mapper.available && interactive) {
                const go = await asker.confirm(`\nDraft the map now with ${mapper.label}? It reads your code (read-only) and usually takes a few minutes.`, true);
                if (go) {
                    drafted = await draft(root, config);
                }
            }
            if (!drafted) {
                const starter = await starterMap(root, config);
                await fs.writeFile(path.join(root, MAP_DIR, 'map.json'), JSON.stringify(starter, null, 2) + '\n');
                console.log(`Started a map from your folders (${starter.nodes.length} folder${starter.nodes.length === 1 ? "" : "s"}, no connections yet).`
                    + (mapper.available ? dim(' Draft a full one later with `repo-map generate --force`.') : ''));
            }
        }
        // 3b. stale map: offer an incremental update (it spends AI usage, so the default is no)
        if (map.nodes.length && mapper.available && interactive) {
            const st = await mapStatus(root, config, map);
            if (st.state === 'stale' && !st.tooBig) {
                const go = await asker.confirm(`\nThe map is out of date: ${st.changed} file${st.changed === 1 ? '' : 's'} changed since it was evaluated. Update it now with ${mapper.label}? It only looks at what changed.`, false);
                if (go) {
                    await runUpdate(root, config);
                }
            }
        }
    } finally {
        asker?.close();
    }

    // 4. serve
    const config = await loadConfig(root);
    const provider = await detectProvider(config);
    const requested = opts.port || Number(process.env.REPO_MAP_PORT) || 4477;
    const { port } = await startServer({ root, port: requested, findFreePort: !opts.port });
    const url = `http://localhost:${port}`;
    console.log(`\n${bold(config.name)} → ${url}`);
    const st = await mapStatus(root, config, await loadMap(root));
    if (st.state === 'stale') {
        console.log(`Map is out of date (${st.changed} file${st.changed === 1 ? '' : 's'} changed). Update it from the banner in the browser, or with \`repo-map update\`.`);
    }
    console.log(provider.available
        ? dim(`Traces use ${provider.label} by default; pick another tool or model beside the Trace button.`)
        : dim('Tracing is off. Turn it on with `repo-map ai <tool>` (see `repo-map doctor`).'));
    console.log(dim('Press Ctrl+C to stop.'));
    if (opts.open !== false && interactive) {
        openBrowser(url);
    }
}

async function runUpdate(root, config) {
    const spinner = createSpinner('Updating map...');
    let run;
    const onSigint = () => {
        spinner.stop();
        run?.kill();
        console.log('\nStopped updating.');
    };
    process.once('SIGINT', onSigint);
    try {
        const r = await updateMap({
            root,
            config,
            onStart: (x) => {
                run = x;
            },
            onProgress: (t) => spinner.progress(dim(`  ${t}`)),
        });
        spinner.stop();
        if (r.state === 'updated') {
            console.log(`Updated the map: ${r.counts.added} added, ${r.counts.updated} changed, ${r.counts.removed} removed.${r.summary ? ` ${r.summary}` : ''}`);
        }
    } catch (err) {
        spinner.stop();
        console.log(`Couldn't update the map: ${err.message}`);
    } finally {
        spinner.stop();
        process.off('SIGINT', onSigint);
    }
}

async function draft(root, config) {
    console.log('');
    const spinner = createSpinner('Drafting map...');
    let last = '';
    let run;
    const onSigint = () => {
        spinner.stop();
        run?.kill();
        console.log('\nStopped drafting.');
    };
    process.once('SIGINT', onSigint);
    try {
        const result = await generateMap({
            root,
            config,
            onStart: (r) => {
                run = r;
            },
            onProgress: (text) => {
                if (text !== last) {
                    last = text;
                    spinner.progress(dim(`  ${text}`));
                }
            },
        });
        spinner.stop();
        const { counts, errors } = result.check;
        console.log(`Drafted ${MAP_DIR}/map.json: ${counts.nodes} nodes, ${counts.edges} connections in ${result.seconds}s${result.spend ? ` (${result.spend})` : ''}.`);
        if (result.docs) {
            console.log(describeLinks(result.docs));
        } else if (result.docsError) {
            console.log(dim(`Couldn’t link documentation (${result.docsError}). Try again later with \`repo-map docs\`.`));
        }
        if (errors.length) {
            console.log(dim(`${errors.length} problems to tidy up later; run \`repo-map validate\` for the list.`));
        }
        return true;
    } catch (err) {
        spinner.stop();
        console.log(`Couldn't draft the map: ${err.message}`);
        console.log(dim('Starting from your folders instead.'));
        return false;
    } finally {
        spinner.stop();
        process.off('SIGINT', onSigint);
    }
}

export { availableChoices, runStart };
