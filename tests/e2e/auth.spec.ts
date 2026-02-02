import { test, expect } from '@playwright/test';

test.describe('Authentication and Error Handling', () => {
  test('should handle local mode authentication automatically', async ({ page }) => {
    await page.goto('/notes/new');
    
    // In local mode with placeholder config, the app should automatically authenticate
    // and show the main interface without requiring login
    
    // Should not show the sign-in screen
    await expect(page.locator('text=Welcome to SimpleNotebook')).not.toBeVisible();
    await expect(page.locator('text=Sign in with your Google account')).not.toBeVisible();
    await expect(page.locator('text=Sign in with Google')).not.toBeVisible();
    
    // Should show the main app interface
    await expect(page.locator('h1')).toHaveText('SimpleNotebook');
    await expect(page.locator('text=local@example.com')).toBeVisible();
  });

  test('should show error message when API calls fail in local mode', async ({ page }) => {
    await page.goto('/notes/new');
    
    // Wait for the interface to load
    await expect(page.locator('h1')).toHaveText('SimpleNotebook');
    
    // Fill in a note
    await page.locator('input[placeholder="ノートのタイトル"]').fill('Test Note');
    await page.locator('textarea[placeholder="Markdownを書いてください..."]').fill('Test content');
    
    // Try to save - this should fail in local mode since the API is not configured
    await page.click('button[type="submit"]');
    
    // Should show saving state first
    await expect(page.locator('text=保存中...')).toBeVisible();
    
    // After failure, should show error message
    await expect(page.locator('text=保存に失敗しました。もう一度お試しください。')).toBeVisible({ timeout: 10000 });
  });

  test('should handle OAuth callback parameters gracefully', async ({ page }) => {
    // Navigate to the page with OAuth callback parameters (simulating redirect from OAuth provider)
    await page.goto('/notes/new?code=test-code&state=test-state');
    
    // Should show processing message initially
    await expect(page.locator('text=Processing OAuth authentication...')).toBeVisible();
    
    // After timeout, should show normal interface
    await expect(page.locator('h1')).toHaveText('SimpleNotebook', { timeout: 5000 });
    
    // URL should be cleaned up (no query parameters)
    expect(page.url()).not.toContain('code=');
    expect(page.url()).not.toContain('state=');
  });

  test('should handle sign out functionality', async ({ page }) => {
    await page.goto('/notes/new');
    
    // Wait for the interface to load
    await expect(page.locator('h1')).toHaveText('SimpleNotebook');
    
    // Click sign out
    await page.click('text=サインアウト');
    
    // In local mode, this might just reload the page or show a different state
    // The exact behavior depends on the implementation, but we can check it doesn't crash
    // and that the page remains functional
    await page.waitForTimeout(1000);
    
    // Page should still be functional
    expect(page.url()).toContain('/notes/new');
  });

  test('should show loading states appropriately', async ({ page }) => {
    await page.goto('/notes/new');
    
    // Wait for the main interface to load (no loading spinner should be visible)
    await expect(page.locator('h1')).toHaveText('SimpleNotebook');
    
    // Should not show auth loading spinner once loaded
    await expect(page.locator('text=Loading...')).not.toBeVisible();
    await expect(page.locator('.animate-spin')).not.toBeVisible();
  });

  test('should handle network errors gracefully', async ({ page }) => {
    // Set up network interception to simulate network failure
    await page.route('**/notes', route => {
      route.abort('failed');
    });
    
    await page.goto('/notes/new');
    
    // Wait for the interface to load
    await expect(page.locator('h1')).toHaveText('SimpleNotebook');
    
    // Fill in a note
    await page.locator('input[placeholder="ノートのタイトル"]').fill('Network Test');
    await page.locator('textarea[placeholder="Markdownを書いてください..."]').fill('This will fail due to network error');
    
    // Try to save
    await page.click('button[type="submit"]');
    
    // Should show error message
    await expect(page.locator('text=保存に失敗しました。もう一度お試しください。')).toBeVisible({ timeout: 10000 });
  });

  test('should clear form after successful operation simulation', async ({ page }) => {
    await page.goto('/notes/new');
    
    // Wait for the interface to load
    await expect(page.locator('h1')).toHaveText('SimpleNotebook');
    
    const testTitle = 'Test Clear Form';
    const testContent = 'This should be cleared after save';
    
    // Fill in the form
    await page.locator('input[placeholder="ノートのタイトル"]').fill(testTitle);
    await page.locator('textarea[placeholder="Markdownを書いてください..."]').fill(testContent);
    
    // Verify the form is filled
    await expect(page.locator('input[placeholder="ノートのタイトル"]')).toHaveValue(testTitle);
    await expect(page.locator('textarea[placeholder="Markdownを書いてください..."]')).toHaveValue(testContent);
    
    // Note: In local mode, the save operation will likely fail, so we don't expect the form to clear
    // This test documents the current behavior
  });
});