import { readStored } from "@/lib/storage";

export async function GET(_req: Request, ctx: RouteContext<"/media/[...key]">) {
  const { key } = await ctx.params;
  const name = key.join("/");
  if (!/^[a-z0-9-]+\.webp$/.test(name)) return new Response("No encontrado", { status: 404 });
  try {
    const data = await readStored(`public/${name}`);
    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": "image/webp",
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("No encontrado", { status: 404 });
  }
}
