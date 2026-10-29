/** A review's own fields (what was compared, risks, changed files), shared by the server and browser. */
const text = (value, limit = 2000) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const list = (value, limit = 20, size = 2000) => (Array.isArray(value) ? value : []).slice(0, limit).map((v) => text(v, size)).filter(Boolean);
const SHA = /^[0-9a-f]{7,40}$/i;
const sha = (value) => SHA.test(String(value || '')) ? String(value).toLowerCase() : '';
const KINDS = ['pr', 'refs', 'local'];
const MAX_FILES = 300;

/** The single-letter git status of a changed file: A, M, D, R, C, T (or M when unknown). */
const fileStatus = (value) => /^[AMDRCT]/.test(String(value || '')) ? String(value)[0] : 'M';

/**
 * Changed files, each with the cards it touches. Only files in the diff are kept
 * (`diffFiles`, when given), and only card ids in `ids`; diff files the AI left out
 * are listed with no cards so every change shows.
 * @param {unknown} raw
 * @param {{ path: string, status?: string, from?: string, additions?: number, deletions?: number }[] | null} [diffFiles]
 * @param {Set<string> | null} [ids]
 */
function normalizeReviewFiles(raw, diffFiles = null, ids = null) {
    const fromDiff = diffFiles ? new Map(diffFiles.map((f) => [f.path, f])) : null;
    const out = [], seen = new Set();
    const clean = (f, extra = {}) => {
        const path = text(f?.path, 300).replace(/^\/+/, '');
        if (!path || seen.has(path) || path.split('/').includes('..') || (fromDiff && !fromDiff.has(path))) return;
        const d = fromDiff?.get(path) || f;
        seen.add(path);
        out.push({ path, status: fileStatus(d.status), ...(text(d.from, 300) ? { from: text(d.from, 300) } : {}),
            additions: Math.max(0, parseInt(d.additions, 10) || 0), deletions: Math.max(0, parseInt(d.deletions, 10) || 0),
            cards: [...new Set(list(f?.cards ?? extra.cards, 8, 80))].filter((id) => !ids || ids.has(id)), note: text(f?.note, 300) });
    };
    for (const f of (Array.isArray(raw) ? raw : []).slice(0, MAX_FILES)) clean(f);
    for (const f of diffFiles || []) if (out.length < MAX_FILES) clean(f, { cards: [] });
    return out;
}

/**
 * The `review` object saved on a review trace, or null when it isn't one.
 * @param {unknown} raw
 * @param {Set<string> | null} [ids] card ids a changed file may name
 */
function normalizeReview(raw, ids = null) {
    if (!raw || typeof raw !== 'object' || !KINDS.includes(raw.kind)) return null;
    const baseSha = sha(raw.baseSha), headSha = sha(raw.headSha);
    if (!baseSha || !headSha) return null;
    return {
        kind: raw.kind,
        base: text(raw.base, 200), head: text(raw.head, 200),
        ...(raw.kind === 'refs' && text(raw.headRef, 200) ? { headRef: text(raw.headRef, 200) } : {}),
        baseSha, headSha, mergeBase: sha(raw.mergeBase) || baseSha,
        ...(raw.kind === 'pr' ? { number: Math.max(0, parseInt(raw.number, 10) || 0),
            url: /^https:\/\/github\.com\//.test(String(raw.url || '')) ? text(raw.url, 300) : '' } : {}),
        ...(raw.kind === 'local' ? { dirty: raw.dirty === true, fingerprint: /^[0-9a-f]{0,40}$/.test(String(raw.fingerprint || '')) ? String(raw.fingerprint || '') : '' } : {}),
        risks: list(raw.risks), questions: list(raw.questions),
        files: normalizeReviewFiles(raw.files, null, ids),
        skipped: list(raw.skipped, 50, 300),
    };
}

/** "PR #12", or "main...feature" for branches and local changes. */
function reviewLabel(review) {
    if (!review) return '';
    if (review.kind === 'pr') return `PR #${review.number}`;
    return review.kind === 'local' ? 'Local changes' : 'Changes';
}

export { normalizeReview, normalizeReviewFiles, reviewLabel };
