// Pure meter logic, ported from the Claude Code turn-meters mod (hooks/meters.ts).

export const doneCount = tasks => tasks.filter(task => task.status === 'completed').length

export const isFinished = plan => doneCount(plan.tasks) === plan.tasks.length

/** What the plan is on now: the task in progress, else the next pending one. */
export const currentTitle = plan => {
  const task = plan.tasks.find(one => one.status === 'in_progress') ?? plan.tasks.find(one => one.status === 'pending')
  return task === undefined ? undefined : (task.title ?? task.id)
}

/** The plan after the task list changed at `at`; a finished plan is replaced by a fresh one. */
export function nextPlan(prev, tasks, at) {
  if (tasks.length === 0) return null
  const done = doneCount(tasks)
  if (prev === null || isFinished(prev)) {
    return { tasks, startedAt: at, lastDoneAt: at, baseDone: done }
  }

  return { ...prev, tasks, lastDoneAt: done > doneCount(prev.tasks) ? at : prev.lastDoneAt }
}

/** Milliseconds left at `at`: the pace so far times the tasks left, counting down since the last completion. */
export function remainingMs(plan, at) {
  const done = doneCount(plan.tasks)
  const measured = done - plan.baseDone
  if (measured <= 0) return null
  const perTask = (plan.lastDoneAt - plan.startedAt) / measured

  return Math.max(0, perTask * (plan.tasks.length - done) - (at - plan.lastDoneAt))
}

export function formatEta(ms) {
  if (ms === null) return 'est. …'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 1) return 'est. <1 min'
  if (minutes < 60) return `est. ${minutes} min`

  return `est. ${Math.floor(minutes / 60)} h ${minutes % 60} min`
}

export const RING_COLUMNS = 10
export const RING_ROWS = 5
export const TRACK = 0x5c5c5c
// braille dot bits by [column][row] inside one cell
const DOTS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
]

export const remainingColor = remaining => (remaining > 50 ? 0x4cc764 : remaining > 20 ? 0xf5b10a : 0xe0251b)

/**
 * A braille ring, 10x5 cells (20x20 dots), as rows of { char, color }: the remaining share
 * lit clockwise from 12 o'clock, the rest a dim track, the label in the middle.
 */
export function ringCells(remaining, label) {
  const color = remaining === null ? TRACK : remainingColor(remaining)
  const rows = []
  for (let row = 0; row < RING_ROWS; row++) {
    const cells = []
    for (let col = 0; col < RING_COLUMNS; col++) {
      let bits = 0
      let lit = 0
      for (let dx = 0; dx < 2; dx++) {
        for (let dy = 0; dy < 4; dy++) {
          const x = col * 2 + dx + 0.5 - RING_COLUMNS
          const y = row * 4 + dy + 0.5 - RING_ROWS * 2
          const radius = Math.hypot(x, y)
          if (radius < 7 || radius > 9.8) continue
          bits |= DOTS[dx][dy]
          const turn = (Math.atan2(x, -y) / (2 * Math.PI) + 1) % 1
          if (remaining !== null && turn < remaining / 100) lit++
          else lit--
        }
      }
      cells.push({ char: bits === 0 ? ' ' : String.fromCharCode(0x2800 + bits), color: lit > 0 ? color : TRACK })
    }
    rows.push(cells)
  }
  const middle = rows[Math.floor(RING_ROWS / 2)]
  const start = Math.floor((RING_COLUMNS - label.length) / 2)
  for (let i = 0; i < label.length; i++) middle[start + i] = { char: label[i], color }

  return rows
}

/** `gpt-6.1-sol-2026-08-01` -> `gpt-6.1-sol`: a dated id loses its date. */
export const shortModel = model => model.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-\d{8}$/, '')

// Codex reserves this many tokens for its fixed prompt (codex-rs/protocol/src/protocol.rs BASELINE_TOKENS).
const BASELINE_TOKENS = 12_000

/** Context left, the same number Codex's own `context-remaining` status-line item shows. */
export function contextLeft(totalTokens, contextWindow) {
  if (contextWindow <= BASELINE_TOKENS) return 0
  const effective = contextWindow - BASELINE_TOKENS
  const used = Math.max(0, totalTokens - BASELINE_TOKENS)

  return Math.min(100, Math.max(0, Math.round((Math.max(0, effective - used) / effective) * 100)))
}
