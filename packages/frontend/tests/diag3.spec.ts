import { test, expect } from "@playwright/test";
import { navigateWithWait, cleanupRoutes, setupConsoleErrorCapture } from "./helpers";

test("Project Status isolated timing probe", async ({ browser }) => {
  const ctx = await browser!.newContext();
  const p = await ctx.newPage();
  const consoleErrors = setupConsoleErrorCapture(p);
  try {
    await cleanupRoutes(p);
    await navigateWithWait(p, "/analyze/ai");
    await p.getByRole("button", { name: /Show all/ }).first().click();
    await p.getByRole("button", { name: /^gemma4:e2b-it-qat/ }).first().click();
    const sendBtn = p.getByRole("button", { name: /^Send$/ });
    const generatingBtn = p.getByRole("button", { name: /^Generating…$/ });

    await p.getByRole("button", { name: "Project Status", exact: true }).click();
    await expect(sendBtn).toBeEnabled({ timeout: 5000 });
    const t0 = Date.now();
    await sendBtn.click();
    await expect(generatingBtn).toBeHidden({ timeout: 300000 });
    const ms = Date.now() - t0;

    const blocks = p.locator(
      "div.bg-gray-700.border.border-gray-600 div.whitespace-pre-wrap",
    );
    const content = ((await blocks.last().textContent()) ?? "").trim();
    // eslint-disable-next-line no-console
    console.log(
      `PROJECT STATUS: ${ms}ms len=${content.length} errors=${JSON.stringify(
        consoleErrors,
      )}\n${content}`,
    );
    expect(content.length).toBeGreaterThan(0);
  } finally {
    await ctx.close().catch(() => {});
  }
});
