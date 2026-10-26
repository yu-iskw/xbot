---

name: verify-xbot
description: "Drive the xbot CLI the way a user does and prove mock-mode research, history, discovery, topic monitoring, and doctor against the built binary. Use when a change to the xbot CLI or research workflow needs a scripted behavior check."
---

# Verify xbot

xbot's primary user surface is the `xbot` CLI. This skill builds `packages/cli/dist/bin.js` once, then runs each check in its own process against a disposable mock-mode home. HTTP (`xbot-http`), MCP (`xbot-mcp`), and Slack (`xbot-slack`) are separate long-running surfaces and are not driven here. Mastra Studio (`pnpm --filter @xbot/dev dev`) is not driven here.

Two launches can run side by side. Each launch owns a distinct `/tmp/xbot-verify-data-*` directory. Do not point `XBOT_HOME` at `~/.xbot`, and do not run two commands at once against the same run id: they share one libSQL file.

## Launch

From the repository root:

```bash
.cursor/skills/verify-xbot/scripts/xbot-verify.sh launch
```

Launch builds the workspace only when `packages/cli/dist/bin.js` is missing (`pnpm install && pnpm build`). It then checks `node packages/cli/dist/bin.js --version`.

Ready output is four lines:

```text
ready xbot 0.1.0
run <run-id>
data /tmp/xbot-verify-data-<run-id>
evidence /tmp/xbot-verify-evidence-<run-id>
```

`ready xbot 0.1.0` means the built CLI answers. The data directory starts empty. The first `doctor` or `run` creates `xbot.db` and its tables. Export `XBOT_VERIFY_RUN` to the printed run id before driving a specific instance. When it is unset, the helper uses `/tmp/xbot-verify-current`, which launch overwrites.

The helper clears `X_BEARER_TOKEN`, `XBOT_X_BEARER_TOKEN`, `XBOT_DB_URL`, `XBOT_CONFIG`, `XBOT_MODEL`, the per-role model variables, `XBOT_X_MODE`, and `XBOT_TENANT` for every CLI process, and it runs with cwd set to the data directory so a `xbot.config.json` in the repo is not loaded. Pass `--config` with an absolute path when a feature needs a config file.

There is no server to stop. Teardown is `cleanup` below.

## Doctor

```bash
.cursor/skills/verify-xbot/scripts/xbot-verify.sh doctor
```

Run this first whenever a drive looks wrong. It is read-only aside from creating the empty database on first open. Exit 0 and the final line `xbot-verify: doctor ok` mean all of the following are true:

- stdout contains `xbot doctor`
- stdout contains `X mode:        mock (no credentials required)`
- stdout contains `X access:      read-only (search, post lookup, user lookup, user timelines)`
- stdout storage line contains this run's `/tmp/xbot-verify-data-<run-id>` path
- stdout contains `Tenant:        default`
- stdout contains `Chat:          unavailable (set XBOT_MODEL)`
- stderr contains `X mode: mock`
- the xbot process exit code is 0

A storage path under `~/.xbot` means this run is not isolated. Stop and launch again. Do not set `XBOT_MODEL`; chat stays unavailable on purpose.

## Drive

Read `.cursor/skills/verify-xbot/features/README.md`, then follow one feature file. The harness is `xbot-verify.sh`. One-shot commands:

```bash
.cursor/skills/verify-xbot/scripts/xbot-verify.sh run <feature-id> -- <xbot args>
```

Piped REPL input:

```bash
printf '%s\n' '/research Mastra' '/exit' | .cursor/skills/verify-xbot/scripts/xbot-verify.sh run-stdin <feature-id> -- chat --mock
```

The helper does not add `--mock`. Every feature command that should stay on fixtures passes `--mock` itself. Global flags (`--mock`, `--config`, `--tenant`) may appear before or after the subcommand. The process cwd is the data directory, so relative `--out` paths land there and cleanup deletes them. Put surviving files under the evidence directory with an absolute path.

Do not call the binary directly, and do not call the live X API. `--live` is only for the refusal check in the research feature, and the helper has already cleared bearer tokens so that check cannot reach the network.

## Evidence

Each `run`, `run-stdin`, and `doctor` writes three files that cleanup does not delete:

- `/tmp/xbot-verify-evidence-<run-id>/<feature-id>.stdout`
- `/tmp/xbot-verify-evidence-<run-id>/<feature-id>.stderr`
- `/tmp/xbot-verify-evidence-<run-id>/<feature-id>.exit`

Record the feature id in the artifact name. Assert the action and the saved state. A research proof is the markdown or JSON report plus `history list --json` showing that same report id. A monitor proof is the monitor summary plus a second `history show`. Mock fixtures are the production mock boundary, not a test-only endpoint. JSON reports contain post ids and URLs, not post text. Markdown excerpts are rendered from the cache at print time.

`--mock` skips the network because the X mode line says `mock` and stderr says `X mode: mock`. Do not treat the flag name as proof. A command that prints `app-only bearer token` or a storage path outside this run's data directory is not a mock-mode proof.

## Cleanup

```bash
.cursor/skills/verify-xbot/scripts/xbot-verify.sh cleanup
```

Cleanup deletes only `/tmp/xbot-verify-data-<run-id>` for the selected run. It refuses any other path. It leaves `/tmp/xbot-verify-evidence-<run-id>/` in place, including `run.env` and every captured stdout, stderr, and exit file. It does not kill processes by name. CLI commands are short-lived; if one is still running, wait for it, then clean that run id.

## Helpers

The helper is `.cursor/skills/verify-xbot/scripts/xbot-verify.sh`. Run it from anywhere; it finds the workspace by walking up to `pnpm-workspace.yaml`.

```bash
.cursor/skills/verify-xbot/scripts/xbot-verify.sh launch
.cursor/skills/verify-xbot/scripts/xbot-verify.sh paths
.cursor/skills/verify-xbot/scripts/xbot-verify.sh doctor
.cursor/skills/verify-xbot/scripts/xbot-verify.sh run <feature-id> -- <xbot args>
printf '%s\n' '/exit' | .cursor/skills/verify-xbot/scripts/xbot-verify.sh run-stdin <feature-id> -- chat --mock
.cursor/skills/verify-xbot/scripts/xbot-verify.sh cleanup
```

`paths` reprints the active run id, data directory, evidence directory, and binary path.
