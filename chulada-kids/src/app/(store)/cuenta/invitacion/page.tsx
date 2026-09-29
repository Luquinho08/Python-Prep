import type { Metadata } from "next";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { authTokens } from "@/lib/db/schema";
import { sha256 } from "@/lib/crypto";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import { InviteForm } from "@/components/store/auth-forms";
import { Alert } from "@/components/ui/alert";

export const metadata: Metadata = { title: "Invitación al equipo", robots: { index: false } };

export default async function InvitePage(props: PageProps<"/cuenta/invitacion">) {
  const sp = await props.searchParams;
  const token = typeof sp.token === "string" ? sp.token : "";
  const [row] = token
    ? await db
        .select()
        .from(authTokens)
        .where(and(eq(authTokens.id, sha256(token)), eq(authTokens.kind, "invitation"), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    : [];
  return (
    <div className="mx-auto max-w-md px-4 py-10">
      <h1 className="text-2xl font-bold">Invitación al equipo</h1>
      <div className="mt-5">
        {row?.email && row.role ? (
          <>
            <p className="mb-4 text-sm">Rol: <strong>{ROLE_LABELS[row.role]}</strong></p>
            <InviteForm token={token} email={row.email} />
          </>
        ) : (
          <Alert tone="error">La invitación no es válida, venció o ya se usó.</Alert>
        )}
      </div>
    </div>
  );
}
