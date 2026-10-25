# AGENTS.md

Guidance for AI coding agents (Claude Code, Codex, Gemini CLI, Cursor, Copilot, etc.) working in this repository. This is the single source of truth: tool-specific files (`CLAUDE.md`, `.gemini/settings.json`) only point here. Shared, tool-agnostic agent assets (skills, prompts) go in `.agents/` (e.g. `.agents/skills/<name>/SKILL.md`).

## Commands

Node >=22.12 is required. The backend uses only Node built-ins. React, React DOM, MobX, observer bindings, TypeScript, Vite, Vitest, Playwright and related frontend tooling are devDependencies. Browser code is bundled into git-ignored `dist/`. Registry packages ship prebuilt assets and require no runtime build tools.

```shell
npm ci                          # install devDependencies; prepare builds assets
npm run dev                     # example backend + Vite
npm run build                   # type-check and bundle to dist/
npm run example                 # build, then serve examples/shop on localhost:4477
npm test                        # Node suites + Vitest
npx playwright install chromium # install once, separately from test runs
npm run test:e2e                # Playwright
node --test test/flow.test.mjs            # one backend suite
node --test --test-name-pattern="layout"  # backend tests matching a name
node bin/repo-map.mjs serve --dir <other-repo> # serve built assets
```

No linter configured. Style: backend/shared helpers use ESM `.mjs`; frontend uses TypeScript/TSX. 4-space indent, single quotes, named exports collected in one `export { … }` at file bottom.

## Architecture

CLI tool that serves an interactive architecture map of a target repo, plus AI-driven "traces" (plain-language walkthrough of a process, with optional flowchart). Each target repo stores state in `.repo-map/` (`config.json`, `map.json`, git-ignored `traces/`, `local.json`, drafts).

- `bin/repo-map.mjs` — arg parsing + command dispatch. No-arg / `start` → `lib/start.mjs` (never prompts: writes a default config if missing, serves, opens the browser). There is no `generate` command: first-run setup is the browser onboarding (`app/src/features/start/`): **Project** (`GET/PUT /api/setup`, `lib/setup.mjs`) → **AI tools** (trace default via `PUT /api/settings/trace` → global `ai.json`; map pick via `PUT /api/settings/generate`) → **Build** (map, optional parallel sitemap, or folder starter map via `POST /api/map/starter`).
- `lib/server.mjs` ? localhost-only Node built-in HTTP server serving built `dist/` assets and `/api/*` routes. API requires `x-map: 1` (CSRF guard) and rejects non-localhost Host headers. Map update/generate/docs jobs share one server-side lock; sitemap generation has its own, so it can run beside a map job (409 when the relevant lock is busy).
- `app/index.html` ? Vite HTML entry, replacing the inline UI. Agent choices come from `/api/agents`; trace preferences are browser-local, and map preferences use `PUT /api/settings/generate` (? `.repo-map/local.json` `ai.generate`). Services handle streams and persistence.

The React/TypeScript/MobX frontend follows MVVM under `app/src/`:

- `bootstrap/`: composition root constructing services, models and view models.
- `models/`: shared domain and application state.
- `features/`: start (first-run build screen), shell, architecture, sitemap, traces, flowchart, plans and settings.
- `shared/`: services, ui, styles and types.

View models are plain MobX classes with injected services and callbacks, owning observable state, actions and computed values. React views use `observer`, render state and invoke view-model actions; views make no direct network or storage calls. Services own HTTP/NDJSON streaming and persistence. Keep the base map immutable and derive proposal diagrams as computed, disposable compositions. DOM adapters for diagram mounting, measurement, focus, scrolling and SVG integration stay in views, outside models and view models.

Shared UI standards (`app/src/shared/ui/`): every modal or overlay starts with `ModalHeader` (one row: title, then **Close**) followed by one `.modal-body` element, which is the only part that scrolls; diagram detail panels (architecture card, flowchart step, sitemap screen) are right-side `.fside` panels inside the diagram with **Close** and Escape, not modals; direction tabs (From/To) use `DirectionTabs`; job progress uses a `ProgressLog` (in the view model) rendered by `ProgressLine` (one truncated line, expandable history).

Existing shared pure `.mjs` helpers, including `app/flowchart.mjs`, `lib/flow.mjs`, `lib/proposal.mjs` and `lib/trace-outputs.mjs`, remain dependency-free and browser-safe, without `node:` imports. Vite bundles frontend imports; source modules need no individual server module-whitelist entries.

