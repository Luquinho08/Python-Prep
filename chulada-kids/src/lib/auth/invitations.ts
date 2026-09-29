import "server-only";
import { db } from "../db";
import { authTokens } from "../db/schema";
import { randomToken, sha256 } from "../crypto";
import { enqueueEmail } from "../email/outbox";
import { env } from "../env";
import { ROLE_LABELS, type Role } from "./permissions";

/** Crea una invitación de un solo uso (7 días). Devuelve el enlace para compartir si no hay email configurado. */
export async function createInvitation(email: string, role: Role, createdBy: string | null) {
  const token = randomToken(32);
  await db.insert(authTokens).values({
    id: sha256(token),
    kind: "invitation",
    email: email.toLowerCase(),
    role,
    createdBy,
    expiresAt: new Date(Date.now() + 7 * 86400_000),
  });
  const link = `${env.appUrl}/cuenta/invitacion?token=${token}`;
  await enqueueEmail({
    dedupeKey: `invite:${sha256(token)}`,
    to: email,
    subject: "Te invitaron al panel de Chulada Kids",
    text: `Te invitaron como ${ROLE_LABELS[role]}. Activá tu acceso (vence en 7 días):\n${link}`,
  });
  return link;
}
