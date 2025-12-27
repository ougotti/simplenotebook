import { test, expect } from '@playwright/test';

test.describe('Debug Tests', () => {
  test('debug page loading and content', async ({ page }) => {
    console.log('Starting debug test...');
    
    // Go to root page
    await page.goto('/');
    console.log('Navigated to root page');
    
    // Take screenshot of root page
    await page.screenshot({ path: 'debug-root.png' });
    console.log('Screenshot taken: debug-root.png');
    
    // Get current URL
    console.log('Current URL after root:', page.url());
    
    // Wait a bit to see if redirect happens
    await page.waitForTimeout(3000);
    console.log('Current URL after wait:', page.url());
    
    // Take screenshot after wait
    await page.screenshot({ path: 'debug-after-wait.png' });
    
    // Try to navigate directly to /notes/new
    await page.goto('/notes/new');
    console.log('Navigated directly to /notes/new');
    console.log('Final URL:', page.url());
    
    // Take screenshot of notes/new page
    await page.screenshot({ path: 'debug-notes-new.png' });
    
    // Get page content
    const pageContent = await page.content();
    console.log('Page HTML length:', pageContent.length);
    
    // Check for specific elements
    const h1Elements = await page.locator('h1').count();
    console.log('H1 elements found:', h1Elements);
    
    if (h1Elements > 0) {
      const h1Text = await page.locator('h1').first().textContent();
      console.log('First H1 text:', h1Text);
    }
    
    // Check for form elements
    const inputCount = await page.locator('input').count();
    const textareaCount = await page.locator('textarea').count();
    const buttonCount = await page.locator('button').count();
    
    console.log('Elements found:');
    console.log('  - Inputs:', inputCount);
    console.log('  - Textareas:', textareaCount);
    console.log('  - Buttons:', buttonCount);
    
    // List all visible text
    const bodyText = await page.locator('body').textContent();
    console.log('Body text preview:', bodyText?.substring(0, 500));
  });
});