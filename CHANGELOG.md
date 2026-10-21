# Changelog

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
