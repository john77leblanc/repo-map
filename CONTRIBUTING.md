# Contributing to repo-map

## Local development

Requires Node.js 20+. There are no dependencies to install.

```shell
git clone https://github.com/john77leblanc/repo-map.git
cd repo-map
npm test              # node --test (no network, no AI tool needed)
npm run example       # serves examples/shop on http://localhost:4477
```

To try your working copy against another repo:

```shell
node /path/to/repo-map/bin/repo-map.mjs serve --dir /path/to/other-repo
```

### Layout

```
bin/repo-map.mjs     CLI: init, generate, validate, doctor, serve
lib/config.mjs       loads .repo-map/config.json, map.json and the layered AI settings
lib/server.mjs       local HTTP server: config, map, file reads, traces, saved traces
lib/repo.mjs         git info and safe, read-only file access (codeRoots / blocked)
lib/prompts.mjs      prompts for traces and generate
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
app/index.html       the whole UI (single file, no build step)
templates/           starter config for `repo-map init`
examples/shop/       small fictional repo used by `npm run example` and the tests
test/                node:test suites
```

### Adding an AI provider

Each runner takes `{ root, config, prompt, settings, timeoutMs, maxTurns, onProgress }` and returns `{ promise, kill }`. The promise resolves to `{ text, cost?, turns?, tokens? }`, or rejects with an `Error` whose `code` is one of `missing`, `auth`, `access`, `limit`, `model`, `timeout`, `turns` or `failed`. Use `classifyFailure()` from `lib/ai/errors.mjs` for the message. Add it to the registry in `lib/ai/agents.mjs`: a detect function returning `{ id, kind, label, available, reason, settings, models, efforts, defaultModel }`, an entry in `listAgents`, `AUTO_ORDER` and `PROVIDERS` (`lib/config.mjs`), and a case in `runSelection` if it needs a new runner. Pass the model and effort to the tool as flags, never through a shell. Document it in SETUP.md, and add a test with a fake server or script (see `test/ai.test.mjs`).

Runners must stay read-only: no tools that write files, run shell commands or browse.

## Releasing

1. Update `CHANGELOG.md` and bump `version` in `package.json` (`npm version minor --no-git-tag-version`, or edit it).
2. `npm test`
3. `npm publish --dry-run`. Check the file list, and that there's **no** "errors corrected" warning. If npm says it removed `bin`, the `repo-map` command would be missing from the package: make sure `bin` is `"bin/repo-map.mjs"` (no leading `./`) and the file is executable (`chmod +x bin/repo-map.mjs`).
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
