const { test, expect } = require('@playwright/test');

// @critical
test.describe('Auth + signup guardrails @critical', () => {
  test('login mode is default and signup mode toggles required fields', async ({ page }) => {
    await page.goto('/login.html');

    await expect(page.locator('#form-title')).toHaveText('Login');
    await expect(page.locator('#confirm-password-field')).toBeHidden();
    await expect(page.locator('#activation-code-field')).toBeHidden();
    await expect(page.locator('#forgot-password-link')).toBeVisible();

    await page.locator('#toggle-btn').click();

    await expect(page.locator('#form-title')).toHaveText('Sign Up');
    await expect(page.locator('#confirm-password-field')).toBeVisible();
    await expect(page.locator('#activation-code-field')).toBeVisible();
    await expect(page.locator('#forgot-password-link')).toBeHidden();
  });

  test('invite code URL auto-switches into signup guardrail mode', async ({ page }) => {
    await page.goto('/login.html?code=abcd1234');

    await expect(page.locator('#form-title')).toHaveText('Sign Up');
    await expect(page.locator('#activation-code')).toHaveValue('ABCD1234');
    await expect(page.locator('#activation-code')).not.toBeVisible();
    await expect(page.getByText("You've been invited to ALL PLAYS!")).toBeVisible();
  });

  test('signup blocks password mismatch before auth call', async ({ page }) => {
    await page.goto('/login.html');
    await page.locator('#toggle-btn').click();

    await page.locator('#email').fill('guardrail@example.com');
    await page.locator('#password').fill('password123');
    await page.locator('#confirm-password').fill('password456');
    await page.locator('#activation-code').fill('ABCDEFGH');
    await page.locator('#submit-btn').click();

    await expect(page.locator('#error-message')).toBeVisible();
    await expect(page.locator('#error-message')).toHaveText('Passwords do not match');
  });

  test('google signup requires activation code', async ({ page }) => {
    await page.goto('/login.html');
    await page.locator('#toggle-btn').click();

    await page.locator('#google-btn').click();

    const errorMessage = page.locator('#error-message');
    await errorMessage.waitFor({ state: 'visible', timeout: 5000 });
    await expect(errorMessage).toHaveText('Activation code is required for new accounts');
  });
});
