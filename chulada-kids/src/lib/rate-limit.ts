import "server-only";
import { sql } from "drizzle-orm";
import { db } from "./db";

/**
 * Límite de frecuencia de ventana fija persistido en Postgres (sirve con varias instancias).
 * Devuelve true si la acción está permitida.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const windowStart = new Date(Math.floor(Date.now() / (windowSeconds * 1000)) * windowSeconds * 1000);
  const rows = await db.execute<{ count: number }>(sql`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${windowStart.toISOString()}::timestamptz, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count`);
  if (Math.random() < 0.02) {
    await db.execute(sql`DELETE FROM rate_limits WHERE window_start < now() - interval '1 day'`);
  }
  return Number(rows[0]?.count ?? 0) <= limit;
}
