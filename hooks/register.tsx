import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Tracked } from '../types'
import {
  agentKeys,
  describeCall,
  parseNotification,
  remember,
  shellKeys,
  statusLines,
  type History,
} from './eta'

const tasks = atom({ plugin: 'task-progress', key: 'tasks' } as const, [] as Tracked[])
/** The time the rows are drawn at; ticking it redraws them while anything runs. */
const clockNow = atom({ plugin: 'task-progress', key: 'now' } as const, 0)

const ACTIVE = new Set(['pending', 'running', 'waiting'])
const STALE_MS = 12 * 3600_000
/** An agent from agent.spawn may not be listed yet; give it this long. */
const LIST_GRACE_MS = 5_000

let history: History | undefined

async function loadHistory($: EngineInterface): Promise<History> {
  history ??= ((await $.store.get('history')) as History | undefined) ?? {}
  return history
}

async function track($: EngineInterface, task: Tracked) {
  await update($, tasks, list => (list.some(t => t.id === task.id) ? list : [...list, task]))
}

async function finish($: EngineInterface, id: string, status: string, now: number) {
  const task = (await read($, tasks)).find(t => t.id === id)
  if (!task) return
  await update($, tasks, list => list.filter(t => t.id !== id))
  if (status === 'completed') {
    history = remember(await loadHistory($), task.keys, now - task.startedAt)
    await $.store.set('history', history)
  }
}

async function draw($: EngineInterface) {
  if ((await read($, tasks)).length === 0) return
  const now = await $.clock.now()
  await update($, clockNow, () => now)
}

async function tick($: EngineInterface) {
  const now = await $.clock.now()
  const agents = await $.agent.list()
  const byId = new Map(agents.map(a => [a.id, a]))

  for (const t of await read($, tasks)) {
    if (t.kind === 'agent') {
      const a = byId.get(t.id)
      if (a && !ACTIVE.has(a.status)) await finish($, t.id, a.status, now)
      else if (!a && now - t.startedAt > LIST_GRACE_MS) await finish($, t.id, 'gone', now)
    } else if (now - t.startedAt > STALE_MS) {
      await finish($, t.id, 'stale', now)
    }
  }

  // Agents started before this mod loaded, or by a path agent.spawn did not see.
  const known = new Set((await read($, tasks)).map(t => t.id))
  for (const a of agents) {
    if (ACTIVE.has(a.status) && !known.has(a.id)) {
      await track($, {
        id: a.id,
        kind: 'agent',
        label: a.description || a.type,
        keys: agentKeys(a.type),
        startedAt: now,
      })
    }
  }

  await draw($)
}

/** Tracks a shell call that ended up in the background. */
async function trackShell(
  $: EngineInterface,
  call: { command: string; description?: string },
  ran: { deny?: string; isError?: boolean; result?: unknown },
  startedAt: number,
) {
  if (ran.deny !== undefined || ran.isError) return
  const id = (ran.result as { backgroundTaskId?: string } | undefined)?.backgroundTaskId
  if (!id) return
  await track($, {
    id,
    kind: 'shell',
    label: call.description || call.command,
    keys: shellKeys(call.command),
    startedAt,
    detail: call.description ? call.command : undefined,
  })
  await draw($)
}

/** Notes a subagent's latest tool call as its detail. */
async function noteCall($: EngineInterface, agentId: string, detail: string) {
  if (!(await read($, tasks)).some(t => t.id === agentId)) return
  await update($, tasks, list => list.map(t => (t.id === agentId ? { ...t, detail } : t)))
}

/** A hook whose bookkeeping failed hands the event on untouched. */
const passThrough = <E, R>(_$: unknown, e: E, next: (e: E) => Promise<R>) => next(e)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.ui.status(undefined) // clears the line earlier versions pinned
    // One-time wipe of the runs learned while the mod was being demoed.
    if ((await $.store.get('demoReset')) !== true) {
      await $.store.delete('history')
      await $.store.set('demoReset', true)
    }
    await loadHistory($)
    $.clock.every(1000, () => {
      tick($).catch(() => {})
    })
    return result
  })

  on('agent.spawn', async ($, e, next) => {
    const startedAt = await $.clock.now()
    const spawned = await next(e)
    if (spawned.deny === undefined && spawned.agentId) {
      await track($, {
        id: spawned.agentId,
        kind: 'agent',
        label: e.description || e.subagentType,
        keys: agentKeys(e.subagentType),
        startedAt,
      })
      await draw($)
    }
    return spawned
  }).catch(passThrough)

  on('tool.call', async ($, e, next) => {
    if (e.agentId) {
      const { tool, agentId, tool_use_id: _id, ...input } = e as typeof e & Record<string, unknown>
      await noteCall($, agentId, describeCall(tool, input)).catch(() => {})
    }
    return next(e)
  }).catch(passThrough)

  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const startedAt = await $.clock.now()
    const ran = await next(e)
    await trackShell($, e, ran, startedAt).catch(() => {})
    return ran
  }).catch(passThrough)

  on('tool.call', { tool: 'TaskStop' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined && !ran.isError) {
      await finish($, ran.result.task_id, 'killed', await $.clock.now())
      await draw($)
    }
    return ran
  }).catch(passThrough)

  on('prompt.submit', async ($, e, next) => {
    const done = e.origin.kind === 'task-notification' ? parseNotification(e.text) : undefined
    if (done) {
      await finish($, done.id, done.status, await $.clock.now())
      await draw($)
    }
    return next(e)
  }).catch(passThrough)

  // Under the prompt: the engine's hint line, then one row per running task.
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const list = await read($, tasks)
    const now = await read($, clockNow)
    const hint = await next(e)
    if (list.length === 0) return hint

    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {hint}
        {statusLines(history ?? {}, list, Math.max(now, ...list.map(t => t.startedAt))).map((row, i) => (
          <Text key={`task-${i}`} wrap="truncate-end">
            {row}
          </Text>
        ))}
      </Box>
    )
  })
}
