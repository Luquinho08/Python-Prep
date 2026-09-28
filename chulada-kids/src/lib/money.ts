/** Todos los importes internos son centavos enteros (ARS). */

const arsFormatter = new Intl.NumberFormat("es-AR", {
  style: "currency",
  currency: "ARS",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatARS(cents: number): string {
  const hasCents = cents % 100 !== 0;
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency: "ARS",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

export { arsFormatter };


/** Porcentaje expresado en basis points (1000 = 10 %). */
export function percentOf(cents: number, basisPoints: number): number {
  return roundHalfUp((cents * basisPoints) / 10000);
}

export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.floor(-value + 0.5) : Math.floor(value + 0.5);
}

export function clampNonNegative(cents: number): number {
  return cents < 0 ? 0 : cents;
}

/** Convierte centavos a string decimal para APIs externas ("1234.50"). */
export function centsToDecimalString(cents: number): string {
  if (!Number.isInteger(cents)) throw new Error("Importe no entero");
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Convierte un decimal de API ("1234.5" o 1234.5) a centavos, sin errores de coma flotante. */
export function decimalToCents(value: string | number): number {
  const s = typeof value === "number" ? value.toFixed(2) : value.trim();
  const m = /^(-)?(\d+)(?:\.(\d{1,}))?$/.exec(s);
  if (!m) throw new Error(`Importe inválido: ${value}`);
  const frac = (m[3] ?? "").padEnd(3, "0");
  let cents = Number(m[2]) * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1;
  return m[1] ? -cents : cents;
}

/** Parsea una entrada de formulario en pesos ("1.234,50", "1234.5", "1234") a centavos. */
export function parsePesosInput(input: string): number | null {
  const raw = input.trim().replace(/\s|\$/g, "");
  if (!raw) return null;
  let normalized = raw;
  if (raw.includes(",")) normalized = raw.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) normalized = raw.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  return decimalToCents(normalized);
}

export function centsToPesosInput(cents: number | null | undefined): string {
  if (cents == null) return "";
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace(".", ",");
}
