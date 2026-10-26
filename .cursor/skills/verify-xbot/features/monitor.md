# Monitor a topic

Monitor lets a user list topics from a config file, research one topic, and see what changed since the previous report for that topic.

## Sub-features

- `monitor-list` prints configured topic ids.
- `monitor-first` writes the first report and says there is no previous one.
- `monitor-second` names the previous report id on the next run.
- `monitor-empty` prints the empty-topics line when no config topics exist.

## How to get to it (user POV)

- Run `xbot monitor` with a config file that has topics.
- Run `xbot monitor <topicId>`.
- Run `xbot monitor` with no topics configured.

## Driving it with xbot-verify

Preconditions:

- `xbot-verify.sh doctor` printed `xbot-verify: doctor ok` for this run.
- This run has not monitored `mastra` yet. If it has, launch a new run.

- **Empty list.** Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh run monitor-empty -- monitor`. Exit code `0`. Stdout is `No topics configured (add them to xbot.config.json).` followed by a newline.
- **Write topics.** Create the config in the data directory. Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh paths` and write this file to `$data/topics.json`, using the printed data path:

```json
{
  "topics": [{ "id": "mastra", "description": "Mastra", "keywords": ["#Mastra"] }]
}
```

- **List topics.** Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh run monitor-list -- --config <data>/topics.json monitor`, substituting the absolute data path. Exit code `0`. Stdout contains `mastra  Mastra`.
- **First monitor.** Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh run monitor-first -- --config <data>/topics.json monitor mastra`. Exit code `0`. Stdout contains `# Monitor: mastra`, `First report for this topic`, and `Report: \``.
- **Confirm the report.** Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh run monitor-saved -- history list --json`. Exit code `0`. The array contains a report whose `query` is `#Mastra`.
- **Second monitor.** Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh run monitor-second -- --config <data>/topics.json monitor mastra --json`. Exit code `0`. The JSON `topicId` is `mastra` and `previousReportId` is a non-empty string.

## Gotchas

- Topic ids must match `^[a-z0-9][a-z0-9-]*$`. `Mastra` is a description, not an id.
- The helper's cwd is the data directory, so a config file in the repository root is not loaded. Pass `--config` with the absolute path written above.
- The first monitor's human output has no `(previous: ...)`. Only the second run must name a previous report.
- `--window-days` defaults to 1 for monitor, unlike research which defaults to 7. Leave it unset in this recipe.
- An empty topic list is a passing check only for `monitor-empty`, before the config file exists. After `topics.json` is passed, an empty list means the flag did not point at that file.
