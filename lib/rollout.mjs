// Reads Codex rollout files (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) into widget state.
// Read-only. Only the fields listed in CAPABILITY.md are read; prompts, outputs and messages are ignored.
import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { contextLeft, isFinished, nextPlan } from './meters.mjs'

const STATUSES = ['pending', 'in_progress', 'completed']
const FIVE_HOURS = 300
const WEEK = 10_080
const CHUNK = 8 * 1024 * 1024
const MAX_ACTIVITY = 8
const MAX_REQUESTS = 32
const MAX_FILES = 500

export const emptyThread = () => ({
  id: null,
  parentId: null,
  nickname: null,
  path: null,
  cwd: null,
  model: null,
  effort: null,
  isRunning: false,
  plan: null,
  usage: { fiveHour: null, week: null, context: null },
  closed: [],
  startedAt: null,
  lastAt: null,
  turns: { count: 0, totalMs: 0, lastMs: null, startedAt: null, recent: [] },
  // cumulative, from token_count.info.total_token_usage
  tokens: null,
  // output tokens of each model request, newest last, for the sparkline
  requests: [],
  window: { used: null, size: null },
  resets: { fiveHour: null, week: null },
  compactions: 0,
  activity: [],
  files: [],
})

const parsePlan = args => {
  try {
    const steps = JSON.parse(args)?.plan
    if (!Array.isArray(steps)) return null
    if (!steps.every(step => typeof step?.step === 'string' && STATUSES.includes(step?.status))) return null
    return steps.map(step => ({ id: step.step, status: step.status, title: step.step }))
  } catch {
    return null
  }
}

/** Folds one rollout record into the thread state. Unknown or malformed records leave it unchanged. */
export function applyRecord(thread, record) {
  const payload = record?.payload
  if (payload === null || typeof payload !== 'object') return thread
  const at = Date.parse(record.timestamp) || 0
  const next = reduce(thread, record.type, payload, at)
  return next === thread || !at ? next : { ...next, lastAt: at }
}

function reduce(thread, type, payload, at) {
  switch (type) {
    case 'session_meta':
      // a forked sub-agent's rollout repeats its parent's session_meta later on; the first one is its own
      if (thread.id !== null) return thread
      return {
        ...thread,
        id: payload.id ?? thread.id,
        parentId: payload.parent_thread_id ?? null,
        nickname: payload.agent_nickname ?? null,
        path: payload.agent_path ?? null,
        cwd: payload.cwd ?? thread.cwd,
        startedAt: at || null,
      }
    case 'turn_context':
      return { ...thread, model: payload.model ?? thread.model, effort: payload.effort ?? payload.reasoning_effort ?? null }
    case 'response_item':
      if (payload.type === 'function_call' && payload.name === 'update_plan') {
        const tasks = parsePlan(payload.arguments)
        return tasks === null ? thread : { ...thread, plan: nextPlan(thread.plan, tasks, at) }
      }
      return thread
    case 'event_msg':
      // a finished plan stays up until the next turn starts, like the Claude mod's next prompt
      if (payload.type === 'task_started') {
        return {
          ...thread,
          isRunning: true,
          plan: thread.plan !== null && isFinished(thread.plan) ? null : thread.plan,
          turns: { ...thread.turns, startedAt: at || null },
        }
      }
      if (payload.type === 'task_complete' && payload.error) {
        // a turn that ended on an error (a usage limit, say) is not a completed turn; its text is not shown
        return pushActivity({ ...thread, isRunning: false, turns: { ...thread.turns, startedAt: null } }, [{ at, verb: 'Turn', target: 'ended with an error', tone: 'bad', note: null }])
      }
      if (payload.type === 'task_complete') {
        const ms = typeof payload.duration_ms === 'number' ? payload.duration_ms : thread.turns.startedAt && at ? at - thread.turns.startedAt : null
        const recent = ms === null ? thread.turns.recent : [...thread.turns.recent, ms].slice(-MAX_REQUESTS)
        const turns = { count: thread.turns.count + 1, totalMs: thread.turns.totalMs + (ms ?? 0), lastMs: ms, startedAt: null, recent }
        return { ...thread, isRunning: false, turns }
      }
      if (payload.type === 'turn_aborted') return { ...thread, isRunning: false, turns: { ...thread.turns, startedAt: null } }
      if (payload.type === 'token_count') return readTokens({ ...thread, usage: readUsage(thread.usage, payload) }, payload)
      if (payload.type === 'item_completed') return readItem(thread, payload.item, at)
      return thread
    default:
      return thread
  }
}

