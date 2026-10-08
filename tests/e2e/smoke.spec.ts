import { expect, test } from "@playwright/test";

test("비로그인 계정 설정은 로그인 복귀 주소를 보존해요", async ({ page }) => {
  await page.goto("/settings/account");
  await expect(
    page.getByRole("heading", { name: "Floor에 로그인", exact: true }),
  ).toBeVisible();
  const url = new URL(page.url());
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("next")).toBe("/settings/account");
});

test("로그인하지 않은 파일 내려받기는 401이에요", async ({ request }) => {
  const response = await request.get(
    "/api/files/48db9ea0-4f45-4168-a2b1-e44a26c59791",
  );
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("private, no-cache");
});

test("서명 없는 통화 웹훅과 비로그인 아직 있음 요청을 거절해요", async ({
  request,
}) => {
  const webhook = await request.post("/api/livekit/webhook", {
    data: {
      event: "room_finished",
      room: { name: "call:11111111-1111-4111-8111-111111111111" },
    },
    maxRedirects: 0,
  });
  expect([401, 404]).toContain(webhook.status());
  expect(await webhook.text()).toBe("");
  expect(webhook.headers()["cache-control"]).toBe("no-store");
  const heartbeat = await request.post("/api/calls/heartbeat", {
    data: { participantId: "11111111-1111-4111-8111-111111111111" },
    maxRedirects: 0,
  });
  expect(heartbeat.status()).toBe(401);
  expect(heartbeat.headers()["cache-control"]).toBe("no-store");
  expect(await heartbeat.text()).toBe("");
  expect(heartbeat.headers().location).toBeUndefined();
});

test("비로그인 스페이스 초대는 로그인 후 돌아올 주소를 보존해요", async ({
  page,
}) => {
  const path = "/s/join/aaaaaaaaaaaaaaaaaaaaaa";
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Floor에 로그인", exact: true }),
  ).toBeVisible();
  const url = new URL(page.url());
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("next")).toBe(path);
});

test("비로그인 회의 채널은 로그인으로 안내해요", async ({ page }) => {
  const path = "/m/11111111-1111-4111-8111-111111111111";
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Floor에 로그인", exact: true }),
  ).toBeVisible();
  const url = new URL(page.url());
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("next")).toBe(path);
});

test("비로그인 친구 화면은 로그인으로, 사람 찾기는 401로 안내해요", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/people/search?q=a", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(await response.json()).toEqual({ code: "UNAUTHENTICATED" });
  await page.goto("/friends");
  await expect(
    page.getByRole("heading", { name: "Floor에 로그인", exact: true }),
  ).toBeVisible();
  const url = new URL(page.url());
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("next")).toBe("/friends");
});

test("비로그인 채팅의 이전 메시지와 목록 API는 401로 답해요", async ({
  request,
}) => {
  for (const path of [
    "/api/rooms/11111111-1111-4111-8111-111111111111/messages?after=0",
    "/api/chat/nav",
  ]) {
    const response = await request.get(path);
    expect(response.status()).toBe(401);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(await response.json()).toEqual({ code: "UNAUTHENTICATED" });
  }
});

test("비로그인 메시지 화면은 로그인으로, 실시간 토큰은 401로 안내해요", async ({
  page,
  request,
}) => {
  const response = await request.post("/api/realtime/token", {
    data: { rooms: [] },
    maxRedirects: 0,
  });
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(response.headers().location).toBeUndefined();
  await page.goto("/messages");
  await expect(
    page.getByRole("heading", { name: "Floor에 로그인", exact: true }),
  ).toBeVisible();
  const url = new URL(page.url());
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("next")).toBe("/messages");
});

test("비로그인 예약 수정 화면은 로그인으로 안내해요", async ({ page }) => {
  const path = "/bookings/11111111-1111-4111-8111-111111111111/edit";
  await page.goto(path);
  await expect(
    page.getByRole("heading", { name: "Floor에 로그인", exact: true }),
  ).toBeVisible();
  const url = new URL(page.url());
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("next")).toBe(path);
});

test("비로그인 알림 API는 401이고 알림 화면은 로그인으로 안내해요", async ({
  request,
  page,
}) => {
  const response = await request.get("/api/notifications", { maxRedirects: 0 });
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(response.headers().location).toBeUndefined();
  await page.goto("/notifications");
  await expect(
    page.getByRole("heading", { name: "Floor에 로그인", exact: true }),
  ).toBeVisible();
  const url = new URL(page.url());
  expect(url.pathname).toBe("/login");
  expect(url.searchParams.get("next")).toBe("/notifications");
});

test("비로그인 참석자 검색은 로그인 이동 없이 401로 답해요", async ({
  request,
}) => {
  const response = await request.get("/api/participants/search?q=ab", {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(response.headers().location).toBeUndefined();
});

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
    page.getByRole("button", { name: "비밀번호 보기" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("비밀번호", { exact: true })).toHaveAttribute(
    "type",
    "text",
  );
  await expect(
    page.getByRole("button", { name: "비밀번호 숨기기" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
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
