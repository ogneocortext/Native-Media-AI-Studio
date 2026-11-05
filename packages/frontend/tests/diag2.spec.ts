import { test, expect } from "@playwright/test";
import { navigateWithWait, cleanupRoutes } from "./helpers";

test("send flow probe: Video Concept template", async ({ page }) => {
  await cleanupRoutes(page);
  await navigateWithWait(page, "/analyze/ai");

  await page.getByRole("button", { name: /Show all/ }).first().click();
  await page.getByRole("button", { name: "gemma4:e2b-it-qat" }).first().click();

  const promptBox = page.locator(
    'textarea[placeholder*="Ask for video concepts"]',
  );
  const sendBtn = page.getByRole("button", { name: /^Send$/ });

  // Click a template
  await page.getByRole("button", { name: "Video Concept", exact: true }).click();
  const promptValue = await promptBox.inputValue();
  // eslint-disable-next-line no-console
  console.log("PROMPT_FILLED:", JSON.stringify(promptValue));
  await expect(sendBtn).toBeEnabled({ timeout: 5000 });

  const generating = page.getByText("Generating…");
  await sendBtn.click();

  // Did generating start?
  try {
    await expect(generating).toBeVisible({ timeout: 8000 });
  } catch {
    // eslint-disable-next-line no-console
    console.log("GENERATING never became visible");
  }

  // Wait for it to finish
  try {
    await expect(generating).toBeHidden({ timeout: 110000 });
    // eslint-disable-next-line no-console
    console.log("GENERATING finished");
  } catch {
    // eslint-disable-next-line no-console
    console.log("GENERATING did not finish in time");
  }

  // Read assistant content blocks
  const blocks = page.locator("div.bg-gray-700.border.border-gray-600 div.whitespace-pre-wrap");
  const count = await blocks.count();
  // eslint-disable-next-line no-console
  console.log("ASSISTANT_BLOCK_COUNT:", count);
  for (let i = 0; i < count; i++) {
    const t = await blocks.nth(i).textContent();
    // eslint-disable-next-line no-console
    console.log(`BLOCK[${i}] len=${t ? t.length : 0}:`, JSON.stringify((t ?? "").slice(0, 200)));
  }

  // Any error card?
  const errorCount = await page.locator(".text-red-400, [class*='cardError']").count();
  // eslint-disable-next-line no-console
  console.log("ERROR_CARD_COUNT:", errorCount);
});
