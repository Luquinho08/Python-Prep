import { execSync } from "node:child_process";
import { rmSync } from "node:fs";
import postgres from "postgres";

/** Base E2E limpia: migraciones (idempotentes), vaciado de tablas y seed de demostración. */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? "postgres://chulada:chulada_dev@localhost:5432/chulada_e2e";
  const env = { ...process.env, DATABASE_URL: url, STORAGE_DIR: "./storage-e2e", SEED_USER_PASSWORD: "e2e-password-segura-2026" };
  execSync("pnpm exec tsx scripts/migrate.ts", { env, stdio: "inherit" });
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  const tables = await sql<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  if (tables.length) await sql.unsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await sql.end();
  rmSync("./storage-e2e", { recursive: true, force: true });
  execSync("pnpm exec tsx --conditions=react-server scripts/seed.ts", { env, stdio: "inherit" });
}
