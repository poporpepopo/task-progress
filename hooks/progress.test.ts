import { expect, mock, test } from 'claude-code/testing'

import { describeCall, estimate, parseNotification, remember, shellKeys, statusLines } from './eta'
import type { Tracked } from '../types'

const shell = (command: string, startedAt = 0): Tracked => ({
  id: 'b1',
  kind: 'shell',
  label: command,
  keys: shellKeys(command),
  startedAt,
})

test('estimate is the median of past runs of the same command', () => {
  let h = {}
  for (const ms of [50_000, 60_000, 70_000]) h = remember(h, shellKeys('npm test'), ms)
  expect(estimate(h, shell('npm test'))).toEqual({ ms: 60_000, isGuess: false })
  // Same first two words, different args: falls back, flagged as a guess.
  expect(estimate(h, shell('npm test -- --watch=false'))).toEqual({ ms: 60_000, isGuess: true })
})

test('status line reads hourglass, name, bar, est, detail', () => {
  const h = remember({}, shellKeys('npm test'), 100_000)
  const [text] = statusLines(h, [shell('npm test')], 40_000)
  expect(text).toBe('⏳ npm test ████░░░░░░ est 1:00')
})

test('an overrun says so instead of a negative est', () => {
  const h = remember({}, shellKeys('make'), 10_000)
  expect(statusLines(h, [shell('make')], 25_000)[0]).toContain('est超過 +0:15')
})

test('runs under 10s are not learned, old ones are ignored', () => {
  const keys = shellKeys('make')
  expect(remember({}, keys, 4_000)).toEqual({})
  const old = { [keys[0]]: [4_000, 6_000] }
  expect(estimate(old, shell('make'))).toEqual({ ms: 120_000, isGuess: true })
})

test('task notifications are parsed', () => {
  const text =
    '<task-notification>\n<task-id>bx81k</task-id>\n<status>failed</status>\n<summary>x</summary>\n</task-notification>'
  expect(parseNotification(text)).toEqual({ id: 'bx81k', status: 'failed' })
  expect(parseNotification('hello')).toBeUndefined()
})

test('each background task is its own row under the hint line', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on)
  on('ui.status', () => ({ value: undefined }) as never)
  on('agent.list', () => ({ value: [] }) as never)
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, { dimColor: true }, '? for shortcuts')
  })
  let n = 0
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: `b${++n}` },
  }))

  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Bash', command: 'npm run build', description: 'Build', run_in_background: true })
  await $.tool.call({ tool: 'Bash', command: 'npm test', description: 'Test', run_in_background: true })
  await clock.advance(1000)

  const ui = await $.ui.mount({
    plugin: 'task-progress',
    surface: 'terminal',
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  })
  const rows = (await ui.findAll({ type: 'Text' })).map(t => t.text)
  expect(rows).toEqual([
    '? for shortcuts',
    '⏳ Build ░░░░░░░░░░ est 1:59? npm run build',
    '⏳ Test ░░░░░░░░░░ est 1:59? npm test',
  ])
  expect(rows.some(r => r.includes('task-progress'))).toBe(false)
})

test('a subagent call reads as tool and target', () => {
  expect(describeCall('Read', { file_path: 'C:\\a\\b\\eta.ts' })).toBe('Read: eta.ts')
  expect(describeCall('Grep', { pattern: 'TODO' })).toBe('Grep: TODO')
  expect(describeCall('TodoWrite', {})).toBe('TodoWrite')
})
