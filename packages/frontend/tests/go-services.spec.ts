import { expect, test } from "@playwright/test";
import {
  cleanupRoutes,
  expectNoConsoleErrors,
  mockGoServiceHealth,
  mockGoServiceHealthDegraded,
  mockHealthPage,
  navigateWithWait,
  setupConsoleErrorCapture,
  BACKEND_OFFLINE_FILTERS,
} from "./helpers";

test.describe("GoServicesCard", () => {
  test.beforeEach(async ({ page }) => {
    await cleanupRoutes(page);
  });

  test("renders Go services as all online when healthy", async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockHealthPage(page);
    await mockGoServiceHealth(page);
    await navigateWithWait(page, "/health");

    const card = page.locator(".card", { hasText: "Go Sidecars" });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.locator("h3")).toContainText("5/5 online");

    const services = ["Go Dashboard", "Go Media", "Go Worker", "Go Gateway", "Go Ports"];
    for (const svc of services) {
      await expect(page.getByText(svc)).toBeVisible();
    }

    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });

  test("shows degraded state when some Go services are offline", async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockHealthPage(page);
    await mockGoServiceHealthDegraded(page, ["go-media", "go-ports"]);
    await navigateWithWait(page, "/health");

    const card = page.locator(".card", { hasText: "Go Sidecars" });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.locator("h3")).toContainText("3/5 online");

    await expect(page.getByText("Offline").first()).toBeVisible();

    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });

  test("shows all offline when no Go services respond", async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockHealthPage(page);
    await mockGoServiceHealthDegraded(page, [
      "go-dashboard",
      "go-media",
      "go-worker",
      "go-gateway",
      "go-ports",
    ]);
    await navigateWithWait(page, "/health");

    const card = page.locator(".card", { hasText: "Go Sidecars" });
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card.locator("h3")).toContainText("0/5 online");

    expectNoConsoleErrors(errors, BACKEND_OFFLINE_FILTERS);
  });

  test("GoServicesCard does not throw when backend health is failing", async ({ page }) => {
    const errors = setupConsoleErrorCapture(page);
    await mockHealthPage(page, { healthStatus: 500 });
    await mockGoServiceHealth(page);
    await navigateWithWait(page, "/health");

    const card = page.locator(".card", { hasText: "Go Sidecars" });
    await expect(card).toBeVisible({ timeout: 10_000 });

    expectNoConsoleErrors(errors, ["502", "Bad Gateway", "ECONNREFUSED", "500"]);
  });
});
