/**
 * Turns whatever an AI tool printed when it failed into a cause the user can act on.
 */
const RULES = [
    {
        code: 'auth',
        test: /not (logged|signed) in|please (log|sign) in|run .*login|unauthori[sz]ed|\b401\b|invalid[ _-]?api[ _-]?key|incorrect api key|authentication (failed|error|required)|missing (api )?key|no api key/i,
        message: 'isn’t signed in, or its API key was rejected.',
    },
    {
        code: 'access',
        test: /\b403\b|forbidden|permission denied|not (enabled|available) for (your|this)|requires a (paid|pro|max|team)|subscription|upgrade your plan/i,
        message: 'is signed in, but this account doesn’t have access to it.',
    },
    {
        code: 'limit',
        test: /rate.?limit|\b429\b|quota|usage limit|too many requests|credit balance|insufficient[_ ]quota|overloaded/i,
        message: 'hit a usage or rate limit. Try again later.',
    },
    {
        code: 'model',
        test: /model[^\n]{0,60}(not found|does not exist|unknown|unsupported|not available)|unknown model|invalid model/i,
        message: 'doesn’t recognise the configured model.',
    },
];

/**
 * @param {string} label  e.g. "Claude Code"
 * @param {string} output stderr/stdout tail or an error body
 * @param {string} hint   provider-specific fix for auth problems
 */
function classifyFailure(label, output, hint = '') {
    const text = String(output || '');
    for (const rule of RULES) {
        if (rule.test.test(text)) {
            const extra = rule.code === 'auth' && hint ? ` ${hint}` : '';
            return { code: rule.code, message: `${label} ${rule.message}${extra}` };
        }
    }
    const last = text.trim().split('\n').filter(Boolean).slice(-1)[0] || '';
    return {
        code: 'failed',
        message: `${label} stopped without an answer${last ? `: ${last.slice(0, 200)}` : '.'} Run \`repo-map doctor\` to check your setup.`,
    };
}

export { classifyFailure };
