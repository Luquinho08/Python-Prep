import { describe, expect, it } from "vitest";
import { centsToDecimalString, decimalToCents, formatARS, parsePesosInput } from "@/lib/money";
import { storeLocalToUtc, storeToday, utcToStoreLocalInput } from "@/lib/time";
import { validatePersonalization, type FieldDef } from "@/lib/catalog/personalization";
import { normalizePostalCode, postalCodeMatches, validPostalRules } from "@/lib/shipping";
import { aggregatePayments, mapOrderStatus, mapPaymentStatus } from "@/lib/payments/status";
import { csvCell } from "@/lib/csv";
import { transitionProblem } from "@/lib/orders/status";
import { sanitizeRichText } from "@/lib/content/sanitize";

describe("dinero", () => {
  it("convierte sin errores de coma flotante", () => {
    expect(decimalToCents("1234.5")).toBe(123450);
    expect(decimalToCents(0.1 + 0.2)).toBe(30);
    expect(decimalToCents("10.005")).toBe(1001);
    expect(centsToDecimalString(123405)).toBe("1234.05");
  });
  it("parsea entradas argentinas", () => {
    expect(parsePesosInput("1.234,50")).toBe(123450);
    expect(parsePesosInput("$ 5400")).toBe(540000);
    expect(parsePesosInput("12.500")).toBe(1250000);
    expect(parsePesosInput("abc")).toBeNull();
  });
  it("formatea ARS", () => {
    expect(formatARS(1250000).replace(/\s/g, " ")).toBe("$ 12.500");
  });
});

describe("zona horaria de la tienda (America/Argentina/Buenos_Aires)", () => {
  it("medianoche de Buenos Aires = 03:00 UTC", () => {
    expect(storeLocalToUtc("2026-10-01T00:00").toISOString()).toBe("2026-10-01T03:00:00.000Z");
    expect(utcToStoreLocalInput(new Date("2026-10-01T03:00:00Z"))).toBe("2026-10-01T00:00");
  });
  it("el día calendario cambia a las 03:00 UTC", () => {
    expect(storeToday(new Date("2026-10-01T02:59:00Z"))).toBe("2026-09-30");
    expect(storeToday(new Date("2026-10-01T03:00:00Z"))).toBe("2026-10-01");
  });
});

describe("personalización", () => {
  const fields: FieldDef[] = [
    { key: "nombre", label: "Nombre", type: "text", required: true, maxLength: 10, options: [], surchargeCents: 0, minLeadDays: null, sort: 1 },
    { key: "color", label: "Color", type: "select", required: false, maxLength: null, options: [{ value: "rosa", label: "Rosa", surchargeCents: 300 }], surchargeCents: 0, minLeadDays: null, sort: 2 },
    { key: "fecha", label: "Fecha", type: "date", required: false, maxLength: null, options: [], surchargeCents: 0, minLeadDays: 10, sort: 3 },
  ];
  const now = new Date("2026-10-01T15:00:00Z");
  it("obligatorio, máximo de caracteres y opciones válidas", () => {
    const r = validatePersonalization(fields, { nombre: "", color: "verde" }, { now });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.nombre).toContain("Completá");
      expect(r.errors.color).toContain("opción válida");
    }
    expect(validatePersonalization(fields, { nombre: "Maximiliano José" }, { now }).ok).toBe(false);
  });
  it("anticipación mínima de la fecha y recargos del servidor", () => {
    expect(validatePersonalization(fields, { nombre: "Tomás", fecha: "2026-10-05" }, { now }).ok).toBe(false);
    const ok = validatePersonalization(fields, { nombre: "Tomás", color: "rosa", fecha: "2026-10-20" }, { now });
    expect(ok.ok && ok.surchargeUnitCents).toBe(300);
  });
  it("rechaza marcado HTML en textos", () => {
    expect(validatePersonalization(fields, { nombre: "<b>x</b>" }, { now }).ok).toBe(false);
  });
});

describe("entregas por código postal", () => {
  it("normaliza CPA y rangos", () => {
    expect(normalizePostalCode("C1425ABC")).toBe("1425");
    expect(normalizePostalCode("1425")).toBe("1425");
    expect(normalizePostalCode("14")).toBeNull();
    expect(postalCodeMatches(["1000-1499"], "1425")).toBe(true);
    expect(postalCodeMatches(["1000-1499", "1602"], "1602")).toBe(true);
    expect(postalCodeMatches(["1000-1499"], "1600")).toBe(false);
    expect(validPostalRules(["1000-1499", "abc"])).toBe(false);
  });
});

describe("estados de pago", () => {
  it("Orders API", () => {
    expect(mapOrderStatus("processed", "accredited")).toBe("approved");
    expect(mapOrderStatus("action_required", "pending_challenge")).toBe("requires_action");
    expect(mapOrderStatus("failed", "x")).toBe("rejected");
    expect(mapOrderStatus("algo_nuevo", null)).toBe("to_verify");
  });
  it("Payments API: solo approved confirma", () => {
    expect(mapPaymentStatus("approved", 0, 100)).toBe("approved");
    expect(mapPaymentStatus("authorized")).toBe("pending");
    expect(mapPaymentStatus("in_process")).toBe("pending");
    expect(mapPaymentStatus("refunded", 50, 100)).toBe("partially_refunded");
    expect(mapPaymentStatus("charged_back")).toBe("charged_back");
  });
  it("agregado de varios pagos prioriza aprobado sobre rechazado", () => {
    const base = { statusDetail: null, amountCents: 1, refundedCents: 0, currency: "ARS", collectorId: null, externalReference: null, installments: null, paymentMethodId: null, dateOfExpiration: null };
    expect(aggregatePayments([{ ...base, providerPaymentId: "1", status: "rejected" }, { ...base, providerPaymentId: "2", status: "approved" }])).toBe("approved");
  });
});

describe("seguridad de salida", () => {
  it("CSV neutraliza fórmulas", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@cmd")).toBe("'@cmd");
    expect(csvCell('a"b')).toBe('"a""b"');
  });
  it("sanitiza HTML del CMS", () => {
    const out = sanitizeRichText('<p onclick="x()">Hola<script>alert(1)</script><a href="javascript:alert(1)">l</a><img src=x onerror=1></p>');
    expect(out).not.toMatch(/script|onclick|javascript|onerror|<img/);
    expect(out).toContain("Hola");
  });
});

describe("estados de producción", () => {
  const base = { requiresApproval: false, hasApprovedProof: false, shippingKind: "delivery" as const };
  it("bloquea producción sin pago aprobado", () => {
    expect(transitionProblem({ ...base, from: "received", to: "in_production", paymentStatus: "pending" })).toContain("pago");
  });
  it("bloquea producción sin diseño aprobado cuando se requiere", () => {
    expect(transitionProblem({ ...base, from: "received", to: "in_production", paymentStatus: "approved", requiresApproval: true })).toContain("diseño");
    expect(transitionProblem({ ...base, from: "received", to: "in_production", paymentStatus: "approved", requiresApproval: true, hasApprovedProof: true })).toBeNull();
  });
  it("respeta el flujo y el tipo de entrega", () => {
    expect(transitionProblem({ ...base, from: "received", to: "delivered", paymentStatus: "approved" })).not.toBeNull();
    expect(transitionProblem({ ...base, from: "ready", to: "picked_up", paymentStatus: "approved" })).toContain("envío");
  });
});
