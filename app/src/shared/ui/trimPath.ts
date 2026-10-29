/** A path cut to its last `keep` segments, with `.../` in front when any were dropped. */
function trimPath(path: string, keep: number) {
    const parts = path.split('/');
    if (keep >= parts.length) return path;
    return '.../' + parts.slice(-Math.max(1, keep)).join('/');
}

export { trimPath };
