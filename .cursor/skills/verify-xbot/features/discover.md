# Discover topics

Discover topics lets a user scan one or more interests against mock X fixtures and read a ranked topic list.

## Sub-features

- `discover-json` returns ranked topics as JSON.
- `discover-markdown` prints the same run as a short markdown list.
- `discover-requires-interest` refuses a discover run that has no interest.

## How to get to it (user POV)

- Run `xbot workflow run discover --interest "AI agents" --mock --format json`.
- Run `xbot workflow run discover --interest "AI agents" --mock`.
- Run `xbot workflow run discover --mock` when checking the missing-interest error.

## Driving it with xbot-verify

Preconditions:

- `xbot-verify.sh doctor` printed `xbot-verify: doctor ok` for this run.

- **JSON topics.** Scan one interest. Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh run discover-json -- workflow run discover --interest "AI agents" --mock --format json`. Exit code `0`. Stdout parses as an object whose `topics` array is non-empty, whose `postsScanned` is a number, and whose topic objects include `label` and `samplePostIds`.
- **Markdown topics.** Repeat for the human format. Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh run discover-markdown -- workflow run discover --interest "AI agents" --mock`. Exit code `0`. Stdout contains `# Discovery (` and `posts scanned)`.
- **Missing interest.** Omit `--interest`. Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh run discover-requires-interest -- workflow run discover --mock`. Exit code `1`. Stderr contains `--interest is required`.

## Gotchas

- `--interest` can be repeated. A single interest is enough for this recipe.
- Discover does not print a research report and does not replace `history list` results from the research recipe. It does open a workflow run in the same database.
- Human output includes limitation lines. Assert the heading, not a particular limitation sentence.
- Do not add `--account` unless the recipe is extended. The fixture proof above is the interest path only.
