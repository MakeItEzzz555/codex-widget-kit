// Draws one frame as plain text with ANSI truecolor, the same layout as the Claude turn-meters band and panel.
import {
  currentTitle,
  doneCount,
  formatEta,
  RING_COLUMNS,
  RING_ROWS,
  remainingMs,
  ringCells,
  shortModel,
} from './meters.mjs'

// Codex's reasoning efforts, lowest to highest
const LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh']
const TICKS = ['▂', '▃', '▄', '▆', '█']
// yellow -> red, one per effort level
const HEAT = [0xf5d90a, 0xf5b10a, 0xf5820a, 0xef5310, 0xe0251b]
const SUCCESS = 0x4cc764
const ACCENT = 0x7aa2f7
const IDLE = 0x8a8a8a
const MAX_AGENTS = 9
const CARD_WIDTH = 46

// A line is a list of segments: { text, color?, dim?, bold? }.
const seg = (text, style = {}) => ({ text, ...style })
const width = line => line.reduce((sum, part) => sum + [...part.text].length, 0)

const truncate = (line, max) => {
  const out = []
  let left = max
  for (const part of line) {
    if (left <= 0) break
    const chars = [...part.text]
    if (chars.length <= left) {
      out.push(part)
      left -= chars.length
    } else {
      out.push({ ...part, text: chars.slice(0, Math.max(0, left - 1)).join('') + '…' })
      left = 0
    }
  }
  return out
}

const padTo = (line, size) => [...line, seg(' '.repeat(Math.max(0, size - width(line))))]

export function toAnsi(line, isColor) {
  if (!isColor) return line.map(part => part.text).join('')
  return line
    .map(part => {
      const codes = []
      if (part.bold) codes.push('1')
      if (part.dim) codes.push('2')
      if (part.color !== undefined) codes.push(`38;2;${(part.color >> 16) & 255};${(part.color >> 8) & 255};${part.color & 255}`)
      return codes.length === 0 ? part.text : `\x1b[${codes.join(';')}m${part.text}\x1b[0m`
    })
    .join('')
}

const effortTicks = effort => {
  const index = LEVELS.indexOf(effort)
  return TICKS.map((mark, i) => (i <= index ? seg(mark, { color: HEAT[i] }) : seg(mark, { dim: true })))
}

const effortLabel = (model, effort) => {
  const index = LEVELS.indexOf(effort)
  const words = ` ${effort ?? 'no effort'} · ${shortModel(model)}`
  return index < 0 ? seg(words, { dim: true }) : seg(words, { color: HEAT[index] })
}

const progressBar = (plan, size, at) => {
  const done = doneCount(plan.tasks)
  const isDone = done === plan.tasks.length
  const tail = ` ${done}/${plan.tasks.length} · ${isDone ? 'done' : formatEta(remainingMs(plan, at))}`
  const bar = Math.max(4, Math.min(40, size - tail.length))
  const filled = Math.round((done / plan.tasks.length) * bar)
  return [seg('█'.repeat(filled), { color: isDone ? SUCCESS : ACCENT }), seg('░'.repeat(bar - filled), { dim: true }), seg(tail, { dim: true })]
}

/** The band: usage rings, with the main thread's effort and tasks beside them when they fit. */
function band(main, columns, at) {
  const gauges = [
    ['5h', main.usage.fiveHour],
    ['week', main.usage.week],
    ['ctx', main.usage.context],
  ].flatMap(([label, percent]) => (percent === null ? [] : [{ label, left: Math.max(0, Math.round(100 - percent)) }]))

  const ringsWidth = gauges.length * RING_COLUMNS + Math.max(0, gauges.length - 1) * 2
  const isBeside = gauges.length > 0 && columns - ringsWidth - 3 >= 34
  const rowsWidth = isBeside ? columns - ringsWidth - 3 : columns
  const mainRows = []
  if (main.model !== null) mainRows.push([seg('effort ', { dim: true }), ...effortTicks(main.effort), effortLabel(main.model, main.effort)])
  if (main.plan !== null) mainRows.push([seg('tasks  ', { dim: true }), ...progressBar(main.plan, rowsWidth - 7, at)])

  const ringLines = []
  if (gauges.length > 0) {
    const rings = gauges.map(({ label, left }) => ringCells(left, `${left}%`))
    for (let row = 0; row < RING_ROWS; row++) {
      const line = []
      rings.forEach((ring, i) => {
        if (i > 0) line.push(seg('  '))
        for (const cell of ring[row]) line.push(seg(cell.char, { color: cell.color }))
      })
      ringLines.push(line)
    }
    const labels = []
    gauges.forEach(({ label }, i) => {
      if (i > 0) labels.push(seg('  '))
      const text = `${label} left`
      const before = Math.floor((RING_COLUMNS - text.length) / 2)
      labels.push(seg(' '.repeat(before) + text + ' '.repeat(RING_COLUMNS - text.length - before), { dim: true }))
    })
    ringLines.push(labels)
  }

  if (!isBeside) return [...ringLines, ...mainRows.map(row => truncate(row, columns))]
  const top = Math.floor((ringLines.length - mainRows.length) / 2)
  return ringLines.map((line, i) => {
    const row = mainRows[i - top]
    return row === undefined ? line : [...padTo(line, ringsWidth), seg('   '), ...truncate(row, rowsWidth)]
  })
}

/** A rounded card: the thread's name, what it is on, its progress and its effort. */
function card(name, kind, dot, thread, size, at) {
  const inner = size - 4
  const rows = [[seg('● ', { color: dot }), seg(name, { bold: true }), seg(` ${kind}`, { dim: true })]]
  if (thread.plan === null) rows.push([seg('no task list yet', { dim: true })])
  else rows.push([seg(`▸ ${currentTitle(thread.plan) ?? 'all tasks done'}`)], progressBar(thread.plan, inner, at))
  if (thread.model === null) rows.push([seg('no model request yet', { dim: true })])
  else rows.push([...effortTicks(thread.effort), effortLabel(thread.model, thread.effort)])

  const edge = text => seg(text, { dim: true })
  return [
    [edge(`╭${'─'.repeat(size - 2)}╮`)],
    ...rows.map(row => [edge('│ '), ...padTo(truncate(row, inner), inner), edge(' │')]),
    [edge(`╰${'─'.repeat(size - 2)}╯`)],
  ]
}

const agentName = agent => agent.nickname ?? agent.path?.split('/').pop() ?? 'agent'
const agentKind = agent => agent.path?.split('/').pop() ?? 'sub-agent'

/** The whole frame as segment lines: band, then the main card and one card per sub-agent. */
export function frame({ main, agents }, columns, at) {
  const size = Math.max(24, Math.min(CARD_WIDTH, columns))
  const lines = [...band(main, columns, at), []]
  lines.push(...card('Codex', 'main', main.isRunning ? SUCCESS : IDLE, main, size, at))
  if (agents.length === 0) lines.push([seg(' No agents running', { dim: true })])
  for (const agent of agents.slice(0, MAX_AGENTS)) {
    lines.push(...card(agentName(agent), agentKind(agent), agent.isRunning ? SUCCESS : IDLE, agent, size, at))
  }
  if (agents.length > MAX_AGENTS) lines.push([seg(` +${agents.length - MAX_AGENTS} more agents`, { dim: true })])
  return lines
}
