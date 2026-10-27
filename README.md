# repo-map

An interactive architecture map for any repo, with plain-language process tracing through the AI tool you already use: Claude Code, Codex, Gemini, OpenAI or any OpenAI-compatible API, including local models like Ollama.

- **See how a codebase fits together.** Services, apps, pages or modules, the shared code they lean on, and the outside systems they talk to, laid out left to right in the order data flows. Hover a card to light up its connections; click it for a description, key facts and a GitHub link.
- **Ask how a process works.** Type "What happens when someone places an order?" and your AI tool reads the map and your checkout (read-only), numbers the path on the map, and shows the code behind each step, read live from your files. Choose the tool, model and effort under **Settings / Agents**.
- **Explore a hypothetical change.** Ask "Where would coupon support fit?" in the same prompt window. Intent is detected automatically. The trace explains placement and rationale and marks proposed components and connections as **New**, **Modified**, or **Removed** in both diagrams. Select **Create implementation plan** (top of the trace sidebar) to generate ordered tasks, interface changes, tests and risks in a modal. Its content scrolls while the title and Close button stay visible. Plans and proposal diagrams travel with saved traces and shared codes; the repository map stays unchanged.
- **Choose how to explore a process.** Select **Code architecture**, **Flowchart**, or both when creating a trace. Architecture shows only the cards and path the process uses (**Show** → **Whole map** for the full, dimmed map); Flowcharts opens its decisions, failure paths and outcomes on the main canvas. Click a card or step for its explanation, expandable code references and linked docs. Copy a flowchart as Mermaid or download it as SVG.
- **Read the docs where the code is.** When the map is drawn, a second pass links sections of your docs, your agent guidance (AGENTS.md, CLAUDE.md…) and substantial code comments to the cards they explain. Open a card and its docs are listed first, agent guidance on top, readable in place.
- **Keep what you learn.** Every trace is saved locally, and any one can be shared as a short code a teammate pastes in.
- **Stay current.** The map knows which commit it describes, flags when the code has moved on, and updates itself from just the diff.

Everything runs on your machine. The server listens on `localhost` only, and no code leaves your machine except what your AI tool reads while tracing. With a local model, nothing leaves it at all.

**Full setup guide: [SETUP.md](SETUP.md)**, covering install options, adding a map to a repo, configuring each AI tool, and troubleshooting.

## Requirements

