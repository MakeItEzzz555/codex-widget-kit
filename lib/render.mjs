// Draws one frame as plain text with ANSI truecolor: a dashboard of cards in a grid that follows the terminal width.
import {
  currentTitle,
  doneCount,
  formatEta,
  RING_COLUMNS,
  RING_ROWS,
  remainingColor,
  remainingMs,
  ringCells,
  shortModel,
} from './meters.mjs'

// Codex's reasoning efforts, lowest to highest
const LEVELS = ['minimal', 'low', 'medium', 'high', 'xhigh']
const MAX_AGENTS = 9

// Design tokens. Colours are semantic; each theme fills them in for its background.
export const THEMES = {
  dark: { accent: 0x4aa3ff, accent2: 0x22d3ee, border: 0x3a4454, muted: 0x8b95a3, ok: 0x4cc764, warn: 0xf5b10a, bad: 0xe0251b, agent: 0xa78bfa, edit: 0x22d3ee, heat: [0xf5d90a, 0xf5b10a, 0xf5820a, 0xef5310, 0xe0251b] },
  light: { accent: 0x0b6bcb, accent2: 0x0e7490, border: 0xb4bfcc, muted: 0x5b6573, ok: 0x1a7f37, warn: 0x9a6700, bad: 0xcf222e, agent: 0x6d28d9, edit: 0x0e7490, heat: [0xa16207, 0xb45309, 0xc2410c, 0xc2410c, 0xb91c1c] },
}
const GLYPHS = {
  unicode: { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│', full: '█', empty: '░', dot: '●', ring: '○', ticks: ['▂', '▃', '▄', '▆', '█'], spark: ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'], here: '▸', sep: '·', icons: true },
  ascii: { tl: '+', tr: '+', bl: '+', br: '+', h: '-', v: '|', full: '#', empty: '.', dot: '*', ring: 'o', ticks: ['#', '#', '#', '#', '#'], unlit: '.', spark: ['_', '.', '-', '=', '#'], here: '>', sep: '-', icons: false },
}
const ICONS = { session: '◷', context: '◧', tokens: '≋', turns: '↻', fiveHour: '◔', week: '▦', tasks: '☰', agents: '◉', activity: '∿' }

// A line is a list of segments: { text, color?, dim?, bold? }.
// Plan steps, agent names and paths come from the rollout, so control characters (ESC included) are dropped.
const seg = (text, style = {}) => ({ text: String(text).replace(/[\u0000-\u001f\u007f-\u009f]/g, ''), ...style })
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
/** `left`, then `right` against the far edge of `size`; the left side gives way first. */
const spread = (left, right, size) => {
  const room = size - width(right) - 1
  if (room < 4) return truncate(left, size)
  return [...padTo(truncate(left, room), size - width(right)), ...right]
}

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

// Readings

/** 28_320 -> `28.3k`, 1_234_567 -> `1.23M`. */
export const formatTokens = count => {
  if (count < 1_000) return `${count}`
  if (count < 1_000_000) return `${(count / 1_000).toFixed(count < 100_000 ? 1 : 0)}k`
  return `${(count / 1_000_000).toFixed(count < 10_000_000 ? 2 : 1)}M`
}

/** 64_000 -> `1m 04s`, 25 min -> `25m`, 102 min -> `1h 42m`. */
export const formatSpan = ms => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 10) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

/** Cuts from the front, so a long path keeps its file name: `…/Package.swift`. */
export const fitTail = (text, room) => {
  const chars = [...text]
  return chars.length <= room ? text : `…${chars.slice(chars.length - Math.max(1, room - 1)).join('')}`
}

export const formatAgo = ms => (ms < 45_000 ? 'now' : `${formatSpan(ms).split(' ')[0]} ago`)

/** Bar heights for a series, scaled to its own largest value. */
export const sparkline = (values, marks) => {
  const top = Math.max(...values, 1)
  return values.map(value => marks[Math.min(marks.length - 1, Math.round((value / top) * (marks.length - 1)))]).join('')
}

// Building blocks, each given the style { theme, glyphs }

