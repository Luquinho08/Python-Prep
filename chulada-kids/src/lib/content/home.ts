import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { banners, media, themes } from "../db/schema";
import { publicMediaUrl } from "../storage";

export async function getActiveBanner() {
  const [b] = await db
    .select({ b: banners, key: media.storageKey, w: media.width, h: media.height, alt: media.alt })
    .from(banners)
    .leftJoin(media, eq(media.id, banners.imageId))
    .where(eq(banners.isActive, true))
    .orderBy(asc(banners.sort))
    .limit(1);
  if (!b) return null;
  return { ...b.b, imageUrl: publicMediaUrl(b.key), imageWidth: b.w, imageHeight: b.h, imageAlt: b.alt ?? "" };
}

export async function getThemeById(id: string | null) {
  if (!id) return null;
  const [t] = await db.select().from(themes).where(and(eq(themes.id, id), eq(themes.isActive, true)));
  return t ?? null;
}
