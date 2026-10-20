# Security policy

## What the kit touches

- **Reads** `~/.codex/sessions/**/rollout-*.jsonl` (or `$CODEX_HOME/sessions`), only the fields listed in [CAPABILITY.md](CAPABILITY.md).
- **Never reads** `auth.json`, `history.jsonl`, the sqlite databases or any credentials.
- **Never writes** anything under `~/.codex` while running. `install.sh` writes only to `~/.codex/widget-kit` and `~/.local/bin/codex-widgets`. With `--statusline` it also edits `config.toml`, after taking a dated backup.
- **No network** at runtime. `install.sh` uses `git clone` from this repository only.
- **No prompts, outputs or message bodies** are ever shown, logged or stored.

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/MakeItEzzz555/codex-widget-kit/security/advisories/new) rather than a public issue. Include the version, your OS and steps to reproduce. You can expect a reply within 7 days.

## Supported versions

Only the latest release gets fixes.
