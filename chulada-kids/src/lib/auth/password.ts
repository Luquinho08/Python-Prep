import "server-only";
import { hash, verify } from "@node-rs/argon2";

// Argon2id (algorithm 2) con parámetros recomendados por OWASP (m=19 MiB, t=2, p=1).
const OPTS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTS);
}

export async function verifyPassword(hashed: string | null, plain: string): Promise<boolean> {
  if (!hashed) {
    // Tiempo constante aproximado para no revelar si existe la cuenta.
    await hash(plain, OPTS);
    return false;
  }
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

export function passwordProblem(plain: string): string | null {
  if (plain.length < 10) return "La contraseña debe tener al menos 10 caracteres.";
  if (plain.length > 200) return "La contraseña es demasiado larga.";
  return null;
}
