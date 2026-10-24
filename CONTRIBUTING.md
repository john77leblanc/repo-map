# Contributing to repo-map

## Local development

Node >=22.12 is required. The backend uses only Node built-ins. React, React DOM, MobX, observer bindings, TypeScript, Vite, Vitest, Playwright and related frontend tooling are devDependencies. Browser code is bundled into git-ignored `dist/`. Registry packages ship prebuilt assets and require no runtime build tools.

```shell
git clone https://github.com/john77leblanc/repo-map.git
cd repo-map
npm ci                          # install devDependencies; prepare builds assets
npm run dev                     # example backend + Vite
npm run build                   # type-check and bundle to dist/
npm run example                 # build, then serve examples/shop on localhost:4477
npm test                        # Node suites + Vitest
npx playwright install chromium # install once, separately from test runs
npm run test:e2e                # Playwright
```

`prepare` is `npm run build`. `npx github:john77leblanc/repo-map` requires Git and enabled npm lifecycle scripts; npm installs development dependencies and builds frontend assets on the first Git install. Git checkouts do not contain built assets. Do not disable lifecycle scripts for Git installs.

`npm ci` runs prepare. Tests use fixtures/fakes without live AI services. To try your built working copy against another repo:

```shell
node /path/to/repo-map/bin/repo-map.mjs serve --dir /path/to/other-repo
```

Startup uses the dependency-free `lib/spinner.mjs` helper while drafting or updating the map, including the docs pass. It animates only on TTY stdout, preserves progress lines, and must be stopped before result or cancellation messages and in `finally` cleanup. Standalone AI commands use plain progress output.

### Layout

```
bin/repo-map.mjs     CLI: init, ai, update, docs, validate, doctor, serve
lib/config.mjs       loads .repo-map/config.json, map.json and the layered AI settings
lib/server.mjs       local HTTP server: config, map, file reads, traces, saved traces
lib/repo.mjs         git info and safe, read-only file access (codeRoots / blocked)
lib/prompts.mjs      prompts for traces, flowcharts, generate, update and the docs pass
lib/docs.mjs         docs pass: links documents, agent guidance and code comments to cards (docs.json)
lib/guidance.mjs     reads the repo's AGENTS.md / CLAUDE.md / … for every prompt
lib/validate.mjs     map.json checks
lib/json.mjs         pulls the JSON object out of a model's reply
lib/ai/agents.mjs    registry: detects each agent (claude, codex, gemini, api, ollama, lmstudio, command),
                     lists its models and effort levels, validates picks, runs a selection
lib/ai/index.mjs     picks the agent for a task (trace / generate) and runs it
lib/ai/claude.mjs    Claude Code CLI runner
lib/ai/command.mjs   generic CLI runner and presets (codex, gemini)
lib/ai/api.mjs       OpenAI-compatible Chat Completions runner with a tool-call loop
lib/ai/tools.mjs     read-only repo tools given to API models
lib/ai/errors.mjs    turns provider failures into causes people can act on
app/index.html       Vite HTML entry for React
app/src/bootstrap/   dependency construction
app/src/models/      shared state
app/src/features/    shell, architecture, traces, flowchart, plans, settings
app/src/shared/      services, ui, styles, types
dist/                generated, git-ignored assets included in npm packages
lib/trace-outputs.mjs shared output availability and legacy trace compatibility
lib/proposal.mjs      browser-safe proposal/plan validation and disposable map composition
lib/trace-run.mjs     hidden classification, fallback, one schema repair retry, usage totals and cancellation for traces
lib/response-contracts.mjs shared JSON Schemas, prompt contracts and runtime validation for all AI responses
templates/           starter config for `repo-map init`
examples/shop/       small fictional repo used by `npm run example` and the tests
test/                node:test suites
```

