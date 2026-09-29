import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/** Salud para monitoreo. `?db=1` además verifica la base de datos. */
export async function GET(req: Request) {
  if (new URL(req.url).searchParams.get("db") !== "1") return Response.json({ ok: true });
  try {
    await db.execute(sql`SELECT 1`);
    return Response.json({ ok: true, db: true });
  } catch {
    return Response.json({ ok: false, db: false }, { status: 503 });
  }
}
