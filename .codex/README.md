# Codex configuration

This directory contains the repo-local Codex setup for this dbt package template.

## What is here

- `config.toml` defines the shared Codex defaults for the repository.
- `agents/` contains the small set of repo-specific Codex subagents.
- `hooks/` contains deterministic advisory scripts for context routing, verification hints, and sandbox-parity reminders.

## Design principles

- Keep the setup pragmatic and copyable.
- Reuse the canonical skill tree in `.claude/skills/` through `.agents/skills`.
- Mirror real maintainer jobs in this repository instead of creating generic agent roles.
- Keep security defaults conservative: on-request approvals, workspace-write sandboxing, and no subprocess network by default.

## Hook note

The current local Codex configuration surface in this repository supports repo-local subagents cleanly, while lifecycle hook configuration is still limited. The scripts in `hooks/` are shipped as stable repo helpers and can be used directly or wired into future Codex hook support without changing their behavior.
