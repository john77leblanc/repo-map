# Setting up repo-map

This guide covers installing repo-map, adding it to a repo, and choosing the AI tool that powers plain-language traces and `repo-map generate`.

You don't need an AI tool to use the map. Without one you can still browse it, search it, follow connections, and open traces that teammates share as trace codes. An AI tool is only needed to run new traces and to draft a map.

- [The short version](#the-short-version)
- [Scripted setup](#scripted-setup)
- [1. Requirements](#1-requirements)
- [2. Install](#2-install)
- [3. Add a map to a repo](#3-add-a-map-to-a-repo)
- [4. Choose an AI tool](#4-choose-an-ai-tool)
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
npx repo-map ai codex                                   # or: ai gemini
npx repo-map ai none                                    # map only, no tracing
```

Then:

```shell
npx repo-map doctor      # confirms the tool works
npm run map              # http://localhost:4477
```

Add `--local` to save the choice for one repo only (`.repo-map/local.json`, git-ignored), or `--repo` to set the team default (`.repo-map/config.json`). Run `npx repo-map ai show` to see the combined settings that apply in the current repo.

### In CI

```shell
npx repo-map validate         # fails the build if map.json references unknown nodes, groups or missing paths
```

`npx repo-map doctor --json` prints a machine-readable status, `{ "ready": true, "provider": "claude", … }`, and exits 1 when tracing isn't available.

The rest of this guide explains each step in more detail.

## 1. Requirements

- **Node.js 20 or newer** (`node -v`)
- **git**, for branch info and GitHub links
- **Optional: one AI tool** from [section 4](#4-choose-an-ai-tool)

repo-map has no npm dependencies.

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

**Without npm**, from a clone:

```shell
git clone https://github.com/john77leblanc/repo-map.git ~/tools/repo-map
alias repo-map='node ~/tools/repo-map/bin/repo-map.mjs'   # add to ~/.zshrc or ~/.bashrc
```

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

repo-map works with three kinds of AI tool:

| Provider  | What it is | Reads code with | Cost |
|-----------|------------|-----------------|------|
| `claude`  | Claude Code CLI | its own read-only tools (`Read`, `Grep`, `Glob`) | your Claude plan or API usage |
| `api`     | Any OpenAI-compatible API: OpenAI, OpenRouter, Azure OpenAI, or a local server like Ollama, LM Studio or vLLM | repo-map's read-only tools (`list_files`, `search_code`, `read_file`) | per token, or free when local |
| `command` | Any CLI that takes a prompt and prints an answer. Presets for Codex CLI and Gemini CLI | whatever the CLI does on its own | depends on the tool |

With `"provider": "auto"` (the default), repo-map uses the first one that's ready:

1. **Claude Code**, if `claude` is on your `PATH`
2. **The API**, if a model is set and a key is present (or the base URL points to a local server)
3. **A command**, if one is configured

### Where AI settings go

The AI tool is usually a personal choice, so you don't have to change the shared config. Settings are layered, and later layers win:

1. `"ai"` in `.repo-map/config.json`: the team default (committed)
2. `~/.config/repo-map/ai.json`: your default for every repo
3. `.repo-map/local.json`: your override for this repo (git-ignored)
4. Environment variables and flags: `REPO_MAP_AI_PROVIDER` / `--provider`, `REPO_MAP_MODEL` / `--model`, `REPO_MAP_API_BASE_URL`, `REPO_MAP_CLAUDE_BIN`

`local.json` and `ai.json` take the same shape as the `"ai"` block. API keys never go in these files: they're read from an environment variable.

The quickest way to save a choice is `repo-map ai <tool>`, shown under each tool below. It writes the same JSON you'd otherwise edit by hand, to `~/.config/repo-map/ai.json` by default (`--local` and `--repo` choose the other files).

### Claude Code

1. Install the [Claude Code CLI](https://docs.claude.com/en/docs/claude-code).
2. Run `claude` once in a terminal and sign in.
3. That's it: `auto` picks it up. To use it explicitly: `repo-map ai claude [--model <id>]`.

Optional settings:

```json
{ "provider": "claude", "claude": { "model": "", "maxTurns": 40, "bin": "claude" } }
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
   That writes `{ "provider": "api", "api": { "baseUrl": "http://localhost:11434/v1", "model": "qwen2.5-coder:14b" } }`. For LM Studio, use `repo-map ai lmstudio --model <id>`.

No key is needed for `localhost`. LM Studio's default base URL is `http://localhost:1234/v1`.

Smaller local models give rougher traces and maps. If answers come back malformed or miss obvious steps, try a larger model.

### Codex CLI or Gemini CLI

```shell
repo-map ai codex        # or: repo-map ai gemini
```

That writes `{ "provider": "command", "command": { "preset": "codex" } }`. Sign in to the CLI first (`codex login`, or run `gemini` once).

These presets are starting points from each tool's documentation and haven't been tested against every version. CLI flags change between releases, so if one doesn't work, set the command yourself (next section).

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
- The tool must print its answer to stdout and exit 0. repo-map finds the JSON in the answer.
- The tool needs to read files in the repo on its own. Run it in a read-only or sandboxed mode if it has one: repo-map can't restrict what a third-party CLI does.

### Turning AI off

```shell
repo-map ai none
```

## 5. Check your setup with `repo-map doctor`

```shell
repo-map doctor
```

It tells you which AI tool traces will use and why. For the API provider, it also checks that the server is reachable and the model exists, without spending any tokens. If nothing is ready, it lists the quickest ways to set one up. It exits with code 1 when tracing is off, so you can use it in scripts, and `repo-map doctor --json` prints the result as JSON.

`repo-map serve` prints the same one-line summary when it starts.

## 6. Teammates without an AI tool

The map still works for them: browsing, search, hover tracing, descriptions and GitHub links. The trace box explains that tracing is off on their machine.

To share a trace, anyone who has an AI tool can run it, press **Copy trace code**, and send the code (`rmap1:…`). The other person pastes it under **Import a trace code** to see the numbered path and the code panels, read from their own checkout.

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
| Port 4477 in use | `repo-map serve --port 4478`, or set `REPO_MAP_PORT`. |
