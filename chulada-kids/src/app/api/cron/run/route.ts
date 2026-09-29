import { safeEqual } from "@/lib/crypto";
import { env } from "@/lib/env";
import { runAllJobs } from "@/lib/jobs";

/** Tareas programadas (cada 5 min). Protegido con Authorization: Bearer CRON_SECRET. */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const secret = env.cronSecret;
  if (!secret || !safeEqual(auth, `Bearer ${secret}`)) return new Response("No autorizado", { status: 401 });
  return Response.json(await runAllJobs());
}

export const GET = POST;