- `lib/config.mjs` — loads config/map with defaults. AI settings layered: defaults < `config.json` `ai` < `~/.config/repo-map/ai.json` < `.repo-map/local.json` < `REPO_MAP_*` env vars. `lib/settings.mjs` writes these for `repo-map ai <tool>` (presets in `AI_PRESETS`).
- `lib/ai/` — agent abstraction. `agents.mjs` is the registry: detects every agent (claude, codex, gemini, api, ollama, lmstudio, command) with its models and effort levels (`listAgents`, cached 60s), and `resolveSelection(config, { task, pick })` picks agent+model+effort for a task (`trace` or `generate`; `generate` reads `ai.generate`, empty fields fall back to trace defaults). Browser/CLI picks are validated there (code `pick` → HTTP 400): only detected agents, listed efforts, model ids matching a safe pattern and not starting with `-`. `index.mjs` wraps it: `detectProvider(config, task)`, `runAi({ ..., task, pick })` (returns `used`), `agentsSummary` for `GET /api/agents`. Model/effort reach CLIs as flags (`claude --model/--effort`; codex `-m`, `-c model_reasoning_effort=`; presets use `modelArgs`/`effortArgs` and an `{options}` slot). On Windows, npm `.cmd` shims are started via cmd.exe with shell-safe args only (`command.mjs`). Runner contract: takes `{ root, config, prompt, settings, timeoutMs, maxTurns, onProgress }`, returns `{ promise, kill }`; promise resolves `{ text, cost?, turns?, tokens? }` or rejects with `Error` whose `code` ∈ `missing|auth|access|limit|model|timeout|turns|failed` (use `classifyFailure()` in `errors.mjs`). `api.mjs` runs a tool-call loop using `tools.mjs` read-only repo tools.
- `lib/prompts.mjs` builds prompts for trace / flow / generate / update; `lib/json.mjs` extracts the JSON object from model replies; `lib/validate.mjs` checks `map.json`.
- Map freshness: `map.json` records the commit it was evaluated at. `lib/freshness.mjs` diffs HEAD vs that commit (restricted to `codeRoots`) → state `current|stale|unrecorded|unknown|starter|empty`. `lib/update.mjs` sends map + diff to AI, gets back a patch, applies it with pure `applyPatch`.
- `lib/scaffold.mjs` — starter config + no-AI folder-based starter map. `lib/generate.mjs` — full AI-drafted map, then the docs pass.
- Docs pass: `lib/docs.mjs` (`linkDocs` → `.repo-map/docs.json` `{commit, links: {nodeId: [{path,start,end,title,why,kind}]}}`, kind `guide|doc|comment`, cleaned by `cleanLinks`; `docsStatus`, `pruneDocs`). Runs after generate, via `repo-map docs`, the Map tab, and from `updateMap` when documents changed or cards were added. `lib/guidance.mjs` reads AGENTS.md/CLAUDE.md/etc. (follows `@file` imports once) and every prompt in `lib/prompts.mjs` includes it via `aboutRepo()`.
- File access: `safePath` (codeRoots only) vs `readablePath` (codeRoots or docs per `config.docs` globs + guidance files). `readLines`, `/api/file` and the API tools' `read_file` use `readablePath`; same `.env`/`blocked`/`.repo-map` exclusions.
- `lib/repo.mjs` — git helpers and the safe file reader.

## Invariants

- **Read-only AI.** Runners must never get tools that write files, run shell, or browse. Claude Code runs with `Read`, `Grep`, `Glob` only.
- **File access** limited to `codeRoots`; `.env*`, `.repo-map/` and `blocked` segments always refused. Applies to the code viewer and API-model tools alike.
- API keys only from env vars, never written to config.
- Adding a provider: wire into `detectProvider` and `runAi`, document in SETUP.md, add a test with a fake server or script (see `test/ai.test.mjs`).
- `examples/shop/` is used by both `npm run example` and the tests; changes there affect test expectations.
- User-facing docs: README.md (overview, config/map schema), SETUP.md (install, AI tool config, troubleshooting), CONTRIBUTING.md (layout, releasing). Update them and CHANGELOG.md when behavior changes.

## Packaging

`prepare` is `npm run build`. `npx github:john77leblanc/repo-map` requires Git and enabled npm lifecycle scripts; npm installs development dependencies and builds frontend assets on the first Git install. Git checkouts do not contain built assets. Do not disable lifecycle scripts for Git installs.

`dist/` stays git-ignored but must ship prebuilt in registry packages. `npm run dev` starts the example backend plus Vite; `npm run example` builds before serving. `npm test` runs Node suites and Vitest; Playwright runs separately after a one-time Chromium install.

## Releasing

Bump `version` in package.json + CHANGELOG.md, `npm run build`, `npm test`, `npm run test:e2e`, `npm publish --dry-run` (verify prebuilt `dist/` assets are included) (check no "errors corrected" warning; `bin` must stay `"bin/repo-map.mjs"` with no leading `./`). Commit `chore: release 0.x.y`, tag `v0.x.y`. Published as `@whitemane/repo-map`. Commit messages follow `feat:` / `fix:` / `chore:` with version in parens for feature releases.
