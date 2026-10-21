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

const FLOW_RULES = `Flowchart: show the process's logic for a reader who doesn't know the code, as you found it in the code you read: what the person does, what the system does, the checks and decisions it makes (validation, sign-in, permissions, feature flags, limits, retries, error handling) and every outcome, including the main failure paths. Plain words, not function names: each label at most 8 words, with "detail" adding one sentence on where or how it happens. Usually 6-25 boxes.
- "type": "start" (where it begins, once), "action" (something the person does), "process" (something the system does), "decision" (a yes/no or multi-way check, phrased as a question), "error" (a failure outcome the person sees or the system records), "end" (a finished outcome).
- Every decision has two or more outgoing connections, each with a short "label" ("yes", "no", "declined", "over limit").
- "step" is the 1-based number of the trace step whose code holds that logic; omit it when none does.
- Loops (retry, edit and resubmit) point back to an earlier box.
- Set "inferred": true on boxes or connections you are inferring from naming, docs or the map rather than code you read. Don't invent branches you saw no sign of.`;

const FLOW_SHAPE = '"flow":{"nodes":[{"id":"f1","type":"start","label":"Shopper opens checkout","detail":"one sentence","step":1}],"edges":[{"from":"f1","to":"f2","label":""}]}';

function tracePrompt(config, map, question, { flow = false } = {}) {
    const roots = config.codeRoots.join(', ');
    return `You are tracing a process through the "${config.name}" codebase. The current directory is the repository root. Use only your tools for searching and reading files; don't change anything.
${traceSystem(config)}

Below is a hand-curated map of the repo: nodes and the connections between them.

${mapText(config, map)}

TASK
1. For the process described at the end, list the map nodes it passes through in the order data moves, starting where the process begins (often an outside-world node). Use only node ids from NODES, exactly as written; a node appears once; usually 3-15 steps. Include side effects only when the question is about them.
2. For each step whose node has a repo path, find the code that implements its part. Search inside that path first, and elsewhere under ${roots} when the logic lives in shared code. Skip tests, mocks and build output. Search for identifiers from the question, then read the file to confirm exact line numbers.
3. If the map or the code doesn't show part of the process, say so briefly in "gaps" instead of guessing. Mention when you relied on a connection marked inferred.${flow ? `
4. Draw a flowchart of the process (the "flow" field below).` : ''}

Reply with only one JSON object, no prose before or after:
{"title":"2-6 word name","summary":"2-3 sentences","steps":[{"id":"node-id","note":"one plain sentence on what this node does in the process","refs":[{"path":"repo/relative/file.ts","start":21,"end":40,"why":"one sentence"}]}],"edges":[["from-id","to-id"]],"gaps":""${flow ? `,${FLOW_SHAPE}` : ''}}

Rules for refs: repo-relative paths under ${roots}; line numbers taken from what you actually read; 3-60 lines covering the relevant function or block; at most 2 per step and 10 in total, most relevant first; an empty array for nodes with no code in this repo. "edges" may only contain pairs listed in CONNECTIONS, in the listed direction.
${flow ? `\n${FLOW_RULES}\n` : ''}
PROCESS
${question}`;
}

/** Draw a flowchart for a trace that was saved without one. */
function flowPrompt(config, map, trace) {
    const byId = Object.fromEntries(map.nodes.map((n) => [n.id, n]));
    const steps = trace.steps.map((s, i) => {
        const n = byId[s.id] || {};
        const refs = (trace.refs || []).filter((r) => r.step === s.id).map((r) => `    code: ${r.path} lines ${r.start}-${r.end}${r.why ? ` (${r.why})` : ''}`).join('\n');
        return `${i + 1}. ${n.title || s.id} [${s.id}${n.path ? `, ${n.path}` : ''}]: ${s.note}${refs ? `\n${refs}` : ''}`;
    }).join('\n');
    return `You are drawing a flowchart for a process in the "${config.name}" codebase. The current directory is the repository root. Use only your tools for searching and reading files; don't change anything.
${traceSystem(config)}

The process was already traced through the code. Start from the code listed under each step, and read around it (callers, validation, error handling, branches) to find the decisions and outcomes.

PROCESS: ${trace.prompt || trace.title}
SUMMARY: ${trace.summary || ''}
STEPS
${steps}
${trace.gaps ? `NOT CLEAR FROM THE CODE: ${trace.gaps}\n` : ''}
${FLOW_RULES}

Reply with only one JSON object, no prose before or after:
{${FLOW_SHAPE}}`;
}

