# repo-map

An interactive architecture map for any repo, with plain-language process tracing through the [Claude Code](https://docs.claude.com/en/docs/claude-code) CLI.

- **See how a codebase fits together.** Services, apps, pages or modules, the shared code they lean on, and the outside systems they talk to, laid out left to right in the order data flows. Hover a card to light up its connections; click it for a description, key facts and a GitHub link.
- **Ask how a process works.** Type "What happens when someone places an order?" and Claude Code reads the map and your checkout (read-only), numbers the path on the map, and shows the code behind each step, read live from your files.
- **Keep what you learn.** Save traces locally, or share one as a short code a teammate can paste in.

Everything runs on your machine. The server listens on `localhost` only, and no code leaves your machine except what Claude Code reads while tracing, the same as using Claude Code in the repo yourself.

## Requirements

- Node.js 20 or newer
- The [Claude Code CLI](https://docs.claude.com/en/docs/claude-code), installed and signed in (`claude` on your `PATH`), for tracing and `generate`. The map itself works without it.

No other dependencies.

## Try the example

```shell
git clone https://github.com/john77leblanc/repo-map.git
cd repo-map
npm run example      # http://localhost:4477
```

## Add it to a repo

Install it as a dev dependency:

```shell
npm install --save-dev github:john77leblanc/repo-map
# or, once published to npm:
npm install --save-dev @john77leblanc/repo-map
```

Or run it without installing: `npx github:john77leblanc/repo-map <command>`. You can also copy the package folder into the repo (for example `tools/repo-map/`) and run `node tools/repo-map/bin/repo-map.mjs`, which keeps it working for teammates without touching your lockfile.

Then, from the repo root:

```shell
npx repo-map init        # creates .repo-map/config.json with guessed code folders
#   edit .repo-map/config.json: name, codeRoots, columns, labels, prompt.context
npx repo-map generate    # Claude Code explores the repo and drafts .repo-map/map.json (a few minutes)
npx repo-map validate    # checks ids, groups, kinds and paths
npx repo-map serve       # http://localhost:4477
```

Add a script so everyone runs it the same way:

```json
"scripts": { "map": "repo-map serve" }
```

Commit `.repo-map/config.json` and `.repo-map/map.json`. Saved traces stay local (`.repo-map/traces/` is git-ignored).

Treat the generated map as a first draft: read it through, fix descriptions, collapse noisy groups, and mark guessed links `"inferred": true`. Running `generate` again when a map exists writes `map.draft.json` instead, keeping your ids and wording where they still hold, so you can diff before adopting it (`--force` overwrites `map.json`).

## Commands

| Command    | What it does |
|------------|--------------|
| `init`     | Create `.repo-map/` with a starter `config.json` |
| `generate` | Draft `map.json` with Claude Code (read-only tools) |
| `validate` | Report unknown ids, groups, kinds and missing paths; exits 1 on errors, so it fits in CI |
| `serve`    | Start the map (the default command) |

Options: `--dir <repo root>`, `--port <n>` (or `REPO_MAP_PORT`), `--force`, `--model <id>`, `--version`, `--help`.
`REPO_MAP_CLAUDE_BIN` and `REPO_MAP_MODEL` override the CLI path and model.

## How a repo describes itself

Each repo keeps one folder:

```
.repo-map/
  config.json   how to read the repo
  map.json      the drawn graph
  .gitignore    traces/, map.draft.json, map.raw.txt
  traces/       saved traces (local only)
```

### config.json

| Key             | Purpose |
|-----------------|---------|
| `name`          | Page title |
| `github`        | `owner/repo` for links; detected from `origin` when empty; `false` turns links off |
| `defaultBranch` | Used for links when your `HEAD` isn't pushed |
| `codeRoots`     | Folders that traces and the code viewer may read, e.g. `["src/"]` or `["services/", "packages/"]` |
| `blocked`       | Path segments never read (`.env*` files and `.repo-map/` are always blocked) |
| `columns`       | Left-to-right stages, each `{ "title", "subtitle" }` |
| `kinds`         | Labels for the three node shapes: `service` (square), `topic` (diamond), `external` (circle) |
| `edgeTypes`     | Labels for the three line colours: `http`, `event`, `sync` |
| `prompt`        | `context` (what the repo is, where code lives) and `hints` (quirks worth knowing), given to Claude Code |
| `footnote`      | Note shown under the map |
| `tracesDir`     | Where saved traces go |
| `claude`        | `bin`, `model`, `maxTurns`, `timeoutMs` for traces |

The keys of `kinds` and `edgeTypes` are fixed; their labels are yours. A backend might use *service* / *Kafka topic* / *outside the repo*; a frontend *package* / *store* / *backend or vendor*.

`prompt.context` matters most. Two or three sentences on the stack, where code lives and how it reaches other systems make traces far better.

### map.json

```json
{
  "groups": [{ "id": "g-checkout", "col": 1, "title": "Checkout", "open": true, "note": "optional" }],
  "nodes": [{
    "id": "checkout-page", "group": "g-checkout", "kind": "service", "tag": "web",
    "path": "src/pages/checkout", "title": "optional display name",
    "desc": "One or two sentences.", "facts": ["/checkout", "placeOrder()"]
  }],
  "edges": [{ "from": "checkout-page", "to": "orders-api", "type": "http", "label": "POST /orders", "inferred": false }]
}
```

- `col` indexes `config.columns`. Groups with `"open": false` start collapsed, and edges into them attach to the group header.
- `path` is the node's folder in the repo. Nodes without one (outside systems) get no code references.
- `inferred: true` draws the edge dashed and tells Claude Code the link came from docs or naming rather than code.

## Safety

- Listens on `127.0.0.1` only and rejects requests addressed to any other host name.
- The API requires a custom header, so other websites open in your browser can't call it.
- File reads are limited to `codeRoots` and never touch `.env*`, `.repo-map/` or `blocked` segments.
- Claude Code runs with `Read`, `Grep` and `Glob` only; shell, edit and web tools are disallowed. Each trace is billed to whichever account the CLI is signed in with, and the cost is shown when it finishes.

## Development

```shell
npm test             # node --test
npm run example
```

## License

MIT
