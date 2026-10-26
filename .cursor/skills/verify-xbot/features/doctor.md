# Doctor

Doctor lets a user see whether this xbot process is on mock fixtures, where it stores reports, and whether a chat model is configured.

## Sub-features

- `doctor-mock` reports mock mode, read-only X access, the disposable database path, and no chat model.

## How to get to it (user POV)

- Run `xbot doctor --mock`.

## Driving it with xbot-verify

Preconditions:

- Launch printed `ready xbot 0.1.0` for this run.
- `XBOT_VERIFY_RUN` is that run id.

- **Doctor.** Run `.cursor/skills/verify-xbot/scripts/xbot-verify.sh doctor`. Exit code `0`. The command prints `xbot-verify: doctor ok`. Evidence files `doctor.stdout`, `doctor.stderr`, and `doctor.exit` exist in the evidence directory. Stdout contains `X mode:        mock (no credentials required)`, `read-only`, the data directory path, `Tenant:        default`, and `Chat:          unavailable (set XBOT_MODEL)`.

## Gotchas

- Doctor creates `xbot.db` on first open. That is expected and is not a research report.
- A passing doctor does not prove research. It proves the process under test is the isolated mock-mode CLI.
- Do not export `XBOT_MODEL` or `X_BEARER_TOKEN` before doctor. The helper clears them, and a hand-run binary would not.
