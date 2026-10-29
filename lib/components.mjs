import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runAi } from './ai/index.mjs';
import { loadMap, MAP_DIR } from './config.mjs';
import { normalizeComponents } from './components-data.mjs';
import { mapStatus } from './freshness.mjs';
import { readGuidance } from './guidance.mjs';
import { componentsPrompt } from './prompts.mjs';
import { clampRef, git, safePath } from './repo.mjs';
import { RESPONSE_SCHEMAS } from './response-contracts.mjs';
import { dirtyCode, freshnessConfig, loadSitemap } from './sitemap.mjs';

const componentsFile = (root) => path.join(root, MAP_DIR, 'components.json');
const screenIdsOf = (sitemap) => sitemap ? new Set(sitemap.screens.map((s) => s.id)) : null;

/** Every component must resolve to readable code; links to dropped components go with them. */
async function cleanComponents(root, config, raw, sitemap = null) {
    const first = normalizeComponents(raw, screenIdsOf(sitemap));
    if (!first) throw new Error('The AI tool did not return a usable component map. Try generating it again.');
    let omitted = false;
    for (const component of first.components) {
        const checked = [];
        for (const ref of component.refs) {
            if (!safePath(root, config, ref.path) || !Number.isInteger(ref.start) || ref.start < 1 || !Number.isInteger(ref.end) || ref.end < ref.start) continue;
            const value = await clampRef(root, config, ref);
            if (value && value.start === ref.start && value.end === ref.end) {
                checked.push({ ...value, end: Math.min(value.end, value.start + 59), why: ref.why });
            }
        }
        component.refs = checked;
        if (!checked.length) omitted = true;
    }
    if (!omitted) return first;
    const kept = first.components.filter((c) => c.refs.length);
    const ids = new Set(kept.map((c) => c.id));
    const gaps = [...first.gaps, 'Components without valid code evidence were omitted. Regenerate to refresh missing or changed references.'];
    return { ...first, applicability: first.applicability === 'none' ? 'none' : 'incomplete', gaps, components: kept,
        uses: first.uses.filter((u) => ids.has(u.from) && ids.has(u.to)),
        screens: first.screens.filter((s) => ids.has(s.root)) };
}

async function loadComponents(root, config, sitemap = undefined) {
    let raw;
    try {
        raw = await fs.readFile(componentsFile(root), 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
    const current = sitemap === undefined ? await loadSitemap(root, config) : sitemap;
    return cleanComponents(root, config, JSON.parse(raw), current);
}

async function componentsStatus(root, config, components) {
    const dirty = await dirtyCode(root, config);
    if (!components) return { state: 'missing', dirty };
    const status = await mapStatus(root, freshnessConfig(config), { nodes: [{}], commit: components.commit, evaluatedAt: components.generatedAt });
    return { ...status, dirty, dirtyAtGeneration: components.dirtyAtGeneration };
}

async function generateComponents({ root, config, onProgress = () => {}, onStart = () => {} }) {
    const sitemap = await loadSitemap(root, config);
    if (!sitemap || !sitemap.screens.length) {
        throw Object.assign(new Error('Generate the sitemap before mapping components.'), { code: 'sitemap' });
    }
    const map = await loadMap(root);
    const commit = await git(root, 'rev-parse', 'HEAD');
    const dirtyBefore = await dirtyCode(root, config);
    let cancelled = false;
    const run = await runAi({ root, config, task: 'generate',
        responseSchema: RESPONSE_SCHEMAS.components,
        prompt: componentsPrompt(config, sitemap, map, { guidance: await readGuidance(root) }),
        maxTurns: 120, timeoutMs: Math.max(config.ai.timeoutMs, 30 * 60 * 1000), onProgress });
    onStart({ ...run, kill: () => { cancelled = true; run.kill(); } });
    const out = await run.promise;
    const raw = out.value;
    const components = await cleanComponents(root, config, raw, sitemap);
    if (raw.components?.length && !components.components.length) {
        throw new Error('No components had valid code evidence. The previous component map was kept.');
    }
    if (cancelled) throw new Error('Component generation stopped.');
    const cards = new Set(map.nodes.map((n) => n.id));
    for (const component of components.components) if (component.card && !cards.has(component.card)) delete component.card;
    components.generatedAt = new Date().toISOString();
    delete components.commit;
    if (commit) components.commit = commit;
    components.dirtyAtGeneration = dirtyBefore || await dirtyCode(root, config);
    const file = componentsFile(root);
    const temporary = path.join(root, MAP_DIR, `components.${randomUUID()}.tmp`);
    try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(temporary, JSON.stringify(components, null, 2) + '\n', { flag: 'wx' });
        if (cancelled) throw new Error('Component generation stopped.');
        await fs.rename(temporary, file);
    } finally {
        await fs.rm(temporary, { force: true });
    }
    return { components, status: await componentsStatus(root, config, components), used: run.used };
}

export { cleanComponents, componentsStatus, generateComponents, loadComponents };
