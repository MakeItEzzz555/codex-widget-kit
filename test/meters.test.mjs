import assert from 'node:assert/strict'
import { test } from 'node:test'

import { contextLeft, formatEta, nextPlan, remainingMs, ringCells, shortModel } from '../lib/meters.mjs'

const MIN = 60_000
const tasks = (done, total) =>
  Array.from({ length: total }, (_, i) => ({ id: `t${i}`, status: i < done ? 'completed' : 'pending' }))

test('the estimate follows the pace of finished tasks and counts down', () => {
  let plan = nextPlan(null, tasks(0, 4), 0)
  assert.equal(remainingMs(plan, 0), null)

  plan = nextPlan(plan, tasks(1, 4), 2 * MIN) // 2 min per task, 3 left
  assert.equal(remainingMs(plan, 2 * MIN), 6 * MIN)
  assert.equal(formatEta(remainingMs(plan, 3 * MIN)), 'est. 5 min')
  assert.equal(formatEta(90 * MIN), 'est. 1 h 30 min')

  plan = nextPlan(plan, tasks(4, 4), 9 * MIN)
  assert.equal(nextPlan(plan, tasks(0, 2), 12 * MIN).startedAt, 12 * MIN) // a finished plan restarts
})

test("a ring lights the remaining share clockwise from 12 o'clock", () => {
  const rows = ringCells(25, '25%')
  const lit = (row, col) => rows[row][col].color !== 0x5c5c5c
  assert.equal(lit(0, 7), true) // top right: inside the first quarter
  assert.equal(lit(4, 2), false) // bottom left: used
  assert.equal(rows[2][3].char, '2')
})

test('context left matches Codex: a 12k baseline is left out of both sides', () => {
  assert.equal(contextLeft(12_000, 475_000), 100)
  assert.equal(contextLeft(180_978, 475_000), 64) // recorded: Codex showed 64% left
  assert.equal(contextLeft(500_000, 475_000), 0)
  assert.equal(contextLeft(1, 10_000), 0)
})

test('a dated model id loses its date', () => {
  assert.equal(shortModel('gpt-6.1-sol-2026-08-01'), 'gpt-6.1-sol')
  assert.equal(shortModel('gpt-6.1-sol'), 'gpt-6.1-sol')
})
