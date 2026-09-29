import { expect, test } from "@playwright/test";

test.describe("tienda pública", () => {
  test("inicio permite encontrar productos: buscador, categorías y destacados", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("search")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Categorías" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Destacados" })).toBeVisible();
    await page.getByLabel("Buscar productos").first().fill("CUMPLEAÑOS");
    await page.getByLabel("Buscar productos").first().press("Enter");
    await page.waitForURL(/\/productos\?q=/);
    await expect(page.getByText(/\d+ productos?/).first()).toBeVisible();
    await expect(page.locator("article").first()).toBeVisible();
  });

  test("filtros reflejados en la URL y mensaje sin resultados", async ({ page }) => {
    await page.goto("/productos?personalizable=1&orden=precio-asc");
    const count = await page.locator("article").count();
    expect(count).toBeGreaterThan(0);
    await expect(page.locator("article", { hasText: "Personalizable" })).toHaveCount(count);
    await page.goto("/productos?q=zzzzzz");
    await expect(page.getByRole("heading", { name: "No encontramos productos" })).toBeVisible();
  });

  test("borradores no se ven en la tienda", async ({ page }) => {
    const res = await page.goto("/productos/agenda-2027-borrador");
    expect(res?.status()).toBe(404);
  });

  test("personalización obligatoria y complementarios que requieren opciones", async ({ page }) => {
    await page.goto("/productos/invitaciones-dino-aventura");
    await page.getByRole("button", { name: "Agregar al carrito" }).click();
    await expect(page.getByText("Completá “Nombre de quien cumple”.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Completá tu idea" })).toBeVisible();
    const sobres = page.locator("li", { hasText: "Sobres pastel" });
    await expect(sobres.getByRole("link", { name: "Elegir opciones" })).toBeVisible();
    const stickers = page.locator("li", { hasText: "Stickers redondos Arcoíris" });
    await expect(stickers.getByText("Sumar")).toBeVisible();
    // Nada preseleccionado.
    await expect(page.getByRole("button", { name: "Agregar seleccionados al carrito" })).toBeDisabled();
  });

  test("teclado: enlace para saltar al contenido y foco visible", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Saltar al contenido" });
    await expect(skip).toBeFocused();
    const outline = await skip.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).not.toBe("none");
  });
});