New trace opens a native modal dialog with focus containment, Escape/Close dismissal, draft retention, and background generation after dismissal. Each new trace uses an independent observable `TraceJob` with its own prompt/output/agent snapshot, controller, progress, early title, and save result. Modal state attaches to one job or a fresh draft; closing it does not abort the request. Only an explicitly stopped job or disposing the application cancels its run. Background results must never steal selection, overwrite another draft, or hide another failed save. Output choices form a vertical list with hover/focus tooltips. Trace-code import lives inside the new-trace modal, and the action row keeps the create button, refresh button, and ellipsized progress on one line. The sidebar has a home view (New trace and Saved traces) and a selected trace view (back button, title, prompt, output tabs, expanded walkthrough and actions, and flowchart step details). Returning home clears highlighting and restores group state without deleting saved data. Trace information stays outside the main diagram layout. Settings has a separate dialog; architecture cards retain their code and docs inspector. The sidebar keeps the map title and New trace button above a compact divider; repository identity, counts, and Git revision are computed by the settings view model and rendered in Settings / Repository. Trace tabs render only completed, available outputs, and keyboard navigation follows those visible tabs; use Edit to request missing outputs. A saved trace's optional `outputs: { architecture, flowchart, sitemap? }` records its available outputs. Legacy traces expose architecture and any valid flowchart. `pendingFlow: true` keeps an incomplete flowchart discoverable for retry. Supporting trace steps remain present for flowchart-only results. The shared output helper remains browser-safe and is imported into the frontend bundle.

### Frontend MVVM boundaries

The React/TypeScript/MobX frontend follows MVVM under `app/src/`:

- `bootstrap/`: composition root constructing services, models and view models.
- `models/`: shared domain and application state.
- `features/`: shell, architecture, traces, flowchart, plans and settings.
- `shared/`: services, ui, styles and types.

View models are plain MobX classes with injected services and callbacks, owning observable state, actions and computed values. React views use `observer`, render state and invoke view-model actions; views make no direct network or storage calls. Services own HTTP/NDJSON streaming and persistence. Keep the base map immutable and derive proposal diagrams as computed, disposable compositions. DOM adapters for diagram mounting, measurement, focus, scrolling and SVG integration stay in views, outside models and view models.

Existing shared pure `.mjs` helpers, including `app/flowchart.mjs`, `lib/flow.mjs`, `lib/proposal.mjs` and `lib/trace-outputs.mjs`, remain dependency-free and browser-safe, without `node:` imports. Vite bundles frontend imports; source modules need no individual server module-whitelist entries.

### UI behavior to preserve

The application shell has a viewport-height row; both diagram workspaces use a flex chain with `min-height: 0` down to their scroll containers. Keep architecture scrolling on `.scroller` and flowchart scrolling on `.fcanvas` so horizontal scrollbars stay at the bottom of the available canvas rather than the end of short diagram content. Expanded keys take space above the canvas. On narrow screens, the sidebar and diagram share the viewport vertically.

Diagram keys use independent, initially collapsed accordions: control-row buttons expose `aria-expanded` and `aria-controls`, and reveal the full key beneath the controls. Architecture details use a nonmodal native dialog (`show()`, not `showModal()`) and a backdrop positioned inside `.arch-stage`; both are clipped to the diagram so sidebar interaction stays available. Preserve connection navigation and cleanup on dismissal or trace changes. Close, Escape and backdrop clicks dismiss it. Flowchart details use the trace sidebar without architecture step badges, labels or walkthroughs; hidden step metadata still maps boxes to code references and docs and remains backward compatible in saved traces.

AI wire formats are defined in `lib/response-contracts.mjs`: classification, traces (including requested outputs and proposals), flowcharts, plans, maps, patches, documentation links, sitemaps and sitemap traces. Every production call supplies `responseSchema`; `runSelection` appends it as the authoritative output contract, and Claude also receives a native `--json-schema` with top-level combinators omitted. The full contract remains in the prompt and local validator. The Claude runner retries recognized schema/flag compatibility failures once without native structured output, preserving model, effort, cancellation and the original timeout; it does not retry unrelated failures. Regression tests use fake CLI processes, including the rejected-schema result event and cancellation during fallback. `runAi` returns the validated object as `out.value`; traces validate inside their cancellable lifecycle so one repair can include field-level errors. Validation rejects missing required fields, unknown properties, wrong types and invalid enums without coercion. The validator deliberately implements only the JSON Schema vocabulary used by these contracts; tests guard that vocabulary. Extend the shared contract and its tests when changing a wire format. Repository identities, paths, references and saved-file compatibility still belong to the existing domain validators and normalizers.

