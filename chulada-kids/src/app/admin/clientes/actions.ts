"use server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { inquiries } from "@/lib/db/schema";
import { requirePermission } from "@/lib/auth/guards";
import { redirectOk } from "@/lib/admin/flash";

export async function setInquiryStatusAction(formData: FormData) {
  await requirePermission("customers:read");
  const id = z.string().uuid().parse(formData.get("id"));
  const status = z.enum(["new", "answered", "archived"]).parse(formData.get("status"));
  await db.update(inquiries).set({ status }).where(eq(inquiries.id, id));
  redirectOk("/admin/clientes", "Consulta actualizada.");
}
