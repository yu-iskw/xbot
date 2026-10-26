# History

History lets a user list saved reports, open one by id, filter them by text, and see a clear error for an unknown id.

## Sub-features

- `history-list` lists saved reports as JSON.
- `history-show` prints one saved report as JSON.
- `history-search` filters list results by query text.
- `history-missing` exits non-zero for an unknown report id.

## How to get to it (user POV)

- Run `xbot history list --json`.
- Run `xbot history show <reportId> --format json`.
- Run `xbot history list --search <text> --json`.
- Run `xbot history show <reportId>` for an id that was never saved.

## Driving it with xbot-verify

Preconditions:

- `xbot-verify.sh doctor` printed `xbot-verify: doctor ok` for this run.
- This run has no saved reports yet. If `history list --json` is not `[]`, launch a new run and stop this recipe with that reason.

- **Create a report to inspect.** Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh run history-seed -- research "Mastra" --mock --format json`. Exit code `0`. Stdout is one JSON report. Keep `id` and `query`.
- **List.** Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh run history-list -- history list --json`. Exit code `0`. The array contains the saved `id` and `query` `Mastra`.
- **Show.** Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh run history-show -- history show <id> --format json`, substituting the saved id. Exit code `0`. The JSON `id` equals the listed id and `query` is `Mastra`.
- **Search hit.** Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh run history-search-hit -- history list --search Mastra --json`. Exit code `0`. The array contains the saved id.
- **Search miss.** Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh run history-search-miss -- history list --search volcano-not-a-topic --json`. Exit code `0`. Stdout is `[]`.
- **Missing id.** Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh run history-missing -- history show rpt_missing`. Exit code `1`. Stderr contains `not found`.

## Gotchas

- Human-readable `history list` pads columns with the generation time. Assert `--json`.
- `history show` without `--format json` prints markdown. The id is still in the `Report ID` line, but JSON is the stable check.
- Search matches query and summary text, not post text. `volcano-not-a-topic` must not match the Mastra fixture report.
- An empty list before the seed step is a failed precondition, not a passing empty state. Do not skip the seed.
