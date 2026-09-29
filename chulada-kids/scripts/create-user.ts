/**
 * Alta inicial segura: crea una invitación de un solo uso y muestra el enlace.
 * No existe ninguna contraseña fija en el código.
 * Uso: pnpm user:create --email duena@example.com --role owner
 */
import "dotenv/config";
import { sqlClient } from "../src/lib/db";
import { createInvitation } from "../src/lib/auth/invitations";

const args = Object.fromEntries(
  process.argv.slice(2).reduce<[string, string][]>((acc, a, i, arr) => (a.startsWith("--") ? [...acc, [a.slice(2), arr[i + 1]]] : acc), []),
);
const email = String(args.email ?? "").toLowerCase();
const role = String(args.role ?? "owner");
if (!/^[^@\s]+@[^@\s]+$/.test(email) || !["owner", "catalog_editor", "order_operator"].includes(role)) {
  console.error("Uso: pnpm user:create --email persona@dominio --role owner|catalog_editor|order_operator");
  process.exit(1);
}
createInvitation(email, role as "owner", null)
  .then((link) => {
    console.log(`Invitación creada para ${email} (${role}). Enlace de un solo uso, vence en 7 días:\n${link}`);
    return sqlClient.end();
  })
  .catch(async (e) => {
    console.error(e);
    await sqlClient.end();
    process.exit(1);
  });
