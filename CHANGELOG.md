# Changelog

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
