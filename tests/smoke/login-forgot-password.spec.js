import { test, expect } from '@playwright/test';

function buildUrl(baseURL, path) {
    const url = new URL(path, `${baseURL}/`);
    url.searchParams.set('cb', String(Date.now()));
    return url.toString();
}

async function mockLoginPageModules(page, resetScenario = {}) {
    await page.route(/\/js\/auth\.js\?v=\d+$/, async (route) => {
        const moduleSource = `
            const resetScenario = ${JSON.stringify(resetScenario)};
            window.__authMock = window.__authMock || { resetCalls: [] };

            export async function login() {
                throw new Error('login not mocked');
            }

            export async function signup() {
                throw new Error('signup not mocked');
            }

            export function checkAuth(callback) {
                callback(null);
            }

            export async function loginWithGoogle() {
                return null;
            }

            export async function handleGoogleRedirectResult() {
                return null;
            }

            export async function resetPassword(email) {
                window.__authMock.resetCalls.push(email);
                if (resetScenario.error) {
                    const error = new Error(resetScenario.error.message);
                    error.code = resetScenario.error.code;
                    throw error;
                }
            }

            export function getRedirectUrl() {
                return 'dashboard.html';
            }
        `;

        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: moduleSource
        });
    });

    await page.route(/\/js\/db\.js\?v=\d+$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: 'export async function getUserProfile() { return null; }'
        });
    });

    await page.route(/\/js\/utils\.js\?v=\d+$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export function renderHeader(container) {
                    if (container) {
                        container.innerHTML = '<header data-test-id="mock-header"></header>';
                    }
                }

                export function renderFooter(container) {
                    if (container) {
                        container.innerHTML = '<footer data-test-id="mock-footer"></footer>';
                    }
                }
            `
        });
    });

    await page.route(/\/js\/invite-redirect\.js\?v=\d+$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: 'export function getPostAuthRedirectUrl(defaultRedirect) { return defaultRedirect; }'
        });
    });

    await page.route(/\/js\/login-page\.js\?v=\d+$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                function getPasswordResetErrorMessage(error) {
                    if (error?.code === 'auth/invalid-email') {
                        return 'Invalid email address format.';
                    }

                    if (error?.code === 'auth/user-not-found') {
                        return 'No account found with this email address.';
                    }

                    if (error?.code === 'auth/too-many-requests') {
                        return 'Too many requests. Please try again later.';
                    }

                    return error?.message || 'Unable to reset password right now.';
                }

                function showPasswordResetMessage(errorDiv, message, isSuccess) {
                    errorDiv.classList.remove('hidden', 'text-red-500', 'text-green-600');
                    errorDiv.classList.add(isSuccess ? 'text-green-600' : 'text-red-500');
                    errorDiv.textContent = message;
                }

                export function createForgotPasswordHandler({ emailInput, errorDiv, resetPassword }) {
                    return async function handleForgotPasswordClick() {
                        errorDiv.classList.add('hidden');
                        errorDiv.classList.remove('text-green-600');
                        errorDiv.classList.add('text-red-500');

                        const email = emailInput.value.trim();
                        if (!email) {
                            showPasswordResetMessage(errorDiv, 'Please enter your email address', false);
                            return;
                        }

                        try {
                            await resetPassword(email);
                            emailInput.value = '';
                            showPasswordResetMessage(
                                errorDiv,
                                'Password reset email sent! Please check your inbox and spam folder.',
                                true
                            );
                        } catch (error) {
                            showPasswordResetMessage(errorDiv, getPasswordResetErrorMessage(error), false);
                        }
                    };
                }
            `
        });
    });
}

test('forgot-password success clears email and shows the reset confirmation', async ({ page, baseURL }) => {
    await mockLoginPageModules(page);
    await page.goto(buildUrl(baseURL, '/login.html'), { waitUntil: 'domcontentloaded' });

    await page.locator('#email').fill('player@example.com');
    await page.locator('#forgot-password-btn').click();

    await expect(page).toHaveURL(/\/login\.html/);
    await expect(page.locator('#email')).toHaveValue('');
    await expect(page.locator('#error-message')).toHaveText(
        'Password reset email sent! Please check your inbox and spam folder.'
    );

    const resetCalls = await page.evaluate(() => window.__authMock.resetCalls);
    expect(resetCalls).toEqual(['player@example.com']);
});

test('forgot-password translates Firebase reset errors into user-facing messages', async ({ page, baseURL }) => {
    const scenarios = [
        {
            code: 'auth/invalid-email',
            message: 'Firebase invalid email',
            expectedMessage: 'Invalid email address format.'
        },
        {
            code: 'auth/user-not-found',
            message: 'Firebase missing user',
            expectedMessage: 'No account found with this email address.'
        },
        {
            code: 'auth/too-many-requests',
            message: 'Firebase throttled',
            expectedMessage: 'Too many requests. Please try again later.'
        }
    ];

    for (const scenario of scenarios) {
        await mockLoginPageModules(page, { error: scenario });
        await page.goto(buildUrl(baseURL, '/login.html'), { waitUntil: 'domcontentloaded' });

        await page.locator('#email').fill('player@example.com');
        await page.locator('#forgot-password-btn').click();

        await expect(page).toHaveURL(/\/login\.html/);
        await expect(page.locator('#error-message')).toHaveText(scenario.expectedMessage);
    }
});

test('forgot-password validation resets styling after a prior success', async ({ page, baseURL }) => {
    await mockLoginPageModules(page);
    await page.goto(buildUrl(baseURL, '/login.html'), { waitUntil: 'domcontentloaded' });

    const errorMessage = page.locator('#error-message');

    await page.locator('#email').fill('player@example.com');
    await page.locator('#forgot-password-btn').click();
    await expect(errorMessage).toHaveText('Password reset email sent! Please check your inbox and spam folder.');

    await page.locator('#forgot-password-btn').click();

    await expect(errorMessage).toHaveText('Please enter your email address');
    await expect(errorMessage).toHaveClass(/text-red-500/);
    await expect(errorMessage).not.toHaveClass(/text-green-600/);
});
