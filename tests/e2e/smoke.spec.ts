import { expect, test } from "@playwright/test";

for (const path of ["/booking", "/teams"]) {
  test(`비로그인 ${path} 접근은 로그인으로 안내해요`, async ({ page }) => {
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: "Floor에 로그인", exact: true }),
    ).toBeVisible();
    const url = new URL(page.url());
    expect(url.pathname).toBe("/login");
    expect(url.searchParams.get("next")).toBe(path);
  });
}

test("비로그인 운영 지점 접근은 운영자 로그인으로 안내해요", async ({
  page,
}) => {
  await page.goto("/admin/branches/11111111-1111-4111-8111-111111111111");
  await expect(page).toHaveURL("http://127.0.0.1:3100/admin/login");
  await expect(
    page.getByRole("heading", { name: "운영자 로그인" }),
  ).toBeVisible();
});

test("비로그인 홈은 DB에 접속하지 않고 로그인으로 안내해요", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page).toHaveTitle("Floor");
  await expect(
    page.getByRole("heading", { name: "Floor에 로그인", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  await expect(page.locator("body")).toHaveCSS(
    "background-color",
    "rgb(247, 247, 245)",
  );
  await expect(page.locator("body")).toHaveCSS("color", "rgb(28, 28, 26)");
  await expect(page).toHaveURL(/\/login\?next=%2F$/);
  await expect(page.getByLabel("이메일", { exact: true })).toBeVisible();
  await expect(page.getByLabel("비밀번호", { exact: true })).toBeVisible();
});

test("외부 next 주소가 이동 링크에 들어가지 않아요", async ({ page }) => {
  await page.goto("/login?next=https://example.com");
  await expect(page.getByRole("link", { name: "계정 만들기" })).toHaveAttribute(
    "href",
    "/signup?next=%2F",
  );
  for (const href of await page
    .locator("a[href]")
    .evaluateAll((links) => links.map((link) => link.getAttribute("href")))) {
    expect(href).not.toContain("example.com");
  }
  await page.getByRole("link", { name: "계정 만들기" }).click();
  await expect(page).toHaveURL("http://127.0.0.1:3100/signup?next=%2F");
});

test("이메일 서비스가 없는 production의 안내와 운영자 로그인은 공개돼요", async ({
  page,
}) => {
  await page.goto("/signup");
  await expect(
    page.getByText(
      "지금은 이메일로 가입하거나 재설정할 수 없어요. Google이나 GitHub로 계속해 주세요",
    ),
  ).toBeVisible();
  await expect(page.getByLabel("비밀번호", { exact: true })).toHaveCount(0);
  await page.goto("/admin");
  await expect(page).toHaveURL("http://127.0.0.1:3100/admin/login");
  await expect(
    page.getByRole("heading", { name: "운영자 로그인" }),
  ).toBeVisible();
});

test("키보드로 로그인 양식을 확인할 수 있어요", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("이메일", { exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("비밀번호", { exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", { name: "로그인", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("이메일", { exact: true })).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});
