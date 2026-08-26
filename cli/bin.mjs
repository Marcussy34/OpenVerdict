#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("./src/index.ts", import.meta.url));
const tsx = fileURLToPath(
  new URL(
    `../node_modules/.bin/${process.platform === "win32" ? "tsx.cmd" : "tsx"}`,
    import.meta.url,
  ),
);
const child = spawn(tsx, [entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

child.on("error", (error) => {
  console.error(`OPENVERDICT_CLI_LAUNCH_FAILED: ${error.message}`);
  process.exitCode = 1;
});

child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