const muted = (text, style) => seg(text, { color: style.theme.muted })
// the meters' green / amber / red, from the theme so they keep contrast on a light background
const leftColor = (left, { theme }) => (left > 50 ? theme.ok : left > 20 ? theme.warn : theme.bad)

const bar = (share, size, color, { glyphs }) => {
  const filled = Math.round(Math.max(0, Math.min(1, share)) * size)
  return [seg(glyphs.full.repeat(filled), { color }), seg(glyphs.empty.repeat(size - filled), { dim: true })]
}

const effortTicks = (effort, style) => {
  const index = LEVELS.indexOf(effort)
  return style.glyphs.ticks.map((mark, i) => (i <= index ? seg(mark, { color: style.theme.heat[i] }) : seg(style.glyphs.unlit ?? mark, { dim: true })))
}

const effortRow = (model, effort, style) => {
  const index = LEVELS.indexOf(effort)
  const words = ` ${effort ?? 'no effort'} ${style.glyphs.sep} ${shortModel(model)}`
  return [...effortTicks(effort, style), index < 0 ? seg(words, { dim: true }) : seg(words, { color: style.theme.heat[index] })]
}

const planBar = (plan, size, at, style) => {
  const done = doneCount(plan.tasks)
  const isDone = done === plan.tasks.length
  const tail = ` ${done}/${plan.tasks.length} ${style.glyphs.sep} ${isDone ? 'done' : formatEta(remainingMs(plan, at))}`
  const length = Math.max(4, Math.min(40, size - tail.length))
  return [...bar(done / plan.tasks.length, length, isDone ? style.theme.ok : style.theme.accent, style), seg(tail, { dim: true })]
}

/**
 * A card: `title` and `value` sit in the top border, `body(inner)` returns its rows.
 * `span` is how many grid columns it takes.
 */
const card = (key, title, value, body, span = 1) => ({ key, title, value, body, span })

function drawCard(item, size, height, style) {
  const { glyphs, theme } = style
  const inner = size - 4
  const edge = text => seg(text, { color: theme.border })
  const icon = glyphs.icons ? [seg(`${ICONS[item.key]} `, { color: theme.accent })] : []
  const value = item.value
  const valueWidth = value.length === 0 ? 0 : width(value) + 3
  const head = truncate([...icon, seg(item.title, { bold: true })], Math.max(1, size - 6 - valueWidth))
  const fill = size - 5 - width(head) - valueWidth
  const top = [
    edge(`${glyphs.tl}${glyphs.h} `),
    ...head,
    edge(` ${glyphs.h.repeat(Math.max(0, fill))}`),
    ...(value.length === 0 ? [] : [seg(' '), ...value, edge(` ${glyphs.h}`)]),
    edge(glyphs.tr),
  ]
  const rows = item.body(inner)
  while (rows.length < height - 2) rows.push([])
  return [
    top,
    ...rows.map(row => [edge(`${glyphs.v} `), ...padTo(truncate(row, inner), inner), edge(` ${glyphs.v}`)]),
    [edge(`${glyphs.bl}${glyphs.h.repeat(size - 2)}${glyphs.br}`)],
  ]
}

/** Packs cards row by row into `columns` grid columns, in their given order; a row is as tall as its tallest card. */
function grid(cards, total, columns, style) {
  const gap = 1
  const unit = Math.floor((total - gap * (columns - 1)) / columns)
  const rows = [[]]
  let used = 0
  for (const item of cards) {
    const span = Math.min(item.span, columns)
    if (used + span > columns) {
      rows.push([])
      used = 0
    }
    rows.at(-1).push({ item, size: unit * span + gap * (span - 1) })
    used += span
  }

  const lines = []
  for (const items of rows) {
    // the last card of a row takes the leftover columns, so every row ends on the same edge
    const taken = items.reduce((sum, one) => sum + one.size, 0) + gap * (items.length - 1)
    items.at(-1).size += Math.max(0, total - taken)
    const height = Math.max(...items.map(({ item, size }) => item.body(size - 4).length)) + 2
    const drawn = items.map(({ item, size }) => drawCard(item, size, height, style))
    for (let i = 0; i < height; i++) lines.push(drawn.flatMap((one, at) => (at === 0 ? one[i] : [seg(' '.repeat(gap)), ...one[i]])))
  }
  return lines
}

