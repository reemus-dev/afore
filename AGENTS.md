# agses

`agses` is a Bun CLI that finds, outlines, reads and searches persisted Claude
Code sessions. It publishes its TypeScript source to npm and runs it with Bun
1.3.7 or later.

Read `README.md` for the user contract.

## Where to work

| Area                       | Responsibility                                              |
| -------------------------- | ----------------------------------------------------------- |
| `src/index.ts`             | Entry, command tree, usage guide and shell completion       |
| `src/commands/`            | One citty command per file, parsing and output              |
| `src/modules/sessions.ts`  | Discovery, session and subagent resolution, transcript I/O  |
| `src/modules/events.ts`    | Projecting a thread's entries into numbered events          |
| `src/modules/previews.ts`  | One-line previews of tool calls                             |
| `src/modules/workflows.ts` | Workflow runs from Workflow calls, journals and snapshots   |
| `src/modules/format.ts`    | Text tables, paths, sizes and dates                         |
| `src/modules/cli.ts`       | Failures, strict argument validation and `--first`/`--last` |

## Design constraints

- Read only. Never write to the Claude Code config directory.
- Resolve the config directory from `CLAUDE_CONFIG_DIR`, as Claude Code and the
  Agent SDK do, and fall back to `~/.claude`.
- The Agent SDK lists sessions and selects a thread's branch. `agses` hands it
  relinked entries through an in-memory session store, so the thread spans every
  compaction. A session continued in a new transcript reads the old transcript
  first.
- `#N` refs number every event, extras included, so a ref holds with or without
  `--extra`.
- Only `tokens` uses the network. It requires `AGSES_ANTHROPIC_API_KEY` or, as a
  fallback, `ANTHROPIC_API_KEY`.

## Development

Install the locked toolchain with `mise install`. `.mise.toml` is the authority
for commands and tool versions. Run the complete gate with:

```sh
mise run check
```

Run from source with `bun src/index.ts <command>`.
