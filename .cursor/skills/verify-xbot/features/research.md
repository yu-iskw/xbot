# Research

Research lets a user ask a question, get a cited markdown or JSON report from mock X fixtures, and find that report again in history.

## Sub-features

- `research-markdown` runs a one-shot question and prints a cited markdown report.
- `research-json` writes the same report shape as JSON on stdout.
- `research-repl` runs the same workflow from the `chat` REPL without a chat model.
- `research-live-refuses` refuses `--live` when no bearer token is configured.

## How to get to it (user POV)

- Run `xbot research "<question>" --mock`.
- Run `xbot research "<question>" --mock --format json`.
- Run `xbot chat --mock` and enter `/research <question>`.
- Run `xbot research "<question>" --live` when checking that live mode does not start without a token.

## Driving it with xbot-verify

Preconditions:

- `xbot-verify.sh doctor` printed `xbot-verify: doctor ok` for this run.
- `history list --json` is `[]` before the first research command in this recipe. If it is not, launch a new run.

- **Markdown report.** Ask the documented question. Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh run research-markdown -- research "What are developers discussing about Mastra?" --mock`. Exit code `0`. Stdout contains `# Research: What are developers discussing about Mastra?`, `## Sources`, and `https://x.com/fixture_`. Stderr contains `X mode: mock`.
- **Saved report.** List history. Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh run research-saved -- history list --json`. Exit code `0`. The JSON array has one object whose `query` is `What are developers discussing about Mastra?` and whose `sources` is greater than 0. Keep that object's `id`.
- **JSON report.** Ask a shorter question as JSON. Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh run research-json -- research "Mastra" --mock --format json`. Exit code `0`. Stdout parses as one object with `query` `Mastra`, a non-empty `sources` array, and `methodology.xMode` `mock`. The object has no post text field.
- **REPL research.** Ask from the chat prompt. Run `printf '%s\n' '/research Mastra' '/exit' | .cursor/skills/verify-xbot/scripts/xbot-verify.sh run-stdin research-repl -- chat --mock`. Exit code `0`. Stdout contains `xbot research REPL`, `No chat model configured`, the prompt `xbot> `, and `# Research: Mastra`.
- **Live refusal.** Request live mode. Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh run research-live-refuses -- research "Mastra" --live`. Exit code `1`. Stderr contains `bearer token`. Stdout is empty.

## Gotchas

- The helper does not add `--mock`. A command without `--mock` or `--live` stays on mock only because the helper cleared bearer tokens. Still pass `--mock` on the research commands above so the proof does not depend on that side effect.
- `--mock` and `--live` together fail before a report is saved.
- Plain `research` is not idempotent. A second identical question creates a second report. Do not expect `deduplicated` unless the command used `--event-id` through `workflow run research`.
- JSON is the stable assertion format. Markdown excerpts include fixture post text and can change without the citation changing.
- REPL free text without `XBOT_MODEL` does not research. It prints that no chat model is configured. Use `/research`.
- Relative `--out` files are written in the data directory and disappear on cleanup. This recipe asserts stdout instead.
