import "server-only";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Falta la variable de entorno ${name}`);
  return v;
}

export const env = {
  get appUrl() {
    return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  },
  get isProduction() {
    return process.env.NODE_ENV === "production";
  },
  get encryptionKey() {
    const key = Buffer.from(required("APP_ENCRYPTION_KEY"), "base64");
    if (key.length !== 32) throw new Error("APP_ENCRYPTION_KEY debe ser 32 bytes en base64");
    return key;
  },
  get signingSecret() {
    return required("APP_SIGNING_SECRET");
  },
  get cronSecret() {
    return process.env.CRON_SECRET ?? "";
  },
  get storageDir() {
    return process.env.STORAGE_DIR ?? "./storage";
  },
  get reservationMinutes() {
    return Number(process.env.RESERVATION_MINUTES ?? 30);
  },
  get pendingHoldHours() {
    return Number(process.env.PENDING_PAYMENT_HOLD_HOURS ?? 72);
  },
  get termsVersion() {
    return process.env.TERMS_VERSION ?? "sin-version";
  },
  get paymentsDriver(): "mercadopago" | "fake" {
    const d = process.env.PAYMENTS_DRIVER ?? "mercadopago";
    if (d === "fake") {
      if (process.env.NODE_ENV === "production" || process.env.ALLOW_FAKE_PAYMENTS !== "true") {
        throw new Error("El simulador de pagos solo puede usarse fuera de producción con ALLOW_FAKE_PAYMENTS=true");
      }
      return "fake";
    }
    return "mercadopago";
  },
  get mpWebhookSecret() {
    return process.env.MP_WEBHOOK_SECRET ?? "";
  },
};
