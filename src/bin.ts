#!/usr/bin/env node
/** Entry point: forwards the process arguments to run() and sets the exit code. */
import { run } from "./cli.js";

process.exitCode = await run(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
});
