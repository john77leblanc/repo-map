# Changelog

## Unreleased

- Clear architecture hover highlighting when the cursor leaves a node button or group header, including within the diagram.
- Keep the implementation-plan modal header and Close button visible while its content scrolls.
- Document the approved React/TypeScript/MobX MVVM frontend migration, bootstrap/models/features/shared layout, injected plain-class view models, observer views, immutable base map with computed proposals, and view-layer DOM adapters. Shared pure `.mjs` helpers remain browser-safe.
- Require Node >=22.12 with the Node built-in-only backend. Frontend libraries and tooling are development dependencies bundled into git-ignored `dist/`; registry packages ship prebuilt assets without runtime build tools.
- Document `npm ci`, example backend + Vite development, builds, build-before-serve examples, Node + Vitest tests and separate Playwright tests with one-time Chromium installation. `prepare` runs `npm run build` for first Git installs via `npx github:john77leblanc/repo-map` (Git and lifecycle scripts required).

## 0.9.0

- Removed the duplicate Not shown clearly message from the top of the flowchart sidebar.

- Removed the inherited left indentation from the architecture details overlay's trace-step section.

- Architecture details and their backdrop are confined to the diagram; the sidebar stays interactive while details are open.
- Flowcharts and SVG exports no longer display architecture step badges or labels. The flowchart column omits the architecture walkthrough while retaining relevant code references and documentation.

- Architecture detail modals show the matching numbered trace-step badge and group the step explanation and code references inside a bordered section.

- Removed the How to read it and proposed-change guidance sections from the flowchart details column; the diagram key remains available in its accordion.

- Both diagram workspaces fill their container's available height and scroll internally. The architecture diagram's horizontal scrollbar stays at the bottom of the screen, including when its content is short or the key is expanded.

- Diagram keys are collapsed by default, with one Diagram key accordion button beside each diagram's controls that expands the key beneath them.
- Architecture card details open in a centered modal over the diagram, with keyboard focus management, connection navigation and Close, Escape or backdrop dismissal.

- Trace prompts automatically route to current-behavior descriptions or hypothetical proposals using a hidden same-provider classifier, with main-agent fallback and cancellation across both stages.
- Proposal traces show distinctly labeled new, modified and removed components/connections in architecture diagrams and flowcharts without changing the base map. Proposal state survives redraws, exports, saves and shared trace codes.
- An optional Implementation plan modal generates and retains ordered tasks, interface changes, tests, risks and open questions, with Stop, retry, Copy and explicit regeneration.

- Startup shows an ASCII spinner while the agent drafts or updates the map and links documentation, keeping progress messages visible and clearing the indicator on completion, failure, or Ctrl+C.

## 0.8.0

- Removed the descriptive footnote beneath the architecture map.
- Repository title and details appear above New trace in the sidebar home. Settings and Back to all traces share the top control slot. Flowchart controls sit above its diagram key, and the canvas fills the available height; duplicate titles and the sidebar divider are removed.
- Map and documentation notices use a notification icon on Settings instead of a banner above the diagram. Dismissal is remembered in this browser for the current issue; new issues notify again. Status and maintenance actions remain in Settings.
- Corrected the sidebar chevron direction; Settings appears only in the sidebar home view.
- Diagram keys remain visible above both diagrams. Flowcharts open two zoom-in steps closer; Fit still fits the chart.
- The sidebar switches between a trace library and a selected trace information panel, with title, prompt, Architecture / Flowchart tabs, expanded walkthrough and actions, and flowchart step details.
- Back to all traces returns to the whole repository without deleting saved traces. Trace information stays out of the space above the map, keeping its vertical position stable.

## 0.7.0

- The sidebar centers navigation on saved traces. Each card shows its title, prompt, and Architecture / Flowchart buttons; Settings and collapse controls sit above New trace. Both outputs use the main canvas.
- New trace creation offers Code architecture and Flowchart independently, remembers selections, and saves linked outputs together. Older saved traces and share codes remain compatible; incomplete flowcharts can be retried.
- The trace composer places the prompt above output choices, followed by Create trace, tool refresh and progress on one row. The AI picker is available in Settings.
- Settings has its own panel with map maintenance and both AI preference groups. The trace AI picker lives in Settings.
- Architecture cards and flowchart steps show explanations, expandable code and linked docs in details panels. Diagram keys are compact, and flowchart drawing has a Stop action.

