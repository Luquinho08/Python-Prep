import "server-only";
import { redirect } from "next/navigation";

export function redirectOk(path: string, msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}ok=${encodeURIComponent(msg)}`);
}

export function redirectError(path: string, msg: string): never {
  redirect(`${path}${path.includes("?") ? "&" : "?"}error=${encodeURIComponent(msg)}`);
}

export function zodMessage(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((i) => (i.path.length ? `${String(i.path[0])}: ${i.message}` : i.message)).join(" · ");
}
