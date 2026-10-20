#!/usr/bin/env node
// codex-widgets: usage rings, effort, task progress and agent cards for the Codex session in a folder.
// Run it in its own terminal pane beside `codex`. It only reads Codex's rollout files.
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { frame, toAnsi } from '../lib/render.mjs'
import { readMeta, recentRollouts, RolloutTail } from '../lib/rollout.mjs'

const USAGE = 'usage: codex-widgets [--cwd <folder>] [--once]'
let options
try {
  options = parseArgs({ options: { cwd: { type: 'string' }, once: { type: 'boolean' }, help: { type: 'boolean', short: 'h' } } }).values
} catch (error) {
  console.error(`${error.message}\n${USAGE}`)
  process.exit(2)
}
if (options.help) {
  console.log(USAGE)
  process.exit(0)
}

const cwd = resolve(options.cwd ?? process.cwd())
const sessions = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'sessions')
const isColor = process.env.NO_COLOR === undefined && (options.once ? process.stdout.isTTY : true)
const metas = new Map()
const tails = new Map()
let main = null

const metaOf = file => {
  if (metas.has(file)) return metas.get(file)
  // a failed read is retried: Codex may still be writing the first line
  const meta = readMeta(file)
  if (meta !== null) metas.set(file, meta)
  return meta
}
const tailOf = file => {
  if (!tails.has(file)) tails.set(file, new RolloutTail(file))
  return tails.get(file)
}

/** Picks the newest top-level session for `cwd` and the sub-agents it spawned. */
function rescan() {
  const files = recentRollouts(sessions)
  const root = files.find(file => {
    const meta = metaOf(file)
    return meta !== null && meta.thread_source !== 'subagent' && meta.cwd === cwd
  })
  main = root === undefined ? null : tailOf(root)
  if (main === null) return []
  return files.filter(file => metaOf(file)?.parent_thread_id === metaOf(main.file).id).map(tailOf)
}

let agents = []
const poll = () => {
  main?.poll()
  for (const agent of agents) agent.poll()
}

const render = () => {
  const columns = process.stdout.columns || Number(process.env.COLUMNS) || 80
  if (main === null) return `\n Waiting for a Codex session in ${cwd}\n`
  const closed = new Set(main.thread.closed)
  const live = agents.map(tail => tail.thread).filter(thread => !closed.has(thread.id))
  return frame({ main: main.thread, agents: live }, columns, Date.now())
    .map(line => toAnsi(line, isColor))
    .join('\n')
}

agents = rescan()
poll()
if (options.once) {
  process.stdout.write(`${render()}\n`)
  process.exit(0)
}

let shown = ''
const draw = (force = false) => {
  const next = render()
  if (!force && next === shown) return
  shown = next
  // home, draw, clear what is left below
  process.stdout.write(`\x1b[H${next.split('\n').join('\x1b[K\n')}\x1b[K\x1b[J`)
}

const restore = () => process.stdout.write('\x1b[?25h\x1b[?1049l')
process.stdout.write('\x1b[?1049h\x1b[?25l\x1b[2J')
process.on('exit', restore)
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => process.exit(0))
process.on('SIGWINCH', () => draw(true))

draw(true)
// shortcut: polls file sizes once a second instead of fs.watch, which drops events on macOS; fine for a handful of files
// redrawing each second also keeps the ETA counting down between events
setInterval(() => {
  poll()
  draw()
}, 1_000)
setInterval(() => {
  agents = rescan()
  poll()
  draw()
}, 5_000)