## 0.6.0

- **Documentation on the cards.** After drawing the map, a second pass with the map's AI tool links sections of the repo's docs, its agent guidance (AGENTS.md, CLAUDE.md, GEMINI.md, Copilot and Cursor rules) and substantial code comments to the cards they explain. Open a card and they're listed first, agent guidance on top, before the code; each opens in place with its lines read live. Saved in `.repo-map/docs.json` (commit it).
- **Agent guidance goes to every AI run.** AGENTS.md and friends are given to map, update, docs, trace and flowchart runs as context, following `@file` imports once.
- **The Map tab.** A second sidebar tab for the map itself: status and changed files, **Update map** (moved here from the banner), **Redraw map**, **Relink docs**, each with progress and Stop, and the map's own tool, model and effort, saved for you in `.repo-map/local.json`. The banner above the map is now one line that opens it.
- **Spinners** wherever the page waits on an AI tool: traces, flowcharts, map jobs and the tool list.
- The trace menu and the Map tab's menu share one list of tools and one picker.
- New `repo-map docs` (`--check` for CI), `generate --no-docs`, `update --no-docs`, and a `docs` block in config.json (which documents to read, whether to include code comments). `validate` warns about doc links to cards that are gone.
- Documents are readable by the code viewer and the AI tools even outside `codeRoots`; `.env`, `.repo-map/` and blocked folders still never are.
- **Redraw** keeps the previous map as `map.prev.json`, like updates do. Updates relink docs when documents changed or cards were added.
- Costs under a cent show as "<$0.01"; progress shows repo-relative paths on Windows.
- Fixed on Windows: reading files when the repo path was given as a relative path, and three tests that assumed a POSIX shell.

## 0.5.0

- **Choose the AI tool, model and effort per trace.** A menu beside the **Trace** button lists every AI tool repo-map finds on your machine (Claude Code, Codex, Gemini, a configured API, a running Ollama or LM Studio, a custom command), each with its models and effort levels, plus **Custom model…** for any model id. The choice is remembered per repo in your browser and also used for **Draw flowchart**. Each saved trace records what made it.
- Models are listed live where the tool can say: `claude --help`, Codex's local model cache (with each model's own effort levels), and `GET /models` for APIs and local servers. Lists can be overridden in settings (`ai.<tool>.models`, `ai.<tool>.efforts`).
- **A separate tool for drawing the map.** `ai.generate` sets the tool, model and effort for `generate` and `update`; empty fields fall back to the trace default. First-run setup asks about it, and `repo-map ai <tool> --for generate` sets it.
- New `--effort` flag and `REPO_MAP_EFFORT`, saved as `"effort"` by `repo-map ai`. `--provider`, `--model` and `--effort` now apply to every task in that run.
- New providers `codex`, `gemini`, `ollama` and `lmstudio`. Settings from 0.4 (`"command"` with a codex/gemini preset, `"api"` pointed at localhost) keep working.
- `repo-map doctor` lists every tool found with its models and effort levels, and checks the map's tool too.
- Fixed: Codex and Gemini ignored the configured model (it was only passed as an environment variable). It is now passed as `-m`.
- Fixed: on Windows, CLIs installed by npm (`.cmd` scripts, e.g. Codex) couldn't be started.

## 0.4.0

- **Flowcharts for traces.** With **Include a flowchart** ticked (the default, remembered per browser), the AI tool also draws the process's logic: what the person does, what the system does, the decisions and their outcomes, failure paths and retry loops. Boxes are linked to trace steps, and anything inferred rather than read in code is dashed.
- The flowchart opens in a window from the trace: zoom and fit, click a box for its detail, its trace step and that step's code, or **Show on map**. **Copy Mermaid** and **Download SVG** export it; **Redraw** asks for a new one.
- Traces saved before this, or without a flowchart, get a **Draw flowchart** button that draws one from the trace's steps and code and saves it with the trace.
- Flowcharts are saved in the trace file and included in trace codes. Layout is built in; no new dependencies.

## 0.3.1

- **Sharper focus.** Inside groups that stay visible, cards that aren't involved fade too.
- Highlighted connections are drawn above the cards, so a faded group no longer dims the lines that cross it.
- Added space between the right-most column and the traces sidebar.

## 0.3.0

