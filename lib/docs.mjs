/**
 * The docs pass: a separate agent run (with the map's tool, model and effort)
 * that links sections of the repo's documents, agent guidance files and doc
 * comments in code to the map cards they explain. Saved to .repo-map/docs.json:
 *
 *   { commit, generatedAt, links: { [nodeId]: [{ path, start, end, title, why, kind }] } }
 *
 * kind is "guide" (agent guidance: AGENTS.md, CLAUDE.md…), "doc" or "comment".
 * Cards list them in that order, before their code.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { detectProvider, runAi, spendText } from './ai/index.mjs';
import { MAP_DIR } from './config.mjs';
import { guidancePaths, readGuidance } from './guidance.mjs';
import { extractJson } from './json.mjs';
import { docsPrompt } from './prompts.mjs';
import { clampRef, findDocFiles, git, isDocPath, readablePath } from './repo.mjs';

const KINDS = ['guide', 'doc', 'comment'];
const MAX_PER_NODE = 6;
const MAX_LINES = 160;
const MAX_HEADINGS = 30;

const docsFile = (root) => path.join(root, MAP_DIR, 'docs.json');

/** docs.json, or an empty set of links. */
async function loadDocs(root) {
    try {
        const raw = JSON.parse(await fs.readFile(docsFile(root), 'utf8'));
        return { commit: raw.commit || null, generatedAt: raw.generatedAt || null, links: raw.links && typeof raw.links === 'object' ? raw.links : {} };
    } catch {
        return { commit: null, generatedAt: null, links: {} };
    }
}

async function saveDocs(root, docs) {
    await fs.writeFile(docsFile(root), JSON.stringify(docs, null, 2) + '\n');
}

