import {defineCommand} from "citty";
import {CliFailure, runSafely, validateArguments} from "../modules/cli.js";
import {
  discoverProjects,
  type SessionRecord,
  sessionsOf,
} from "../modules/discovery.js";
import type {MessageEvent, SessionEvent} from "../modules/events.js";
import {
  formatFrontmatter,
  formatMessage,
  printJson,
} from "../modules/format.js";
import {
  readSessionEvents,
  readSubagentEvents,
  readSubagents,
  resolveProject,
  sessionFrontmatter,
  type SubagentRecord,
} from "../modules/sessions.js";

type SearchWindow = {
  session: SessionRecord;
  subagent: SubagentRecord | null;
  messages: Array<MessageEvent & {match: boolean}>;
};

function parseContext(value: string): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new CliFailure("--context must be a non-negative integer.");
  }
  return count;
}

function createMatcher(
  query: string,
  regex: boolean,
  caseSensitive: boolean,
): (text: string) => boolean {
  if (!query) throw new CliFailure("Search query cannot be empty.");

  if (regex) {
    let expression: RegExp;
    try {
      expression = new RegExp(query, caseSensitive ? "" : "i");
    } catch (error) {
      throw new CliFailure(
        error instanceof Error
          ? error.message
          : `Invalid regular expression: ${query}`,
      );
    }
    return (text) => expression.test(text);
  }

  const needle = caseSensitive ? query : query.toLocaleLowerCase();
  return (text) =>
    (caseSensitive ? text : text.toLocaleLowerCase()).includes(needle);
}

/** Merge ±context ranges around matches into non-overlapping windows */
function coalesceWindows(matches: number[], count: number, context: number) {
  const windows: Array<{start: number; end: number}> = [];
  for (const index of matches) {
    const start = Math.max(0, index - context);
    const end = Math.min(count - 1, index + context);
    const previous = windows.at(-1);
    if (previous && start <= previous.end + 1)
      previous.end = Math.max(previous.end, end);
    else windows.push({start, end});
  }
  return windows;
}

function formatWindow(window: SearchWindow): string {
  const messages = window.messages.map(({match, ...message}) =>
    formatMessage(message, match ? {match} : {}),
  );
  return [
    formatFrontmatter(sessionFrontmatter(window.session, window.subagent)),
    ...messages,
  ].join("\n\n");
}

export const searchCommand = defineCommand({
  meta: {
    name: "search",
    description: "Search user and assistant message text across sessions.",
  },
  args: {
    query: {
      type: "positional",
      description: "Substring or JavaScript regular expression",
      required: true,
    },
    project: {
      type: "string",
      description: "Project path or unique cwd substring (defaults to cwd)",
      alias: ["p"],
    },
    all: {
      type: "boolean",
      description: "Search all discovered projects",
      alias: ["a"],
      default: false,
    },
    role: {
      type: "enum",
      description: "Message role",
      alias: ["r"],
      options: ["user", "assistant", "both"] as const,
      default: "both",
    },
    context: {
      type: "string",
      description: "Adjacent messages on each side",
      alias: ["c"],
      default: "0",
      valueHint: "count",
    },
    regex: {
      type: "boolean",
      description: "Interpret query as a JavaScript regular expression",
      alias: ["R"],
      default: false,
    },
    caseSensitive: {
      type: "boolean",
      description: "Match case sensitively",
      alias: ["C"],
      default: false,
    },
    subagents: {
      type: "boolean",
      description: "Also search each session's subagent threads",
      alias: ["s"],
      default: false,
    },
    format: {
      type: "enum",
      description: "Output format",
      alias: ["f"],
      options: ["text", "json"] as const,
      default: "text",
    },
  },
  async run({args, rawArgs, cmd}) {
    await runSafely(async () => {
      await validateArguments(rawArgs, cmd.args);
      const context = parseContext(args.context);
      const matcher = createMatcher(args.query, args.regex, args.caseSensitive);
      if (args.all && args.project !== undefined) {
        throw new CliFailure("--project and --all are mutually exclusive.");
      }

      const projects = await discoverProjects();
      const sessions = sessionsOf(
        args.all ? projects : [resolveProject(projects, args.project)],
      );
      const windows: SearchWindow[] = [];

      for (const session of sessions) {
        let threads: Array<{
          subagent: SubagentRecord | null;
          events: SessionEvent[];
        }>;
        try {
          const subagents = await readSubagents(session);
          threads = [
            {
              subagent: null,
              events: await readSessionEvents(session, subagents),
            },
          ];
          if (args.subagents) {
            for (const subagent of subagents) {
              threads.push({
                subagent,
                events: await readSubagentEvents(session, subagents, subagent),
              });
            }
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          process.stderr.write(
            `Warning: skipped unreadable session ${session.id}: ${message}\n`,
          );
          continue;
        }

        for (const {subagent, events} of threads) {
          const messages = events.filter(
            (event): event is MessageEvent => event.kind === "message",
          );
          const matches = new Set<number>();
          for (const [index, message] of messages.entries()) {
            if (
              (args.role === "both" || message.role === args.role) &&
              matcher(message.text)
            ) {
              matches.add(index);
            }
          }
          for (const {start, end} of coalesceWindows(
            [...matches],
            messages.length,
            context,
          )) {
            windows.push({
              session,
              subagent,
              messages: messages
                .slice(start, end + 1)
                .map((message, offset) => ({
                  ...message,
                  match: matches.has(start + offset),
                })),
            });
          }
        }
      }

      if (args.format === "json") {
        printJson({
          query: args.query,
          role: args.role,
          context,
          regex: args.regex,
          caseSensitive: args.caseSensitive,
          matches: windows,
        });
        return;
      }

      if (windows.length > 0) {
        process.stdout.write(`${windows.map(formatWindow).join("\n\n")}\n`);
      }
    });
  },
});
