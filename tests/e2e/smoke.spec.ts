import { expect, test } from "@playwright/test";

test("Floor 홈페이지를 열 수 있어요", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Floor");
  await expect(
    page.getByRole("heading", { name: "Floor", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
});
