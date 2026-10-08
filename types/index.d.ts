export type TaskKind = 'agent' | 'shell'

export type Tracked = {
  id: string
  kind: TaskKind
  label: string
  /** History keys, most specific first. */
  keys: string[]
  startedAt: number
  /** What it is doing: a shell's command, a subagent's latest tool call. */
  detail?: string
}

declare module 'claude-code' {
  interface PluginState {
    'task-progress': { tasks: Tracked[]; now: number }
  }
}
