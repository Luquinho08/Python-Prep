import { expect, test } from "@playwright/test";
import { addSimpleProduct, fillCheckoutPickup } from "./helpers";

test.describe("checkout de invitado (simulador de pagos)", () => {
  test("paga con tarjeta, ve el resultado desde el backend y accede a su pedido solo con el token", async ({ page, browser }) => {
    await addSimpleProduct(page, "stickers-arcoiris");
    await fillCheckoutPickup(page);
    await expect(page.getByRole("heading", { name: "Método de pago" })).toBeVisible();
    await expect(page.getByText("Tarjeta de crédito o débito — procesado por Mercado Pago")).toBeVisible();
    await expect(page.getByText("Pagar con mi cuenta de Mercado Pago")).toBeVisible();
    await expect(page.getByText("SIMULADOR LOCAL — NO ES MERCADO PAGO", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: /Comprar ·/ }).click();
    await page.waitForURL(/\/checkout\/resultado/);
    await expect(page.getByRole("heading", { name: "¡Gracias! Pago aprobado" })).toBeVisible();

    await page.getByRole("link", { name: "Ver mi pedido" }).click();
    await expect(page.getByRole("heading", { name: /Pedido CK-/ })).toBeVisible();
    await expect(page.getByText("Pagado").first()).toBeVisible();

    // Mismo pedido sin token, desde otra sesión: no se muestra.
    const url = new URL(page.url());
    const other = await browser.newContext();
    const p2 = await other.newPage();
    const res = await p2.goto(url.pathname);
    expect(res?.status()).toBe(404);
    await other.close();
  });

  test("un retorno con parámetros falsificados no marca el pedido como pagado", async ({ page }) => {
    await addSimpleProduct(page, "stickers-arcoiris");
    await fillCheckoutPickup(page, "falsificado@example.com");
    const u = new URL(page.url());
    const pedido = u.searchParams.get("pedido");
    const t = u.searchParams.get("t");
    await page.goto(`/checkout/resultado?pedido=${pedido}&t=${encodeURIComponent(t ?? "")}&collection_status=approved&status=approved&payment_id=999999`);
    await expect(page.getByRole("heading", { name: "Todavía no registramos un pago" })).toBeVisible();
  });

  test("rechazo muestra un mensaje útil y permite reintentar", async ({ page }) => {
    await addSimpleProduct(page, "stickers-arcoiris");
    await fillCheckoutPickup(page, "rechazo@example.com");
    await page.getByLabel("Resultado a simular").selectOption("reject");
    await page.getByRole("button", { name: /Comprar ·/ }).click();
    await expect(page.getByText(/fondos suficientes/)).toBeVisible();
    await page.getByLabel("Resultado a simular").selectOption("approve");
    await page.getByRole("button", { name: /Comprar ·/ }).click();
    await page.waitForURL(/\/checkout\/resultado/);
    await expect(page.getByRole("heading", { name: "¡Gracias! Pago aprobado" })).toBeVisible();
  });

  test("cuenta de Mercado Pago: cancelar vuelve al mismo pedido; luego aprobar", async ({ page }) => {
    await addSimpleProduct(page, "stickers-arcoiris");
    await fillCheckoutPickup(page, "wallet@example.com");
    await page.getByText("Pagar con mi cuenta de Mercado Pago").click();
    await expect(page.getByText(/Vas a ir al sitio de Mercado Pago/)).toBeVisible();
    await page.getByRole("button", { name: "Continuar con Mercado Pago" }).click();
    await page.getByRole("link", { name: /simulador de Mercado Pago/ }).click();
    await page.getByRole("button", { name: "Cancelar y volver a la tienda" }).click();
    await expect(page.getByRole("heading", { name: "Todavía no registramos un pago" })).toBeVisible();
    await page.getByRole("link", { name: "Elegir cómo pagar" }).click();
    await expect(page.getByText(/Pedido CK-\d+ creado/)).toBeVisible();
    await page.getByText("Pagar con mi cuenta de Mercado Pago").click();
    await page.getByRole("button", { name: "Continuar con Mercado Pago" }).click();
    await page.getByRole("link", { name: /simulador de Mercado Pago/ }).click();
    await page.getByRole("button", { name: "Aprobar pago" }).click();
    await expect(page.getByRole("heading", { name: "¡Gracias! Pago aprobado" })).toBeVisible();
  });

  test("3DS: la verificación del banco completa el pago", async ({ page }) => {
    await addSimpleProduct(page, "stickers-arcoiris");
    await fillCheckoutPickup(page, "tresds@example.com");
    await page.getByLabel("Resultado a simular").selectOption("challenge");
    await page.getByRole("button", { name: /Comprar ·/ }).click();
    const frame = page.frameLocator('iframe[title="Verificación del banco emisor"]');
    await frame.getByRole("button", { name: "Verificación correcta" }).click();
    await page.waitForURL(/\/checkout\/resultado/);
    await expect(page.getByRole("heading", { name: "¡Gracias! Pago aprobado" })).toBeVisible();
  });
});
