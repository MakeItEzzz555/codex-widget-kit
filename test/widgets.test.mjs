import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { frame, toAnsi } from '../lib/render.mjs'
import { applyText, emptyThread, RolloutTail } from '../lib/rollout.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))
const fixtures = join(here, 'fixtures')
const day = join(fixtures, 'sessions/2026/10/20')
const at = Date.parse('2026-10-20T10:03:02.000Z')
const text = lines => lines.map(line => toAnsi(line, false)).join('\n')

test('a rollout folds into model, effort, plan, usage and closed agents', () => {
  const tail = new RolloutTail(join(day, 'rollout-2026-10-20T10-00-00-root-thread.jsonl'))
  tail.poll()
  const thread = tail.thread
  assert.equal(thread.model, 'gpt-6.1-sol')
  assert.equal(thread.effort, 'high')
  assert.equal(thread.isRunning, true)
  assert.deepEqual(thread.usage, { fiveHour: 30, week: 85.5, context: 50 }) // a null token_count keeps the last reading
  assert.equal(thread.plan.tasks.length, 4)
  assert.equal(thread.plan.lastDoneAt, Date.parse('2026-10-20T10:02:02.000Z'))
  assert.deepEqual(thread.closed, ['closed-thread'])
  assert.match(tail.rest, /function_c$/) // the partial last line waits for the rest
})

test('a partial line is applied once its end arrives', () => {
  const start = applyText(emptyThread(), '{"type":"turn_context","payload":{"model":"m","eff')
  assert.equal(start.thread.model, null)
  const end = applyText(start.thread, `${start.rest}ort":"low"}}\n`)
  assert.equal(end.thread.effort, 'low')
})

test('the frame draws rings, effort, tasks and one card per live agent', () => {
  const root = new RolloutTail(join(day, 'rollout-2026-10-20T10-00-00-root-thread.jsonl'))
  const agent = new RolloutTail(join(day, 'rollout-2026-10-20T10-01-00-agent-thread.jsonl'))
  root.poll()
  agent.poll()
  const drawn = text(frame({ main: root.thread, agents: [agent.thread] }, 120, at))
  for (const label of ['5h left', 'week left', 'ctx left', '70%', '15%', '50%', ' high · gpt-6.1-sol']) {
    assert.ok(drawn.includes(label), `missing ${label}`)
  }
  assert.ok(drawn.includes(' 1/4 · est. 5 min')) // 2 min per task, 3 left, 1 min gone
  assert.ok(drawn.includes('▸ Fix the bug'))
  assert.ok(drawn.includes('Curie scan_repo'))
  assert.ok(drawn.includes(' medium · gpt-6.1-sol'))
  // wide enough: effort sits beside the rings on the middle ring row
  assert.match(drawn.split('\n')[2], /effort/)
  // narrow: the rows stack under the rings
  assert.doesNotMatch(text(frame({ main: root.thread, agents: [] }, 60, at)).split('\n')[2], /effort/)
  assert.ok(text(frame({ main: root.thread, agents: [] }, 60, at)).includes('No agents running'))
})

test('a finished plan stays up until the next turn starts', () => {
  const record = (type, payload) => `${JSON.stringify({ type, timestamp: '2026-10-20T10:00:00.000Z', payload })}\n`
  const done = record('response_item', { type: 'function_call', name: 'update_plan', arguments: JSON.stringify({ plan: [{ step: 'a', status: 'completed' }] }) })
  const after = applyText(emptyThread(), done).thread
  assert.notEqual(after.plan, null)
  assert.equal(applyText(after, record('event_msg', { type: 'task_complete' })).thread.plan, after.plan)
  assert.equal(applyText(after, record('event_msg', { type: 'task_started' })).thread.plan, null)
})

test('text from the rollout cannot write terminal escapes', () => {
  const { thread } = applyText(
    emptyThread(),
    `${JSON.stringify({ type: 'response_item', payload: { type: 'function_call', name: 'update_plan', arguments: JSON.stringify({ plan: [{ step: 'evil\u001b]52;c;aGk=\u0007\u009b2J', status: 'in_progress' }] }) } })}\n`,
  )
  const drawn = frame({ main: thread, agents: [{ ...emptyThread(), nickname: '\u001b[31mred' }] }, 80, at)
    .map(line => toAnsi(line, true))
    .join('\n')
  assert.ok(!drawn.includes('\u0007') && !drawn.includes('\u009b') && !drawn.includes('\u001b]'))
  assert.ok(drawn.includes('evil]52;c;aGk=2J'))
  assert.ok(!drawn.includes('\u001b[31mred'))
})

test('the cli picks the newest top-level session for the folder and skips closed agents', () => {
  const out = execFileSync(process.execPath, [join(here, '../bin/codex-widgets.mjs'), '--once', '--cwd', '/work/app'], {
    env: { ...process.env, CODEX_HOME: fixtures, COLUMNS: '100' },
    encoding: 'utf8',
  })
  assert.ok(out.includes('Codex main'))
  assert.ok(out.includes('Curie scan_repo'))
  assert.ok(!out.includes('Boyle'))
  assert.ok(!out.includes('\x1b[')) // piped output has no colour codes

  const none = execFileSync(process.execPath, [join(here, '../bin/codex-widgets.mjs'), '--once', '--cwd', '/elsewhere'], {
    env: { ...process.env, CODEX_HOME: fixtures },
    encoding: 'utf8',
  })
  assert.match(none, /Waiting for a Codex session in \/elsewhere/)
})
