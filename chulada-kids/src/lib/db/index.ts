import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

declare global {
  var __ckSql: ReturnType<typeof postgres> | undefined;
}

function createClient() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL no está configurada");
  return postgres(url, { max: Number(process.env.DATABASE_POOL_MAX ?? 10), prepare: false });
}

// Reutiliza la conexión entre recargas en desarrollo.
export const sqlClient = globalThis.__ckSql ?? createClient();
if (process.env.NODE_ENV !== "production") globalThis.__ckSql = sqlClient;

export const db = drizzle(sqlClient, { schema, casing: "snake_case" });
export type DB = typeof db;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type DbOrTx = DB | Tx;
export { schema };
