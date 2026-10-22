import {shortenPath} from "./format.js";

export function stringArgument(
  input: Record<string, unknown>,
  ...names: string[]
) {
  for (const name of names) {
    const value = input[name];
    if (typeof value === "string" && value.trim()) return value;
  }
}

function readRange({offset, limit}: Record<string, unknown>): string {
  if (typeof offset !== "number" && typeof limit !== "number") return "";
  const start = Number(offset ?? 1);
  return typeof limit === "number"
    ? `:${start}-${start + limit - 1}`
    : `:${start}`;
}

export function previewToolCall(
  name: string,
  input: Record<string, unknown>,
): string {
  const filePath = stringArgument(input, "file_path", "notebook_path", "path");

  switch (name) {
    case "Read": {
      return `${shortenPath(filePath ?? "(unknown path)")}${readRange(input)}`;
    }
    case "Grep":
    case "Glob": {
      return `${stringArgument(input, "pattern") ?? ""} in ${shortenPath(filePath ?? ".")}`;
    }
    case "Agent":
    case "Task": {
      const type = stringArgument(input, "subagent_type");
      const description = stringArgument(input, "description", "prompt") ?? "";
      return type ? `[${type}] ${description}` : description;
    }
    case "Workflow": {
      const scriptPath = stringArgument(input, "scriptPath");
      if (scriptPath) return shortenPath(scriptPath);
      return stringArgument(input, "name") ?? "(inline script)";
    }
  }

  const primary = stringArgument(
    input,
    "command",
    "url",
    "query",
    "skill",
    "description",
    "prompt",
    "message",
  );
  if (primary) return primary;
  if (filePath) return shortenPath(filePath);

  const names = Object.keys(input).toSorted();
  return names.length === 0 ? "(no arguments)" : `args: ${names.join(", ")}`;
}
