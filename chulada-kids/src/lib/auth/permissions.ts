export type Role = "customer" | "owner" | "catalog_editor" | "order_operator";

export const STAFF_ROLES: Role[] = ["owner", "catalog_editor", "order_operator"];

const MATRIX = {
  "dashboard:read": ["owner", "catalog_editor", "order_operator"],
  "catalog:write": ["owner", "catalog_editor"],
  "promotions:write": ["owner", "catalog_editor"],
  "content:write": ["owner", "catalog_editor"],
  "orders:read": ["owner", "order_operator"],
  "orders:write": ["owner", "order_operator"],
  "orders:export": ["owner", "order_operator"],
  "orders:refund": ["owner"],
  "customers:read": ["owner", "order_operator"],
  "shipping:write": ["owner"],
  "settings:write": ["owner"],
  "payments:manage": ["owner"],
  "team:manage": ["owner"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof MATRIX;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (MATRIX[permission] as readonly Role[]).includes(role);
}

export function isStaff(role: Role | null | undefined): boolean {
  return !!role && STAFF_ROLES.includes(role);
}

export const ROLE_LABELS: Record<Role, string> = {
  customer: "Cliente",
  owner: "Propietario",
  catalog_editor: "Editor de catálogo",
  order_operator: "Operador de pedidos",
};
