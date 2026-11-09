import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "./schema";

type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __lastroDb?: Db };

function create(): Db {
  const client = postgres(env().DATABASE_URL, { max: 5 });
  return drizzle(client, { schema });
}

/** Lazily-created singleton (survives dev hot reloads). */
export function db(): Db {
  if (!globalForDb.__lastroDb) globalForDb.__lastroDb = create();
  return globalForDb.__lastroDb;
}

export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

export { schema };
