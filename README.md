# afore

[![CI](https://github.com/reemus-dev/afore/actions/workflows/ci.yml/badge.svg)](https://github.com/reemus-dev/afore/actions/workflows/ci.yml)

Find, outline, read and search Claude Code sessions from your terminal.

- List projects and sessions, newest activity first
- Outline a session as numbered events, then read any event in full
- Read across every compaction, not just the context since the last one
- Follow subagent threads and workflow runs from the parent session
- Search message text across one project or all of them
- Get JSON output from every session command

`afore` reads the full transcripts that Claude Code already saves, exactly as
recorded, with no index to build or keep current. It is made for agents that
need to recover earlier work. It is not a memory system or an index.

## Contents

- [Installation](#installation)
- [Usage](#usage)
  - [Session selection](#session-selection)
  - [Subagents and workflow runs](#subagents-and-workflow-runs)
- [How it works](#how-it-works)
- [Privacy](#privacy)
- [Development](#development)
- [License](#license)

## Installation

<!-- prettier-ignore -->
> [!NOTE]
> `afore` requires [Bun](https://bun.sh/) 1.3.7 or later.

```sh
bun add -g @reemus/afore
```

Or run it without installing:

```sh
bunx @reemus/afore sessions
```

Shell completion is available for bash, zsh, fish and PowerShell:

```sh
source <(afore complete bash)
```

## Usage

```sh
afore projects
afore sessions [--project PATH_OR_QUERY | --all] [--limit N]
afore outline [SESSION] [--subagent ID] [--first N | --last N] [--no-tools] [--extra]
afore read [SESSION] [--subagent ID] [--role user|assistant|both] [--no-tools] [--extra] [--first N | --last N] [--entry N] [--tokens N]
afore search QUERY [--project PATH_OR_QUERY | --all] [--role user|assistant|both] [--subagents] [--context N] [--regex] [--case-sensitive]
afore workflows [SESSION] [--run ID|REF]
afore tokens [FILE] [--model opus|sonnet|haiku|ID]
```

A typical recovery starts with an outline, then reads the events that matter:

```sh
afore sessions --all --limit 20                # find the session
afore outline SESSION --last 40                # numbered events, newest last
afore read SESSION --entry 20                  # one event in full
afore read SESSION --no-tools --tokens 80000   # recent conversation within a token budget
afore search "query" --all --context 1         # matches with one message either side
```

- Every session command accepts `--format text|json`.
- `#N` refs in an outline number every event, including the attachment, meta and
  system entries that only `--extra` shows. A ref is the same with or without
  `--extra`. Pass it to `read --entry N`.
- `tokens` counts the tokens in a file, or stdin, for a model.
- Run `afore --help` for the guide, and `afore <command> --help` for every
  option.

### Session selection

Projects are the working directories that sessions recorded. `--project` takes
an exact path or a unique substring. Without it, `afore` uses the closest
project that contains the current directory.

`SESSION` resolves within that project, in this order:

1. A `.jsonl` path selects that session by file name. It must belong to
   `--project` when given.
2. Exactly 14 hex characters are a Hex ID, as `sessions` shows it, with no
   fallback to the other forms.
3. An exact session UUID.
4. An exact title, case-insensitive.
5. An unambiguous UUID prefix.

Without `--project`, a `SESSION` with no match in the current directory's
project, or given outside any project, resolves across all projects by the same
rules. An ambiguous match across projects fails and lists each candidate's
project. Pick one with `--project` or its Hex ID.

Omit `SESSION` to use the most recently active session of the project.

### Subagents and workflow runs

Outline rows that spawn, message or report back from a subagent show
`@SUBAGENT_ID`. Workflow calls and their task notifications show `@wf_RUN_ID`.

```sh
afore outline SESSION --subagent SUBAGENT_ID
afore read SESSION --subagent SUBAGENT_ID --entry 12
afore search "query" --subagents
afore workflows SESSION
afore workflows SESSION --run RUN_ID
```

- `--subagent` takes the id, a unique prefix (`@` optional), or the ref of a row
  that shows it (`131`). The subagent's thread has its own `#N` refs.
- `--run` takes a run id, a unique prefix (`wf_` optional), or the ref of a
  linked row (`40`), and shows the run's agents by phase.
- An all-digit value is always a ref.

## How it works

`afore` reads `$CLAUDE_CONFIG_DIR/projects`, or `~/.claude/projects` when
`CLAUDE_CONFIG_DIR` is not set. It never starts a model session.

Session lists and metadata come from the Claude Agent SDK (`listSessions`). For
events, `afore` reads the transcript JSONL and hands it to `getSessionMessages`
through an in-memory session store. It re-parents each compaction boundary onto
the history before it, so the SDK's branch selection resolves the whole main
thread instead of stopping at the last compaction.

- **Projects** are the recorded session working directories (`cwd`). A session
  started in a git worktree belongs to the worktree path.
- **Events** are user and assistant text, compaction summaries, and tool calls
  on the main thread, plus extras: attachments (hook output, file and reminder
  context), plugin and meta messages, system entries, and harness noise
  (interruptions, slash-command output, reminder-only turns). Extras are hidden
  unless `--extra` is given. Thinking is dropped. Tool results attach to their
  call.
- **Subagents** each keep one transcript,
  `<session>/subagents/agent-<id>.jsonl`, across every continuation. Its
  `.meta.json` names the Agent call that spawned it. On the parent thread, that
  call, `SendMessage` calls to the subagent, and its hand-backs and task
  notifications show `@<id>`. A fork's thread starts at its spawning call,
  skipping the parent history its transcript copies. Workflow agents are
  subagents under `<session>/subagents/workflows/<runId>/`. Their `.meta.json`
  names the workflow phase instead of a spawning call.
- **Workflow runs** start from a Workflow call. Its result names the run and the
  launch's task, and the call and the launch's task notification show
  `@<runId>`. A resume reuses the run under a new task. The run's journal
  (`journal.jsonl` beside its agents) records each agent's start and outcome as
  it runs. The snapshot `<session>/workflows/<runId>.json` adds status, usage
  and errors when a launch settles. It only counts while it records the latest
  launch. Until then, the latest launch's notification gives the status, or it
  is `unknown`.

## Privacy

- `afore` is read-only. It never writes to the Claude Code config directory.
- Everything runs locally, except `tokens`. It sends its input to Anthropic's
  token-counting API and needs `AFORE_ANTHROPIC_API_KEY` or `ANTHROPIC_API_KEY`,
  in that order. Claude Code can use `ANTHROPIC_API_KEY` in place of your
  subscription login, so export `AFORE_ANTHROPIC_API_KEY` to make the key
  available in every shell.

## Development

Requires [Mise](https://mise.jdx.dev/).

```sh
mise install
mise run check
```

Run from source with `bun src/index.ts <command>`.

## License

[MIT](LICENSE)