// The widgets. Each reads only the thread's verified fields and says so when a reading is missing.

const waiting = (text, style) => [muted(text, style)]

function sessionCard(main, at, style) {
  const { theme, glyphs } = style
  const status = main.isRunning ? [seg(`${glyphs.dot} Running`, { color: theme.ok })] : [seg(`${glyphs.ring} Idle`, { color: theme.muted })]
  return card('session', 'Session', status, () => {
    const rows = []
    rows.push(main.startedAt === null ? waiting('Start time unknown', style) : [muted('elapsed ', style), seg(formatSpan(at - main.startedAt), { bold: true })])
    if (main.isRunning && main.turns.startedAt !== null) rows.push([muted('this turn ', style), seg(formatSpan(at - main.turns.startedAt), { color: theme.accent2 })])
    else if (main.lastAt !== null) rows.push([muted('last activity ', style), seg(formatAgo(at - main.lastAt))])
    rows.push(main.model === null ? waiting('No model request yet', style) : effortRow(main.model, main.effort, style))
    return rows
  })
}

function contextCard(main, style) {
  const left = main.usage.context === null ? null : Math.max(0, Math.round(100 - main.usage.context))
  const value = left === null ? [] : [seg(`${left}% left`, { color: leftColor(left, style), bold: true })]
  return card('context', 'Context', value, inner => {
    if (left === null) return [waiting('Waiting for the first response', style)]
    const rows = [bar(left / 100, Math.min(inner, 40), leftColor(left, style), style)]
    if (main.window.used !== null) rows.push([seg(formatTokens(main.window.used)), muted(` / ${formatTokens(main.window.size)} tokens in window`, style)])
    if (main.compactions > 0) rows.push([seg(`compacted ${main.compactions}×`, { color: style.theme.warn })])
    return rows
  })
}

function tokensCard(main, style) {
  const tokens = main.tokens
  const value = tokens === null ? [] : [seg(formatTokens(tokens.total), { bold: true })]
  return card('tokens', 'Tokens', value, inner => {
    if (tokens === null) return [waiting('Waiting for token counts', style)]
    const sep = ` ${style.glyphs.sep} `
    const rows = [
      [muted('in ', style), seg(formatTokens(tokens.input)), muted(`${sep}cached `, style), seg(formatTokens(tokens.cached)), muted(`${sep}out `, style), seg(formatTokens(tokens.output))],
    ]
    if (tokens.reasoning > 0) rows.push([muted('reasoning ', style), seg(formatTokens(tokens.reasoning))])
    if (main.requests.length > 1) {
      const recent = main.requests.slice(-Math.max(4, inner - 20))
      rows.push([seg(sparkline(recent, style.glyphs.spark), { color: style.theme.accent }), muted(' output per request', style)])
    }
    return rows
  })
}

function turnsCard(main, at, style) {
  const { count, totalMs, lastMs, startedAt, recent } = main.turns
  // a count, never "n of m": Codex has no turn quota
  return card('turns', 'Turns', [seg(`${count} done`, { bold: true })], inner => {
    const sep = ` ${style.glyphs.sep} `
    const rows = []
    if (count === 0) rows.push(waiting('No completed turn yet', style))
    else rows.push([muted('avg ', style), seg(formatSpan(totalMs / count)), muted(`${sep}last `, style), seg(lastMs === null ? '—' : formatSpan(lastMs))])
    if (startedAt !== null) rows.push([muted('live ', style), seg(formatSpan(at - startedAt), { color: style.theme.accent2 })])
    if (recent.length > 1) rows.push([seg(sparkline(recent.slice(-Math.max(4, inner - 16)), style.glyphs.spark), { color: style.theme.accent }), muted(' turn lengths', style)])
    return rows
  })
}

