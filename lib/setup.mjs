/**
 * First-run setup answered in the browser's onboarding screen: the map name,
 * code folders and a short description, saved to .repo-map/config.json.
 */
import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { which } from './ai/which.mjs';
import { MAP_DIR } from './config.mjs';
import { detectDefaults, normaliseRoots, writeConfig } from './scaffold.mjs';

const SKIP = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', 'tmp', 'temp', 'vendor', MAP_DIR]);
const MAX_DIRS = 60;
const MAX_NAME = 120;
const MAX_CONTEXT = 1000;
// the template's placeholder text counts as "no description yet"
const PLACEHOLDER = /^Describe the repo in a sentence or two/;

/** Top-level folders worth offering as code folders. */
async function topLevelDirs(root, config) {
    const blocked = new Set(config.blocked || []);
    let entries = [];
    try {
        entries = await fs.readdir(root, { withFileTypes: true });
    } catch {
        return [];
    }
    return entries
        .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SKIP.has(e.name) && !blocked.has(e.name))
        .map((e) => e.name + '/')
        .sort((a, b) => a.localeCompare(b))
        .slice(0, MAX_DIRS);
}

/** What the onboarding screen shows: current answers plus the folders to choose from. */
async function setupInfo(root, config) {
    const [defaults, dirs, ollamaBin] = await Promise.all([detectDefaults(root), topLevelDirs(root, config), which('ollama')]);
    const suggested = new Set(defaults.codeRoots);
    const context = config.prompt?.context || '';
    return {
        name: config.name || defaults.name,
        codeRoots: config.codeRoots?.length ? config.codeRoots : defaults.codeRoots,
        context: PLACEHOLDER.test(context) ? '' : context,
        dirs: dirs.map((d) => ({ path: d, suggested: suggested.has(d) })),
        ollamaInstalled: Boolean(ollamaBin),
    };
}

/** Check a folder answer: relative, inside the repo, an existing folder, never .repo-map or .env. */
function checkRoot(root, r) {
    const segments = r.replace(/\/$/, '').split('/');
    if (r === './') {
        return null;
    }
    if (path.isAbsolute(r) || /^[a-z]:/i.test(r) || r.includes('\\') || segments.some((s) => s === '..' || s === '' || s === MAP_DIR || s.startsWith('.env'))) {
        return `“${r}” isn’t a folder inside this repo.`;
    }
    if (!existsSync(path.join(root, r))) {
        return `There is no folder “${r}” in this repo.`;
    }
    return null;
}

/** Validate and save the onboarding answers. Throws Error with `status` 400 on bad input. */
async function saveSetup(root, body = {}) {
    const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
    const name = String(body.name ?? '').trim();
    if (!name || name.length > MAX_NAME) {
        throw bad(`Give the map a name (up to ${MAX_NAME} characters).`);
    }
    if (!Array.isArray(body.codeRoots)) {
        throw bad('Pick at least one code folder.');
    }
    const codeRoots = [...new Set(normaliseRoots(body.codeRoots.slice(0, MAX_DIRS)).map((r) => (r === '/' ? './' : r)))];
    if (!codeRoots.length) {
        throw bad('Pick at least one code folder.');
    }
    for (const r of codeRoots) {
        const problem = checkRoot(root, r);
        if (problem) {
            throw bad(problem);
        }
    }
    const context = String(body.context ?? '').trim();
    if (context.length > MAX_CONTEXT) {
        throw bad(`Keep the description under ${MAX_CONTEXT} characters.`);
    }
    const { config } = await writeConfig(root, { name, codeRoots, prompt: { context } });
    return { name: config.name, codeRoots: config.codeRoots, context: config.prompt?.context || '' };
}

export { saveSetup, setupInfo, topLevelDirs };
