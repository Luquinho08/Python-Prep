"use client";
import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { addToCartAction, type CartActionState } from "@/app/actions/cart";
import { formatARS } from "@/lib/money";
import { Alert } from "../ui/alert";
import { Button } from "../ui/button";
import { Field, Input, Select, Textarea } from "../ui/field";

export type ConfigVariant = {
  id: string;
  name: string;
  priceCents: number;
  regularPriceCents: number;
  available: number;
  availability: "in_stock" | "low" | "out" | "made_to_order" | "backorder";
};

export type ConfigField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "select" | "date" | "file";
  required: boolean;
  maxLength: number | null;
  options: { value: string; label: string; surchargeCents?: number }[];
  surchargeCents: number;
  helpText: string;
  minDate: string | null;
  acceptMime: string[] | null;
  maxFileMb: number | null;
};

const AVAIL: Record<ConfigVariant["availability"], string> = {
  in_stock: "Disponible",
  low: "Últimas unidades",
  out: "Agotado",
  made_to_order: "A pedido",
  backorder: "Por encargo",
};

export function ProductConfigurator(props: {
  productId: string;
  variants: ConfigVariant[];
  fields: ConfigField[];
  minQty: number;
  qtyStep: number;
  maxQty: number | null;
  packUnits: number;
  unitLabel: string;
  allowBackorder: boolean;
  checkoutEnabled: boolean;
}) {
  const firstBuyable = props.variants.find((v) => v.availability !== "out") ?? props.variants[0];
  const [variantId, setVariantId] = useState(firstBuyable?.id ?? "");
  const [qty, setQty] = useState(props.minQty);
  const [values, setValues] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<Record<string, { mediaId: string; token: string; name: string } | { error: string } | "loading">>({});
  const [state, action, pending] = useActionState<CartActionState | null, FormData>(addToCartAction, null);

  const variant = props.variants.find((v) => v.id === variantId);
  const surcharge = useMemo(() => {
    let s = 0;
    for (const f of props.fields) {
      const v = values[f.key];
      if (f.type === "file") {
        const u = uploads[f.key];
        if (u && typeof u === "object" && "mediaId" in u) s += f.surchargeCents;
        continue;
      }
      if (!v) continue;
      if (f.type === "select") s += (f.options.find((o) => o.value === v)?.surchargeCents ?? 0) + f.surchargeCents;
      else s += f.surchargeCents;
    }
    return s;
  }, [values, uploads, props.fields]);

  const out = !variant || (variant.availability === "out" && !props.allowBackorder);
  const maxByStock = variant && !props.allowBackorder ? variant.available : Infinity;
  const maxQty = Math.min(props.maxQty ?? Infinity, maxByStock);
  const unitTotal = (variant?.priceCents ?? 0) + surcharge;
  const regularTotal = (variant?.regularPriceCents ?? 0) + surcharge;
  const fe = state?.fieldErrors ?? {};

  async function upload(key: string, file: File | undefined) {
    if (!file) {
      setUploads((u) => ({ ...u, [key]: undefined as never }));
      return;
    }
    setUploads((u) => ({ ...u, [key]: "loading" }));
    const body = new FormData();
    body.append("file", file);
    try {
      const res = await fetch("/api/uploads/reference", { method: "POST", body });
      const data = await res.json();
      if (!res.ok || !data.ok) setUploads((u) => ({ ...u, [key]: { error: data.error ?? "No pudimos subir el archivo." } }));
      else setUploads((u) => ({ ...u, [key]: { mediaId: data.mediaId, token: data.token, name: data.name } }));
    } catch {
      setUploads((u) => ({ ...u, [key]: { error: "Se interrumpió la conexión. Volvé a intentar." } }));
    }
  }

  const step = (dir: 1 | -1) => setQty((q) => Math.max(props.minQty, Math.min(q + dir * props.qtyStep, Number.isFinite(maxQty) ? maxQty : q + props.qtyStep)));

  return (
    <form action={action} className="space-y-5" noValidate>
      <input type="hidden" name="productId" value={props.productId} />
      {props.variants.length > 1 ? (
        <fieldset>
          <legend className="text-sm font-semibold">Opción</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {props.variants.map((v) => {
              const disabled = v.availability === "out" && !props.allowBackorder;
              return (
                <label
                  key={v.id}
                  className={`cursor-pointer rounded-2xl border-2 px-3 py-2 text-sm has-[:checked]:border-blue-strong has-[:checked]:bg-brand-blue/15 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-blue-strong ${disabled ? "cursor-not-allowed border-line text-ink-soft line-through" : "border-line"}`}
                >
                  <input type="radio" name="variantId" value={v.id} checked={variantId === v.id} disabled={disabled} onChange={() => setVariantId(v.id)} className="sr-only" />
                  {v.name}
                  <span className="block text-xs text-ink-soft no-underline">
                    {formatARS(v.priceCents)} · {AVAIL[v.availability]}
                  </span>
                </label>
              );
            })}
          </div>
          {fe.variantId ? <p className="mt-1 text-sm font-medium text-danger">{fe.variantId}</p> : null}
        </fieldset>
      ) : (
        <input type="hidden" name="variantId" value={variantId} />
      )}

      {props.fields.length > 0 ? (
        <fieldset className="space-y-4 rounded-card border border-line bg-surface-soft p-4">
          <legend className="px-1 text-sm font-semibold">Personalización</legend>
          {props.fields.map((f) => {
            const id = `pf-${f.key}`;
            const err = fe[f.key];
            const hint = [f.helpText, f.maxLength && (f.type === "text" || f.type === "textarea") ? `Máximo ${f.maxLength} caracteres.` : "", f.surchargeCents > 0 ? `Recargo: ${formatARS(f.surchargeCents)}.` : ""]
              .filter(Boolean)
              .join(" ");
            const set = (v: string) => setValues((s) => ({ ...s, [f.key]: v }));
            return (
              <Field key={f.key} id={id} label={f.label} required={f.required} error={err} hint={hint || undefined}>
                {(a11y) => {
                  switch (f.type) {
                    case "textarea":
                      return <Textarea {...a11y} name={`p_${f.key}`} maxLength={f.maxLength ?? 500} value={values[f.key] ?? ""} onChange={(e) => set(e.target.value)} />;
                    case "select":
                      return (
                        <Select {...a11y} name={`p_${f.key}`} value={values[f.key] ?? ""} onChange={(e) => set(e.target.value)}>
                          <option value="">Elegí una opción</option>
                          {f.options.map((o) => (
                            <option key={o.value} value={o.value}>{o.label}</option>
                          ))}
                        </Select>
                      );
                    case "date":
                      return <Input {...a11y} type="date" name={`p_${f.key}`} min={f.minDate ?? undefined} value={values[f.key] ?? ""} onChange={(e) => set(e.target.value)} />;
                    case "file": {
                      const u = uploads[f.key];
                      return (
                        <div>
                          <Input
                            {...a11y}
                            required={false}
                            type="file"
                            accept={(f.acceptMime ?? ["image/jpeg", "image/png", "image/webp"]).join(",")}
                            onChange={(e) => upload(f.key, e.target.files?.[0])}
                            className="text-sm file:mr-3 file:rounded-full file:border-0 file:bg-brand-mint file:px-3 file:py-1.5 file:font-semibold"
                          />
                          <p className="mt-1 text-xs text-ink-soft" aria-live="polite">
                            {u === "loading" ? "Subiendo archivo…" : u && "mediaId" in u ? `Archivo listo: ${u.name}` : u && "error" in u ? <span className="font-medium text-danger">{u.error}</span> : `JPG, PNG, WEBP${(f.acceptMime ?? []).includes("application/pdf") ? " o PDF" : ""}, hasta ${f.maxFileMb ?? 8} MB. Queda privado.`}
                          </p>
                          {u && typeof u === "object" && "mediaId" in u ? (
                            <>
                              <input type="hidden" name={`p_${f.key}`} value={u.mediaId} />
                              <input type="hidden" name={`t_${f.key}`} value={u.token} />
                            </>
                          ) : null}
                        </div>
                      );
                    }
                    default:
                      return <Input {...a11y} type="text" name={`p_${f.key}`} maxLength={f.maxLength ?? 60} value={values[f.key] ?? ""} onChange={(e) => set(e.target.value)} autoComplete="off" />;
                  }
                }}
              </Field>
            );
          })}
        </fieldset>
      ) : null}

      <div>
        <label htmlFor="qty" className="text-sm font-semibold">
          Cantidad {props.packUnits > 1 ? <span className="font-normal text-ink-soft">(packs de {props.packUnits} {props.unitLabel})</span> : null}
        </label>
        <div className="mt-1.5 flex items-center gap-2">
          <button type="button" onClick={() => step(-1)} className="h-11 w-11 rounded-full border-2 border-line text-lg font-bold" aria-label="Restar">−</button>
          <input
            id="qty"
            name="quantity"
            type="number"
            inputMode="numeric"
            min={props.minQty}
            step={props.qtyStep}
            max={Number.isFinite(maxQty) ? maxQty : undefined}
            value={qty}
            onChange={(e) => setQty(Math.max(0, Number(e.target.value)))}
            className="h-11 w-20 rounded-xl border-2 border-line text-center text-base"
            aria-describedby="qty-hint"
          />
          <button type="button" onClick={() => step(1)} className="h-11 w-11 rounded-full border-2 border-line text-lg font-bold" aria-label="Sumar">+</button>
        </div>
        <p id="qty-hint" className="mt-1 text-xs text-ink-soft">
          {props.minQty > 1 ? `Mínimo ${props.minQty}. ` : ""}
          {props.packUnits > 1 ? `Total: ${qty * props.packUnits} ${props.unitLabel}.` : ""}
          {variant && variant.availability !== "out" && variant.availability !== "made_to_order" && Number.isFinite(maxByStock) ? ` Disponibles: ${variant.available}.` : ""}
          {variant?.availability === "made_to_order" ? ` Cupos de producción disponibles: ${variant.available}.` : ""}
        </p>
        {fe.quantity ? <p className="text-sm font-medium text-danger">{fe.quantity}</p> : null}
      </div>

      <div className="rounded-card bg-brand-yellow/25 p-4" aria-live="polite">
        <p className="text-sm text-ink-soft">Total para esta selección</p>
        <p className="text-2xl font-bold">
          {formatARS(unitTotal * Math.max(qty, 0))}
          {regularTotal > unitTotal ? <span className="ml-2 text-sm font-normal text-ink-soft line-through">{formatARS(regularTotal * Math.max(qty, 0))}</span> : null}
        </p>
        <p className="text-xs text-ink-soft">
          {formatARS(unitTotal)} {props.packUnits > 1 ? "por pack" : `por ${props.unitLabel}`}
          {surcharge > 0 ? ` (incluye ${formatARS(surcharge)} de personalización)` : ""}. Envío no incluido; lo ves antes de pagar.
        </p>
      </div>

      {state ? (
        <Alert tone={state.ok ? "success" : "error"}>
          {state.message}{" "}
          {state.ok ? <Link href="/carrito" className="font-semibold underline">Ver carrito</Link> : null}
        </Alert>
      ) : null}

      {out ? (
        <Alert tone="warning" title="Agotado">Esta opción no tiene disponibilidad por ahora.</Alert>
      ) : (
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button type="submit" name="intent" value="add" size="lg" className="flex-1" disabled={pending}>
            {pending ? "Agregando…" : "Agregar al carrito"}
          </Button>
          {props.checkoutEnabled ? (
            <Button type="submit" name="intent" value="buy" size="lg" variant="accent" className="flex-1" disabled={pending}>
              Comprar ahora
            </Button>
          ) : null}
        </div>
      )}
    </form>
  );
}
