import { mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { addSimpleProduct, login, noHorizontalOverflow } from "./helpers";

const WIDTHS = [360, 390, 768, 1440];
const OUT = "docs/screenshots";

test.describe("revisión visual y responsive", () => {
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));

  for (const width of WIDTHS) {
    test(`páginas clave a ${width}px sin desbordamiento`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      const pages: [string, string][] = [
        ["inicio", "/"],
        ["catalogo", "/productos"],
        ["ficha", "/productos/invitaciones-dino-aventura"],
      ];
      for (const [name, url] of pages) {
        await page.goto(url, { waitUntil: "networkidle" });
        await noHorizontalOverflow(page);
        await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true });
      }
      await addSimpleProduct(page, "toppers-dino-aventura");
      await page.goto("/carrito", { waitUntil: "networkidle" });
      await noHorizontalOverflow(page);
      await page.screenshot({ path: `${OUT}/carrito-${width}.png`, fullPage: true });
      await page.goto("/checkout", { waitUntil: "networkidle" });
      await noHorizontalOverflow(page);
      await page.screenshot({ path: `${OUT}/checkout-${width}.png`, fullPage: true });
    });
  }

  test("panel de administración (escritorio y móvil)", async ({ page }) => {
    await login(page, "owner@chulada.test");
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const [name, url] of [["admin-resumen", "/admin"], ["admin-pagos", "/admin/pagos"], ["admin-producto", "/admin/productos"]]) {
        await page.goto(url, { waitUntil: "networkidle" });
        await expect(page.locator("h1").first()).toBeVisible();
        await page.screenshot({ path: `${OUT}/${name}-${width}.png`, fullPage: true });
      }
    }
  });
});
