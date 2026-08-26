import { PGlite } from "@electric-sql/pglite";
import { Pool } from "pg";

export type DbHandle = PGlite | Pool;

export interface CreateDbOptions {
  url?: string;
  dataDir?: string;
}

/** Use embedded Postgres by default and a regular Pool when DATABASE_URL exists. */
export function createDb(options: CreateDbOptions = {}): DbHandle {
  if (options.url?.trim()) return new Pool({ connectionString: options.url });
  return new PGlite(options.dataDir ?? ".pglite");
}

export async function closeDb(db: DbHandle): Promise<void> {
  if (db instanceof PGlite) await db.close();
  else await db.end();
}
