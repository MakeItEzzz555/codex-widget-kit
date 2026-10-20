# Changelog

## 0.2.0 — Live Developer Observatory

- The pane is now a dashboard of cards in a grid that follows the width: three columns from 132, two from 76, one from 40, a compact view below. `--layout auto|compact|standard|expanded`.
- New cards: Session (state, elapsed, live turn), Context (tokens in window, compactions), Tokens (input, cached, output, reasoning, output-per-request sparkline), Turns (count, average, last, live, turn-length sparkline), Recent activity (commands, file changes, MCP calls, sub-agent starts, compactions, failed turns).
- 5h and weekly limits show reset countdowns. The v0.1 rings live inside the limit cards in the three-column layout.
- Design tokens with `--theme dark|light` (from `COLORFGBG` when possible), `--ascii` glyphs, `NO_COLOR` support.
- Only changed lines are redrawn; frames are cut to the pane height.
- A turn that ends on an error is no longer counted as completed.
- Privacy: commands are reduced to program and subcommand, paths to their last two parts; outputs, diffs and arguments are never kept.

## 0.1.0 — 2026-10-20

First release.

- `codex-widgets`: 5h, week and context rings, effort meter, task bar with ETA, and sub-agent cards, drawn from Codex rollout files.
- Context ring uses Codex's own `context-remaining` formula.
- `install.sh` with `--statusline` (backed-up `config.toml` merge) and `--uninstall`.
- Status-line preset in `config/statusline.toml`.
- Zero dependencies, `node --test` suite with a redacted 0.163 fixture.
