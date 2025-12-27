import { test, expect } from '@playwright/test';

test.describe('Development Server Test', () => {
  test('should load dev server page and take screenshot', async ({ page }) => {
    console.log('Testing dev server at localhost:3001');
    
    // Navigate to development server
    await page.goto('http://localhost:3001/simplenotebook/notes/new', { waitUntil: 'networkidle' });
    
    console.log('Current URL:', page.url());
    
    // Take screenshot
    await page.screenshot({ path: 'dev-server-test.png' });
    
    // Check if page loads
    const pageContent = await page.content();
    console.log('Page content length:', pageContent.length);
    
    // Try to find any elements
    const allElements = await page.locator('*').count();
    console.log('Total elements found:', allElements);
    
    // Check for specific text
    const bodyText = await page.locator('body').textContent();
    console.log('Body text preview:', bodyText?.substring(0, 500));
    
    // Try different selectors
    const h1Count = await page.locator('h1').count();
    const inputCount = await page.locator('input').count();
    const textareaCount = await page.locator('textarea').count();
    const buttonCount = await page.locator('button').count();
    const divCount = await page.locator('div').count();
    
    console.log('Element counts:');
    console.log(`  H1: ${h1Count}`);
    console.log(`  Input: ${inputCount}`);
    console.log(`  Textarea: ${textareaCount}`);
    console.log(`  Button: ${buttonCount}`);
    console.log(`  Div: ${divCount}`);
  });
});