Trace intent is `description` or `proposal`; legacy traces default to description. Proposals keep `rationale`, `assumptions`, `questions`, and trace-local `nodes`/`edges` with `status: new|modified|removed`. New component ids use `proposal:` and an existing group; modified/removed elements must refer to the base map. `lib/proposal.mjs` validates these identities and composes a disposable view. Keep the underlying map immutable and preserve change status separately from `inferred` in normalization, flowchart redraw, SVG/Mermaid exports, persistence and sharing.

`POST /api/trace` runs the cancellable classifier and response under one lifecycle. Classification also generates a short title; an NDJSON `title` event arrives before the main response (with a question-derived fallback if classification fails), without an extra AI call. The API service exposes an optional title callback; ordinary progress and result events are unchanged. Small-model choices are explicit provider mappings, checked against detected model lists, with optional `ai.classify` overrides on the same provider. Classifier failure falls back to the main agent. `POST /api/plan` accepts a proposal trace and streams a normalized `{ summary, tasks: [{ title, detail, files }], interfaces, tests, risks, questions }` plan. It uses the existing read-only runner and API protections. Plans are generated on demand, retained as `trace.plan`, and included in trace codes. The proposal tests use fake runners/HTTP servers; frontend ViewModel/component tests and browser scenarios cover sharing and modal caching/cancellation without AI services.

### Sitemap and lane diagrams

`lib/sitemap-data.mjs` is the browser-safe version-1 sitemap normalizer. `lib/sitemap.mjs` owns code-reference validation, atomic persistence, generation, and commit freshness. `GET /api/sitemap` returns `{ sitemap, status }`; `POST /api/sitemap/generate` streams the standard progress/result/error events using map-generation AI settings and its own job lock (map update/generate/docs share a separate one), so it can run beside a map job. `POST /api/map/starter` writes the folder-based starter map when none exists. Failed validation or cancellation must not replace the existing artifact. The repository sitemap remains independent and immutable during tracing. A trace owns a separate snapshot and optional proposal overlay.

The sitemap MVVM feature uses injected services and the shared `DiagramSvg` DOM adapter. `DiagramToolbar` owns the common flowchart/sitemap controls and styling; feature views supply selectors, state, and callbacks. `DiagramMore` handles dropdown focus, Escape, and outside-click dismissal. Sitemap's view model owns Info, Details, More, and Diagram key disclosure state. Hide metadata by default when a diagram is available; keep empty-result explanations and active status visible. Selecting a screen or journey step reopens Details, and only the selected journey step shows its note. Repository views are Architecture/Sitemap; trace outputs are Architecture/Flowchart/Sitemap. Preserve the last repository view across trace exploration. Cover no-UI and incomplete results, route-less screens, cross-application navigation, invalid evidence, cancellation, and stale commits using fake AI servers and browser fixtures.

Sitemap exports use its computed displayed graph and layout, including application/context filters and proposal composition. Reuse `flowToMermaid` and the pure `shared/diagramExport.ts` SVG/filename helpers; include sitemap context styling in exported SVGs. The shared toolbar resolves theme variables in the view, and view models call injected browser services. Invalidate pending clipboard feedback when the displayed graph changes or the view model is disposed. Export state must never modify a saved sitemap or trace.

Flow lane definitions (`lanes: [{ id, label }]`) and per-node `lane` are optional. Normalization drops unused/invalid lanes and leaves uncertain nodes unassigned. Reserve right-side corridors inside each execution lane for same-lane return paths and their captions; overlapping vertical spans get separate corridors, while disjoint spans can reuse space. Cross-lane returns retain the outer route. Layout uses lanes only with two known participants; compact mode does not discard metadata. Keep ownership independent of proposal/inference flags and preserve it through save/share, redraw, SVG, and Mermaid. Shared pure layout helpers stay dependency-free. `DiagramSvg` owns mounting, measurement, keyboard selection, scrolling, and zoom interaction outside view models. Lane headings use an opaque sticky HTML band aligned to the scaled SVG columns; its full scaled height covers the top gap, margins, and rounded corners, while a matching negative bottom margin preserves diagram positioning; keep it inside the canvas so horizontal scrolling and resizing stay aligned. Hide the original SVG headings only in the interactive view, preserving headings in standalone exports.

### Adding an AI provider

