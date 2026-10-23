# Setting up repo-map

This guide covers installing repo-map, adding it to a repo, and choosing the AI tool that powers plain-language traces and `repo-map generate`.

You don't need an AI tool to use the map. Without one you can still browse it, search it, follow connections, and open traces that teammates share as trace codes. An AI tool is only needed to run new traces and to draft a map.

- [The short version](#the-short-version)
- [Scripted setup](#scripted-setup)
- [1. Requirements](#1-requirements)
- [2. Install](#2-install)
- [3. Add a map to a repo](#3-add-a-map-to-a-repo)
- [4. Choose an AI tool](#4-choose-an-ai-tool)
- [Keeping the map up to date](#keeping-the-map-up-to-date)
- [5. Check your setup with `repo-map doctor`](#5-check-your-setup-with-repo-map-doctor)
- [6. Teammates without an AI tool](#6-teammates-without-an-ai-tool)
- [7. Troubleshooting](#7-troubleshooting)

## The short version

```shell
npm install --save-dev @whitemane/repo-map
npx repo-map
```

The first run asks only what it needs:

1. **Map details** (only if the repo has no `.repo-map/` yet): a name, the folders that hold code, and a one-line description. Press Enter to accept each suggestion.
2. **AI tool** (only if none is working yet): it lists what it finds on your machine (Claude Code, a running Ollama or LM Studio, Codex, Gemini) plus OpenAI, or **Skip**. Your choice is saved for every repo in `~/.config/repo-map/ai.json`. An OpenAI key you paste is used for that session only and never saved to a file.
3. **Draft the map** (only if there isn't one): with your AI tool, which takes a few minutes, or, if you skipped AI, from your folder structure.
4. **Open the map** in your browser. If port 4477 is taken, it uses the next free one.

After that, `npx repo-map` (or `npm run map`) just opens the map. Teammates joining a repo that already has a map get only step 2, and only if they don't have an AI tool set up yet.

`npx @whitemane/repo-map` does the same without installing anything. When there's no terminal to ask questions in (CI, a pipe, or `--yes`), it uses the defaults, skips the AI draft and the browser, and starts from your folders.

While startup drafts or updates the map and links documentation, a terminal spinner (`| / - \`) shows that work is continuing, even between progress messages. It clears when the work finishes, fails, or is stopped with Ctrl+C. Animation is only enabled for terminal output; standalone `generate`, `update`, and `docs` commands keep their plain progress output.

Everything else in this guide is for when you want more control.

## Scripted setup

Every step is also a plain command with flags: nothing prompts you, and each one is safe to run again. That makes it easy to paste into a README, an onboarding script, or a `Makefile`.

### Add repo-map to a repo (once, by whoever sets it up)

```shell
npm install --save-dev @whitemane/repo-map
npx repo-map init --name "Shop Map" --roots src --context "A React storefront. Pages live in src/pages, shared state in src/stores, API clients in src/api."
npx repo-map ai claude --repo            # optional: the team's default AI tool, saved in config.json
npx repo-map doctor                      # exits 1 if no AI tool is ready
npx repo-map generate --if-missing       # drafts map.json; does nothing if one already exists
npx repo-map validate                    # exits 1 on errors
npm pkg set scripts.map="repo-map"
git add .repo-map package.json package-lock.json
git commit -m "chore: add repo-map"
```

`generate` is the one step whose output varies, because an AI tool writes the draft. Review it, then commit `map.json`: from then on, everyone sees the same map, and `--if-missing` turns re-runs into no-ops.

### Set up your machine (once per person)

Choose one AI tool. The setting is saved in `~/.config/repo-map/ai.json` and applies to every repo:

```shell
npx repo-map ai claude                                  # Claude Code (installed and signed in)
npx repo-map ai openai --model gpt-4.1                  # then: export REPO_MAP_API_KEY=sk-...
npx repo-map ai ollama --model qwen2.5-coder:14b        # local model, no key
npx repo-map ai codex --effort medium                   # or: ai gemini
npx repo-map ai none                                    # map only, no tracing
npx repo-map ai claude --model opus --effort high --for generate   # optional: a stronger model just for drawing the map
```

You can change the tool, model and effort for new traces in **Settings / Trace agent**.

Then:

```shell
npx repo-map doctor      # confirms the tool works
npm run map              # http://localhost:4477
```

Add `--local` to save the choice for one repo only (`.repo-map/local.json`, git-ignored), or `--repo` to set the team default (`.repo-map/config.json`). Run `npx repo-map ai show` to see the combined settings that apply in the current repo.

### In CI

```shell
npx repo-map validate         # fails the build if map.json references unknown nodes, groups or missing paths
npx repo-map update --check   # optional: fails when the map hasn't been updated for code changes
```

`npx repo-map doctor --json` prints a machine-readable status, `{ "ready": true, "provider": "claude", "map": { … }, "agents": [ … ] }`, and exits 1 when tracing isn't available.

To draw or update the map with a particular tool in a script, pass it for that run: `npx repo-map generate --provider claude --model opus --effort high`.

The rest of this guide explains each step in more detail.

## 1. Requirements

- **Node.js >=22.12** (`node -v`)
- **git**, for branch info and GitHub links
- **Optional: one AI tool** from [section 4](#4-choose-an-ai-tool)

Node >=22.12 is required. The backend uses only Node built-ins. React, React DOM, MobX, observer bindings, TypeScript, Vite, Vitest, Playwright and related frontend tooling are devDependencies. Browser code is bundled into git-ignored `dist/`. Registry packages ship prebuilt assets and require no runtime build tools.

## 2. Install

Pick whichever fits the project.

**As a dev dependency** (recommended for teams, so everyone runs the same version):

```shell
npm install --save-dev @whitemane/repo-map
# pnpm: pnpm add -D @whitemane/repo-map   (add -w at a workspace root)
```

Then add a script to `package.json`:

```json
"scripts": { "map": "repo-map" }
```

**Always the newest version, with nothing installed:**

```json
"scripts": { "map": "npx -y @whitemane/repo-map@latest" }
```

**Directly from GitHub:**

```shell
npx github:john77leblanc/repo-map
```

`prepare` is `npm run build`. `npx github:john77leblanc/repo-map` requires Git and enabled npm lifecycle scripts; npm installs development dependencies and builds frontend assets on the first Git install. Git checkouts do not contain built assets. Do not disable lifecycle scripts for Git installs.

**From a clone:**

```shell
git clone https://github.com/john77leblanc/repo-map.git ~/tools/repo-map
cd ~/tools/repo-map
npm ci                 # prepare builds frontend assets
alias repo-map='node ~/tools/repo-map/bin/repo-map.mjs'   # add to ~/.zshrc or ~/.bashrc
```

For development in the clone:

```shell
npm ci                          # install devDependencies; prepare builds assets
npm run dev                     # example backend + Vite
npm run build                   # type-check and bundle to dist/
npm run example                 # build, then serve examples/shop on localhost:4477
npm test                        # Node suites + Vitest
npx playwright install chromium # install once, separately from test runs
npm run test:e2e                # Playwright
```

`npm ci` runs prepare. Rebuild after frontend changes when serving directly with Node; `npm run dev` runs the example backend plus Vite. Chromium installation is separate from running tests.

The examples below use `repo-map`. With a dev dependency, run them as `npx repo-map …` (or `pnpm exec repo-map …`).

## 3. Add a map to a repo

From the repo root:

```shell
repo-map init        # creates .repo-map/config.json and .repo-map/.gitignore
```

Set the essentials with flags (`init --name … --roots src,lib --context "…" --github owner/repo`), or open `.repo-map/config.json` and set:

- **`name`**: the page title.
- **`codeRoots`**: the folders the map, traces and code viewer may read, e.g. `["src/"]` or `["services/", "packages/"]`. Everything else stays off-limits.
- **`columns`, `kinds`, `edgeTypes`**: how the map is laid out and labelled. The defaults are fine to start.
- **`prompt.context`**: two or three sentences on the stack, where code lives, and how it reaches other systems. This matters more than anything else for trace quality.

Then:

```shell
repo-map doctor      # confirms which AI tool will be used (section 5)
repo-map generate    # the AI tool explores the repo read-only and drafts .repo-map/map.json
repo-map validate    # checks ids, groups, kinds and paths
repo-map serve       # opens on http://localhost:4477
```

`generate` gives you a first draft. Read it through, fix descriptions, close noisy groups (`"open": false`), and mark guessed links `"inferred": true`. You can also write or edit `map.json` by hand; the format is described in the [README](README.md#mapjson).

**Commit** `.repo-map/config.json`, `.repo-map/map.json` and `.repo-map/.gitignore`. The `.gitignore` keeps saved traces (`traces/`) and personal settings (`local.json`) out of git.

## 4. Choose an AI tool

repo-map works with these AI tools:

| Provider   | What it is | Reads code with | Models listed from | Effort |
|------------|------------|-----------------|--------------------|--------|
| `claude`   | Claude Code CLI | its own read-only tools (`Read`, `Grep`, `Glob`) | `claude --help` (aliases like `opus`, `sonnet`) | `--effort`: low … max |
| `codex`    | Codex CLI | its read-only sandbox | Codex's own model cache (`~/.codex/models_cache.json`) | reasoning effort, per model |
| `gemini`   | Gemini CLI | whatever the CLI does on its own | a short built-in list | none |
| `api`      | Any OpenAI-compatible API: OpenAI, OpenRouter, Azure OpenAI, vLLM… | repo-map's read-only tools (`list_files`, `search_code`, `read_file`) | the server (`GET /models`) | `reasoning_effort`: low, medium, high |
| `ollama`, `lmstudio` | A local Ollama or LM Studio server | repo-map's read-only tools | the server (`GET /models`) | none |
| `command`  | Any CLI that takes a prompt and prints an answer | whatever the CLI does on its own | `command.models`, if you set it | `command.efforts`, if you set it |

With `"provider": "auto"` (the default), repo-map uses the first one that's ready: Claude Code, then a configured API, a configured command, Codex, Gemini, Ollama and LM Studio.

### Choosing per trace, and a different tool for the map

The setting above is only the **default**. In the browser, **Settings / Trace agent** lists every tool repo-map found on your machine, with its models and effort levels. This choice is remembered in that browser for new traces and flowchart redraws. **Custom model...** takes any model id the tool accepts. The refresh button beside **Create trace**, or the one in Settings, looks for tools again, for example after you start Ollama.

Drawing and updating the map reads much more code than a trace, so it can use its own tool, model and effort. `repo-map` asks about this the first time; to change it later:

```shell
repo-map ai claude --model opus --effort high --for generate
```

That writes `"generate": { "provider": "claude", "model": "opus", "effort": "high" }` next to your trace default. Empty fields fall back to the trace default, and `--provider`, `--model` and `--effort` on a command override both for that run.

Each tool's model and effort lists can be replaced in settings, e.g. `"gemini": { "models": ["gemini-2.5-pro"] }` or `"api": { "efforts": ["low", "high"] }`. Run `repo-map doctor` to see what was found.

### Where AI settings go

The AI tool is usually a personal choice, so you don't have to change the shared config. Settings are layered, and later layers win:

1. `"ai"` in `.repo-map/config.json`: the team default (committed)
2. `~/.config/repo-map/ai.json`: your default for every repo
3. `.repo-map/local.json`: your override for this repo (git-ignored)
4. Environment variables and flags: `REPO_MAP_AI_PROVIDER` / `--provider`, `REPO_MAP_MODEL` / `--model`, `REPO_MAP_EFFORT` / `--effort`, `REPO_MAP_API_BASE_URL`, `REPO_MAP_CLAUDE_BIN`

`local.json` and `ai.json` take the same shape as the `"ai"` block. API keys never go in these files: they're read from an environment variable.

The quickest way to save a choice is `repo-map ai <tool>`, shown under each tool below. It writes the same JSON you'd otherwise edit by hand, to `~/.config/repo-map/ai.json` by default (`--local` and `--repo` choose the other files).

### Claude Code

1. Install the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code).
2. Run `claude` once in a terminal and sign in.
3. That's it: `auto` picks it up. To use it explicitly: `repo-map ai claude [--model <id>] [--effort <level>]`.

Optional settings:

```json
{ "provider": "claude", "effort": "", "claude": { "model": "", "maxTurns": 40, "bin": "claude" } }
```

### OpenAI (or another hosted, OpenAI-compatible API)

```shell
export REPO_MAP_API_KEY=sk-...        # OPENAI_API_KEY also works
repo-map ai openai --model gpt-4.1
```

Or in `~/.config/repo-map/ai.json` or `.repo-map/local.json`:

```json
{ "provider": "api", "api": { "model": "gpt-4.1" } }
```

For other hosts, set the base URL and, if you like, a different variable for the key: `repo-map ai api --model anthropic/claude-sonnet-4 --base-url https://openrouter.ai/api/v1 --key-env OPENROUTER_API_KEY`, or:

```json
{
  "provider": "api",
  "api": {
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "anthropic/claude-sonnet-4",
    "apiKeyEnv": "OPENROUTER_API_KEY"
  }
}
```

Use a model that supports tool (function) calling; repo-map relies on it to read code.

### A local model (Ollama, LM Studio, vLLM)

Nothing leaves your machine, and there's no per-token cost.

1. Install [Ollama](https://ollama.com) and pull a model that supports tool calling, for example:
   ```shell
   ollama pull qwen2.5-coder:14b
   ```
2. Save it:
   ```shell
   repo-map ai ollama --model qwen2.5-coder:14b
   ```
   That writes `{ "provider": "ollama", "ollama": { "model": "qwen2.5-coder:14b" } }`. For LM Studio, use `repo-map ai lmstudio --model <id>`. `--model` is optional for both: without it, the first model the server lists is used.

No key is needed. The default base URLs are `http://localhost:11434/v1` (Ollama) and `http://localhost:1234/v1` (LM Studio); change them with `--base-url`. For vLLM or another local server, use `repo-map ai api --base-url <url> --model <id>`.

A running Ollama or LM Studio shows up in the trace menu even when it isn't your default.

Smaller local models give rougher traces and maps. If answers come back malformed or miss obvious steps, try a larger model.

### Codex CLI or Gemini CLI

```shell
repo-map ai codex        # or: repo-map ai gemini
```

That writes `{ "provider": "codex", "codex": {} }` (add `--model` and `--effort` to set them). Sign in to the CLI first (`codex login`, or run `gemini` once). Settings from older versions, `{ "provider": "command", "command": { "preset": "codex" } }`, still work.

repo-map passes the model as `-m <model>` to both, and Codex's effort as `-c model_reasoning_effort=<level>`. Codex lists the models your account can use, and each one's effort levels, from the cache it keeps in `~/.codex` (or `$CODEX_HOME`); run Codex once if the list is empty.

These presets are starting points from each tool's documentation and haven't been tested against every version. CLI flags change between releases, so if one doesn't work, set the command yourself (next section). On Windows, CLIs installed by npm are `.cmd` scripts; repo-map starts them through `cmd.exe`, which only works when the prompt goes in on stdin (Codex does; the Gemini preset passes it as an argument).

### Any other CLI

```json
{
  "provider": "command",
  "command": {
    "label": "My AI tool",
    "bin": "my-ai",
    "args": ["run", "--read-only"],
    "promptVia": "stdin"
  }
}
```

- **`promptVia: "stdin"`** pipes the prompt in. **`"arg"`** passes it as an argument instead; put `"{prompt}"` in `args` to choose its position.
- **`modelArgs`** and **`effortArgs`** (e.g. `["--model", "{model}"]`) pass the chosen model and effort; put `"{options}"` in `args` to choose where they go. List what the trace menu should offer in **`models`** and **`efforts`**. The model and effort are also in the environment as `REPO_MAP_MODEL` and `REPO_MAP_EFFORT`.
- The tool must print its answer to stdout and exit 0. repo-map finds the JSON in the answer.
- The tool needs to read files in the repo on its own. Run it in a read-only or sandboxed mode if it has one: repo-map can't restrict what a third-party CLI does.

### Turning AI off

```shell
repo-map ai none
```

## Keeping the map up to date

`map.json` records the commit it describes (`"commit"`). Each time the map opens, repo-map compares that commit with your checkout and counts the files under `codeRoots` that changed. Map and documentation issues show a notification icon on **Settings**. The panel lists the changed files and offers **Update map**. **Dismiss notification** hides the icon for the current issue in this browser, while keeping the status and maintenance controls available. A different issue shows the icon again.

An update sends your AI tool the current map plus **only the git diff** since that commit (capped in size; it can read whole files when it needs more), and asks for a small patch: nodes, groups and connections to add, change or remove. repo-map applies the patch, checks the result with the same rules as `validate`, records the new commit, and keeps the previous version as `.repo-map/map.prev.json`. If the patch would leave the map broken, nothing is written.

From a terminal:

```shell
repo-map update            # update from the diff
repo-map update --check    # report only; exits 1 when the map is out of date (useful in CI)
repo-map update --mark     # record the current commit without changing the map
repo-map generate --force  # redraw the whole map instead (for big refactors)
```

After an update, review it with `git diff .repo-map/map.json` and commit it, so teammates get the same map. Maps made before 0.3 have no recorded commit: Settings offers **Mark as current**, which does the same as `update --mark`.

### Settings

The sidebar's **Settings** button opens a dedicated panel for map maintenance and AI preferences:

- **Status**: up to date or not, the files that changed, and whether documents changed since the docs were linked.
- **Update map**, **Redraw map** (asks you to confirm; the old map is kept as `.repo-map/map.prev.json`) and **Relink docs**, each with progress and **Stop**. One runs at a time.
- **Map agent**: the tool, model and effort that draw and update the map and link its docs, from the same list as the trace menu. **Same as traces** follows your trace default. Changes are saved for you in this repo (`.repo-map/local.json`, git-ignored).

**Trace agent** sets the tool, model and effort used for process architecture and flowcharts. This preference is remembered in your browser for this repo and used for new traces and flowchart redraws.

### Creating and exploring traces

Choose **New trace**, describe a process, and select **Code architecture**, **Flowchart**, or both. At least one output is required. Both are selected initially; later choices are remembered in this browser. Architecture shows the process path on the repository map. Select a saved trace, then use its **Architecture** and **Flowchart** tabs to open outputs on the main canvas.

You can also ask where a hypothetical feature would fit, or how you would change existing behavior. A hidden classification request chooses description or proposal automatically; mixed questions include relevant existing behavior in a proposal. Proposed items are labeled **New**, **Modified**, or **Removed**, with distinct borders and connection styles. They belong only to that trace. Suggested file paths describe future implementation locations; code references still point to verified existing files.

After reviewing placement and rationale, select **Implementation plan**. The modal generates ordered tasks, affected files, interface changes, tests, risks and open questions on first use. Reopening shows the retained plan; **Regenerate** explicitly requests a new one. Closing the modal or pressing **Stop** cancels unfinished generation. Failed regeneration preserves the previous plan. Completed plans are saved and included in shared trace codes. Each prompt is independent; follow-up conversation is not retained.

Classification uses the selected provider and a designated small model when it appears in that provider's model list (Claude `haiku`, Gemini Flash variants, designated Codex small models, or supported API nano/mini models). Otherwise it uses the selected trace model. It never switches providers. To choose another classification model, add `"ai": { "classify": { "model": "your-small-model", "effort": "low" } }` to `.repo-map/config.json`, or put `"classify": { "model": "your-small-model" }` beside the other AI settings in `.repo-map/local.json`. Use an effort supported by that model, or omit it. No classifier setting is required. Classification is limited to one turn and at most 30 seconds; on failure or invalid output, the main agent classifies and answers in one request. Available usage totals include both requests.

Each saved trace is one question with linked outputs. The sidebar home shows the repository title and details above New trace and the saved trace list. Selecting one replaces the library with its title, prompt, output tabs, and expanded walkthrough and actions. **Back to all traces** returns to the library and whole map. You can add a missing output later without creating a second trace. Deleting a trace removes both outputs. Old traces and import codes keep working. If a flowchart is missing from an otherwise usable answer, its library entry offers a retry; failed saves remain visible with **Retry saving** until you reload.

Click an architecture card or flowchart box for explanations, code references and linked documentation. Flowchart details appear in the selected trace sidebar, without architecture step numbers, step labels or the architecture walkthrough. Relevant code and documentation remain accessible. Switch outputs using its **Architecture** and **Flowchart** tabs. **Back to all traces** returns to the library and whole map without deleting saved data. Trace information stays beside the diagram so it does not shift vertically. Flowchart zoom, Fit, Mermaid and SVG export, redraw, progress and Stop controls sit above the diagram key. Its canvas fills the available height; process details remain in the sidebar. Settings and Back to all traces share the top sidebar control slot.

Each diagram's **Diagram key** button is an accordion beside its controls, collapsed by default. Expanding it reveals the complete key below the controls. Architecture card details open in an overlay centered within the diagram, with explanations, code references, documentation and connection navigation. Its backdrop covers only the diagram, so the sidebar remains interactive by mouse and keyboard. Use **Close details**, Escape, or click its backdrop to dismiss it. Flowchart details remain in the trace sidebar. Flowcharts initially zoom in two steps beyond the fitted view; **Fit** restores the fitted view. Settings is available from the sidebar home; use **Back to all traces** to return there.

### Documentation on the cards

Diagram canvases fill the available height beneath their controls and expanded key, with scrolling inside the canvas. The architecture scrollbar sits at the bottom of the screen. On narrow screens, the sidebar stacks above the diagram and scrolls independently, leaving the remaining height for the canvas.

After drawing the map, `generate` runs a second pass with the map's tool that reads the repo's documents and links their sections to the cards they explain:

- **Agent guidance** (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Copilot and Cursor rules), listed first on each card. These files are also given to every AI run as context about the repo.
- **Docs**: `README`s, `docs/`, ADRs and other markdown, per `docs` in config.json.
- **Code comments**: substantial module headers and doc blocks in each card's own folder (`"docs": { "comments": false }` turns this off).

The links are saved in `.repo-map/docs.json`; commit it with `map.json`. An update relinks docs when documents changed or cards were added, and drops links to removed cards. To relink by hand:

```shell
repo-map docs              # link docs to the cards again
repo-map docs --check      # exits 1 when documents changed since they were linked
repo-map generate --no-docs   # draw the map without the docs pass
```

## 5. Check your setup with `repo-map doctor`

```shell
repo-map doctor
```

It tells you which AI tool traces will use and why. For the API provider, it also checks that the server is reachable and the model exists, without spending any tokens. If nothing is ready, it lists the quickest ways to set one up. It exits with code 1 when tracing is off, so you can use it in scripts, and `repo-map doctor --json` prints the result as JSON.

`repo-map serve` prints the same one-line summary when it starts.

## 6. Teammates without an AI tool

The map still works for them: browsing, search, hover tracing, descriptions and GitHub links. The trace box explains that tracing is off on their machine.

To share a trace, anyone who has an AI tool can run it, press **Copy trace code**, and send the code (`rmap1:…`). The other person pastes it under **Import a trace code** to see the numbered path and the code panels, read from their own checkout. The trace's flowchart travels with the code, so they can open it too; only drawing a new one needs an AI tool.

## 7. Troubleshooting

| Message | What to do |
|---------|------------|
| "No AI tool found" | Set one up (section 4), then run `repo-map doctor`. |
| "isn't signed in, or its API key was rejected" | Claude Code: run `claude` and sign in. API: check the variable named in `apiKeyEnv`. Codex: `codex login`. |
| "doesn't have access to it" | The account is signed in but not entitled to the tool or model. Check your plan, or pick another model or provider. |
| "hit a usage or rate limit" | Wait and try again, or switch to another model or provider. |
| "doesn't recognise the configured model" | Fix `model`. For the API provider, `repo-map doctor` lists whether the server knows it. |
| "answered, but not in the expected JSON shape" | Try again. If it keeps happening, use a stronger model. |
| "ran out of turns" | Ask a narrower question, or raise `maxTurns`. |
| "Couldn't reach …" | The API server isn't running or the base URL is wrong. For Ollama, run `ollama serve`. |
| Missing frontend assets | Use Node >=22.12, enable lifecycle scripts, then run `npm ci` and `npm run build` in the checkout. Registry packages include prebuilt assets. |
| Playwright cannot find Chromium | Run `npx playwright install chromium` once, then retry `npm run test:e2e`. |
| Port 4477 in use | `repo-map serve --port 4478`, or set `REPO_MAP_PORT`. |
