import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { media } from "../db/schema";
import { env } from "../env";

export type Visibility = "public" | "private";

export const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const REFERENCE_MIME = [...IMAGE_MIME, "application/pdf"] as const;

export class UploadError extends Error {}

function root() {
  return path.resolve(process.cwd(), env.storageDir);
}

function resolveKey(key: string) {
  if (!/^(public|private)\/[a-z0-9-]+\.(webp|pdf)$/.test(key)) throw new Error("Clave de almacenamiento inválida");
  return path.join(root(), key);
}

export async function readStored(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}

async function writeStored(key: string, data: Buffer) {
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data, { mode: 0o600 });
}

export async function deleteStored(key: string) {
  await rm(resolveKey(key), { force: true });
}

/**
 * Valida el contenido real (no la extensión ni el MIME declarado), reencodea imágenes
 * (quita metadatos/EXIF, limita dimensiones) y guarda con nombre aleatorio.
 */
export async function saveUpload(input: {
  data: Buffer;
  visibility: Visibility;
  allowed: readonly string[];
  maxBytes: number;
  originalName?: string;
  alt?: string;
  createdBy?: string | null;
  isPlaceholder?: boolean;
}) {
  if (input.data.length === 0) throw new UploadError("El archivo está vacío.");
  if (input.data.length > input.maxBytes)
    throw new UploadError(`El archivo supera el máximo de ${Math.round(input.maxBytes / 1024 / 1024)} MB.`);
  const detected = await fileTypeFromBuffer(input.data);
  if (!detected || !input.allowed.includes(detected.mime))
    throw new UploadError("Formato no permitido. Usá JPG, PNG o WEBP" + (input.allowed.includes("application/pdf") ? " o PDF." : "."));

  const id = randomUUID();
  let out: Buffer;
  let mime: string;
  let width: number | null = null;
  let height: number | null = null;
  let ext: "webp" | "pdf";

  if (detected.mime === "application/pdf") {
    out = input.data;
    mime = "application/pdf";
    ext = "pdf";
  } else {
    let meta;
    try {
      meta = await sharp(input.data, { limitInputPixels: 50_000_000 }).metadata();
    } catch {
      throw new UploadError("No pudimos leer la imagen. Probá con otro archivo.");
    }
    if (!meta.width || !meta.height || meta.width < 100 || meta.height < 100)
      throw new UploadError("La imagen es demasiado chica (mínimo 100 × 100 px).");
    const result = await sharp(input.data, { limitInputPixels: 50_000_000 })
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer({ resolveWithObject: true });
    out = result.data;
    width = result.info.width;
    height = result.info.height;
    mime = "image/webp";
    ext = "webp";
  }

  const storageKey = `${input.visibility}/${id}.${ext}`;
  await writeStored(storageKey, out);
  const [row] = await db
    .insert(media)
    .values({
      id,
      visibility: input.visibility,
      storageKey,
      mime,
      bytes: out.length,
      width,
      height,
      alt: input.alt ?? "",
      originalName: input.originalName?.slice(0, 120) ?? null,
      isPlaceholder: input.isPlaceholder ?? false,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  return row;
}

export function publicMediaUrl(storageKey: string | null | undefined): string | null {
  if (!storageKey || !storageKey.startsWith("public/")) return null;
  return `/media/${storageKey.slice("public/".length)}`;
}

export async function deleteMediaIfUnused(mediaId: string): Promise<boolean> {
  const [row] = await db.select().from(media).where(eq(media.id, mediaId));
  if (!row) return false;
  try {
    await db.delete(media).where(eq(media.id, mediaId));
  } catch {
    return false; // Referenciado (FK restrict): se conserva.
  }
  await deleteStored(row.storageKey);
  return true;
}
