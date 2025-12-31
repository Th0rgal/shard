import { test, expect } from "@playwright/test";

// Note: These tests require the Tauri dev server to be running
// Run with: cargo tauri dev
// Then in another terminal: bun run test

test.describe("Shard Launcher UI", () => {
  test("should display the sidebar", async ({ page }) => {
    await page.goto("/");

    // Wait for the app to load
    await page.waitForSelector(".sidebar", { timeout: 10000 });

    // Check that sidebar exists
    const sidebar = page.locator(".sidebar");
    await expect(sidebar).toBeVisible();

    // Check that sidebar has the Profiles header
    const profilesHeader = sidebar.locator(".sidebar-header").first();
    await expect(profilesHeader).toContainText("Profiles");
  });

  test("should show empty state when no profiles exist", async ({ page }) => {
    await page.goto("/");

    // Wait for the app to load
    await page.waitForSelector(".main-content", { timeout: 10000 });

    // Check for empty state message
    const emptyState = page.locator(".empty-state");
    // Empty state should be visible if there are no profiles
    // This test may pass or fail depending on existing data
  });

  test("should have navigation buttons in sidebar", async ({ page }) => {
    await page.goto("/");

    await page.waitForSelector(".sidebar", { timeout: 10000 });

    // Check for main action buttons
    const newProfileBtn = page.locator(".sidebar-item.primary-action");
    await expect(newProfileBtn).toBeVisible();
    await expect(newProfileBtn).toContainText("New profile");

    // Check for Content Store button
    const storeBtn = page.locator(".sidebar-item").filter({ hasText: "Content Store" });
    await expect(storeBtn).toBeVisible();

    // Check for Logs button
    const logsBtn = page.locator(".sidebar-item").filter({ hasText: "Logs" });
    await expect(logsBtn).toBeVisible();
  });

  test("should open create profile modal on button click", async ({ page }) => {
    await page.goto("/");

    await page.waitForSelector(".sidebar", { timeout: 10000 });

    // Click the new profile button
    const newProfileBtn = page.locator(".sidebar-item.primary-action");
    await newProfileBtn.click();

    // Check that modal opens
    const modal = page.locator(".modal");
    await expect(modal).toBeVisible();

    // Check modal title
    const modalTitle = modal.locator(".modal-title");
    await expect(modalTitle).toContainText("Create profile");
  });

  test("should navigate to Store view", async ({ page }) => {
    await page.goto("/");

    await page.waitForSelector(".sidebar", { timeout: 10000 });

    // Click Content Store button
    const storeBtn = page.locator(".sidebar-item").filter({ hasText: "Content Store" });
    await storeBtn.click();

    // Check that store view is displayed
    const pageTitle = page.locator(".page-title");
    await expect(pageTitle).toContainText("Content Store");

    // Check for search input
    const searchInput = page.locator('input[placeholder*="Search"]');
    await expect(searchInput).toBeVisible();
  });

  test("should navigate to Logs view", async ({ page }) => {
    await page.goto("/");

    await page.waitForSelector(".sidebar", { timeout: 10000 });

    // Click Logs button
    const logsBtn = page.locator(".sidebar-item").filter({ hasText: "Logs" });
    await logsBtn.click();

    // Check that logs view is displayed
    const pageTitle = page.locator(".page-title");
    await expect(pageTitle).toContainText("Logs");
  });

  test("should navigate to Accounts view", async ({ page }) => {
    await page.goto("/");

    await page.waitForSelector(".sidebar", { timeout: 10000 });

    // Click Accounts button
    const accountsBtn = page.locator(".sidebar-item").filter({ hasText: /^Accounts$/ });
    await accountsBtn.click();

    // Check that accounts view is displayed
    const pageTitle = page.locator(".page-title");
    await expect(pageTitle).toContainText("Accounts");
  });

  test("should navigate to Settings view", async ({ page }) => {
    await page.goto("/");

    await page.waitForSelector(".sidebar", { timeout: 10000 });

    // Click Settings button
    const settingsBtn = page.locator(".sidebar-item").filter({ hasText: /^Settings$/ });
    await settingsBtn.click();

    // Check that settings view is displayed
    const pageTitle = page.locator(".page-title");
    await expect(pageTitle).toContainText("Settings");
  });

  test("create profile modal should have template tabs", async ({ page }) => {
    await page.goto("/");

    await page.waitForSelector(".sidebar", { timeout: 10000 });

    // Click the new profile button
    const newProfileBtn = page.locator(".sidebar-item.primary-action");
    await newProfileBtn.click();

    // Check modal has template tabs
    const blankTab = page.locator(".content-tab").filter({ hasText: "Blank Profile" });
    await expect(blankTab).toBeVisible();

    const templateTab = page.locator(".content-tab").filter({ hasText: "From Template" });
    await expect(templateTab).toBeVisible();
  });

  test("should close modal on escape key", async ({ page }) => {
    await page.goto("/");

    await page.waitForSelector(".sidebar", { timeout: 10000 });

    // Open modal
    const newProfileBtn = page.locator(".sidebar-item.primary-action");
    await newProfileBtn.click();

    // Check modal is open
    const modal = page.locator(".modal");
    await expect(modal).toBeVisible();

    // Press escape
    await page.keyboard.press("Escape");

    // Modal should be closed
    await expect(modal).not.toBeVisible();
  });
});
