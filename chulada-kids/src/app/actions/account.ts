"use server";
import { and, eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/lib/db";
import { addresses, users } from "@/lib/db/schema";
import { getCurrentUser } from "@/lib/auth/session";

async function me() {
  const u = await getCurrentUser();
  if (!u) redirect("/cuenta/ingresar");
  return u;
}

export async function saveProfileAction(formData: FormData) {
  const u = await me();
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  const phone = String(formData.get("phone") ?? "").trim().slice(0, 30);
  if (name.length < 2) redirect("/cuenta?error=" + encodeURIComponent("Ingresá tu nombre."));
  await db.update(users).set({ name, phone: phone || null, updatedAt: new Date() }).where(eq(users.id, u.id));
  redirect("/cuenta?ok=" + encodeURIComponent("Datos guardados."));
}

const addressSchema = z.object({
  label: z.string().trim().min(1).max(40),
  recipient: z.string().trim().min(2).max(80),
  street: z.string().trim().min(2).max(120),
  number: z.string().trim().min(1).max(20),
  apartment: z.string().trim().max(40).optional(),
  city: z.string().trim().min(2).max(80),
  province: z.string().trim().min(2).max(80),
  postalCode: z.string().trim().regex(/^[A-Za-z]?\d{4}[A-Za-z]{0,3}$/, "Código postal inválido"),
  notes: z.string().trim().max(200).optional(),
});

export async function saveAddressAction(formData: FormData) {
  const u = await me();
  const parsed = addressSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) redirect("/cuenta?error=" + encodeURIComponent(`Dirección: ${parsed.error.issues[0].message}`));
  await db.insert(addresses).values({ ...parsed.data, userId: u.id });
  redirect("/cuenta?ok=" + encodeURIComponent("Dirección guardada."));
}

export async function deleteAddressAction(formData: FormData) {
  const u = await me();
  const id = z.string().uuid().parse(formData.get("id"));
  // Solo borra direcciones propias: el id de otra persona no produce efecto.
  await db.delete(addresses).where(and(eq(addresses.id, id), eq(addresses.userId, u.id)));
  refresh();
}
