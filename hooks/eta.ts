import type { TaskKind, Tracked } from '../types'

/** Past durations (ms) per history key, newest last. */
export type History = Record<string, number[]>

const KEEP = 12
/** Runs shorter than this are not learned (aborted or trivial runs skew the median). */
export const MIN_LEARN_MS = 10_000
const BAR = 10
const DEFAULT_MS: Record<TaskKind, number> = { agent: 180_000, shell: 120_000 }

/** History keys for a shell command: the whole command, then its first two words. */
export const shellKeys = (command: string): string[] => {
  const words = command
    .trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(w => !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) // drop leading FOO=bar
  const whole = words.join(' ').slice(0, 160)
  const head = words.slice(0, 2).join(' ')
  return [`shell:${whole}`, `shell~${head}`, 'shell']
}

export const agentKeys = (type: string): string[] => [`agent:${type}`, 'agent']

export const remember = (history: History, keys: string[], ms: number): History => {
  if (ms < MIN_LEARN_MS) return history
  const next = { ...history }
  for (const key of keys) {
    next[key] = [...(next[key] ?? []), Math.round(ms)].slice(-KEEP)
  }
  return next
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/** Estimated total duration; `isGuess` when no run of this command or type was seen. */
export const estimate = (history: History, task: Tracked): { ms: number; isGuess: boolean } => {
  // Older entries may predate MIN_LEARN_MS.
  const runs = (key: string) => (history[key] ?? []).filter(ms => ms >= MIN_LEARN_MS)
  const [exact, ...rest] = task.keys
  if (runs(exact).length) return { ms: median(runs(exact)), isGuess: false }
  for (const key of rest) {
    if (runs(key).length) return { ms: median(runs(key)), isGuess: true }
  }
  return { ms: DEFAULT_MS[task.kind], isGuess: true }
}

export const clock = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const cut = (text: string, max: number): string => {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1)}…` : one
}

/** `⏳ name bar est detail` */
export const line = (history: History, task: Tracked, now: number): string => {
  const elapsed = now - task.startedAt
  const { ms, isGuess } = estimate(history, task)
  const ratio = elapsed / ms
  const filled = Math.min(BAR, Math.floor(Math.min(ratio, 0.99) * BAR))
  const bar = '█'.repeat(filled) + '░'.repeat(BAR - filled)
  const est = ratio < 1 ? `est ${clock(ms - elapsed)}${isGuess ? '?' : ''}` : `est超過 +${clock(elapsed - ms)}`
  const detail = task.detail ? ` ${cut(task.detail, 36)}` : ''
  return `⏳ ${cut(task.label, 24)} ${bar} ${est}${detail}`
}

const base = (path: string): string => path.split(/[\\/]/).pop() ?? path

/** One short phrase for a tool call: `Bash: npm test`, `Read: eta.ts`. */
export const describeCall = (tool: string, input: Record<string, unknown>): string => {
  const s = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : undefined)
  const what =
    s('command') ??
    (s('file_path') && base(s('file_path')!)) ??
    (s('notebook_path') && base(s('notebook_path')!)) ??
    s('pattern') ??
    s('url') ??
    s('query') ??
    s('description')
  return what ? `${tool}: ${what}` : tool
}

/** One row per running task, oldest first. */
export const statusLines = (history: History, tasks: Tracked[], now: number): string[] =>
  [...tasks].sort((a, b) => a.startedAt - b.startedAt).map(t => line(history, t, now))

/** Reads `<task-id>` and `<status>` out of a task-notification prompt. */
export const parseNotification = (text: string): { id: string; status: string } | undefined => {
  const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(text)?.[1]
  if (!id) return undefined
  const status = /<status>\s*([^<]+?)\s*<\/status>/.exec(text)?.[1] ?? 'completed'
  return { id, status }
}
