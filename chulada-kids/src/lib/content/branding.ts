import "server-only";
import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "../db";
import { media } from "../db/schema";
import { publicMediaUrl } from "../storage";
import { getStoreSettings } from "./settings";

export const getBranding = cache(async () => {
  const s = await getStoreSettings();
  let logo: { url: string; width: number; height: number } | null = null;
  if (s.logoMediaId) {
    const [m] = await db.select().from(media).where(eq(media.id, s.logoMediaId));
    const url = publicMediaUrl(m?.storageKey);
    if (m && url && m.width && m.height) logo = { url, width: m.width, height: m.height };
  }
  return { settings: s, logo };
});
