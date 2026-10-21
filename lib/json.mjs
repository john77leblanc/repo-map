/** Parse a JSON object out of a model reply: whole text, a code fence, or first { to last }. */
function extractJson(text) {
    const s = String(text || '').trim();
    const attempts = [s];
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
        attempts.push(fence[1]);
    }
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first >= 0 && last > first) {
        attempts.push(s.slice(first, last + 1));
    }
    for (const attempt of attempts) {
        try {
            return JSON.parse(attempt);
        } catch {
            // try the next shape
        }
    }
    return null;
}

export { extractJson };