function limitCard(key, title, percent, resetsAt, at, style) {
  const left = percent === null ? null : Math.max(0, Math.round(100 - percent))
  const value = left === null ? [] : [seg(`${left}% left`, { color: leftColor(left, style), bold: true })]
  return card(key, title, value, inner => {
    if (left === null) return [waiting('Waiting for rate limits', style)]
    const used = [muted(`${Math.round(percent)}% used`, style)]
    const reset = resetsAt === null ? [muted('reset time unknown', style)] : [muted('resets in ', style), seg(formatSpan(resetsAt - at))]
    if (!style.rings || inner < RING_COLUMNS + 16) return [bar(left / 100, Math.min(inner, 30), leftColor(left, style), style), used, reset]
    // the v0.1 braille ring, with the readings beside it
    const beside = [[], used, reset, [], []]
    return ringCells(left, `${left}%`).map((cells, row) => [...cells.map(cell => seg(cell.char, { color: cell.color === remainingColor(left) ? leftColor(left, style) : cell.color })), seg('  '), ...beside[row]]).slice(0, RING_ROWS)
  })
}

function tasksCard(main, at, style) {
  return card('tasks', 'Tasks', [muted(`${doneCount(main.plan.tasks)}/${main.plan.tasks.length}`, style)], inner => [
    [seg(`${style.glyphs.here} ${currentTitle(main.plan) ?? 'all tasks done'}`)],
    planBar(main.plan, inner, at, style),
  ])
}

const agentName = agent => agent.nickname ?? agent.path?.split('/').pop() ?? 'agent'
const agentKind = agent => agent.path?.split('/').pop() ?? 'sub-agent'

function agentsCard(main, agents, at, style) {
  const { theme, glyphs } = style
  const running = agents.filter(agent => agent.isRunning).length
  return card('agents', 'Agents', [muted(`${running} running`, style)], inner => {
    const rows = []
    const entry = (name, kind, thread) => {
      const dot = thread.isRunning ? seg(`${glyphs.dot} `, { color: theme.ok }) : seg(`${glyphs.ring} `, { color: theme.muted })
      const effort = thread.model === null ? [] : effortRow(thread.model, thread.effort, style)
      rows.push(spread([dot, seg(name, { bold: true }), muted(` ${kind}`, style)], effort, inner))
      if (thread.plan !== null) rows.push([seg('  '), ...planBar(thread.plan, inner - 2, at, style)])
    }
    entry('Codex', 'main', main)
    for (const agent of agents.slice(0, MAX_AGENTS)) entry(agentName(agent), agentKind(agent), agent)
    if (agents.length === 0) rows.push(waiting('No sub-agents running', style))
    if (agents.length > MAX_AGENTS) rows.push(waiting(`+${agents.length - MAX_AGENTS} more agents`, style))
    return rows
  })
}

function activityCard(main, at, style, span) {
  const { theme, glyphs } = style
  const tones = { ok: theme.ok, bad: theme.bad, edit: theme.edit, agent: theme.agent, idle: theme.muted }
  return card(
    'activity',
    'Recent activity',
    [],
    inner => {
      if (main.activity.length === 0) return [waiting('No commands or edits yet', style)]
      return [...main.activity].reverse().map(entry => {
        const ago = formatAgo(at - entry.at)
        // dot, verb column, the note and the time keep their room; the target gives way from its front
        const room = inner - 2 - 10 - (entry.note ? entry.note.length + 1 : 0) - ago.length - 1
        return spread(
          [seg(`${glyphs.dot} `, { color: tones[entry.tone] }), seg(entry.verb.padEnd(10)), seg(fitTail(entry.target, room), { color: theme.accent2 }), ...(entry.note ? [muted(` ${entry.note}`, style)] : [])],
          [muted(ago, style)],
          inner,
        )
      })
    },
    span,
  )
}

