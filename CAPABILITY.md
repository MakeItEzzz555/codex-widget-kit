# Capabilities and limits

How each `turn-meters` feature from the [Claude Widget Kit](https://github.com/MakeItEzzz555/claude-widget-kit) maps to Codex CLI. Checked against Codex CLI **0.163.0** on macOS, using its rollout files and the [openai/codex](https://github.com/openai/codex) source.

| turn-meters feature | Codex Widget Kit | Parity | Evidence |
|---|---|---|---|
| Band drawn inside the agent's own UI | Separate terminal pane | **Approximated** | Codex has no API for drawing custom UI inside its interface. `codex features list` reports `plugin_hooks = removed`. |
| 5h ring | Ring from `rate_limits` window `window_minutes: 300` | **Identical** | `event_msg/token_count` → `rate_limits.primary`/`secondary.used_percent`. Matches Codex's `five-hour-limit` item (`100 - used_percent`). |
| Week ring | Ring from window `window_minutes: 10080` | **Identical** | Same record, the weekly window. |
| Context ring | `contextLeft()` with Codex's 12 000-token baseline | **Identical** | `codex-rs/protocol/src/protocol.rs` `percent_of_context_window_remaining`, fed by `info.last_token_usage.total_tokens` and `info.model_context_window` (`chatwidget/status_controls.rs`). |
| Effort ticks + model | `turn_context.effort` and `model` | **Identical** (levels differ) | Codex levels are minimal / low / medium / high / xhigh. Claude's are low / medium / high / xhigh / max. |
| Task bar + ETA | `update_plan` function calls, same pace estimator | **Identical when Codex plans** | `response_item/function_call` `name: update_plan`, `arguments.plan[].{step,status}`. Recent Codex sessions often run without a plan. The bar then stays hidden rather than guessing. |
| `progress` MCP tool | Not built | **Not needed** | Codex's built-in `update_plan` covers it. |
| Agent cards | Sub-agent rollouts with `parent_thread_id`, `agent_nickname`, `agent_path` | **Identical** | Sub-agent `session_meta` has `thread_source: "subagent"`. Running/idle comes from its `task_started`/`task_complete`, and the parent's `CollabAgentToolCall` `closeAgent` removes the card. |
| ETA ticker | Redraw every second | **Identical** | — |
| Status line | `[tui].status_line` built-in IDs | **Native** | `codex-rs/tui/src/bottom_pane/status_line_setup.rs` `StatusLineItem` (kebab-case): `model-with-reasoning`, `task-progress`, `context-remaining`, `five-hour-limit`, `weekly-limit`, `run-state`, `git-branch`. |

## Fields read

From each rollout line: `type`, `timestamp`, and only these payload fields:

- `session_meta`: `id`, `parent_thread_id`, `agent_nickname`, `agent_path`, `cwd`, `thread_source`
- `turn_context`: `model`, `effort` / `reasoning_effort`
- `response_item` with `name == "update_plan"`: `arguments`
- `event_msg`: `task_started`, `task_complete`, `turn_aborted`, `token_count.rate_limits`, `token_count.info.last_token_usage.total_tokens`, `token_count.info.model_context_window`, and `item_completed` items of type `CollabAgentToolCall` with `tool == "closeAgent"`

Every line is JSON-parsed in memory to find these fields. Message text, reasoning, command output and tool results are never stored, displayed or sent anywhere.

## Known limits

- Rollout formats are internal to Codex and can change between releases. CI tests run against a redacted fixture of the 0.163 shape.
- Only the newest two day folders under `~/.codex/sessions` are scanned. Codex keeps writing a resumed session to its original day folder, so a session started before those two days is not found.
- Rate limits appear after Codex's first response in a session. Until then the rings stay hidden.
