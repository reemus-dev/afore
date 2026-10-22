// Citty otherwise emits ANSI control sequences in redirected help output.
if (!process.stdout.isTTY || process.env.TERM === "dumb") {
  process.env.NO_COLOR ??= "1";
}
