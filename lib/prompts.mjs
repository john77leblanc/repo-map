/**
 * Prompts sent to Claude Code. Everything repo-specific comes from config.json
 * (prompt.context, prompt.hints, kinds, edgeTypes, columns) and map.json.
 */

function mapText(config, map) {
    const groupTitle = Object.fromEntries(map.groups.map((g) => [g.id, g.title]));
    const nodes = map.nodes.map((n) => [
        n.id,
        n.title || n.id,
        config.kinds[n.kind] || n.kind,
        groupTitle[n.group] || n.group,
        n.path || '-',
        n.desc || '',
        (n.facts || []).join('; '),
    ].join(' | ')).join('\n');
    const edges = map.edges.map((e) => `${e.from} -> ${e.to} | ${e.type}${e.label ? ` | ${e.label}` : ''}${e.inferred ? ' | inferred' : ''}`).join('\n');
    return `NODES (id | title | kind | group | repo path | description | facts)\n${nodes}\n\nCONNECTIONS (from -> to | type | label | inferred?)\n${edges}`;
}

function traceSystem(config) {
    const about = config.prompt.context ? `About this repo: ${config.prompt.context}\n` : '';
    const hints = config.prompt.hints ? `Notes: ${config.prompt.hints}\n` : '';
    const types = Object.entries(config.edgeTypes).map(([k, v]) => `${k} = ${v}`).join(', ');
    return `${about}${hints}Connection types: ${types}. Arrow direction: caller -> callee for calls, publisher -> topic -> subscriber for events, source -> destination for syncs.`;
}

function tracePrompt(config, map, question) {
    const roots = config.codeRoots.join(', ');
    return `You are tracing a process through the "${config.name}" codebase. The current directory is the repository root. You have read-only tools (Read, Grep, Glob).
${traceSystem(config)}

Below is a hand-curated map of the repo: nodes and the connections between them.

${mapText(config, map)}

TASK
1. For the process described at the end, list the map nodes it passes through in the order data moves, starting where the process begins (often an outside-world node). Use only node ids from NODES, exactly as written; a node appears once; usually 3-15 steps. Include side effects only when the question is about them.
2. For each step whose node has a repo path, find the code that implements its part. Search inside that path first, and elsewhere under ${roots} when the logic lives in shared code. Skip tests, mocks and build output. Use Grep to locate identifiers from the question, then Read to confirm exact line numbers.
3. If the map or the code doesn't show part of the process, say so briefly in "gaps" instead of guessing. Mention when you relied on a connection marked inferred.

Reply with only one JSON object, no prose before or after:
{"title":"2-6 word name","summary":"2-3 sentences","steps":[{"id":"node-id","note":"one plain sentence on what this node does in the process","refs":[{"path":"repo/relative/file.ts","start":21,"end":40,"why":"one sentence"}]}],"edges":[["from-id","to-id"]],"gaps":""}

Rules for refs: repo-relative paths under ${roots}; line numbers taken from Read output; 3-60 lines covering the relevant function or block; at most 2 per step and 10 in total, most relevant first; an empty array for nodes with no code in this repo. "edges" may only contain pairs listed in CONNECTIONS, in the listed direction.

PROCESS
${question}`;
}

function generatePrompt(config, existing) {
    const cols = config.columns.map((c, i) => `${i} = ${c.title}${c.subtitle ? ` (${c.subtitle})` : ''}`).join('\n');
    const kinds = Object.entries(config.kinds).map(([k, v]) => `"${k}" = ${v}`).join(', ');
    const types = Object.entries(config.edgeTypes).map(([k, v]) => `"${k}" = ${v}`).join(', ');
    const seed = existing && existing.nodes.length
        ? `\nAN EXISTING MAP IS BELOW. Keep its ids, groups and wording where they are still right; add what's missing, fix what's wrong, drop what no longer exists.\n${JSON.stringify(existing)}\n`
        : '';
    return `You are drawing an architecture map of the "${config.name}" codebase for engineers who are new to it. The current directory is the repository root. You have read-only tools (Read, Grep, Glob).
${config.prompt.context ? `About this repo: ${config.prompt.context}\n` : ''}${config.prompt.hints ? `Notes: ${config.prompt.hints}\n` : ''}
Explore the code under ${config.codeRoots.join(', ')}: package manifests, READMEs, entry points, routing, config and env files' variable NAMES (never their values), API clients, event publishers and subscribers. Work out the main units (services, apps, pages, modules — whatever this repo is made of), what each one does, and how data moves between them and the outside world.

COLUMNS (left to right, the order data flows):
${cols}

NODE KINDS: ${kinds}
CONNECTION TYPES: ${types}
${seed}
Reply with only one JSON object, no prose before or after:
{"groups":[{"id":"g-short-id","col":0,"title":"Group title","open":true,"note":"optional one line"}],
 "nodes":[{"id":"kebab-id","group":"g-short-id","kind":"service","tag":"short label or empty","path":"repo/relative/folder or empty","title":"optional display name","desc":"1-2 plain sentences on what it does","facts":["key route, job or detail"]}],
 "edges":[{"from":"node-id","to":"node-id","type":"http","label":"optional short label","inferred":false}]}

Rules:
- Every unit of the repo is a node with its real folder as "path". Outside systems (users, vendors, other repos, databases worth naming) are "external" nodes with an empty path.
- Put each group in one column. Open the groups that carry the main flows; close (open:false) small or repetitive ones so the map stays readable.
- Edges: caller -> callee for calls, publisher -> topic -> subscriber for events, source -> destination for syncs. Set "inferred": true when you are going by docs or naming rather than code you read.
- Facts are short: routes, job names, event names, notable integrations. At most 3 per node.
- Use ids that are stable and readable (folder names work well).`;
}

export { generatePrompt, mapText, tracePrompt };