function generatePrompt(config, existing) {
    const cols = config.columns.map((c, i) => `${i} = ${c.title}${c.subtitle ? ` (${c.subtitle})` : ''}`).join('\n');
    const kinds = Object.entries(config.kinds).map(([k, v]) => `"${k}" = ${v}`).join(', ');
    const types = Object.entries(config.edgeTypes).map(([k, v]) => `"${k}" = ${v}`).join(', ');
    const seed = existing && existing.nodes.length
        ? `\nAN EXISTING MAP IS BELOW. Keep its ids, groups and wording where they are still right; add what's missing, fix what's wrong, drop what no longer exists.\n${JSON.stringify(existing)}\n`
        : '';
    return `You are drawing an architecture map of the "${config.name}" codebase for engineers who are new to it. The current directory is the repository root. Use only your tools for searching and reading files; don't change anything.
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

function updatePrompt(config, map, status, diff) {
    const kinds = Object.entries(config.kinds).map(([k, v]) => `"${k}" = ${v}`).join(', ');
    const types = Object.entries(config.edgeTypes).map(([k, v]) => `"${k}" = ${v}`).join(', ');
    const cols = config.columns.map((c, i) => `${i} = ${c.title}`).join(', ');
    const fileList = diff.files.map((f) => `${f.status}\t${f.from ? `${f.from} -> ` : ''}${f.path}`).join('\n');
    const skipped = diff.skipped.length ? `\nDiffs not shown (too large; read these files if they matter): ${diff.skipped.join(', ')}\n` : '';
    return `You maintain an architecture map of the "${config.name}" codebase. The map below was accurate at commit ${status.commit}. The code has since changed (now at ${status.head}). Update the map to match, using the diff below. The current directory is the repository root; use only your tools for searching and reading files, and don't change anything.
${config.prompt.context ? `About this repo: ${config.prompt.context}\n` : ''}${config.prompt.hints ? `Notes: ${config.prompt.hints}\n` : ''}
COLUMNS: ${cols}
NODE KINDS: ${kinds}
CONNECTION TYPES: ${types}

CURRENT MAP (JSON)
${JSON.stringify({ groups: map.groups, nodes: map.nodes, edges: map.edges })}

CHANGED FILES (git name-status, ${status.commit.slice(0, 9)}..${status.head.slice(0, 9)})
${fileList}
${skipped}
DIFF
${diff.patch}

TASK
Work out what these changes mean for the map: new or removed services/modules, renamed folders, new or dropped calls, events or integrations, and descriptions or facts that are now wrong. Read files when the diff alone isn't enough. Change only what the diff affects; keep every other id, title and description exactly as it is. Most diffs need few or no map changes, and that's fine.

Reply with only one JSON object, no prose before or after:
{"summary":"one or two sentences on what changed in the map (or that nothing needed to)",
 "groups":{"add":[{"id":"g-…","col":0,"title":"…","open":true}],"update":[{"id":"g-…","title":"…"}],"remove":["g-…"]},
 "nodes":{"add":[{"id":"…","group":"g-…","kind":"service","path":"…","desc":"…","facts":["…"]}],"update":[{"id":"existing-id","desc":"new text"}],"remove":["id"]},
 "edges":{"add":[{"from":"id","to":"id","type":"http","label":"…","inferred":false}],"remove":[{"from":"id","to":"id","type":"http"}]}}

Rules: omit any list with nothing in it; "update" entries contain the id plus only the fields that change; new ids are kebab-case and unique; removing a node also removes its edges; paths are repo-relative folders; mark links you are inferring rather than reading in code with "inferred": true.`;
}

export { flowPrompt, generatePrompt, mapText, tracePrompt, updatePrompt };
