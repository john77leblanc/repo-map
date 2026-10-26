/**
 * Drafts map.json with the configured AI tool, then (unless turned off) runs
 * the docs pass that links documents to its cards. Used by `generate`, `start`
 * and the Map panel's Redraw.
 */
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { detectProvider, runAi, spendText } from './ai/index.mjs';
import { MAP_DIR, loadMap } from './config.mjs';
import { cleanMapContracts } from './contracts.mjs';
import { linkDocs } from './docs.mjs';
import { readGuidance } from './guidance.mjs';
import { generatePrompt } from './prompts.mjs';
import { git } from './repo.mjs';
import { validateMap } from './validate.mjs';
import { RESPONSE_SCHEMAS } from './response-contracts.mjs';

async function generateMap({ root, config, force = false, docs = true, pick, onProgress = () => {}, onStart = () => {} }) {
    const existing = await loadMap(root);
    const hasMap = existing.nodes.length && !existing.starter;
    const target = path.join(root, MAP_DIR, hasMap && !force ? 'map.draft.json' : 'map.json');
    const provider = await detectProvider(config, 'generate');
    if (!provider.available) {
        throw new Error(`${provider.reason} Run \`repo-map doctor\` for help, or see SETUP.md.`);
    }
    const t0 = Date.now();
    const run = await runAi({
        root,
        config,
        task: 'generate',
        responseSchema: RESPONSE_SCHEMAS.generate,
        pick,
        prompt: generatePrompt(config, hasMap ? existing : null, { guidance: await readGuidance(root) }),
        onProgress,
        maxTurns: 120,
        timeoutMs: Math.max(config.ai.timeoutMs, 30 * 60 * 1000),
    });
    onStart(run);
    let out;
    try {
        out = await run.promise;
    } catch (error) {
        if (error.code === 'schema') {
            const raw = path.join(root, MAP_DIR, 'map.raw.txt');
            await fs.writeFile(raw, String(error.responseText || ''));
            error.message += `. Its reply is in ${raw}.`;
        }
        throw error;
    }
    const map = cleanMapContracts(out.value);
    // Record what the map describes, so `repo-map` can tell when it's out of date
    map.generatedAt = new Date().toISOString();
    map.evaluatedAt = map.generatedAt;
    map.commit = (await git(root, 'rev-parse', 'HEAD')) || undefined;
    // replacing map.json: keep the previous version next to it (git-ignored) in case the redraw needs undoing
    const mapFile = path.join(root, MAP_DIR, 'map.json');
    if (target === mapFile && hasMap && existsSync(mapFile)) {
        await fs.copyFile(mapFile, path.join(root, MAP_DIR, 'map.prev.json'));
    }
    await fs.writeFile(target, JSON.stringify(map, null, 2) + '\n');
    const drawn = { groups: map.groups || [], nodes: map.nodes, edges: map.edges || [] };
    const check = validateMap(root, config, drawn);
    const result = {
        target,
        draft: target.endsWith('draft.json'),
        check,
        label: run.label,
        seconds: Math.round((Date.now() - t0) / 1000),
        spend: spendText(out),
    };
    // docs attach to the map's cards, so only once map.json itself was written
    if (docs && !result.draft) {
        onProgress('Map drawn. Linking documentation to its cards…');
        try {
            result.docs = await linkDocs({ root, config, map: drawn, pick, onProgress, onStart });
        } catch (err) {
            result.docsError = err.message;
        }
    }
    return result;
}

export { generateMap };
