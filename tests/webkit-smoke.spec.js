const { test, expect } = require("@playwright/test");

test("loads the WebKit-compatible studio shell and security policy", async ({ page, request }) => {
  const response = await request.get("/");
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-security-policy"]).toContain("default-src 'self'");
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "파일을 선택하세요" })).toBeVisible();
  await expect(page.locator("#audio-file")).toBeAttached();
  await expect(page.locator("#play-button")).toBeDisabled();
});

test("keeps non-audio controls usable in WebKit", async ({ page }) => {
  await page.goto("/");
  await page.locator("#theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#perf-toggle, #perf-panel")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "오디오 분석 필드" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Stem 반응 바" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "스펙트럼 밴드" })).toBeVisible();
});