- Node.js >=22.12
- Optional: an AI tool for tracing and drawing the map. Any one of [Claude Code](https://docs.claude.com/en/docs/claude-code), an OpenAI-compatible API key, a local model server (Ollama, LM Studio), or a CLI like Codex or Gemini. See [SETUP.md](SETUP.md#4-choose-an-ai-tool). The map, search and shared trace codes work without one.

Node >=22.12 is required. The backend uses only Node built-ins. React, React DOM, MobX, observer bindings, TypeScript, Vite, Vitest, Playwright and related frontend tooling are devDependencies. Browser code is bundled into git-ignored `dist/`. Registry packages ship prebuilt assets and require no runtime build tools.

## Get started

In the repo you want to map:

```shell
npm install --save-dev @whitemane/repo-map
npx repo-map
```

Or run without adding it to your project: `npx @whitemane/repo-map`.

`prepare` is `npm run build`. `npx github:john77leblanc/repo-map` requires Git and enabled npm lifecycle scripts; npm installs development dependencies and builds frontend assets on the first Git install. Git checkouts do not contain built assets. Do not disable lifecycle scripts for Git installs.

The terminal asks nothing: the first run writes a default config and opens your browser on a short onboarding screen. Confirm the map name, the folders that hold code and a one-line description; pick the AI tool for traces (and, optionally, a different one for the map) from the ones found on your machine; then build the map. Every later run goes straight to the map.

Add a script so teammates only need `npm install` and `npm run map`:

```json
"scripts": { "map": "repo-map" }
```

Commit the `.repo-map/` folder it creates (`config.json`, `map.json`, `.gitignore`). Saved traces and personal AI settings stay out of git.

**Explore:** the sidebar starts with the map title, followed by **New trace** and **Saved traces**. Repository details, component counts, and the current Git revision are in **Settings / Map**. **New trace** opens a modal with vertically stacked output choices; hover or focus each help icon for its description. Expand **Import a trace code** inside this modal to open a shared trace. Closing the modal keeps an unsubmitted draft and lets submitted traces continue in the background. Running traces appear in the sidebar with a spinner and a skeleton title, replaced by an early title while the agent continues. Click a running entry to reopen its prompt, or choose **New trace** to start another. Background completions never replace another draft or selection. Select a trace to see its title, original prompt, and expanded walkthrough and actions. The **Architecture** / **Flowchart** / **Sitemap** tabs sit in one row above the canvas, for the map and for the selected trace; the row's right side says which one you are looking at. A view that doesn't exist yet keeps a dashed tab, and opening it shows a centered message with **Generate** (or **New trace** for Flowchart on the map, since flowcharts only exist for traces). A tab shows a pulsing dot while its output is generating. Opening a trace keeps the view you are on; **Back to all traces** keeps it too, except Flowchart, which returns to your last map view. Flowchart controls sit above its diagram key, while clicking a box opens its details in a panel on the right of the diagram, with **From** and **To** tabs for the steps before and after it (click one to move there). Close the panel with **Close** or Escape. The trace sidebar only describes the trace itself. The flowchart canvas fills the available height. All outputs use the main canvas. Use **Generate** on a missing view, or **Edit** to select and regenerate outputs; generation requires an AI tool. **Back to all traces** returns to the library and whole map without deleting anything. The map stays in place as trace information changes. Older saved traces and import codes continue to work.

Each diagram has a **Diagram key** accordion beside its controls, collapsed by default. Expand it to show the key below the controls. Clicking an architecture card opens its details in a panel on the right of the map, like the flowchart and sitemap, so the card and its wires stay visible. Its connections are split into **From** and **To** tabs; hover one to highlight that card on the map, or click it to move there. Close the panel with **Close** or Escape. Every modal has the same header row: title, then **Close**. Flowcharts show their own process details and code references without architecture step numbers or the architecture walkthrough. Flowcharts initially zoom in two steps beyond the fitted view; **Fit** restores the fitted view. Settings is available from the sidebar home; use **Back to all traces** to return there.

Hovering an architecture node button or group header highlights its connections. Moving off that item clears the hover highlight, including in empty diagram space; any selected card or active trace resumes its highlighting.

Both diagrams fill the available workspace height and scroll inside their canvas. The architecture diagram's horizontal scrollbar stays at the bottom of the screen even when the diagram's content is short.

All AI responses use shared JSON Schema contracts and are validated before use. Claude receives a simplified native schema; if structured output is rejected, repo-map retries once with JSON requested in the prompt, keeping the same model. If a trace violates its contract, the app makes one automatic formatting retry with the same agent and model, including the validation errors. These additional AI requests may add time and cost.

**Keeping it current:** the map remembers the commit it was drawn from. Map and documentation issues show a notification icon on **Settings**, which shows what needs attention and offers **Update map**, **Redraw map**, **Relink docs**, and the tool, model and effort the map uses. Settings also holds the trace AI preference used for new traces and flowchart redraws. Use **Dismiss notification** in Settings to hide the icon for the current issue; dismissal is remembered in this browser, and new issues notify again. From a terminal, use `repo-map update`. Commit the updated `map.json` and `docs.json` like any other change.

The first map is a draft: read it through, fix descriptions, collapse noisy groups, and mark guessed links `"inferred": true`. You build it in the browser: when a repo has no map yet, repo-map opens on the onboarding screen (project details, AI tools, then build). On the last step, optionally tick **Also build the sitemap**, and press **Build**. The map and sitemap build in parallel, each with its own progress. Without an AI tool, **Start from folders instead** gives you one card per folder, which you can fill in by hand or redraw later from Settings.

Want to see it first? Clone this repo, run `npm ci`, then `npm run example` (builds before serving).

For scripted or CI setups, configuring a specific AI tool, and troubleshooting, see [SETUP.md](SETUP.md).

## Commands

| Command    | What it does |
|------------|--------------|
| *(none)* or `start` | Write a default config if missing, then serve and open the map (setup happens in the browser) |
| `init`     | Create `.repo-map/` with a starter `config.json` |
| `docs`     | Link documentation, agent guidance and code comments to the map's cards again (`.repo-map/docs.json`); `--check` for scripts |
| `ai <tool>` | Choose the default AI tool: `claude`, `openai`, `api`, `ollama`, `lmstudio`, `codex`, `gemini`, `command`, `auto`, `none`, with optional `--model` and `--effort`; `--for generate` sets the one that draws the map; `ai show` prints the settings in effect |
| `doctor`   | List the AI tools found, with their models and effort levels, and check the ones traces and the map will use (`--json` for scripts) |
| `update`   | Bring the map up to date with code changed since it was last evaluated (only the diff is sent); `--check` for scripts |
| `validate` | Report unknown ids, groups, kinds and missing paths; exits 1 on errors, so it fits in CI |
| `export`   | Write a snapshot of this map (`--out <file>`, or `-` for stdout) for another repo's workspace to import |
| `serve`    | Start the map without any setup steps |

Options: `--dir <repo root>`, `--port <n>` (or `REPO_MAP_PORT`), `--force`, `--model <id>`, `--effort <level>`, `--version`, `--help`.
`--provider`, `--model` and `--effort` (or `REPO_MAP_AI_PROVIDER`, `REPO_MAP_MODEL` and `REPO_MAP_EFFORT`) pick the AI tool, model and effort for one run. See [SETUP.md](SETUP.md#where-ai-settings-go) for personal settings files.

## How a repo describes itself

Each repo keeps one folder:

```
.repo-map/
  config.json   how to read the repo
  map.json      the drawn graph
  docs.json     documentation linked to its cards
  .gitignore    traces/, local.json, map.draft.json, map.prev.json, map.raw.txt
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
| `footnote`      | Legacy field; accepted but no longer displayed |
| `tracesDir`     | Where saved traces go |
| `docs`          | Which documents the docs pass reads: `{ "include": ["**/*.md", "**/*.mdx", "**/*.rst", "**/*.adoc"], "exclude": ["CHANGELOG.md", "**/CHANGELOG.md"], "comments": true, "maxFiles": 200 }`. `comments` also links substantial doc comments in each card's folder. Documents are readable by the code viewer and the AI tool even outside `codeRoots` |
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
    "desc": "One or two sentences.", "facts": ["/checkout", "placeOrder()"],
    "provides": ["http:GET /checkout"], "consumes": ["http:POST /orders", "env:ORDERS_API_URL"]
  }],
  "edges": [{ "from": "checkout-page", "to": "orders-api", "type": "http", "label": "POST /orders", "inferred": false }]
}
```

- `col` indexes `config.columns`. Groups with `"open": false` start collapsed, and edges into them attach to the group header.
- `path` is the node's folder in the repo. Nodes without one (outside systems) get no code references.
- `provides` / `consumes` (optional) are **contracts**: what a node serves to other repos and what it calls in them, as typed keys: `http:METHOD /path` (path params as `{id}`; `ANY` when the method is unknown), `event:topic`, `pkg:name`, `grpc:pkg.Service/Method`, and `env:VAR` for the variable holding a called service's base URL. The AI tool fills them when it draws or updates the map; keys are normalized (`http:post /orders/:id/` becomes `http:POST /orders/{}`) and unreadable ones are dropped with a `validate` warning. Matching keys are how maps of separate repos are joined in a [workspace](#workspaces-several-repos-in-one-map). Cards list them under **Serves to other repos** and **Calls in other repos**.
- `inferred: true` draws the edge dashed and tells the AI tool the link came from docs or naming rather than code.

### Workspaces: several repos in one map

`.repo-map/workspace.json` (committed) links other repos to this one. The map's **This repo / Workspace** switch then shows them all in one map, joined where one repo calls another.

```json
{
  "links": [
    { "name": "api", "dir": "../shop-api" },
    { "name": "payments", "snapshot": "links/payments.map.json" }
  ],
  "seams": [
    { "from": "payments-client", "to": "payments:charge-route", "type": "http", "label": "POST /charges", "via": "ai",
      "why": "chargeCard posts to PAYMENTS_API_URL", "refs": [{ "path": "src/api/payments.js", "start": 3, "end": 9 }] }
  ]
}
```

- **links**: `name` (2-31 lowercase letters, digits or dashes) prefixes the linked repo's ids: `api:orders-route`. A `dir` link is another checkout with its own `.repo-map/`, read live, relative to this repo. A `snapshot` link is a map copied in with **Settings → Linked repos → Import snapshot** from a file made by `repo-map export` in that repo; it has no code access.
- **Turning a link off** (untick **Include** in **Settings → Linked repos**) leaves that repo out of the workspace for you only: no cards, seams, file reads, AI context or Refresh. It stays in `workspace.json`, and its stored seams come back when you turn it on. The choice is saved in `.repo-map/local.json` as `"workspace": { "off": ["api"] }` (git-ignored); removing a link clears it.
- **seams** are connections between repos. Most are found for free by matching one card's `consumes` against another repo's `provides` (these are never stored). **Find seams** asks the map's AI tool for the rest: it can read files in linked folders, and must cite code for each connection. You accept or dismiss each one; accepted seams are stored here with `"via": "ai"`.
- When a seam explains a placeholder card (an `external` card such as "Orders API" calling into the linked repo, or "Storefront" calling it), the placeholder is replaced by the real card.

**Traces across repos.** While the map shows **Workspace**, a new trace runs over the merged map and can follow a process into linked repos: steps may be linked cards, code references read `<name>:path` files, and the flowchart draws each repo as a band holding its own lanes (fold a band to collapse that repo into one box). The trace remembers it was a workspace trace and opens on the workspace map; steps in a repo you've since unlinked are kept and marked "not linked". Proposals (change requests) stay on this repo's map.

Each repo in the workspace bar shows whether its map is behind its checkout (**map stale**) and how far the checkout is behind its remote's default branch (**behind main 3**), from what was last fetched. **Refresh** runs `git fetch` for that repo (for a snapshot, `git ls-remote` on its recorded remote); repo-map never fetches on its own. Linked cards show their repo; **Collapse** folds a repo into one card that keeps its connections to the others.

### docs.json

Written by the docs pass (after building or redrawing the map, `repo-map docs`, **Relink docs**), and committed with `map.json`:

```json
{ "commit": "…", "links": { "checkout-page": [
  { "path": "AGENTS.md", "start": 12, "end": 30, "title": "Checkout", "why": "Why cards are charged before orders exist", "kind": "guide" }
] } }
```

`kind` is `guide` (agent guidance), `doc` or `comment`, and cards list them in that order, before their code. Links are checked when written: only cards on the map, readable files and real line ranges.

### Agent guidance

If the repo has `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `.cursorrules` or `.cursor/rules/*.mdc`, repo-map gives them to every AI run (map, update, docs, traces, flowcharts) as context about the codebase, alongside `prompt.context`. Lines that only import another file (`@AGENTS.md`) are followed once. They are context only: AI runs stay read-only.

### Flowcharts

With **Flowchart** selected (the default), the AI tool also returns a flowchart with each trace. Traces saved without one have a **Draw flowchart** action, which asks the AI tool to draw it from the trace's steps and code. Open the **Flowchart** view and select a box for its explanation, code references and connections in the panel beside the diagram.

New flowcharts identify where steps execute. When two or more participants are known, vertical **Execution lanes** group steps into Frontend, Backend, workers, databases, or named external services as relevant. Arrows crossing columns show handoffs. Return paths between steps in the same lane stay inside that lane, with space reserved for arrows and labels. Cross-lane returns use the outside route. Lane headings stay visible on an opaque header band while scrolling down the chart, covering the diagram beneath them and remaining aligned during horizontal scrolling and zooming. Ownership follows execution, not source folders; uncertain steps appear as **Unassigned**. Use the **Layout** selector to switch to **Compact**; this preference is remembered per repository in your browser. Single-participant and older flowcharts retain the compact layout. **Redraw** adds lane metadata to an older flowchart; opening it never starts an AI run.

Box types: *start*, *end*, *action* (the person does something), *process* (the system does something), *decision* (a check with labelled outcomes) and *error* (a failure outcome). Dashed boxes and arrows are inferred rather than read in code. The chart is laid out by repo-map itself (using shared pure layout helpers), saved inside the trace, and included in trace codes. Under **Export**, **Copy Mermaid** gives source that GitHub, GitLab and Notion render; **Download SVG** gives a standalone image.

**Collapsing:** fold parts you already understand into one box. Use the collapse button on a lane heading, or select steps (Shift-click, or turn on **Select steps** and click) and choose **Collapse** in the side panel, which lists the selection. Click a collapsed box to see its hidden steps, rename it, or **Expand** it; **Expand all** restores everything. Choices are remembered per trace in your browser and never change the saved flowchart.

**Closer look:** select a box and choose **Look closer** in the side panel. The AI tool reads the code behind that box and returns a short explanation plus 2-12 smaller steps, each with its own code references. The panel shows the explanation, the steps and a small drawing of them; **Show in chart** draws the steps in place of the box, with arrows into the box landing on its first step and each arrow out leaving from the matching step. In the chart, these steps have a purple tint inside a dashed purple frame titled "Expanded: <box>" (the frame is left out when it would cross another box). A box with a closer look that isn't drawn shows a purple **+** badge. **Fold back** turns them back into the box; **Look again** asks again; **Delete** removes it. Closer looks are one level deep, so steps inside one can't be expanded again. They use the trace AI tool, work on proposals and workspace traces, are saved on the trace (and in trace codes), and appear in Mermaid and SVG exports. **Redraw** drops them, since the boxes change. When the AI's steps can't be matched to every arrow out of the box, the closer look stays in the side panel only.

Optional flow metadata is `lanes: [{ id, label }]` and `nodes[].lane`. It survives saving and sharing independently of proposal status and inferred behavior. SVG export follows the displayed layout. Mermaid preserves participant groups as subgraphs; other renderers may position them differently.

### Sitemap

At repository home, choose **Architecture** or **Sitemap** in the view row to explore components or major screens. Select **Generate** on the Sitemap view to analyze pages, substantial workspaces, and navigation from repository code using the map-generation AI settings. This is a whole-application view; a selected trace uses the same view row.

Screens can have URL patterns such as `/products/:id` or no URL at all. Ordinary tabs and dialogs are described in screen details. Arrows require navigation evidence, not merely nested route names. Select a screen for its route, code references, and navigation conditions. Separate applications have an application selector; cross-application destinations are labeled. Incomplete analysis and repositories without user-facing screens have explicit results.

The independent `.repo-map/sitemap.json` is suitable for committing. Version 1 contains `applicability` (`applicable`, `none`, or `incomplete`), `summary`, `applications: [{ id, label }]`, `screens: [{ id, app, label, route, detail, refs }]`, `navigation: [{ from, to, label, condition, refs }]`, `gaps`, and generation metadata (`generatedAt`, `commit`, `dirtyAtGeneration`). References use `{ path, start, end, why }` and are checked against accessible code. Limits are 20 applications, 200 screens, 400 navigation arrows, and three references per item; omissions are disclosed as gaps.

Flowcharts and sitemaps share the same zoom, **Fit**, **Diagram key**, export, and generation toolbar. Sitemap's key explains screens, navigation, journey numbers, surrounding context, and proposed changes. Hover or focus a box to dim everything except it, its links and captions, and the boxes it connects to; a selected box stays in focus until you click it again. Hover a path or its caption to highlight just that link and the two boxes it joins. **Export** → **Copy Mermaid** / **Download SVG** export the displayed application/journey, including filters and proposed changes; SVG preserves theme colors and dimmed context.

Use **More > Show info** for sitemap freshness, snapshot details, and analysis notes, or **More > Hide details** to give the diagram the full width; selecting a screen reopens its details. Journey notes expand for the selected step. **More > Refresh status** reloads the saved result without AI; **Regenerate** explicitly refreshes the analysis. Failed or stopped generation keeps the previous result. Generation has its own job slot, so it can run alongside a map update or redraw; on the first-run starter screen it is opt-in and builds in parallel with the map. Sitemap generation reads code only; it does not crawl a running site.

## Safety

- Listens on `127.0.0.1` only and rejects requests addressed to any other host name.
- The API requires a custom header, so other websites open in your browser can't call it.
- File reads are limited to `codeRoots` and never touch `.env*`, `.repo-map/` or `blocked` segments.
- Linked repos (workspace `dir` links) are read with their own `codeRoots`, docs and the same exclusions, through a `<name>:` path prefix. Snapshot links have no file access. During **Find seams** and workspace traces, Claude Code gets each linked folder with `--add-dir` (still `Read`, `Grep`, `Glob` only); API models use the same prefixed read-only tools.
- Claude Code runs with `Read`, `Grep` and `Glob` only; shell, edit and web tools are disallowed.
- Documents (`docs` in config.json, and agent guidance files) are readable outside `codeRoots`, with the same rules: never `.env*`, `.repo-map/` or `blocked` folders.
- Settings can only save the map's tool, model and effort to `.repo-map/local.json`, after the same checks as the trace menu.
- The trace menu can only choose among the tools repo-map detected, their effort levels, and model ids that look like model ids. The browser can never set a command, its arguments or a URL.
- API models (OpenAI-compatible, including local) only get repo-map's own read-only tools, which go through the same `codeRoots` and `blocked` rules as the code viewer.
- `command` tools (Codex, Gemini, others) read files on their own; use their read-only or sandbox modes. repo-map can't restrict a third-party CLI.
- API keys are read from environment variables and never written to any config file. Each trace is billed to whichever account the tool uses; cost or token counts are shown when it finishes.

## Development

The frontend uses React, TypeScript and MobX with MVVM boundaries under `app/src/`: bootstrap, models, features and shared services/UI/styles/types.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the code layout, adding providers, and releasing.

```shell
npm ci                          # install devDependencies; prepare builds assets
npm run dev                     # example backend + Vite
npm run build                   # type-check and bundle to dist/
npm run example                 # build, then serve examples/shop on localhost:4477
npm test                        # Node suites + Vitest
npx playwright install chromium # install once, separately from test runs
npm run test:e2e                # Playwright
```

## License

MIT

Select **Sitemap** in the new-trace output choices to follow a question through screens and navigation; it can be selected alone or with Architecture and Flowchart. Generate the repository sitemap first if prompted?your question is kept. The journey numbers screens, supports repeated visits, and dims directly connected context. **Show** switches between **Trace screens** (journey screens only), **Trace + nearby** (default), and **Whole application**. Journey steps open as an accordion holding the step's note, screen details, code references and **From** / **To** navigation tabs; hover a connection or step to highlight it on the diagram. Proposals mark screens and links **New**, **Modified**, or **Removed**, with original values in details. The base sitemap stays unchanged. Saved traces and share codes include a snapshot, so later regeneration does not rewrite old journeys. Use **Edit** on a saved trace to select Sitemap and regenerate that output. Questions with no relevant screens show an explanation rather than an invented journey.

### Editing a saved trace

Open a saved trace and choose **Edit** beneath its prompt to revise its complete question and output selections. **Regenerate** replaces the original only when every requested output is usable; its ID and creation date stay the same, and its old implementation plan is cleared. Failures keep the original and your question. Cancel keeps the draft in memory for reopening; reloading discards that draft. Output choices made while editing do not change defaults for new traces.

Revisions reuse up to 12,000 characters of prior findings and code references to focus exploration. They still use the current map, repository guidance, and read-only code tools. No conversation history accumulates, and lower token usage is not guaranteed.
