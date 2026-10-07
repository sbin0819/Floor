import { expect, test } from "@playwright/test";

test("Floor 홈페이지를 열 수 있어요", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Floor");
  await expect(
    page.getByRole("heading", { name: "Floor", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(247, 247, 245)",
  );
  await expect(page.locator("body")).toHaveCSS("color", "rgb(28, 28, 26)");
  await expect(page.getByText("내 예약", { exact: true })).toHaveCSS(
    "border-color",
    "rgb(58, 91, 217)",
  );
  await expect(page.getByRole("listitem")).toHaveCount(6);
});
