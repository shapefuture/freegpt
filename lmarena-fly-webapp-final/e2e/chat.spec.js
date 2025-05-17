const { test, expect } = require('@playwright/test');

test.describe('LMArena E2E - Basic Chat Flow', () => {
  test('should load, select models, send chat, and receive responses', async ({ page }) => {
    await page.goto('/');

    // Wait for model selectors to load
    await expect(page.locator('#modelAId')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('#modelAId option')).toHaveCountGreaterThan(0);

    // Select first available models
    await page.selectOption('#modelAId', { index: 0 });
    await page.selectOption('#modelBId', { index: 0 });

    // Fill in prompts
    await page.fill('#systemPrompt', 'You are an E2E test assistant.');
    await page.fill('#userPrompt', 'Hello from E2E test!');

    // Click send
    await page.click('#sendButton');

    // Wait for the streaming status or first model output
    await expect(page.locator('.status-area')).toContainText(/sending|status|attempt|response/i, { timeout: 15000 });

    // Wait for at least one model response box to be populated
    await expect(page.locator('#modelAResponse')).not.toBeEmpty({ timeout: 45000 });
    // Model B might also be filled, but one is enough for basic E2E

    // Accessibility: can tab to all controls
    await page.keyboard.press('Tab');
    await expect(page.locator('#systemPrompt')).toBeFocused();
  });
});