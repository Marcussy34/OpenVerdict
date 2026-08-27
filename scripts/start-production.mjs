#!/usr/bin/env node
/**
 * Production launcher (Railway): one service running the Next.js observer and
 * the three engine workers. If any child dies, the whole service exits so the
 * platform restarts it atomically.
 */
import { spawn } from "node:child_process";

const children = new Map();
let shuttingDown = false;

function launch(name, command, args) {
  const child = spawn(command, args, { stdio: "inherit", env: process.env });
  children.set(name, child);
  child.on("exit", (code, signal) => {
    children.delete(name);
    if (shuttingDown) return;
    console.error(`[start-production] ${name} exited (code=${code} signal=${signal}); stopping service`);
    shutdown(code ?? 1);
  });
  console.log(`[start-production] launched ${name} (pid ${child.pid})`);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const [name, child] of children) {
    console.log(`[start-production] stopping ${name}`);
    child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(code), 8_000).unref();
  if (children.size === 0) process.exit(code);
}

process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

launch("web", "node", ["node_modules/next/dist/bin/next", "start", "-p", process.env.PORT ?? "3000"]);
launch("evidence-worker", "node", ["node_modules/tsx/dist/cli.mjs", "workers/evidence-worker.ts"]);
launch("inference-worker", "node", ["node_modules/tsx/dist/cli.mjs", "workers/inference-worker.ts"]);
launch("resolution-worker", "node", ["node_modules/tsx/dist/cli.mjs", "workers/resolution-worker.ts"]);