const readUsage = (prev, payload) => {
  const limits = [payload.rate_limits?.primary, payload.rate_limits?.secondary].filter(Boolean)
  const used = minutes => limits.find(limit => limit.window_minutes === minutes)?.used_percent
  const info = payload.info
  const fiveHour = used(FIVE_HOURS)
  const week = used(WEEK)

  return {
    fiveHour: typeof fiveHour === 'number' ? fiveHour : prev.fiveHour,
    week: typeof week === 'number' ? week : prev.week,
    // stored as percent used, like the Claude mod; Codex computes it from the last request
    context:
      info?.last_token_usage && info.model_context_window
        ? 100 - contextLeft(info.last_token_usage.total_tokens, info.model_context_window)
        : prev.context,
  }
}

const count = value => (typeof value === 'number' && value >= 0 ? value : 0)
const epochMs = seconds => (typeof seconds === 'number' && seconds > 0 ? seconds * 1000 : null)

function readTokens(thread, payload) {
  const limits = [payload.rate_limits?.primary, payload.rate_limits?.secondary].filter(Boolean)
  const resetOf = minutes => epochMs(limits.find(limit => limit.window_minutes === minutes)?.resets_at)
  const resets = { fiveHour: resetOf(FIVE_HOURS) ?? thread.resets.fiveHour, week: resetOf(WEEK) ?? thread.resets.week }
  const info = payload.info
  const last = info?.last_token_usage
  const window = last && info.model_context_window ? { used: count(last.total_tokens), size: info.model_context_window } : thread.window
  const total = info?.total_token_usage
  if (total === undefined || total === null) return { ...thread, resets, window }
  const tokens = {
    input: count(total.input_tokens),
    cached: count(total.cached_input_tokens),
    output: count(total.output_tokens),
    reasoning: count(total.reasoning_output_tokens),
    total: count(total.total_tokens),
  }
  // Codex repeats token_count for one response; only a grown total is a new request
  const isNew = tokens.total > (thread.tokens?.total ?? 0)
  const requests = isNew ? [...thread.requests, Math.max(0, tokens.output - (thread.tokens?.output ?? 0))].slice(-MAX_REQUESTS) : thread.requests
  return { ...thread, resets, window, tokens, requests }
}