/** Line count and headings ("L12 Title") of a document, for the prompt. */
async function outline(root, config, rel) {
    const target = readablePath(root, config, rel);
    const text = target ? await fs.readFile(target.abs, 'utf8').catch(() => '') : '';
    const lines = text.split('\n');
    const headings = [];
    let fence = false;
    lines.forEach((line, i) => {
        if (/^\s*(```|~~~)/.test(line)) {
            fence = !fence;
        }
        const m = !fence && (/^(#{1,4})\s+(.+?)\s*#*$/.exec(line) || /^(={1,4})\s+(.+)$/.exec(line));
        if (m && headings.length < MAX_HEADINGS) {
            headings.push(`L${i + 1} ${'  '.repeat(m[1].length - 1)}${m[2].slice(0, 80)}`);
        }
    });
    return { path: rel, lines: lines.length, headings };
}

/**
 * Check links from an agent against the map and the files: known nodes only,
 * readable files only, real line ranges, kinds normalised, guide → doc → comment,
 * at most MAX_PER_NODE per card. Pure apart from reading the files.
 */
async function cleanLinks(root, config, map, raw, guides = []) {
    const nodes = new Set(map.nodes.map((n) => n.id));
    const pathOf = Object.fromEntries(map.nodes.map((n) => [n.id, n.path ? n.path.replace(/\/?$/, '/') : null]));
    const byNode = {};
    const seen = new Set();
    for (const l of Array.isArray(raw) ? raw : []) {
        if (!l || !nodes.has(l.node)) {
            continue;
        }
        const ref = await clampRef(root, config, l);
        if (!ref || ref.end - ref.start > MAX_LINES * 2) {
            continue;
        }
        if (ref.end - ref.start >= MAX_LINES) {
            ref.end = ref.start + MAX_LINES - 1;
        }
        const key = `${l.node}|${ref.path}|${ref.start}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        // the kind follows the file, whatever the agent said
        const kind = guides.includes(ref.path) ? 'guide' : isDocPath(config, ref.path) ? 'doc' : 'comment';
        if (kind === 'comment' && (!config.docs.comments || !pathOf[l.node] || !ref.path.startsWith(pathOf[l.node]))) {
            continue; // code comments only from the card's own folder
        }
        (byNode[l.node] = byNode[l.node] || []).push({
            ...ref,
            title: String(l.title || '').replace(/\s+/g, ' ').trim().slice(0, 120),
            why: String(l.why || '').replace(/\s+/g, ' ').trim().slice(0, 300),
            kind,
        });
    }
    for (const id of Object.keys(byNode)) {
        // stable sort: guide, doc, comment, keeping the agent's order within each
        byNode[id] = byNode[id].sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind)).slice(0, MAX_PER_NODE);
    }
    return byNode;
}

/** Drop links to cards that are no longer on the map. Returns how many cards lost theirs. */
async function pruneDocs(root, map) {
    const docs = await loadDocs(root);
    const ids = new Set(map.nodes.map((n) => n.id));
    const gone = Object.keys(docs.links).filter((id) => !ids.has(id));
    if (gone.length) {
        gone.forEach((id) => delete docs.links[id]);
        await saveDocs(root, docs);
    }
    return gone.length;
}

/** Documents changed since docs.json was made (committed changes, like the map's own status). */
async function docsStatus(root, config) {
    const docs = await loadDocs(root);
    if (!docs.commit) {
        return { linked: Object.keys(docs.links).length > 0, commit: null, changed: 0, files: [] };
    }
    const names = await git(root, 'diff', '--name-only', docs.commit, 'HEAD');
    const files = names.split('\n').filter((f) => f && isDocPath(config, f));
    return { linked: true, commit: docs.commit, generatedAt: docs.generatedAt, changed: files.length, files: files.slice(0, 50) };
}

/**
 * Run the docs pass and write docs.json. `map` is the current map (nodes are
 * what links attach to). Returns { target, counts, label, seconds, spend }.
 */
async function linkDocs({ root, config, map, onProgress = () => {}, onStart = () => {}, pick }) {
    if (!map.nodes.length || map.starter) {
        throw Object.assign(new Error('Draw the map first: docs are linked to its cards.'), { code: 'empty' });
    }
    const provider = await detectProvider(config, 'generate');
    if (!provider.available) {
        throw Object.assign(new Error(`${provider.reason} Run \`repo-map doctor\` for help.`), { code: 'unavailable' });
    }
    onProgress('Finding documents…');
    const [files, guides, guidance] = await Promise.all([findDocFiles(root, config), guidancePaths(root), readGuidance(root)]);
    const docFiles = await Promise.all(files.map((f) => outline(root, config, f)));
    const t0 = Date.now();
    const run = await runAi({
        root,
        config,
        task: 'generate',
        pick,
        prompt: docsPrompt(config, map, { docFiles, guidancePaths: guides, comments: config.docs.comments, guidance }),
        onProgress,
        maxTurns: 80,
        timeoutMs: Math.max(config.ai.timeoutMs, 20 * 60 * 1000),
    });
    onStart(run);
    const out = await run.promise;
    const parsed = extractJson(out.text);
    const raw = parsed && (Array.isArray(parsed) ? parsed : parsed.links);
    if (!Array.isArray(raw)) {
        throw Object.assign(new Error(`${run.label} didn't return doc links in the expected shape. Try again, or use a stronger model.`), { code: 'failed' });
    }
    onProgress('Checking the links…');
    const links = await cleanLinks(root, config, map, raw, guides);
    const docs = { commit: (await git(root, 'rev-parse', 'HEAD')) || null, generatedAt: new Date().toISOString(), links };
    await saveDocs(root, docs);
    const all = Object.values(links).flat();
    return {
        target: docsFile(root),
        counts: { cards: Object.keys(links).length, links: all.length, guide: all.filter((l) => l.kind === 'guide').length, comment: all.filter((l) => l.kind === 'comment').length, documents: files.length },
        label: run.label,
        seconds: Math.round((Date.now() - t0) / 1000),
        spend: spendText(out),
    };
}

/** One line for the terminal about a linkDocs() result. */
function describeLinks(r) {
    const c = r.counts;
    const parts = [c.guide && `${c.guide} from agent guidance`, c.comment && `${c.comment} code comment${c.comment === 1 ? '' : 's'}`].filter(Boolean);
    return `Linked ${c.links} doc section${c.links === 1 ? '' : 's'} to ${c.cards} card${c.cards === 1 ? '' : 's'}${parts.length ? ` (${parts.join(', ')})` : ''}, from ${c.documents} document${c.documents === 1 ? '' : 's'}, in ${r.seconds}s${r.spend ? ` (${r.spend})` : ''}.`;
}

export { cleanLinks, describeLinks, docsFile, docsStatus, linkDocs, loadDocs, outline, pruneDocs };
