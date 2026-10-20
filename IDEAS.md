# Widget ideas

Candidates for the next widgets. Each one lists the data Codex already writes, so nothing here needs a new Codex feature. ⭐ marks the ones that would look best in a short demo video.

| # | Widget | What it shows | Data source (rollout unless noted) | Effort |
|---|---|---|---|---|
| 1 | ⭐ **Reset countdown** | "5h resets in 1 h 12 min" under each ring | `rate_limits.primary/secondary.resets_at` | S |
| 2 | ⭐ **Token burn sparkline** | `▁▂▅█▃` tokens per request over the last 20 requests | `token_count.info.last_token_usage.total_tokens` | S |
| 3 | **Cache-hit meter** | Share of input served from cache, which is why long sessions stay cheap | `cached_input_tokens / input_tokens` | S |
| 4 | ⭐ **Turn timer** | Live elapsed time of the current turn, plus the session's average turn | `task_started` / `task_complete` timestamps | S |
| 5 | ⭐ **Files touched** | Files changed this session, with a coloured dot per edit | `item_completed` `FileChange` (paths only, shortened) | M |
| 6 | **Command feed** | The last 5 commands: program name, exit status, duration | `item_completed` `CommandExecution` (first word only, never arguments or output) | M |
| 7 | ⭐ **Approval alert** | The pane flashes and rings the bell when Codex waits on your approval | `PermissionRequest` hook via `~/.codex/hooks.json` (opt-in) | M |
| 8 | **Compaction counter** | How often the context was compacted, and when last | `item_completed` `ContextCompaction` | S |
| 9 | ⭐ **Sub-agent tree** | Agents drawn as a tree by `agent_path` depth (`/root/a/b`) | sub-agent `session_meta.agent_path` | M |
| 10 | **MCP activity** | Calls per MCP server, last tool used | `item_completed` `McpToolCall` (server and tool names) | S |
| 11 | ⭐ **Multi-session board** | One mini-row per active Codex session across all folders | every recent rollout, grouped by `cwd` | M |
| 12 | **Credits gauge** | Credit balance when the plan uses credits | `rate_limits.credits` | S |
| 13 | **Done notification** | A macOS / Linux desktop notification when a long turn finishes | `task_complete` + `osascript` / `notify-send` (opt-in) | S |
| 14 | **Git pulse** | Branch, ahead/behind, and lines changed in the working tree | `git` in `--cwd`, polled every 10 s | S |
| 15 | **Cost estimate** | Approximate spend from token counts and a user-supplied price table | `total_token_usage` + `~/.codex/widget-kit/prices.json` | M |
| 16 | **Layout presets** | `--layout band|cards|compact` for short or narrow panes | — | S |

Principles every idea must keep: read-only, no network, no prompts or outputs on screen, hidden when the data is missing, and zero dependencies.
