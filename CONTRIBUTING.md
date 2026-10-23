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
bin/repo-map.mjs     CLI: init, generate, validate, doctor, serve
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
lib/trace-run.mjs     hidden classification, fallback, usage totals and cancellation for traces
templates/           starter config for `repo-map init`
examples/shop/       small fictional repo used by `npm run example` and the tests
test/                node:test suites
```

The sidebar has a home view (New trace and Saved traces) and a selected trace view (back button, title, prompt, output tabs, expanded walkthrough and actions, and flowchart step details). Returning home clears highlighting and restores group state without deleting saved data. Trace information stays outside the main diagram layout. Settings has a separate dialog; architecture cards retain their code and docs inspector. A saved trace's optional `outputs: { architecture, flowchart }` records its available outputs. Legacy traces expose architecture and any valid flowchart. `pendingFlow: true` keeps an incomplete flowchart discoverable for retry. Supporting trace steps remain present for flowchart-only results. The shared output helper remains browser-safe and is imported into the frontend bundle.

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

Trace intent is `description` or `proposal`; legacy traces default to description. Proposals keep `rationale`, `assumptions`, `questions`, and trace-local `nodes`/`edges` with `status: new|modified|removed`. New component ids use `proposal:` and an existing group; modified/removed elements must refer to the base map. `lib/proposal.mjs` validates these identities and composes a disposable view. Keep the underlying map immutable and preserve change status separately from `inferred` in normalization, flowchart redraw, SVG/Mermaid exports, persistence and sharing.

`POST /api/trace` runs the cancellable classifier and response under one lifecycle. Small-model choices are explicit provider mappings, checked against detected model lists, with optional `ai.classify` overrides on the same provider. Classifier failure falls back to the main agent. `POST /api/plan` accepts a proposal trace and streams a normalized `{ summary, tasks: [{ title, detail, files }], interfaces, tests, risks, questions }` plan. It uses the existing read-only runner and API protections. Plans are generated on demand, retained as `trace.plan`, and included in trace codes. The proposal tests use fake runners/HTTP servers; frontend ViewModel/component tests and browser scenarios cover sharing and modal caching/cancellation without AI services.

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
