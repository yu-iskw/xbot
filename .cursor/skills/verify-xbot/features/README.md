# xbot verification map

This directory is the maintained source for verifying the user-facing behavior of the xbot CLI. Read this index before driving the app, then use the matching feature file as the recipe.

## Baseline preconditions

- Launch with `.cursor/skills/verify-xbot/scripts/xbot-verify.sh launch` and export `XBOT_VERIFY_RUN` to the printed run id.
- The data directory is `/tmp/xbot-verify-data-$XBOT_VERIFY_RUN`. The evidence directory is `/tmp/xbot-verify-evidence-$XBOT_VERIFY_RUN`.
- Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh doctor` and require `xbot-verify: doctor ok`.
- X mode is mock. No bearer token, model, or database URL is set for the CLI process.
- Never drive `~/.xbot` or a home this verification run did not launch.

## Driving conventions

- Start every recipe from the baseline state unless its preconditions say otherwise.
- Treat every command as literal. Keep quoted queries and flags unchanged.
- Run CLI actions through `xbot-verify.sh run` or `xbot-verify.sh run-stdin`.
- Pass `--mock` on every command except the live-mode refusal check.
- Use `--format json` or `--json` when the recipe asserts structured fields.
- Do not remove proof artifacts during cleanup.

## Proof and skip reporting

- Capture the user action and the resulting state, not only the final screen.
- CLI proof is the feature's stdout, stderr, and exit files under the evidence directory.
- Mutation proof includes a second read-only command (`history list` or `history show`) against the same data directory.
- Record the feature id used as the artifact name.
- Report an unreachable path with the attempted command and the unmet precondition.
- Do not report a skipped entry point as verified through a different path.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph describing the user-visible behavior. It then uses exactly four H2 sections in this order.

1. `Sub-features` lists short IDs with one line for each behavior.
2. `How to get to it (user POV)` lists every user entry point.
3. `Driving it with xbot-verify` starts with `Preconditions:` and uses labeled bullets that pair each user action with an exact command and observable result.
4. `Gotchas` lists traps that can waste or invalidate a verification run.

## Features

- [Research](./research.md) covers one-shot research, the REPL slash command, JSON output, and the live-mode refusal.
- [History](./history.md) covers listing, showing, searching, and a missing report.
- [Discover topics](./discover.md) covers interest discovery from the workflow command.
- [Monitor a topic](./monitor.md) covers listing configured topics and the first and second monitor runs.
- [Doctor](./doctor.md) covers the configuration report for an isolated mock-mode home.
