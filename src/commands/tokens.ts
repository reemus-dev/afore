import {defineCommand} from "citty";
import Anthropic from "@anthropic-ai/sdk";
import {CliFailure, runSafely, validateArguments} from "../modules/cli.js";
import {resolveModel} from "../modules/models.js";

async function readInput(file: string | undefined): Promise<string> {
  if (!file || file === "-") {
    if (process.stdin.isTTY) {
      throw new CliFailure(
        "No file specified and stdin is a TTY. Provide a file path or pipe input.",
      );
    }
    return Bun.stdin.text();
  }

  const bunFile = Bun.file(file);
  if (!(await bunFile.exists())) {
    throw new CliFailure(`File not found: ${file}`);
  }
  return bunFile.text();
}

export const tokensCommand = defineCommand({
  meta: {
    name: "tokens",
    description: "Count tokens in a file or stdin via the Anthropic API.",
  },
  args: {
    file: {
      type: "positional",
      description: "File path (omit or use - for stdin)",
      required: false,
    },
    model: {
      type: "string",
      description: 'Model alias or ID (default: "opus")',
      alias: ["m"],
      default: "opus",
    },
  },
  async run({args, rawArgs, cmd}) {
    await runSafely(async () => {
      await validateArguments(rawArgs, cmd.args);
      const content = await readInput(args.file);
      if (!content.trim()) {
        console.log("0");
        return;
      }

      const apiKey =
        process.env.AGSES_ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw new CliFailure(
          "Set AGSES_ANTHROPIC_API_KEY or ANTHROPIC_API_KEY to count tokens.",
        );
      }
      const client = new Anthropic({apiKey});
      const {input_tokens} = await client.messages.countTokens({
        model: resolveModel(args.model),
        messages: [{role: "user", content}],
      });
      console.log(String(input_tokens));
    });
  },
});
