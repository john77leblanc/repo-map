import { constants, promises as fs } from 'node:fs';
import path from 'node:path';

/** Resolve a command name on PATH (or an explicit path) without running it. */
async function which(bin, env = process.env) {
    if (!bin) {
        return null;
    }
    const exts = process.platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
    const candidates = bin.includes('/') || bin.includes('\\')
        ? [path.resolve(bin)]
        : String(env.PATH || '').split(path.delimiter).filter(Boolean).flatMap((dir) => exts.map((ext) => path.join(dir, bin + ext)));
    for (const file of candidates) {
        try {
            await fs.access(file, constants.X_OK);
            return file;
        } catch {
            // keep looking
        }
    }
    return null;
}

export { which };