// `a/b/c/file.ts` -> `c/file.ts`: enough to recognise, never the full path
export const shortPath = path => {
  const parts = String(path).replace(/^file:\/\//, '').split('/').filter(Boolean)
  return parts.slice(-2).join('/')
}

const SHELLS = /(^|\/)(ba|z|fi|da)?sh$/
const WORD = /^[a-z][\w:.@-]{0,23}$/i

/** `["/bin/zsh","-lc","FOO=1 npm test -- --x"]` -> `npm test`: the program and its subcommand, never the arguments. */
export function commandName(command) {
  const parts = Array.isArray(command) ? command : [command]
  const script = typeof parts[0] === 'string' && SHELLS.test(parts[0]) ? parts.at(-1) : parts.join(' ')
  const words = String(script ?? '').split(/[;&|\n]/)[0].trim().split(/\s+/).filter(word => !/^\w+=/.test(word))
  const program = words[0]?.split('/').pop()
  if (!program || !WORD.test(program)) return 'a command'
  return words[1] !== undefined && WORD.test(words[1]) ? `${program} ${words[1]}` : program
}

const pushActivity = (thread, entries) => (entries.length === 0 ? thread : { ...thread, activity: [...thread.activity, ...entries].slice(-MAX_ACTIVITY) })

function readItem(thread, item, at) {
  switch (item?.type) {
    case 'CollabAgentToolCall':
      if (item.tool !== 'closeAgent') return thread
      return { ...thread, closed: [...thread.closed, ...(item.receiver_thread_ids ?? [])] }
    case 'CommandExecution': {
      const code = typeof item.exit_code === 'number' ? item.exit_code : null
      return pushActivity(thread, [{ at, verb: 'Ran', target: commandName(item.command), tone: code === null ? 'idle' : code === 0 ? 'ok' : 'bad', note: code ? `exit ${code}` : null }])
    }
    case 'FileChange': {
      const paths = Object.keys(item.changes ?? {})
      const verbs = { add: 'Created', delete: 'Deleted', update: 'Edited' }
      const entries = paths.map(path => ({ at, verb: verbs[item.changes[path]?.type] ?? 'Changed', target: shortPath(path), tone: 'edit', note: null }))
      const files = [...thread.files, ...paths.filter(path => !thread.files.includes(path))].slice(0, MAX_FILES)
      return { ...pushActivity(thread, entries), files }
    }
    case 'McpToolCall':
      return pushActivity(thread, [{ at, verb: 'Called', target: `${item.server ?? 'mcp'} ${item.tool ?? ''}`.trim(), tone: item.status === 'failed' ? 'bad' : 'ok', note: item.status === 'failed' ? 'failed' : null }])
    case 'SubAgentActivity':
      if (item.kind !== 'started') return thread
      return pushActivity(thread, [{ at, verb: 'Agent', target: shortPath(item.agent_path ?? 'sub-agent').split('/').pop(), tone: 'agent', note: 'started' }])
    case 'ContextCompaction':
      return pushActivity({ ...thread, compactions: thread.compactions + 1 }, [{ at, verb: 'Compacted', target: 'context', tone: 'idle', note: null }])
    default:
      return thread
  }
}

/** Folds JSONL text into the thread; returns the thread and any trailing partial line. */
export function applyText(thread, text) {
  const lines = text.split('\n')
  const rest = lines.pop() ?? ''
  let next = thread
  for (const line of lines) {
    if (line.trim() === '') continue
    try {
      next = applyRecord(next, JSON.parse(line))
    } catch {
      // a malformed line is skipped
    }
  }
  return { thread: next, rest }
}

/** A rollout file followed from its last read offset. */
export class RolloutTail {
  constructor(file) {
    this.file = file
    this.offset = 0
    this.pending = Buffer.alloc(0)
    this.rest = ''
    this.thread = emptyThread()
  }

  /** Reads what was appended since the last poll; returns true when the thread changed. */
  poll() {
    let size
    try {
      size = statSync(this.file).size
    } catch {
      return false
    }
    if (size <= this.offset) return false
    const before = this.thread
    const fd = openSync(this.file, 'r')
    try {
      // rollouts reach hundreds of MB; whole-file strings would hit V8's string limit
      const buffer = Buffer.alloc(Math.min(CHUNK, size - this.offset))
      while (this.offset < size) {
        const length = readSync(fd, buffer, 0, Math.min(buffer.length, size - this.offset), this.offset)
        if (length === 0) break
        this.offset += length
        // a chunk can end inside a multi-byte character, so whole lines are cut from the bytes first
        const bytes = Buffer.concat([this.pending, buffer.subarray(0, length)])
        const end = bytes.lastIndexOf(0x0a) + 1
        this.pending = bytes.subarray(end)
        if (end > 0) this.thread = applyText(this.thread, bytes.toString('utf8', 0, end)).thread
      }
    } finally {
      closeSync(fd)
    }
    this.rest = this.pending.toString('utf8')
    return this.thread !== before
  }
}

/** The session_meta payload on a rollout's first line, or null. */
export function readMeta(file) {
  let fd
  try {
    fd = openSync(file, 'r')
    // the first line carries the base instructions, so it can be large
    const buffer = Buffer.alloc(1024 * 1024)
    const length = readSync(fd, buffer, 0, buffer.length, 0)
    const text = buffer.toString('utf8', 0, length)
    const end = text.indexOf('\n')
    const record = JSON.parse(end < 0 ? text : text.slice(0, end))
    return record.type === 'session_meta' ? record.payload : null
  } catch {
    return null
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

const listDesc = dir => {
  try {
    return readdirSync(dir).sort().reverse()
  } catch {
    return []
  }
}

/** Rollout files from the newest `days` day folders (YYYY/MM/DD) that exist, newest first. */
export function recentRollouts(sessionsDir, days = 2) {
  const dayDirs = []
  for (const year of listDesc(sessionsDir)) {
    for (const month of listDesc(join(sessionsDir, year))) {
      for (const day of listDesc(join(sessionsDir, year, month))) {
        if (dayDirs.length < days) dayDirs.push(join(sessionsDir, year, month, day))
      }
    }
  }
  const files = []
  for (const dir of dayDirs) {
    for (const name of listDesc(dir)) {
      if (!name.startsWith('rollout-') || !name.endsWith('.jsonl')) continue
      const file = join(dir, name)
      try {
        files.push({ file, mtime: statSync(file).mtimeMs })
      } catch {
        // removed between listing and stat
      }
    }
  }
  return files.sort((a, b) => b.mtime - a.mtime).map(entry => entry.file)
}
