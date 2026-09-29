import { vi } from "vitest";

// Entorno de pruebas: base separada, simulador de pagos, APP_URL inalcanzable (los webhooks
// del simulador no salen; se prueban llamando al handler directamente).
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? "postgres://chulada:chulada_dev@localhost:5432/chulada_test";
process.env.APP_URL = "http://127.0.0.1:9";
process.env.PAYMENTS_DRIVER = "fake";
process.env.ALLOW_FAKE_PAYMENTS = "true";
process.env.MP_WEBHOOK_SECRET = "test-webhook-secret";
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.APP_SIGNING_SECRET = "test-signing-secret";
process.env.RESERVATION_MINUTES = "30";
process.env.PENDING_PAYMENT_HOLD_HOURS = "72";
process.env.TERMS_VERSION = "test";
process.env.SMTP_URL = "";

// Sin request HTTP: cookies/headers vacíos (usuario anónimo).
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("next/server", () => ({ after: (fn: () => unknown) => void Promise.resolve().then(fn) }));
