import { expect, test } from "@playwright/test";
import { login } from "./helpers";

test.describe("administración y permisos", () => {
  test("anónimo es enviado a ingresar; cliente no ve el panel", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/cuenta\/ingresar/);
    await login(page, "cliente@chulada.test");
    const res = await page.goto("/admin");
    expect(res?.status()).toBe(404);
  });

  test("editor de catálogo no accede a pedidos ni pagos; operador no accede a productos", async ({ page, browser }) => {
    await login(page, "editor@chulada.test");
    await page.goto("/admin/pedidos");
    await expect(page).toHaveURL(/sin_permiso=1/);
    await page.goto("/admin/pagos");
    await expect(page).toHaveURL(/sin_permiso=1/);
    await expect(page.getByRole("navigation", { name: "Administración" }).getByRole("link", { name: "Pedidos" })).toHaveCount(0);

    const ctx = await browser.newContext();
    const op = await ctx.newPage();
    await login(op, "operador@chulada.test");
    await op.goto("/admin/productos");
    await expect(op).toHaveURL(/sin_permiso=1/);
    await op.goto("/admin/pedidos");
    await expect(op.getByRole("heading", { name: "Pedidos" })).toBeVisible();
    await ctx.close();
  });

  test("propietario crea un producto, sube imagen y lo publica: aparece en el catálogo", async ({ page }) => {
    await login(page, "owner@chulada.test");
    await page.goto("/admin/productos/nuevo");
    await page.locator("#pf-name").fill("Banderín E2E");
    await page.locator("#pf-sku").fill("BAN-E2E");
    await page.locator("#pf-basePrice").fill("7.250");
    await page.locator("#pf-shortDescription").fill("Banderín creado por la prueba E2E.");
    await page.locator('input[name="categoryIds"]').first().check();
    await page.getByRole("button", { name: "Crear producto" }).click();
    await expect(page.getByText("Producto creado como borrador")).toBeVisible();

    // Publicar sin imagen: se rechaza con explicación.
    await page.locator("#pf-status").selectOption("published");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText(/no se pudo publicar: .*imagen/)).toBeVisible();

    await page.locator('input[name="stockOnHand"]').first().fill("4");
    await page.locator('form:has(input[name="stockOnHand"]) button:has-text("Guardar")').first().click();
    await expect(page.getByText("Variante guardada.")).toBeVisible();

    // PNG válido de 200x200 (se valida el contenido real, no la extensión). Se pasa como buffer.
    const sharp = (await import("sharp")).default;
    const png = await sharp({ create: { width: 200, height: 200, channels: 3, background: "#B1E9E6" } }).png().toBuffer();
    await page.locator("#img-files").setInputFiles({ name: "banderin.png", mimeType: "image/png", buffer: png });
    await page.getByRole("button", { name: "Subir", exact: true }).click();
    await expect(page.getByText(/imagen\(es\) subida/)).toBeVisible();

    await page.locator("#pf-status").selectOption("published");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Producto guardado y publicado.")).toBeVisible();

    await page.goto("/productos?q=banderin");
    await expect(page.locator("article", { hasText: "Banderín E2E" })).toBeVisible();
    await expect(page.locator("article", { hasText: "Banderín E2E" })).toContainText("7.250");
  });

  test("propietario cambia precio y stock: la tienda lo refleja", async ({ page }) => {
    await login(page, "owner@chulada.test");
    await page.goto("/admin/productos?q=TOP-ESP");
    await page.getByRole("link", { name: "Toppers Espacio y estrellas" }).click();
    await page.locator("#pf-basePrice").fill("6.900");
    await page.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(page.getByText("Producto guardado.")).toBeVisible();
    await page.goto("/productos/toppers-espacio");
    await expect(page.locator("h1 ~ div").getByText("$ 6.900").first()).toBeVisible();
  });
});
