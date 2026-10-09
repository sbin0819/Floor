import { expect, test } from "@playwright/test";

test("renders the full synthetic plan while panning and zooming for five seconds", async ({
  page,
}) => {
  const errors: string[] = [];
  const apiRequests: string[] = [];
  const workers: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("worker", (worker) => workers.push(worker.url()));
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/"))
      apiRequests.push(request.url());
  });
  await page.goto("/dev/stress-render");
  await expect(page.locator("[data-stress-ready=true]")).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator("[data-stress-canvas] canvas")).toHaveCount(3);
  expect(workers).toHaveLength(1);
  await page.getByRole("button", { name: "확대·이동 되풀이" }).click();
  const result = page.locator('[data-stress-results="complete"]');
  await expect(result).toBeVisible({ timeout: 15_000 });
  const p50 = Number(await result.getAttribute("data-p50"));
  const p95 = Number(await result.getAttribute("data-p95"));
  const frames = Number(await result.getAttribute("data-frames"));
  const elapsed = Number(await result.getAttribute("data-elapsed"));
  console.log(
    `Floor stress: p50=${p50.toFixed(2)}ms p95=${p95.toFixed(2)}ms frames=${frames} elapsed=${elapsed.toFixed(0)}ms`,
  );
  expect(elapsed).toBeGreaterThanOrEqual(5000);
  expect(frames).toBeGreaterThan(100);
  expect(p50).toBeGreaterThan(0);
  expect(p95).toBeLessThanOrEqual(33);
  expect(apiRequests).toEqual([]);
  expect(errors).toEqual([]);
});
