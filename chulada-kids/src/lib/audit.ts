import "server-only";
import { db, type DbOrTx } from "./db";
import { auditLog } from "./db/schema";

export async function audit(
  actorUserId: string | null,
  action: string,
  entity: string,
  entityId: string | null,
  data: Record<string, unknown> = {},
  tx: DbOrTx = db,
) {
  await tx.insert(auditLog).values({ actorUserId, action, entity, entityId, data });
}
