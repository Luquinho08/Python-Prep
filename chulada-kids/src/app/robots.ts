import type { MetadataRoute } from "next";
import { getStoreSettings } from "@/lib/content/settings";

export const dynamic = "force-dynamic";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const s = await getStoreSettings();
  if (s.noindexSite) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/checkout", "/carrito", "/cuenta", "/pedido", "/api"] },
    sitemap: `${base}/sitemap.xml`,
  };
}
