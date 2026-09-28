"use server";
import { z } from "zod";
import { db } from "@/lib/db";
import { inquiries } from "@/lib/db/schema";
import { enqueueEmail } from "@/lib/email/outbox";
import { rateLimit } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { getStoreSettings } from "@/lib/content/settings";

export type InquiryState = { ok: boolean; message: string; fieldErrors?: Record<string, string> } | null;

const schema = z.object({
  kind: z.enum(["contact", "quote"]),
  productId: z.string().uuid().optional().or(z.literal("")),
  name: z.string().trim().min(2, "Ingresá tu nombre.").max(80),
  email: z.string().trim().toLowerCase().email("Ingresá un email válido.").max(120),
  phone: z.string().trim().max(40).optional(),
  message: z.string().trim().min(10, "Contanos un poco más (mínimo 10 caracteres).").max(2000),
  website: z.string().max(0).optional(), // honeypot
});

export async function sendInquiryAction(_prev: InquiryState, formData: FormData): Promise<InquiryState> {
  const parsed = schema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { ok: false, message: "Revisá los datos marcados.", fieldErrors };
  }
  if (parsed.data.website) return { ok: true, message: "Recibimos tu mensaje." };
  if (!(await rateLimit(`inquiry:${await clientIp()}`, 5, 3600))) return { ok: false, message: "Enviaste varios mensajes seguidos. Probá más tarde." };
  const d = parsed.data;
  const [row] = await db
    .insert(inquiries)
    .values({ kind: d.kind, productId: d.productId || null, name: d.name, email: d.email, phone: d.phone || null, message: d.message })
    .returning();
  const settings = await getStoreSettings();
  const to = process.env.ADMIN_NOTIFICATION_EMAIL || settings.contactEmail;
  await enqueueEmail({
    dedupeKey: `inquiry:${row.id}`,
    to,
    subject: d.kind === "quote" ? `Nuevo pedido de presupuesto de ${d.name}` : `Nueva consulta de ${d.name}`,
    text: `${d.name} <${d.email}> ${d.phone ?? ""}\n\n${d.message}\n\nVer en el panel: /admin/clientes`,
  });
  return { ok: true, message: "¡Gracias! Recibimos tu mensaje y te respondemos por email." };
}
