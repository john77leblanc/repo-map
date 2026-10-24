import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runAi } from './ai/index.mjs';
import { MAP_DIR } from './config.mjs';
import { mapStatus } from './freshness.mjs';
import { readGuidance } from './guidance.mjs';
import { RESPONSE_SCHEMAS } from './response-contracts.mjs';
import { sitemapPrompt } from './prompts.mjs';
import { clampRef, git, safePath } from './repo.mjs';
import { normalizeSitemap } from './sitemap-data.mjs';

const sitemapFile = (root) => path.join(root, MAP_DIR, 'sitemap.json');
// Saving/committing our own artifacts is not an application-code change, even
// when the repository root itself is a codeRoot.
const freshnessConfig = (config) => ({
    ...config,
    codeRoots: [...config.codeRoots.map((root) => root === '/' ? '.' : root), ':(exclude).repo-map/**'],
});
const dirtyCode = async (root, config) => !!await git(root, 'status', '--porcelain', '--', ...freshnessConfig(config).codeRoots);

/** All evidence must resolve to readable code, including on loading saved data. */
async function cleanSitemap(root, config, raw) {
    const sitemap = normalizeSitemap(raw);
    if (!sitemap) throw new Error('The AI tool did not return a usable sitemap. Try generating it again.');
    let omitted = false;
    for (const item of [...sitemap.screens, ...sitemap.navigation]) {
        const checked = [];
        for (const ref of item.refs) {
            if (!safePath(root, config, ref.path) || !Number.isInteger(ref.start) || ref.start < 1 || !Number.isInteger(ref.end) || ref.end < ref.start) continue;
            const value = await clampRef(root, config, ref);
            if (value && value.start === ref.start && value.end === ref.end) {
                checked.push({ ...value, end: Math.min(value.end, value.start + 59), why: ref.why });
            }
        }
        item.refs = checked;
        if (!checked.length) omitted = true;
    }
    sitemap.screens = sitemap.screens.filter((screen) => screen.refs.length);
    const ids = new Set(sitemap.screens.map((screen) => screen.id));
    sitemap.navigation = sitemap.navigation.filter((edge) => edge.refs.length && ids.has(edge.from) && ids.has(edge.to));
    sitemap.applications = sitemap.applications.filter((app) => sitemap.screens.some((screen) => screen.app === app.id));
    if (omitted) {
        sitemap.applicability = 'incomplete';
        sitemap.gaps.push('Entries without valid code evidence were omitted. Regenerate to refresh missing or changed references.');
    }
    return sitemap;
}

async function loadSitemap(root, config) {
    let raw;
    try {
        raw = await fs.readFile(sitemapFile(root), 'utf8');
    } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
    }
    return cleanSitemap(root, config, JSON.parse(raw));
}

async function sitemapStatus(root, config, sitemap) {
    const dirty = await dirtyCode(root, config);
    if (!sitemap) return { state: 'missing', dirty };
    // A negative applicability result still has a commit worth checking.
    const status = await mapStatus(root, freshnessConfig(config), { nodes: [{}], commit: sitemap.commit, evaluatedAt: sitemap.generatedAt });
    return { ...status, dirty, dirtyAtGeneration: sitemap.dirtyAtGeneration };
}

async function generateSitemap({ root, config, onProgress = () => {}, onStart = () => {} }) {
    const commit = await git(root, 'rev-parse', 'HEAD');
    const dirtyBefore = await dirtyCode(root, config);
    let cancelled = false;
    const run = await runAi({ root, config, task: 'generate',
        responseSchema: RESPONSE_SCHEMAS.sitemap,
        prompt: sitemapPrompt(config, { guidance: await readGuidance(root) }),
        maxTurns: 120, timeoutMs: Math.max(config.ai.timeoutMs, 30 * 60 * 1000), onProgress });
    onStart({ ...run, kill: () => { cancelled = true; run.kill(); } });
    const out = await run.promise;
    const raw = out.value;
    const sitemap = await cleanSitemap(root, config, raw);
    if (raw.screens.length && !sitemap.screens.length) {
        throw new Error('No screens had valid code evidence. The previous sitemap was kept.');
    }
    if (cancelled) throw new Error('Sitemap generation stopped.');
    sitemap.generatedAt = new Date().toISOString();
    delete sitemap.commit;
    if (commit) sitemap.commit = commit;
    const dirtyAfter = await dirtyCode(root, config);
    sitemap.dirtyAtGeneration = dirtyBefore || dirtyAfter;
    const file = sitemapFile(root);
    const temporary = path.join(root, MAP_DIR, `sitemap.${randomUUID()}.tmp`);
    try {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(temporary, JSON.stringify(sitemap, null, 2) + '\n', { flag: 'wx' });
        if (cancelled) throw new Error('Sitemap generation stopped.');
        await fs.rename(temporary, file);
    } finally {
        await fs.rm(temporary, { force: true });
    }
    return { sitemap, status: await sitemapStatus(root, config, sitemap), used: run.used };
}

export { cleanSitemap, generateSitemap, loadSitemap, sitemapStatus };
