import "server-only";
import { and, asc, eq, lte } from "drizzle-orm";
import nodemailer from "nodemailer";
import { db, type DbOrTx } from "../db";
import { emailOutbox } from "../db/schema";

/** Encola un email. dedupe_key único: el mismo aviso nunca se envía dos veces. */
export async function enqueueEmail(msg: { dedupeKey: string; to: string; subject: string; text: string; html?: string }, tx: DbOrTx = db) {
  if (!msg.to) return;
  await tx.insert(emailOutbox).values(msg).onConflictDoNothing({ target: emailOutbox.dedupeKey });
}

/**
 * Procesa la cola. Sin SMTP_URL los mensajes quedan "skipped" con el motivo: nunca se marcan como enviados.
 */
export async function processEmailOutbox(limit = 20) {
  const pending = await db
    .select()
    .from(emailOutbox)
    .where(and(eq(emailOutbox.status, "pending"), lte(emailOutbox.nextAttemptAt, new Date())))
    .orderBy(asc(emailOutbox.createdAt))
    .limit(limit);
  if (pending.length === 0) return { sent: 0, skipped: 0, failed: 0 };
  const smtp = process.env.SMTP_URL;
  let sent = 0, skipped = 0, failed = 0;
  if (!smtp) {
    for (const m of pending) {
      await db.update(emailOutbox).set({ status: "skipped", lastError: "Sin proveedor de email configurado (SMTP_URL vacío). No se envió." }).where(eq(emailOutbox.id, m.id));
      skipped++;
    }
    return { sent, skipped, failed };
  }
  const transport = nodemailer.createTransport(smtp);
  for (const m of pending) {
    try {
      await transport.sendMail({ from: process.env.EMAIL_FROM, to: m.to, subject: m.subject, text: m.text, html: m.html ?? undefined });
      await db.update(emailOutbox).set({ status: "sent", sentAt: new Date(), attempts: m.attempts + 1, lastError: null }).where(eq(emailOutbox.id, m.id));
      sent++;
    } catch (e) {
      const attempts = m.attempts + 1;
      const giveUp = attempts >= 6;
      await db
        .update(emailOutbox)
        .set({
          status: giveUp ? "failed" : "pending",
          attempts,
          lastError: String((e as Error).message).slice(0, 500),
          nextAttemptAt: new Date(Date.now() + Math.min(2 ** attempts, 360) * 60_000),
        })
        .where(eq(emailOutbox.id, m.id));
      failed++;
    }
  }
  return { sent, skipped, failed };
}
