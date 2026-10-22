/**
 * Read-only repo tools for providers that call tools through an API (they can't
 * read files themselves). Everything goes through safePath/readablePath, so the
 * model only sees files under config.codeRoots and documents (config.docs),
 * never .env files or blocked folders.
 */
import { promises as fs } from 'node:fs';
import { globToRegExp, readablePath, safePath } from '../repo.mjs';

const MAX_LIST = 400;
const MAX_HITS = 50;
const MAX_READ_LINES = 200;
const MAX_FILE_BYTES = 1024 * 1024;
const TEXT_EXT = /\.(m?[jt]sx?|cjs|cts|mts|json|ya?ml|md|mdx|graphql|gql|sql|py|rb|go|rs|java|kt|kts|swift|cs|php|scss|css|less|html|vue|svelte|astro|sh|toml|ini|xml|proto|tf)$/i;

async function walk(root, config, rel, out, limit) {
    const target = safePath(root, config, rel) || (rel === '' ? { abs: root, clean: '' } : null);
    if (!target) {
        return;
    }
    let entries;
    try {
        entries = await fs.readdir(target.abs, { withFileTypes: true });
    } catch {
        return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
        if (out.length >= limit) {
            return;
        }
        const childRel = target.clean ? `${target.clean.replace(/\/$/, '')}/${e.name}` : e.name;
        if (e.name.startsWith('.') || config.blocked.includes(e.name)) {
            continue;
        }
        if (e.isDirectory()) {
            await walk(root, config, childRel + '/', out, limit);
        } else if (e.isFile() && safePath(root, config, childRel)) {
            out.push(childRel);
        }
    }
}

/** Files under the given folder (or every code root), repo-relative. */
async function listFiles(root, config, folder = '', limit = MAX_LIST) {
    const out = [];
    const roots = folder ? [folder.replace(/^\/+/, '')] : config.codeRoots;
    for (const r of roots) {
        await walk(root, config, r, out, limit);
    }
    return out;
}

function createRepoTools(root, config) {
    return [
        {
            name: 'list_files',
            description: 'List repo files (repo-relative paths). Optionally limit to a folder and/or a glob such as "**/*.ts". Returns at most 400 paths.',
            parameters: {
                type: 'object',
                properties: {
                    folder: { type: 'string', description: 'Folder to list, e.g. "src/api". Omit for all code roots.' },
                    glob: { type: 'string', description: 'Optional filename glob, e.g. "**/*Store.js".' },
                },
            },
            async run({ folder, glob } = {}) {
                let files = await listFiles(root, config, folder || '', glob ? 5000 : MAX_LIST);
                if (glob) {
                    const re = globToRegExp(glob);
                    files = files.filter((f) => re.test(f)).slice(0, MAX_LIST);
                }
                return files.length ? files.join('\n') : 'No files found.';
            },
        },
        {
            name: 'search_code',
            description: 'Search file contents for text (case-insensitive) or a regular expression. Returns up to 50 matches as "path:line: text".',
            parameters: {
                type: 'object',
                properties: {
                    query: { type: 'string', description: 'Text or regex to find.' },
                    regex: { type: 'boolean', description: 'Treat query as a regular expression.' },
                    folder: { type: 'string', description: 'Optional folder to search in.' },
                },
                required: ['query'],
            },
            async run({ query, regex, folder } = {}) {
                if (!query) {
                    throw new Error('query is required');
                }
                let re;
                try {
                    re = regex ? new RegExp(query, 'i') : null;
                } catch {
                    throw new Error('Invalid regular expression');
                }
                const needle = String(query).toLowerCase();
                const hits = [];
                for (const file of await listFiles(root, config, folder || '', 20000)) {
                    if (!TEXT_EXT.test(file) || /(^|\/)(__tests__|__mocks__)\//.test(file)) {
                        continue;
                    }
                    const target = safePath(root, config, file);
                    const stat = await fs.stat(target.abs).catch(() => null);
                    if (!stat || stat.size > MAX_FILE_BYTES) {
                        continue;
                    }
                    const lines = (await fs.readFile(target.abs, 'utf8')).split('\n');
                    for (let i = 0; i < lines.length; i++) {
                        if (re ? re.test(lines[i]) : lines[i].toLowerCase().includes(needle)) {
                            hits.push(`${file}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
                            if (hits.length >= MAX_HITS) {
                                return hits.join('\n') + '\n(more matches not shown; narrow the search)';
                            }
                        }
                    }
                }
                return hits.length ? hits.join('\n') : 'No matches.';
            },
        },
        {
            name: 'read_file',
            description: 'Read lines of a file. Each line is prefixed with its 1-based number ("42| code"). At most 200 lines per call.',
            parameters: {
                type: 'object',
                properties: {
                    path: { type: 'string', description: 'Repo-relative file path.' },
                    start: { type: 'integer', description: 'First line (default 1).' },
                    end: { type: 'integer', description: 'Last line (default start + 199).' },
                },
                required: ['path'],
            },
            async run({ path: rel, start, end } = {}) {
                const target = readablePath(root, config, rel);
                if (!target) {
                    throw new Error(`Not readable: ${rel} (outside ${config.codeRoots.join(', ')} and not a document, or blocked)`);
                }
                const stat = await fs.stat(target.abs).catch(() => null);
                if (!stat || !stat.isFile()) {
                    throw new Error(`File not found: ${rel}`);
                }
                const lines = (await fs.readFile(target.abs, 'utf8')).split('\n');
                const s = Math.max(1, parseInt(start, 10) || 1);
                const e = Math.min(lines.length, Math.max(s, parseInt(end, 10) || s + MAX_READ_LINES - 1), s + MAX_READ_LINES - 1);
                let text = `${target.clean} (${lines.length} lines)\n`;
                for (let i = s; i <= e; i++) {
                    text += `${i}| ${lines[i - 1]}\n`;
                }
                return text;
            },
        },
    ];
}

function describeToolCall(name, args) {
    switch (name) {
        case 'read_file': return `Reading ${args.path}`;
        case 'search_code': return `Searching for “${args.query}”${args.folder ? ` in ${args.folder}` : ''}`;
        case 'list_files': return `Listing ${args.glob || args.folder || 'files'}`;
        default: return `Using ${name}`;
    }
}

export { createRepoTools, describeToolCall, listFiles };
