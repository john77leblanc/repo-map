# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Gemini CLI, Cursor, Copilot, etc.) working in this repository. This is the single source of truth: tool-specific files (`CLAUDE.md`, `.gemini/settings.json`) only point here. Shared, tool-agnostic agent assets (skills, prompts) go in `.agents/` (e.g. `.agents/skills/<name>/SKILL.md`).

## Commands

Node 20+, **zero dependencies** (no `npm install`, no build step). Keep it that way: only `node:` built-ins.

```shell
npm test                                  # node --test, all suites (no network, no AI tool needed)
node --test test/flow.test.mjs            # one file
node --test --test-name-pattern="layout"  # tests matching a name
npm run example                           # serve examples/shop on http://localhost:4477
node bin/repo-map.mjs serve --dir <other-repo>   # try working copy on another repo
```

No linter configured. Style: ESM `.mjs`, 4-space indent, single quotes, named exports collected in one `export { … }` at file bottom.

## Architecture

CLI tool that serves an interactive architecture map of a target repo, plus AI-driven "traces" (plain-language walkthrough of a process, with optional flowchart). Each target repo stores state in `.repo-map/` (`config.json`, `map.json`, git-ignored `traces/`, `local.json`, drafts).

- `bin/repo-map.mjs` — arg parsing + command dispatch. No-arg / `start` → `lib/start.mjs` (interactive setup: config → AI tool → map → serve; non-TTY never prompts).
- `lib/server.mjs` — localhost-only HTTP server. Serves `app/index.html` plus a whitelist of ES modules (`MODULES` map) and `/api/*` routes (config, map, map status/update/mark, file reads, trace, flow, saved traces). API requires `x-map: 1` header (CSRF guard) and rejects non-localhost Host headers.
- `app/index.html` — entire UI, single file, inline JS/CSS. `app/flowchart.mjs` (flowchart layout + SVG) and `lib/flow.mjs` (flow normalization, Mermaid export) are **shared by browser and Node** — must stay dependency-free and browser-safe (no `node:` imports). New browser-imported modules must be added to `MODULES` in server.mjs.
- `lib/config.mjs` — loads config/map with defaults. AI settings layered: defaults < `config.json` `ai` < `~/.config/repo-map/ai.json` < `.repo-map/local.json` < `REPO_MAP_*` env vars. `lib/settings.mjs` writes these for `repo-map ai <tool>` (presets in `AI_PRESETS`).
- `lib/ai/` — provider abstraction. `index.mjs` picks provider (`auto`/`claude`/`command`/`api`/`none`) via `detectProvider` and runs via `runAi`. Runner contract: takes `{ root, config, prompt, settings, timeoutMs, maxTurns, onProgress }`, returns `{ promise, kill }`; promise resolves `{ text, cost?, turns?, tokens? }` or rejects with `Error` whose `code` ∈ `missing|auth|access|limit|model|timeout|turns|failed` (use `classifyFailure()` in `errors.mjs`). `api.mjs` runs a tool-call loop using `tools.mjs` read-only repo tools.
- `lib/prompts.mjs` builds prompts for trace / flow / generate / update; `lib/json.mjs` extracts the JSON object from model replies; `lib/validate.mjs` checks `map.json`.
- Map freshness: `map.json` records the commit it was evaluated at. `lib/freshness.mjs` diffs HEAD vs that commit (restricted to `codeRoots`) → state `current|stale|unrecorded|unknown|starter|empty`. `lib/update.mjs` sends map + diff to AI, gets back a patch, applies it with pure `applyPatch`.
- `lib/scaffold.mjs` — starter config + no-AI folder-based starter map. `lib/generate.mjs` — full AI-drafted map.
- `lib/repo.mjs` — git helpers and the safe file reader.

## Invariants

- **Read-only AI.** Runners must never get tools that write files, run shell, or browse. Claude Code runs with `Read`, `Grep`, `Glob` only.
- **File access** limited to `codeRoots`; `.env*`, `.repo-map/` and `blocked` segments always refused. Applies to the code viewer and API-model tools alike.
- API keys only from env vars, never written to config.
- Adding a provider: wire into `detectProvider` and `runAi`, document in SETUP.md, add a test with a fake server or script (see `test/ai.test.mjs`).
- `examples/shop/` is used by both `npm run example` and the tests; changes there affect test expectations.
- User-facing docs: README.md (overview, config/map schema), SETUP.md (install, AI tool config, troubleshooting), CONTRIBUTING.md (layout, releasing). Update them and CHANGELOG.md when behavior changes.

## Releasing

Bump `version` in package.json + CHANGELOG.md, `npm test`, `npm publish --dry-run` (check no "errors corrected" warning; `bin` must stay `"bin/repo-map.mjs"` with no leading `./`). Commit `chore: release 0.x.y`, tag `v0.x.y`. Published as `@whitemane/repo-map`. Commit messages follow `feat:` / `fix:` / `chore:` with version in parens for feature releases.
