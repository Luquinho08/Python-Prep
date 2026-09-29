import { expect, type Page } from "@playwright/test";

export const PASSWORD = "e2e-password-segura-2026";

export async function login(page: Page, email: string) {
  await page.goto("/cuenta/ingresar");
  await page.locator("#login-email").fill(email);
  await page.locator("#login-pass").fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar", exact: true }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/cuenta/ingresar"));
}

export async function addSimpleProduct(page: Page, slug = "kit-cumple-dino-aventura") {
  await page.goto(`/productos/${slug}`);
  await page.getByRole("button", { name: "Agregar al carrito" }).click();
  await expect(page.getByText("¡Listo! Agregamos el producto al carrito.")).toBeVisible();
}

export async function fillCheckoutPickup(page: Page, email = "comprador@example.com") {
  await page.goto("/checkout");
  await page.getByLabel("Nombre y apellido").fill("Compradora E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Teléfono").fill("11 4444 4444");
  await page.getByLabel("Código postal").fill("1425");
  await page.getByRole("button", { name: "Ver opciones de entrega" }).click();
  await page.getByText("Retiro en punto de entrega").click();
  await page.getByRole("checkbox", { name: /Acepto los/ }).check();
  await page.getByRole("button", { name: /Continuar al pago|Confirmar nuevo total/ }).click();
  // Puede pedir confirmar el total si se recalculó con el envío.
  const confirm = page.getByRole("button", { name: /Confirmar nuevo total/ });
  if (await confirm.isVisible({ timeout: 1500 }).catch(() => false)) await confirm.click();
  await expect(page.getByText(/Pedido CK-\d+ creado/)).toBeVisible();
  await page.waitForURL(/pedido=/);
}

export async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "sin desbordamiento horizontal").toBeLessThanOrEqual(0);
}
