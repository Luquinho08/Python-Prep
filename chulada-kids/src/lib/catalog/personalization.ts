/** Validación de personalizaciones. Pura: se ejecuta en el servidor con la definición de la base. */
import { addDaysToDateString, formatStoreDate, storeToday } from "../time";

export type FieldDef = {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "date" | "file";
  required: boolean;
  maxLength: number | null;
  options: { value: string; label: string; surchargeCents?: number }[];
  surchargeCents: number;
  minLeadDays: number | null;
  sort: number;
};

export type PersonalizationEntry = { key: string; label: string; value: string; display: string; mediaId?: string };

export type PersonalizationResult =
  | { ok: true; values: PersonalizationEntry[]; surchargeUnitCents: number }
  | { ok: false; errors: Record<string, string> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validatePersonalization(
  fields: FieldDef[],
  submitted: Record<string, string | undefined>,
  opts: { now?: Date; fileDisplayNames?: Record<string, string> } = {},
): PersonalizationResult {
  const errors: Record<string, string> = {};
  const values: PersonalizationEntry[] = [];
  let surcharge = 0;
  const today = storeToday(opts.now);

  for (const f of [...fields].sort((a, b) => a.sort - b.sort)) {
    const raw = (submitted[f.key] ?? "").replace(/\s+/g, " ").trim();
    if (!raw) {
      if (f.required) errors[f.key] = `Completá “${f.label}”.`;
      continue;
    }
    switch (f.type) {
      case "text":
      case "textarea": {
        const max = f.maxLength ?? (f.type === "text" ? 60 : 500);
        if (raw.length > max) {
          errors[f.key] = `“${f.label}” admite hasta ${max} caracteres (escribiste ${raw.length}).`;
          continue;
        }
        if (/[<>]/.test(raw)) {
          errors[f.key] = `“${f.label}” no puede contener los caracteres < o >.`;
          continue;
        }
        values.push({ key: f.key, label: f.label, value: raw, display: raw });
        surcharge += f.surchargeCents;
        break;
      }
      case "select": {
        const opt = f.options.find((o) => o.value === raw);
        if (!opt) {
          errors[f.key] = `Elegí una opción válida para “${f.label}”.`;
          continue;
        }
        values.push({ key: f.key, label: f.label, value: opt.value, display: opt.label });
        surcharge += (opt.surchargeCents ?? 0) + f.surchargeCents;
        break;
      }
      case "date": {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
          errors[f.key] = `Ingresá una fecha válida para “${f.label}”.`;
          continue;
        }
        const minDate = addDaysToDateString(today, f.minLeadDays ?? 0);
        if (raw < minDate) {
          errors[f.key] = `Para “${f.label}” necesitamos al menos ${f.minLeadDays ?? 0} días de anticipación: elegí desde el ${formatStoreDate(minDate)}.`;
          continue;
        }
        if (raw > addDaysToDateString(today, 400)) {
          errors[f.key] = `La fecha de “${f.label}” está demasiado lejos; escribinos para coordinar.`;
          continue;
        }
        values.push({ key: f.key, label: f.label, value: raw, display: formatStoreDate(raw) });
        surcharge += f.surchargeCents;
        break;
      }
      case "file": {
        if (!UUID_RE.test(raw)) {
          errors[f.key] = `El archivo de “${f.label}” no es válido. Volvé a subirlo.`;
          continue;
        }
        values.push({
          key: f.key,
          label: f.label,
          value: raw.toLowerCase(),
          mediaId: raw.toLowerCase(),
          display: opts.fileDisplayNames?.[raw.toLowerCase()] ?? "Archivo de referencia",
        });
        surcharge += f.surchargeCents;
        break;
      }
    }
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values, surchargeUnitCents: surcharge };
}

export function hasRequiredFields(fields: Pick<FieldDef, "required">[]): boolean {
  return fields.some((f) => f.required);
}
