#!/usr/bin/env node
/**
 * Production launcher (Railway): one service running the Next.js observer and
 * the three engine workers. If any child dies, the whole service exits so the
 * platform restarts it atomically.
 */
import { spawn } from "node:child_process";

const children = new Map();
let shuttingDown = false;

function launch(name, command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    // Per-process overrides only when the deployment has not set them itself.
    env: { ...env, ...process.env },
  });
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

// Each process pins a distinct operator gas coin and takes its own tick lock,
// so an approval, a draw and a Walrus archive no longer queue behind one
// another. Run `pnpm walrus:writers --fund --split-gas 3` first: a slot past
// the coins that exist simply falls back to the shared behaviour.
const workerEnv = (slot, lockName) => ({
  OPENVERDICT_OPERATOR_GAS_SLOT: String(slot),
  OPENVERDICT_TICK_LOCK_NAME: lockName,
});

// OPENVERDICT_ROLE=workers runs only the three engine workers (Railway), the
// website stays on Vercel; any other value keeps the original all-in-one shape.
if (process.env.OPENVERDICT_ROLE !== "workers") {
  launch(
    "web",
    "node",
    ["node_modules/next/dist/bin/next", "start", "-p", process.env.PORT ?? "3000"],
    { OPENVERDICT_OPERATOR_GAS_SLOT: "3" },
  );
}
launch("evidence-worker", "node", ["node_modules/tsx/dist/cli.mjs", "workers/evidence-worker.ts"], workerEnv(0, "evidence-worker"));
launch("inference-worker", "node", ["node_modules/tsx/dist/cli.mjs", "workers/inference-worker.ts"], workerEnv(1, "inference-worker"));
launch("resolution-worker", "node", ["node_modules/tsx/dist/cli.mjs", "workers/resolution-worker.ts"], workerEnv(2, "resolution-worker"));
