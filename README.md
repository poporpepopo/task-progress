# task-progress

A Claude Code mod that shows running subagents and background shells as rows under the prompt:

```
⏳ Build ███░░░░░░░ est 1:20 npm run build
⏳ 調査 █████░░░░░ est 2:05? Read: eta.ts
```

- **est**: the median of past run times for the same command or agent type. A `?` means no exact match was found and a fallback was used.
- **detail**: a shell's command, or the latest tool call a subagent made.
- Runs shorter than 10 seconds are not learned.

## Load it

Add this to `~/.claude/settings.json`:

```json
"env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/Developer/task-progress" }
```

Several folders are separated by `:` on macOS (`;` on Windows).

Or start a single session with `claude --plugin-dir <path>`.

## Check it

```
claude plugin validate .
claude plugin test .
```
