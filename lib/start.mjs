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
import { detectProvider } from './ai/index.mjs';
import { which } from './ai/which.mjs';
import { MAP_DIR, findRepoRoot, globalAiFile, loadConfig, loadMap } from './config.mjs';
import { generateMap } from './generate.mjs';
import { openBrowser } from './open.mjs';
import { git } from './repo.mjs';
import { detectDefaults, normaliseRoots, starterMap, writeConfig } from './scaffold.mjs';
import { startServer } from './server.mjs';
import { AI_PRESETS, writeAiSettings } from './settings.mjs';

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

async function localModels(baseUrl) {
    try {
        const res = await fetch(`${baseUrl}/models`, { signal: AbortSignal.timeout(1200) });
        if (!res.ok) {
            return null;
        }
        const data = await res.json();
        return (data.data || []).map((m) => m.id).filter(Boolean);
    } catch {
        return null;
    }
}

/** AI tools this machine can use right now, best first. */
async function availableChoices() {
    const [claude, codex, gemini, ollamaBin, ollama, lmstudio] = await Promise.all([
        which('claude'), which('codex'), which('gemini'), which('ollama'),
        localModels('http://localhost:11434/v1'), localModels('http://localhost:1234/v1'),
    ]);
    const envKey = process.env.REPO_MAP_API_KEY || process.env.OPENAI_API_KEY;
    const choices = [];
    if (claude) {
        choices.push({ key: 'claude', label: 'Claude Code', hint: 'installed' });
    }
    if (ollama?.length) {
        choices.push({ key: 'ollama', label: 'Ollama (local model, free)', hint: `${ollama.length} model${ollama.length === 1 ? '' : 's'} available`, models: ollama });
    }
    if (lmstudio?.length) {
        choices.push({ key: 'lmstudio', label: 'LM Studio (local model, free)', hint: `${lmstudio.length} model${lmstudio.length === 1 ? '' : 's'} loaded`, models: lmstudio });
    }
    if (codex) {
        choices.push({ key: 'codex', label: 'Codex CLI', hint: 'installed' });
    }
    if (gemini) {
        choices.push({ key: 'gemini', label: 'Gemini CLI', hint: 'installed' });
    }
    choices.push({ key: 'openai', label: 'OpenAI API', hint: envKey ? 'key found in your environment' : 'needs an API key' });
    choices.push({ key: 'skip', label: 'Skip for now', hint: 'map only; you can still open trace codes teammates share' });
    return { choices, ollamaInstalledNotRunning: Boolean(ollamaBin) && !ollama };
}

async function setupAi(asker, root) {
    const { choices, ollamaInstalledNotRunning } = await availableChoices();
    console.log(`\n${bold('Plain-language tracing')} needs an AI tool to read your code (read-only). The map works without one.`);
    if (ollamaInstalledNotRunning) {
        console.log(dim('Ollama is installed but not running. Start it with `ollama serve` to use a free local model.'));
    }
    const pick = await asker.choose('Which AI tool should repo-map use?', choices, 0);
    if (pick.key === 'skip') {
        await writeAiSettings({ root: null, scope: 'global', patch: { provider: 'auto', setupSkipped: true } });
        console.log(dim('Skipped. Turn tracing on any time with `repo-map ai <tool>`.'));
        return;
    }
    const opts = {};
    if (pick.models) {
        const preferred = pick.models.find((m) => /coder|qwen|llama3|mistral|deepseek/i.test(m)) || pick.models[0];
        opts.model = pick.models.length === 1
            ? pick.models[0]
            : (await asker.choose('Which model?', pick.models.slice(0, 15).map((m) => ({ label: m, model: m })), Math.max(0, pick.models.indexOf(preferred)))).model;
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
    const { file } = await writeAiSettings({ root: null, scope: 'global', patch: AI_PRESETS[pick.key](opts) });
    console.log(dim(`Saved to ${file}. Change it any time with \`repo-map ai <tool>\`.`));
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
            console.log(`Created ${path.relative(process.cwd(), file) || file}`);
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

        // 3. map
        const map = await loadMap(root);
        if (!map.nodes.length) {
            let drafted = false;
            if (provider.available && interactive) {
                const go = await asker.confirm(`\nDraft the map now with ${provider.label}? It reads your code (read-only) and usually takes a few minutes.`, true);
                if (go) {
                    drafted = await draft(root, config);
                }
            }
            if (!drafted) {
                const starter = await starterMap(root, config);
                await fs.writeFile(path.join(root, MAP_DIR, 'map.json'), JSON.stringify(starter, null, 2) + '\n');
                console.log(`Started a map from your folders (${starter.nodes.length} folder${starter.nodes.length === 1 ? "" : "s"}, no connections yet).`
                    + (provider.available ? dim(' Draft a full one later with `repo-map generate --force`.') : ''));
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
    console.log(provider.available
        ? dim(`Traces use ${provider.label}.`)
        : dim('Tracing is off. Turn it on with `repo-map ai <tool>` (see `repo-map doctor`).'));
    console.log(dim('Press Ctrl+C to stop.'));
    if (opts.open !== false && interactive) {
        openBrowser(url);
    }
}

async function draft(root, config) {
    console.log('');
    let last = '';
    let run;
    const onSigint = () => {
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
                    console.log(dim(`  ${text}`));
                }
            },
        });
        const { counts, errors } = result.check;
        console.log(`Drafted ${MAP_DIR}/map.json: ${counts.nodes} nodes, ${counts.edges} connections in ${result.seconds}s${result.spend ? ` (${result.spend})` : ''}.`);
        if (errors.length) {
            console.log(dim(`${errors.length} problems to tidy up later; run \`repo-map validate\` for the list.`));
        }
        return true;
    } catch (err) {
        console.log(`Couldn't draft the map: ${err.message}`);
        console.log(dim('Starting from your folders instead.'));
        return false;
    } finally {
        process.off('SIGINT', onSigint);
    }
}

export { availableChoices, runStart };