Each runner takes `{ root, config, prompt, settings, timeoutMs, maxTurns, onProgress }` and returns `{ promise, kill }`. The promise resolves to `{ text, cost?, turns?, tokens? }`, or rejects with an `Error` whose `code` is one of `missing`, `auth`, `access`, `limit`, `model`, `timeout`, `turns` or `failed`. Use `classifyFailure()` from `lib/ai/errors.mjs` for the message. Add it to the registry in `lib/ai/agents.mjs`: a detect function returning `{ id, kind, label, available, reason, settings, models, efforts, defaultModel }`, an entry in `listAgents`, `AUTO_ORDER` and `PROVIDERS` (`lib/config.mjs`), and a case in `runSelection` if it needs a new runner. Pass the model and effort to the tool as flags, never through a shell. Document it in SETUP.md, and add a test with a fake server or script (see `test/ai.test.mjs`).

Runners must stay read-only: no tools that write files, run shell commands or browse.

## Packaging

`prepare` is `npm run build`. `npx github:john77leblanc/repo-map` requires Git and enabled npm lifecycle scripts; npm installs development dependencies and builds frontend assets on the first Git install. Git checkouts do not contain built assets. Do not disable lifecycle scripts for Git installs.

Keep frontend libraries and tooling in `devDependencies` and include prebuilt `dist/` assets in registry packages. Installed registry packages need no runtime build tools; backend code continues to use only Node built-ins.

## Releasing

1. Update `CHANGELOG.md` and bump `version` in `package.json` (`npm version minor --no-git-tag-version`, or edit it).
2. `npm ci`, `npm run build`, `npm test`, and `npm run test:e2e` (install Chromium once separately with `npx playwright install chromium`).
3. `npm publish --dry-run`. Check that the file list includes prebuilt `dist/` assets, and that there's **no** "errors corrected" warning. If npm says it removed `bin`, the `repo-map` command would be missing from the package: make sure `bin` is `"bin/repo-map.mjs"` (no leading `./`) and the file is executable (`chmod +x bin/repo-map.mjs`).
4. Commit, tag and push:
   ```shell
   git commit -am "chore: release 0.x.y"
   git tag v0.x.y
   git push && git push --tags
   ```
5. Publish. npm requires two-factor authentication to publish: enable it under npmjs.com → Account → Two-Factor Authentication ("Authorization and writes"), then:
   ```shell
   npm publish --otp=123456     # the current code from your authenticator app
   ```

The package is published as `@whitemane/repo-map` (the npm account's scope). The GitHub repository is `john77leblanc/repo-map`.

`lib/sitemap-trace.mjs` normalizes and composes version-1 trace Sitemap outputs. Each has `base` (a saved sitemap snapshot), `applicability: relevant|none`, `summary`, `gaps`, ordered `steps: [{screen,note,refs}]`, `navigation` (zero-based indexes into the snapshot), and `changes: {screens,navigation}`. Steps may revisit screens; indexes distinguish parallel navigation links. Screen changes use existing ids or new `proposal-` ids, an existing application, change status and rationale. Navigation modifications/removals identify their original `index`; additions omit it. Never resolve an old trace against a regenerated sitemap.

`POST /api/trace` accepts `sitemap: true` and optional `architecture: false`; it requires a saved sitemap and attaches the validated snapshot server-side. `POST /api/trace/sitemap` accepts `{trace,...agentPick}` and streams an independent Sitemap result for add/retry/redraw. Both use trace settings and read-only tools. References must pass code-root access checks. Valid screen-only traces need no architecture steps. `pendingSitemap` keeps partial output failures discoverable. Persist/share the snapshot and proposal changes, include them in flowchart and plan prompts, and preserve legacy output behavior. The request body limit is 2 MiB to accommodate snapshots.

### Trace revisions

`POST /api/trace` accepts optional `previousTrace` data alongside the complete revised `prompt`. `lib/trace-context.mjs` allowlists and bounds prior findings to 12,000 serialized characters, omitting plans, history, and the old sitemap base. Old navigation indexes are resolved to endpoints before discarding that base. The classifier receives only the revised question; the main runner receives compact findings plus the current map and guidance. Existing callers and saved trace formats remain compatible.

The trace view model owns editing state, output choices, cancellation, and all-output validation. Entering the editor disconnects diagram views and cancels their jobs. Revisions use the existing PUT persistence path with the original ID and creation date; plans and unrequested diagrams are removed. Keep failed saves available in memory for retry. Cover context bounds, cancellation, incomplete outputs, persistence failure, and the browser edit flow when changing this behavior.
