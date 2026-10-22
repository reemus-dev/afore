import type {CommandDef} from "citty";

export class CliFailure extends Error {
  override name = "CliFailure";
}

export async function runSafely(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error: ${message}\n`);
    process.exitCode = 1;
  }
}

export function parsePositiveInteger(value: string, option: string): number {
  const count = Number(value);
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(count)) {
    throw new CliFailure(`${option} must be a positive integer.`);
  }
  return count;
}

/**
 * Keep the leading `--first` or trailing `--last` items; at most one may be
 * given
 */
export function selectWindow<T>(
  items: T[],
  first: string | undefined,
  last: string | undefined,
): {selected: T[]; omittedBefore: number; omittedAfter: number} {
  if (first !== undefined && last !== undefined) {
    throw new CliFailure("--first and --last are mutually exclusive.");
  }
  const start =
    last === undefined
      ? 0
      : Math.max(0, items.length - parsePositiveInteger(last, "--last"));
  const end =
    first === undefined
      ? items.length
      : Math.min(items.length, parsePositiveInteger(first, "--first"));
  return {
    selected: items.slice(start, end),
    omittedBefore: start,
    omittedAfter: items.length - end,
  };
}

/** Whether each option name and alias takes a value, and the positional count */
async function describeArguments(commandArgs: CommandDef["args"]): Promise<{
  takesValueByName: Map<string, boolean>;
  maximumPositionals: number;
}> {
  const definitions =
    (await (typeof commandArgs === "function" ? commandArgs() : commandArgs)) ??
    {};
  const takesValueByName = new Map<string, boolean>();
  let maximumPositionals = 0;
  for (const [name, option] of Object.entries(definitions)) {
    if (option.type === "positional") {
      maximumPositionals++;
      continue;
    }
    const kebabName = name
      .replaceAll(/([a-z\d])([A-Z])/g, "$1-$2")
      .toLowerCase();
    const aliases = "alias" in option ? (option.alias ?? []) : [];
    for (const alias of [
      name,
      kebabName,
      ...(Array.isArray(aliases) ? aliases : [aliases]),
    ]) {
      takesValueByName.set(alias, option.type !== "boolean");
    }
  }
  return {takesValueByName, maximumPositionals};
}

/** Citty ignores unknown options and extra positionals; reject them instead */
export async function validateArguments(
  rawArguments: string[],
  commandArgs: CommandDef["args"],
): Promise<void> {
  const {takesValueByName, maximumPositionals} =
    await describeArguments(commandArgs);

  let positionals = 0;
  for (let index = 0; index < rawArguments.length; index++) {
    const argument = rawArguments[index]!;
    if (argument === "--") {
      positionals += rawArguments.length - index - 1;
      break;
    }
    if (!argument.startsWith("-") || argument === "-") {
      positionals++;
      continue;
    }

    const separatorIndex = argument.indexOf("=");
    const optionName = argument.slice(
      argument.startsWith("--") ? 2 : 1,
      separatorIndex === -1 ? undefined : separatorIndex,
    );
    const negated = optionName.startsWith("no-");
    const takesValue = takesValueByName.get(
      negated ? optionName.slice(3) : optionName,
    );
    if (takesValue === undefined || (negated && takesValue)) {
      throw new CliFailure(`Unknown option: ${argument}`);
    }
    if (takesValue && separatorIndex === -1) {
      if (rawArguments[index + 1] === undefined) {
        throw new CliFailure(`Option ${argument} requires a value.`);
      }
      index++;
    }
  }

  if (positionals > maximumPositionals) {
    throw new CliFailure("Too many positional arguments.");
  }
}
