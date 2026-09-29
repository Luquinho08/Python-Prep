export const STORE_TZ = "America/Argentina/Buenos_Aires";

/** Offset (minutos) de la zona de la tienda en un instante dado. */
function tzOffsetMinutes(at: Date, timeZone = STORE_TZ): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** "2026-10-01T09:30" interpretado en hora de Buenos Aires → instante UTC. */
export function storeLocalToUtc(local: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?$/.exec(local.trim());
  if (!m) throw new Error(`Fecha inválida: ${local}`);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
  let offset = tzOffsetMinutes(new Date(guess));
  let result = guess - offset * 60000;
  // Segunda pasada por si el offset cambió (DST).
  offset = tzOffsetMinutes(new Date(result));
  result = guess - offset * 60000;
  return new Date(result);
}

/** Instante → "YYYY-MM-DDTHH:mm" en hora de la tienda (para inputs datetime-local). */
export function utcToStoreLocalInput(at: Date | null | undefined): string {
  if (!at) return "";
  const shifted = new Date(at.getTime() + tzOffsetMinutes(at) * 60000);
  return shifted.toISOString().slice(0, 16);
}

/** Fecha calendario de hoy en la tienda ("YYYY-MM-DD"). */
export function storeToday(now = new Date()): string {
  return utcToStoreLocalInput(now).slice(0, 10);
}

export function addDaysToDateString(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function formatStoreDateTime(at: Date | string | null | undefined): string {
  if (!at) return "—";
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: STORE_TZ,
    dateStyle: "short",
    timeStyle: "short",
  }).format(typeof at === "string" ? new Date(at) : at);
}

export function formatStoreDate(at: Date | string | null | undefined): string {
  if (!at) return "—";
  const d = typeof at === "string" && /^\d{4}-\d{2}-\d{2}$/.test(at) ? new Date(`${at}T12:00:00Z`) : new Date(at);
  return new Intl.DateTimeFormat("es-AR", { timeZone: STORE_TZ, dateStyle: "long" }).format(d);
}

export function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}
