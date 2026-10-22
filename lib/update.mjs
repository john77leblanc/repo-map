/**
 * Incremental map updates: give the AI tool the existing map plus the git diff
 * since the map's recorded commit, get back a small patch, apply it.
 */
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { detectProvider, runAi, spendText } from './ai/index.mjs';
import { MAP_DIR, loadMap } from './config.mjs';
import { docsStatus, linkDocs, pruneDocs } from './docs.mjs';
import { collectDiff, mapStatus } from './freshness.mjs';
import { readGuidance } from './guidance.mjs';
import { extractJson } from './json.mjs';
import { updatePrompt } from './prompts.mjs';
import { validateMap } from './validate.mjs';

const list = (v) => (Array.isArray(v) ? v : []);
const edgeKey = (e) => `${e.from}|${e.to}|${e.type}`;

/** Apply a patch from updatePrompt() to a map. Pure: returns a new map and what changed. */
function applyPatch(map, patch) {
    const p = patch || {};
    const out = { ...map, groups: [...map.groups], nodes: [...map.nodes], edges: [...map.edges] };
    const counts = { added: 0, updated: 0, removed: 0 };

    const applyTo = (key, section, isRef) => {
        const s = p[section] || {};
        const removeIds = new Set(list(s.remove).map((r) => (typeof r === 'string' ? r : r?.id)).filter(Boolean));
        if (removeIds.size) {
            const before = out[key].length;
            out[key] = out[key].filter((x) => !removeIds.has(x.id));
            counts.removed += before - out[key].length;
        }
        for (const u of list(s.update)) {
            const i = out[key].findIndex((x) => x.id === u?.id);
            if (i >= 0) {
                out[key][i] = { ...out[key][i], ...u };
                counts.updated++;
            }
        }
        const ids = new Set(out[key].map((x) => x.id));
        for (const a of list(s.add)) {
            if (a?.id && !ids.has(a.id) && isRef(a)) {
                out[key].push(a);
                ids.add(a.id);
                counts.added++;
            }
        }
        return removeIds;
    };

    applyTo('groups', 'groups', (g) => Number.isInteger(g.col));
    const removedNodes = applyTo('nodes', 'nodes', (n) => typeof n.group === 'string');

    const e = p.edges || {};
    const removeEdges = new Set(list(e.remove).map(edgeKey));
    const before = out.edges.length;
    out.edges = out.edges.filter((x) => !removeEdges.has(edgeKey(x)) && !removedNodes.has(x.from) && !removedNodes.has(x.to));
    counts.removed += before - out.edges.length;
    const have = new Set(out.edges.map(edgeKey));
    for (const a of list(e.add)) {
        if (a?.from && a?.to && a?.type && !have.has(edgeKey(a))) {
            out.edges.push(a);
            have.add(edgeKey(a));
            counts.added++;
        }
    }
    // drop anything left pointing at nodes or groups that no longer exist
    const nodeIds = new Set(out.nodes.map((n) => n.id));
    const groupIds = new Set(out.groups.map((g) => g.id));
    const dangling = out.edges.filter((x) => !nodeIds.has(x.from) || !nodeIds.has(x.to)).length;
    out.edges = out.edges.filter((x) => nodeIds.has(x.from) && nodeIds.has(x.to));
    const orphanNodes = out.nodes.filter((n) => !groupIds.has(n.group));
    return { map: out, counts, summary: String(p.summary || ''), dropped: dangling, orphanNodes: orphanNodes.map((n) => n.id) };
}

/**
 * Update map.json for the changes since its recorded commit.
 * Resolves { state: 'current' } when nothing under codeRoots changed.
 */
