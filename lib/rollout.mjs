// Reads Codex rollout files (~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl) into widget state.
// Read-only. Only the fields listed in CAPABILITY.md are read; prompts, outputs and messages are ignored.
import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { contextLeft, isFinished, nextPlan } from './meters.mjs'

const STATUSES = ['pending', 'in_progress', 'completed']
const FIVE_HOURS = 300
const WEEK = 10_080
const CHUNK = 8 * 1024 * 1024

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
  switch (record.type) {
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
        return { ...thread, isRunning: true, plan: thread.plan !== null && isFinished(thread.plan) ? null : thread.plan }
      }
      if (payload.type === 'task_complete' || payload.type === 'turn_aborted') return { ...thread, isRunning: false }
      if (payload.type === 'token_count') return { ...thread, usage: readUsage(thread.usage, payload) }
      if (payload.type === 'item_completed' && payload.item?.type === 'CollabAgentToolCall' && payload.item.tool === 'closeAgent') {
        return { ...thread, closed: [...thread.closed, ...(payload.item.receiver_thread_ids ?? [])] }
      }
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
