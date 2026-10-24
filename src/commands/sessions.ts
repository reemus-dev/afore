import {defineCommand} from "citty";
import {
  CliFailure,
  parsePositiveInteger,
  runSafely,
  validateArguments,
} from "../modules/cli.js";
import {discoverProjects, sessionsOf} from "../modules/discovery.js";
import {
  formatDateTime,
  formatPreview,
  formatSize,
  formatTable,
  outputWidth,
  printJson,
} from "../modules/format.js";
import {resolveProject} from "../modules/sessions.js";

export const sessionsCommand = defineCommand({
  meta: {
    name: "sessions",
    description:
      "List sessions for a resolved Claude Code project or all projects.",
  },
  args: {
    project: {
      type: "string",
      description: "Project path or unique cwd substring",
      alias: ["p"],
    },
    all: {
      type: "boolean",
      description: "List sessions across all projects",
      alias: ["a"],
      default: false,
    },
    limit: {
      type: "string",
      description: "Show at most this many sessions",
      valueHint: "count",
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
      if (args.all && args.project !== undefined) {
        throw new CliFailure("--project and --all are mutually exclusive.");
      }
      const limit =
        args.limit === undefined
          ? undefined
          : parsePositiveInteger(args.limit, "--limit");
      const projects = await discoverProjects();
      const sessions = sessionsOf(
        args.all ? projects : [resolveProject(projects, args.project)],
      ).slice(0, limit);

      if (args.format === "json") {
        printJson({sessions});
        return;
      }

      // Across projects, the project path takes the room of the creation
      // time and first prompt
      const width = outputWidth();
      const includeProject = args.all;
      const includeTitle = width >= 25;
      const includeLastActivity = width >= 45;
      const includeSize = width >= 60;
      const includeCreated = !args.all && width >= 80;
      const includeFirstPrompt = !args.all && width >= 110;
      const headers = [
        "Hex ID",
        ...(includeTitle ? ["Title"] : []),
        ...(includeProject ? ["Project"] : []),
        ...(includeCreated ? ["Created"] : []),
        ...(includeLastActivity ? ["Last activity"] : []),
        ...(includeSize ? ["Size"] : []),
        ...(includeFirstPrompt ? ["First prompt"] : []),
      ];
      const rows = sessions.map((session) => [
        session.hexId,
        ...(includeTitle ? [formatPreview(session.title)] : []),
        ...(includeProject ? [session.project] : []),
        ...(includeCreated ? [formatDateTime(session.created)] : []),
        ...(includeLastActivity ? [formatDateTime(session.lastActivity)] : []),
        ...(includeSize ? [formatSize(session.size)] : []),
        ...(includeFirstPrompt
          ? [formatPreview(session.firstPrompt ?? "-")]
          : []),
      ]);
      const flexibleColumns = ["Title", "Project", "First prompt"]
        .map((header) => headers.indexOf(header))
        .filter((index) => index !== -1);
      process.stdout.write(
        `${formatTable(headers, rows, {flexibleColumns, maximumWidth: width})}\n`,
      );
    });
  },
});