/** The title row above the grid: product name and the session's folder. */
function header(main, columns, style) {
  const name = [seg('Codex', { color: style.theme.accent, bold: true }), seg(' Widget Kit', { bold: true })]
  const folder = main.cwd === null ? [] : [muted(`~/…/${main.cwd.split('/').filter(Boolean).pop() ?? ''}`, style)]
  return [spread(name, folder, columns), []]
}

/** Compact mode: one reading per line, for narrow panes or `--layout compact`. */
function compact(main, agents, columns, at, style) {
  const { theme, glyphs } = style
  const sep = muted(` ${glyphs.sep} `, style)
  const lines = []
  const state = main.isRunning ? seg(`${glyphs.dot} running`, { color: theme.ok }) : seg(`${glyphs.ring} idle`, { color: theme.muted })
  lines.push([
    state,
    ...(main.startedAt === null ? [] : [sep, seg(formatSpan(at - main.startedAt))]),
    sep,
    seg(`${main.turns.count} turn${main.turns.count === 1 ? '' : 's'}`),
    ...(main.turns.startedAt === null ? [] : [sep, muted('live ', style), seg(formatSpan(at - main.turns.startedAt))]),
  ])
  const gauges = [
    ['5h', main.usage.fiveHour],
    ['week', main.usage.week],
    ['ctx', main.usage.context],
  ].flatMap(([label, percent]) => (percent === null ? [] : [{ label, left: Math.max(0, Math.round(100 - percent)) }]))
  if (gauges.length > 0) {
    lines.push([...gauges.flatMap(({ label, left }, i) => [...(i > 0 ? [sep] : []), muted(`${label} `, style), seg(`${left}%`, { color: leftColor(left, style) })]), muted(' left', style)])
  }
  if (main.tokens !== null) {
    lines.push([muted('tokens ', style), seg(formatTokens(main.tokens.total)), muted(` out ${formatTokens(main.tokens.output)} `, style), seg(sparkline(main.requests.slice(-12), glyphs.spark), { color: theme.accent })])
  }
  if (main.model !== null) lines.push(effortRow(main.model, main.effort, style))
  if (main.plan !== null) lines.push([muted('tasks ', style), ...planBar(main.plan, columns - 6, at, style)])
  if (agents.length > 0) lines.push([muted('agents ', style), seg(`${agents.filter(agent => agent.isRunning).length} running`), muted(` of ${agents.length}`, style)])
  return lines.map(line => truncate(line, columns))
}

export const styleFor = ({ theme = 'dark', ascii = false } = {}) => ({ theme: THEMES[theme] ?? THEMES.dark, glyphs: ascii ? GLYPHS.ascii : GLYPHS.unicode })

/** How many grid columns a width holds; 0 means compact mode. */
export const gridColumns = columns => (columns >= 132 ? 3 : columns >= 76 ? 2 : columns >= 40 ? 1 : 0)

/**
 * The whole frame as segment lines. `layout` is `auto` (by width), `compact`, `standard` (at most two columns)
 * or `expanded` (as many as fit, up to three); `theme` is `dark` or `light`; `ascii` swaps the Unicode glyphs.
 */
export function frame({ main, agents }, columns, at, { layout = 'auto', ...look } = {}) {
  const fit = gridColumns(columns)
  const cols = layout === 'compact' ? 0 : layout === 'standard' ? Math.min(2, fit) : fit
  // the braille rings are five rows tall: only the three-column grid has the room beside them
  const style = { ...styleFor(look), rings: cols === 3 && !look.ascii }
  if (cols === 0) return compact(main, agents, columns, at, style)

  const cards = [
    sessionCard(main, at, style),
    contextCard(main, style),
    tokensCard(main, style),
    limitCard('fiveHour', '5h limit', main.usage.fiveHour, main.resets.fiveHour, at, style),
    limitCard('week', 'Weekly limit', main.usage.week, main.resets.week, at, style),
    turnsCard(main, at, style),
    ...(main.plan === null ? [] : [tasksCard(main, at, style)]),
    agentsCard(main, agents, at, style),
    activityCard(main, at, style, main.plan === null ? 2 : 3),
  ]
  return [...header(main, columns, style), ...grid(cards, columns, cols, style)]
}