- **Know when the map is out of date.** `generate` and `update` record the commit the map describes (`commit` in `map.json`). On load, the map compares it with your checkout and shows a banner when files under the code folders have changed since, listing them. Changes elsewhere (docs, CI config) are ignored.
- **Incremental updates.** **Update map** in the banner, or `repo-map update`, sends the AI tool the current map plus only the git diff since the recorded commit, and applies the small patch it returns (nodes, groups and connections added, changed or removed). The previous map is kept as `.repo-map/map.prev.json` (git-ignored), and nothing is written if the patch would break the map. `repo-map update --check` reports status for scripts (exit 1 when stale); `--mark` records the current commit without changing the map. Very large diffs suggest a full `generate --force` instead.
- `repo-map` (start) offers to update a stale map, defaulting to no because it uses AI credits, and mentions it when the map opens.
- **Traces are saved automatically** and shown as one collapsible list: opening a trace shows it on the map, closing it clears the map. Imported trace codes are saved too. Each open trace has **Copy trace code** and **Delete**.
- **Clearer focus.** Hovering a card or group fades the groups that aren't involved, so the connection lines behind them stay visible. Open traces do the same.
- Fixed: arrowheads faded out when connections were highlighted.

## 0.2.0

Tracing and `generate` are no longer tied to Claude Code.

- **One command to get going.** Running `repo-map` with no command (or `npx @whitemane/repo-map`) now sets up whatever is missing, asking only when it has to: the map's name, code folders and description; which AI tool to use, from those found on the machine (Claude Code, a running Ollama or LM Studio, Codex, Gemini, OpenAI) or skip; and whether to draft the map. Then it opens the map in the browser, moving to the next port if 4477 is taken. Without a terminal it never asks. `repo-map serve` still starts the map with no setup steps.
- **Starter map without AI.** If you skip the AI tool, or drafting fails, the map starts with one card per folder instead of being empty.

- **Choose your AI tool.** New `ai.provider` setting: `claude` (Claude Code CLI), `api` (any OpenAI-compatible API, hosted or local, e.g. OpenAI, OpenRouter, Ollama, LM Studio), `command` (any CLI, with presets for Codex CLI and Gemini CLI), `none`, or `auto` (the default: Claude Code if installed, then an API if configured, then a command).
- **Personal AI settings** in `~/.config/repo-map/ai.json` or a git-ignored `.repo-map/local.json`, plus `--provider` / `--model` flags and `REPO_MAP_*` env vars, so each person can use their own tool without changing the shared config.
- **`repo-map doctor`** shows which AI tool will be used and checks that it works (for APIs, without spending tokens).
- **Scripted setup.** Every step is a non-interactive command that's safe to re-run:
  - `repo-map ai <tool>` (claude, openai, api, ollama, lmstudio, codex, gemini, command, auto, none) saves the AI choice with `--global` (default), `--local` or `--repo`; `repo-map ai show` prints the settings in effect.
  - `repo-map init --name --roots --context --github` sets the essentials without editing JSON, and updates an existing config when re-run with flags.
  - `repo-map generate --if-missing` does nothing when a map already exists.
  - `repo-map doctor --json` prints machine-readable status and exits 1 when tracing is off.
  - Unknown flags now fail with an error instead of being ignored, and `--flag=value` works.
- **Clearer failures.** Traces explain whether the tool isn't installed, isn't signed in, has no access, hit a limit, or doesn't know the model, with what to do next.
- **No-AI mode in the UI.** When no tool is set up, the trace box says so, explains how to enable one, and points to importing a teammate's trace code.
- **SETUP.md** and **CONTRIBUTING.md** with full setup, provider and release instructions.
- Fixed: code references were dropped from traces in repos whose code isn't under `services/` or `packages/`.
- Fixed: a CLI that exits before reading its prompt no longer crashes the server.
- 0.1.x configs with a top-level `"claude"` block keep working.

## 0.1.0

First release.

- `repo-map serve`: interactive map of a repo's units, shared code and outside systems, with hover tracing, search, collapsible groups and a resizable sidebar.
- Plain-language process tracing through the Claude Code CLI (read-only tools), with code references read live from the checkout and GitHub links.
- Saved traces on disk and shareable trace codes.
- `repo-map init`, `repo-map generate` (Claude Code drafts the map) and `repo-map validate`.
