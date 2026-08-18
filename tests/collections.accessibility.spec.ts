import { expect, test } from "@playwright/test";

test("price filters have accessible names and support semantic navigation", async ({ page }) => {
  await page.goto("/shop", { waitUntil: "domcontentloaded" });

  const filterForm = page.getByRole("form", { name: "Product filters" });
  await expect(filterForm).toBeVisible();

  const minPrice = filterForm.getByRole("spinbutton", { name: "Minimum price" });
  const maxPrice = filterForm.getByRole("spinbutton", { name: "Maximum price" });
  await expect(minPrice).toHaveAttribute("name", "min_price");
  await expect(maxPrice).toHaveAttribute("name", "max_price");
  await expect(filterForm.getByRole("group", { name: "Price" })).toBeVisible();

  await minPrice.fill("10");
  await expect(page).toHaveURL(/min_price=10/);
  await maxPrice.fill("20");
  await expect(page).toHaveURL(/max_price=20/);

  await expect(filterForm.getByRole("button", { name: "Clear all" }).first()).toBeVisible();
});