async function updateMap({ root, config, force = false, docs = true, pick, onProgress = () => {}, onStart = () => {} }) {
    const map = await loadMap(root);
    const status = await mapStatus(root, config, map);
    if (status.state === 'current') {
        return { state: 'current', status };
    }
    if (status.state !== 'stale') {
        const why = {
            unrecorded: 'This map has no recorded commit, so there is nothing to compare against. Run `repo-map update --mark` to record the current commit, or `repo-map generate --force` to redraw it.',
            unknown: `${status.reason} Run \`repo-map generate --force\` to redraw the map.`,
            starter: 'This is a folder-based starter map. Draft a full one with `repo-map generate`.',
            empty: 'There is no map yet. Run `repo-map` or `repo-map generate`.',
            nogit: 'This folder isn’t a git repository, so changes can’t be tracked.',
        }[status.state];
        throw Object.assign(new Error(why), { code: status.state });
    }
    if (status.tooBig && !force) {
        throw Object.assign(new Error(`${status.changed} files changed since the map was evaluated. That’s a lot for an incremental update: \`repo-map generate --force\` will redraw the map, or pass --force to update anyway.`), { code: 'too_big' });
    }
    const provider = await detectProvider(config, 'generate');
    if (!provider.available) {
        throw Object.assign(new Error(`${provider.reason} Run \`repo-map doctor\` for help.`), { code: 'unavailable' });
    }
    onProgress(`Reading the diff (${status.changed} file${status.changed === 1 ? '' : 's'} since ${status.commit.slice(0, 9)})…`);
    const diff = await collectDiff(root, config, status.commit);
    const t0 = Date.now();
    const run = await runAi({ root, config, task: 'generate', pick, prompt: updatePrompt(config, map, status, diff, { guidance: await readGuidance(root) }), onProgress, maxTurns: 60 });
    onStart(run);
    const out = await run.promise;
    const patch = extractJson(out.text);
    if (!patch || typeof patch !== 'object') {
        throw Object.assign(new Error(`${run.label} didn't return an update in the expected shape. Try again, or use a stronger model.`), { code: 'failed' });
    }
    const file = path.join(root, MAP_DIR, 'map.json');
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    const result = applyPatch({ groups: raw.groups || [], nodes: raw.nodes || [], edges: raw.edges || [] }, patch);
    const next = { ...raw, groups: result.map.groups, nodes: result.map.nodes, edges: result.map.edges, commit: status.head, evaluatedAt: new Date().toISOString() };
    const check = validateMap(root, config, next);
    if (check.errors.length) {
        throw Object.assign(new Error(`The update would break the map (${check.errors.slice(0, 3).join('; ')}). Nothing was changed. Try again, or redraw with \`repo-map generate --force\`.`), { code: 'invalid' });
    }
    // keep the previous version next to it (git-ignored) in case the update needs undoing
    if (existsSync(file)) {
        await fs.copyFile(file, path.join(root, MAP_DIR, 'map.prev.json'));
    }
    await fs.writeFile(file, JSON.stringify(next, null, 2) + '\n');
    const docsResult = docs ? await refreshDocs({ root, config, map: next, patch, pick, onProgress, onStart }) : {};
    return {
        ...docsResult,
        state: 'updated',
        status,
        summary: result.summary,
        counts: result.counts,
        label: run.label,
        seconds: Math.round((Date.now() - t0) / 1000),
        spend: spendText(out),
        warnings: check.warnings.length,
    };
}

/**
 * After an update: drop doc links to removed cards, and re-run the docs pass when
 * documents changed or cards were added (only if docs were linked before).
 */
async function refreshDocs({ root, config, map, patch, pick, onProgress, onStart }) {
    await pruneDocs(root, map);
    const st = await docsStatus(root, config);
    const added = list(patch.nodes && patch.nodes.add).length;
    if (!st.linked || (!st.changed && !added)) {
        return {};
    }
    onProgress(st.changed
        ? `${st.changed} document${st.changed === 1 ? '' : 's'} changed. Relinking documentation…`
        : 'New cards on the map. Relinking documentation…');
    try {
        return { docs: await linkDocs({ root, config, map, pick, onProgress, onStart }) };
    } catch (err) {
        return { docsError: err.message };
    }
}

export { applyPatch, updateMap };
