/**
 * Drafts map.json with the configured AI tool. Used by `generate` and `start`.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { detectProvider, runAi } from './ai/index.mjs';
import { MAP_DIR, loadMap } from './config.mjs';
import { extractJson } from './json.mjs';
import { generatePrompt } from './prompts.mjs';
import { validateMap } from './validate.mjs';

async function generateMap({ root, config, force = false, onProgress = () => {}, onStart = () => {} }) {
    const existing = await loadMap(root);
    const hasMap = existing.nodes.length && !existing.starter;
    const target = path.join(root, MAP_DIR, hasMap && !force ? 'map.draft.json' : 'map.json');
    const provider = await detectProvider(config);
    if (!provider.available) {
        throw new Error(`${provider.reason} Run \`repo-map doctor\` for help, or see SETUP.md.`);
    }
    const t0 = Date.now();
    const run = await runAi({
        root,
        config,
        prompt: generatePrompt(config, hasMap ? existing : null),
        onProgress,
        maxTurns: 120,
        timeoutMs: Math.max(config.ai.timeoutMs, 30 * 60 * 1000),
    });
    onStart(run);
    const out = await run.promise;
    const map = extractJson(out.text);
    if (!map || !Array.isArray(map.nodes)) {
        const raw = path.join(root, MAP_DIR, 'map.raw.txt');
        await fs.writeFile(raw, String(out.text || ''));
        throw new Error(`${run.label} didn't return a map in the expected shape. Its reply is in ${raw}. A stronger model usually fixes this.`);
    }
    map.generatedAt = new Date().toISOString();
    await fs.writeFile(target, JSON.stringify(map, null, 2) + '\n');
    const check = validateMap(root, config, { groups: map.groups || [], nodes: map.nodes, edges: map.edges || [] });
    return {
        target,
        draft: target.endsWith('draft.json'),
        check,
        label: run.label,
        seconds: Math.round((Date.now() - t0) / 1000),
        spend: out.cost ? `$${out.cost.toFixed(2)}` : out.tokens ? `${out.tokens.toLocaleString()} tokens` : '',
    };
}

export { generateMap };
