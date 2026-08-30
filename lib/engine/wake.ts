import { statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The web process and the three workers share one container (Railway single
// host), so a file timestamp is enough to wake idle workers the moment a
// claim is submitted. Workers poll the database every few seconds only while
// a claim is in flight; between claims they poll slowly and watch this file.
export function wakeFilePath(): string {
  return process.env.OPENVERDICT_WAKE_FILE?.trim() || join(tmpdir(), "openverdict-wake");
}

/** Called after a claim is created. Best effort: a failure only delays the workers. */
export function touchWake(): void {
  try {
    const path = wakeFilePath();
    const now = new Date();
    try {
      utimesSync(path, now, now);
    } catch {
      writeFileSync(path, "");
    }
  } catch {
    // Read-only filesystem or missing tmpdir: the slow poll still picks the claim up.
  }
}

/** Modification time of the wake file in ms (0 when it does not exist). */
export function wakeStamp(): number {
  try {
    return statSync(wakeFilePath()).mtimeMs;
  } catch {
    return 0;
  }
}
