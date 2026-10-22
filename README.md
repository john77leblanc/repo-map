# repo-map

An interactive architecture map for any repo, with plain-language process tracing through the AI tool you already use: Claude Code, Codex, Gemini, OpenAI or any OpenAI-compatible API, including local models like Ollama.

- **See how a codebase fits together.** Services, apps, pages or modules, the shared code they lean on, and the outside systems they talk to, laid out left to right in the order data flows. Hover a card to light up its connections; click it for a description, key facts and a GitHub link.
- **Ask how a process works.** Type "What happens when someone places an order?" and your AI tool reads the map and your checkout (read-only), numbers the path on the map, and shows the code behind each step, read live from your files. A menu beside the **Trace** button lists every AI tool found on your machine with its models and effort levels, so a quick question can use a fast model and a hard one a stronger model.
- **See the logic as a flowchart.** Each trace can come with a flowchart of the process: what the person does, what the system does, the decisions it makes and every outcome, including failure paths. Boxes link back to the trace steps and their code. Copy it as Mermaid or download it as SVG for docs and PRs.
- **Keep what you learn.** Every trace is saved locally, and any one can be shared as a short code a teammate pastes in.
- **Stay current.** The map knows which commit it describes, flags when the code has moved on, and updates itself from just the diff.

Everything runs on your machine. The server listens on `localhost` only, and no code leaves your machine except what your AI tool reads while tracing. With a local model, nothing leaves it at all.

**Full setup guide: [SETUP.md](SETUP.md)**, covering install options, adding a map to a repo, configuring each AI tool, and troubleshooting.

## Requirements

- Node.js 20 or newer
- Optional: an AI tool for tracing and `generate`. Any one of [Claude Code](https://docs.claude.com/en/docs/claude-code), an OpenAI-compatible API key, a local model server (Ollama, LM Studio), or a CLI like Codex or Gemini. See [SETUP.md](SETUP.md#4-choose-an-ai-tool). The map, search and shared trace codes work without one.

No other dependencies.

## Get started

In the repo you want to map:

```shell
npm install --save-dev @whitemane/repo-map
npx repo-map
```

Or try it without installing anything: `npx @whitemane/repo-map`.

The first run asks a few questions: a name for the map, which folders hold the code, a one-line description, and which AI tool to use (it lists the ones it finds on your machine, or you can skip). It then offers to draft the map, and opens it in your browser. Every later run goes straight to the map.

Add a script so teammates only need `npm install` and `npm run map`:

```json
"scripts": { "map": "repo-map" }
```

Commit the `.repo-map/` folder it creates (`config.json`, `map.json`, `.gitignore`). Saved traces and personal AI settings stay out of git.

**Keeping it current:** the map remembers the commit it was drawn from. When files in the code folders change, a banner shows what changed, and **Update map** sends only the diff to your AI tool to patch the map. From a terminal, use `repo-map update`. Commit the updated `map.json` like any other change.

The first map is a draft: read it through, fix descriptions, collapse noisy groups, and mark guessed links `"inferred": true`. Without an AI tool, repo-map starts you with one card per folder, which you can fill in by hand or draft later with `repo-map generate`.

Want to see it first? Clone this repo and run `npm run example`.

For scripted or CI setups, configuring a specific AI tool, and troubleshooting, see [SETUP.md](SETUP.md).

## Commands

| Command    | What it does |
|------------|--------------|
| *(none)* or `start` | Set up anything that's missing (asking only when it has to), then open the map |
| `init`     | Create `.repo-map/` with a starter `config.json` |
| `generate` | Draft `map.json` with your AI tool (read-only) |
| `ai <tool>` | Choose the default AI tool: `claude`, `openai`, `api`, `ollama`, `lmstudio`, `codex`, `gemini`, `command`, `auto`, `none`, with optional `--model` and `--effort`; `--for generate` sets the one that draws the map; `ai show` prints the settings in effect |
| `doctor`   | List the AI tools found, with their models and effort levels, and check the ones traces and the map will use (`--json` for scripts) |
| `update`   | Bring the map up to date with code changed since it was last evaluated (only the diff is sent); `--check` for scripts |
| `validate` | Report unknown ids, groups, kinds and missing paths; exits 1 on errors, so it fits in CI |
| `serve`    | Start the map without any setup steps |

Options: `--dir <repo root>`, `--port <n>` (or `REPO_MAP_PORT`), `--force`, `--model <id>`, `--effort <level>`, `--version`, `--help`.
`--provider`, `--model` and `--effort` (or `REPO_MAP_AI_PROVIDER`, `REPO_MAP_MODEL` and `REPO_MAP_EFFORT`) pick the AI tool, model and effort for one run. See [SETUP.md](SETUP.md#where-ai-settings-go) for personal settings files.

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
| `prompt`        | `context` (what the repo is, where code lives) and `hints` (quirks worth knowing), given to the AI tool |
| `footnote`      | Note shown under the map |
| `tracesDir`     | Where saved traces go |
| `ai`            | Team default AI tool: `{ "provider": "auto" }`, plus optional `"effort"` and `"generate": { "provider", "model", "effort" }` for drawing the map. See [SETUP.md](SETUP.md#4-choose-an-ai-tool). Personal overrides go in `.repo-map/local.json` (git-ignored) or `~/.config/repo-map/ai.json` |

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
- `inferred: true` draws the edge dashed and tells the AI tool the link came from docs or naming rather than code.

### Flowcharts

With **Include a flowchart** ticked (the default), the AI tool also returns a flowchart with each trace. Traces saved without one have a **Draw flowchart** button, which asks the AI tool to draw it from the trace's steps and code. The chart opens in a window over the map: click a box for its detail, the trace step behind it and that step's code, or **Show on map** to jump there.

Box types: *start*, *end*, *action* (the person does something), *process* (the system does something), *decision* (a check with labelled outcomes) and *error* (a failure outcome). Dashed boxes and arrows are inferred rather than read in code. The chart is laid out by repo-map itself (no extra dependencies), saved inside the trace, and included in trace codes. **Copy Mermaid** gives source that GitHub, GitLab and Notion render; **Download SVG** gives a standalone image.

## Safety

- Listens on `127.0.0.1` only and rejects requests addressed to any other host name.
- The API requires a custom header, so other websites open in your browser can't call it.
- File reads are limited to `codeRoots` and never touch `.env*`, `.repo-map/` or `blocked` segments.
- Claude Code runs with `Read`, `Grep` and `Glob` only; shell, edit and web tools are disallowed.
- The trace menu can only choose among the tools repo-map detected, their effort levels, and model ids that look like model ids. The browser can never set a command, its arguments or a URL.
- API models (OpenAI-compatible, including local) only get repo-map's own read-only tools, which go through the same `codeRoots` and `blocked` rules as the code viewer.
- `command` tools (Codex, Gemini, others) read files on their own; use their read-only or sandbox modes. repo-map can't restrict a third-party CLI.
- API keys are read from environment variables and never written to any config file. Each trace is billed to whichever account the tool uses; cost or token counts are shown when it finishes.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for the code layout, adding providers, and releasing.

```shell
npm test             # node --test
npm run example
```

## License

MIT
