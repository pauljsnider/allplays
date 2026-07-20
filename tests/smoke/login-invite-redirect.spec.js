import { test, expect } from '@playwright/test';

function buildUrl(baseURL, path) {
    const url = new URL(path, `${baseURL}/`);
    url.searchParams.set('cb', String(Date.now()));
    return url.toString();
}

function encodeModuleValue(value) {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

async function mockInviteLoginModules(page, options = {}) {
    const {
        profile = {},
        loginResult = {
            user: {
                uid: 'user-123',
                email: 'existing@example.com'
            }
        },
        googleLoginResult = null,
        googleLoginError = null,
        googleRedirectResult = null,
        signupResult = { user: { uid: 'new-user-123', email: 'new@example.com' } },
        signupError = null,
        signupDelayMs = 0,
        defaultRedirect = 'dashboard.html'
    } = options;
    const encodedLoginResult = encodeModuleValue(loginResult);
    const encodedGoogleLoginResult = encodeModuleValue(googleLoginResult);
    const encodedGoogleLoginError = encodeModuleValue(googleLoginError);
    const encodedGoogleRedirectResult = encodeModuleValue(googleRedirectResult);
    const encodedSignupResult = encodeModuleValue(signupResult);
    const encodedSignupError = encodeModuleValue(signupError);
    const encodedDefaultRedirect = encodeModuleValue(defaultRedirect);
    const encodedProfile = encodeModuleValue(profile);

    await page.route(/\/js\/auth\.js\?v=\d+$/, async (route) => {
        const moduleSource = `
            const loginResult = JSON.parse(atob('${encodedLoginResult}'));
            const googleLoginResult = JSON.parse(atob('${encodedGoogleLoginResult}'));
            const googleLoginError = JSON.parse(atob('${encodedGoogleLoginError}'));
            const googleRedirectResult = JSON.parse(atob('${encodedGoogleRedirectResult}'));
            const signupResult = JSON.parse(atob('${encodedSignupResult}'));
            const signupError = JSON.parse(atob('${encodedSignupError}'));
            const defaultRedirect = JSON.parse(atob('${encodedDefaultRedirect}'));
            const signupDelayMs = ${Number(signupDelayMs) || 0};

            export async function login(email, password) {
                window.__authMock = { email, password };
                return loginResult;
            }

            export async function signup(email, password, activationCode) {
                window.__signupCalls = (window.__signupCalls || 0) + 1;
                window.__signupArgs = { email, password, activationCode };
                if (signupDelayMs > 0) {
                    await new Promise((resolve) => setTimeout(resolve, signupDelayMs));
                }
                if (signupError) {
                    const error = new Error(signupError.message || 'signup failed');
                    if (signupError.code) {
                        error.code = signupError.code;
                    }
                    throw error;
                }
                return signupResult;
            }

            export function checkAuth(callback) {
                callback(null);
            }

            export async function loginWithGoogle(activationCode) {
                window.__googleActivationCode = activationCode;
                window.sessionStorage.setItem('__googleActivationCode', activationCode || '');
                if (googleLoginError) {
                    const error = new Error(googleLoginError.message || 'Google login failed');
                    if (googleLoginError.code) {
                        error.code = googleLoginError.code;
                    }
                    throw error;
                }
                return googleLoginResult;
            }

            export async function handleGoogleRedirectResult() {
                return googleRedirectResult;
            }

            export async function resetPassword() {
                return null;
            }

            export function getRedirectUrl() {
                return defaultRedirect;
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
            body: `
                export async function getUserProfile() {
                    return JSON.parse(atob('${encodedProfile}'));
                }
            `
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
}

test('email/password login from a type-less invite link redirects existing users to accept-invite', async ({ page, baseURL }) => {
    await mockInviteLoginModules(page, {
        profile: {
            parentOf: [{ teamId: 'team-1' }]
        },
        defaultRedirect: 'parent-dashboard.html'
    });

    await page.goto(buildUrl(baseURL, '/login.html?code=ab12cd34'), {
        waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('#form-title')).toHaveText('Sign Up');
    await page.locator('#toggle-btn').click();
    await expect(page.locator('#form-title')).toHaveText('Login');

    await page.locator('#email').fill('parent@example.com');
    await page.locator('#password').fill('secret123');
    await page.locator('#login-form').dispatchEvent('submit');

    await expect(page).toHaveURL(/\/accept-invite\.html\?code=AB12CD34$/);
});

test('email/password invite login prefers current link over stale recovery code', async ({ page, baseURL }) => {
    await mockInviteLoginModules(page, {
        profile: {
            parentOf: [{ teamId: 'team-1' }]
        },
        defaultRedirect: 'parent-dashboard.html'
    });
    await page.addInitScript(() => {
        window.sessionStorage.setItem('pendingLoginInviteCode', 'STALE999');
    });

    await page.goto(buildUrl(baseURL, '/login.html?code=cd34ef56&type=parent'), {
        waitUntil: 'domcontentloaded'
    });

    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('pendingLoginInviteCode'))).toBe(null);
    await expect(page.locator('#form-title')).toHaveText('Sign Up');
    await page.locator('#toggle-btn').click();
    await expect(page.locator('#form-title')).toHaveText('Login');

    await page.locator('#email').fill('parent@example.com');
    await page.locator('#password').fill('secret123');
    await page.locator('#login-form').dispatchEvent('submit');

    await expect(page).toHaveURL(/\/accept-invite\.html\?code=CD34EF56&type=parent$/);
});

test('email/password login from a household invite link redirects existing users to accept-invite', async ({ page, baseURL }) => {
    await mockInviteLoginModules(page, {
        profile: {
            parentOf: [{ teamId: 'team-1' }]
        },
        defaultRedirect: 'parent-dashboard.html'
    });

    await page.goto(buildUrl(baseURL, '/login.html?code=ab12cd34&type=household'), {
        waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('#form-title')).toHaveText('Sign Up');
    await page.locator('#toggle-btn').click();
    await expect(page.locator('#form-title')).toHaveText('Login');

    await page.locator('#email').fill('household@example.com');
    await page.locator('#password').fill('secret123');
    await page.locator('#login-form').dispatchEvent('submit');

    await expect(page).toHaveURL(/\/accept-invite\.html\?code=AB12CD34&type=household$/);
});

test('google redirect login mode keeps existing admin invites on accept-invite', async ({ page, baseURL }) => {
    await page.addInitScript(() => {
        window.sessionStorage.setItem('postGoogleAuthMode', 'login');
    });

    await mockInviteLoginModules(page, {
        profile: {
            isAdmin: true
        },
        googleRedirectResult: {
            user: {
                uid: 'admin-123',
                email: 'coach@example.com'
            }
        },
        defaultRedirect: 'dashboard.html'
    });

    await page.goto(buildUrl(baseURL, '/login.html?code=ab12cd34&type=admin'), {
        waitUntil: 'domcontentloaded'
    });

    await expect(page).toHaveURL(/\/accept-invite\.html\?code=AB12CD34&type=admin$/);
});

test('signup hash opens signup mode and passes activation code to Google signup', async ({ page, baseURL }) => {
    await mockInviteLoginModules(page);
    await page.addInitScript(() => {
        window.sessionStorage.setItem('pendingLoginInviteCode', 'STALE999');
    });

    await page.goto(buildUrl(baseURL, '/login.html#signup'), {
        waitUntil: 'domcontentloaded'
    });

    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('pendingLoginInviteCode'))).toBe(null);
    await expect(page.locator('#form-title')).toHaveText('Sign Up');
    await expect(page.locator('#confirm-password-field')).toBeVisible();
    await expect(page.locator('#activation-code-field')).toBeVisible();
    await expect(page.locator('#forgot-password-link')).toBeHidden();

    await page.locator('#activation-code').fill('ab12cd34');
    await page.locator('#google-btn').click();

    await expect.poll(() => page.evaluate(() => window.__googleActivationCode)).toBe('AB12CD34');
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('postGoogleAuthMode'))).toBe('signup');
});

test('google popup signup from invite-prefilled link redeems invite', async ({ page, baseURL }) => {
    await mockInviteLoginModules(page, {
        googleLoginResult: {
            user: {
                uid: 'google-user-123',
                email: 'parent@example.com'
            }
        },
        defaultRedirect: 'dashboard.html'
    });

    await page.goto(buildUrl(baseURL, '/login.html?code=ab12cd34&type=parent'), {
        waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('#form-title')).toHaveText('Sign Up');
    await expect(page.locator('#activation-code-field')).toBeHidden();
    await page.locator('#google-btn').click();

    await expect(page).toHaveURL(/\/accept-invite\.html\?code=AB12CD34&type=parent$/);
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('__googleActivationCode'))).toBe('AB12CD34');
});

test('google popup signup without invite uses normal post-auth redirect', async ({ page, baseURL }) => {
    await mockInviteLoginModules(page, {
        googleLoginResult: {
            user: {
                uid: 'google-user-456',
                email: 'new-parent@example.com'
            }
        },
        defaultRedirect: 'dashboard.html'
    });

    await page.goto(buildUrl(baseURL, '/login.html#signup'), {
        waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('#form-title')).toHaveText('Sign Up');
    await page.locator('#activation-code').fill('ab12cd34');
    await page.locator('#google-btn').click();

    await expect(page).toHaveURL(/\/dashboard\.html$/);
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('__googleActivationCode'))).toBe('AB12CD34');
});

test('invite signup disables auth controls while the request is in flight', async ({ page, baseURL }) => {
    await mockInviteLoginModules(page, {
        signupDelayMs: 60_000
    });

    await page.goto(buildUrl(baseURL, '/login.html?code=ab12cd34&type=parent'), {
        waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('#form-title')).toHaveText('Sign Up');
    await page.locator('#email').fill('mom@example.com');
    await page.locator('#password').fill('secret123');
    await page.locator('#confirm-password').fill('secret123');
    await page.locator('#submit-btn').click();
    await page.locator('#submit-btn').click({ force: true });

    await expect(page.locator('#submit-btn')).toBeDisabled();
    await expect(page.locator('#google-btn')).toBeDisabled();
    await expect(page.locator('#toggle-btn')).toBeDisabled();
    await expect(page.locator('#submit-btn')).toHaveText('Creating account...');
    await page.locator('#toggle-btn').dispatchEvent('click');
    await page.locator('#google-btn').dispatchEvent('click');
    await expect(page.locator('#form-title')).toHaveText('Sign Up');
    await expect.poll(() => page.evaluate(() => window.__signupCalls || 0)).toBe(1);
    await expect.poll(() => page.evaluate(() => window.__signupArgs?.activationCode)).toBe('AB12CD34');
    await expect.poll(() => page.evaluate(() => window.__googleActivationCode || null)).toBe(null);
});

test('invite signup with an existing email switches to clear login recovery', async ({ page, baseURL }) => {
    await mockInviteLoginModules(page, {
        signupError: {
            code: 'auth/email-already-in-use',
            message: 'Firebase: Error (auth/email-already-in-use).'
        }
    });

    await page.goto(buildUrl(baseURL, '/login.html?code=ab12cd34&type=parent'), {
        waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('#form-title')).toHaveText('Sign Up');
    await page.locator('#email').fill('mom@example.com');
    await page.locator('#password').fill('secret123');
    await page.locator('#confirm-password').fill('secret123');
    await page.locator('#submit-btn').click();

    await expect(page.locator('#form-title')).toHaveText('Login');
    await expect(page.locator('#submit-btn')).toBeEnabled();
    await expect(page.locator('#submit-btn')).toHaveText('Sign In');
    await expect(page.locator('#error-message')).toHaveText('That account already exists. Enter the password for this email to accept your invite.');
    await expect(page.locator('#activation-code-field')).toBeHidden();
    await expect(page.locator('#email')).toHaveValue('mom@example.com');
});

test('manual invite code existing-account recovery redeems the typed code after login', async ({ page, baseURL }) => {
    await mockInviteLoginModules(page, {
        signupError: {
            code: 'auth/email-already-in-use',
            message: 'Firebase: Error (auth/email-already-in-use).'
        }
    });

    await page.goto(buildUrl(baseURL, '/login.html#signup'), {
        waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('#form-title')).toHaveText('Sign Up');
    await page.locator('#email').fill('mom@example.com');
    await page.locator('#password').fill('secret123');
    await page.locator('#confirm-password').fill('secret123');
    await page.locator('#activation-code').fill('ab12cd34');
    await page.locator('#submit-btn').click();

    await expect(page.locator('#form-title')).toHaveText('Login');
    await expect(page.locator('#activation-code-field')).toBeHidden();
    await page.locator('#submit-btn').click();

    await expect(page).toHaveURL(/\/accept-invite\.html\?code=AB12CD34$/);
});

test('manual invite code existing-account recovery persists through reload before login', async ({ page, baseURL }) => {
    await mockInviteLoginModules(page, {
        signupError: {
            code: 'auth/email-already-in-use',
            message: 'Firebase: Error (auth/email-already-in-use).'
        }
    });

    await page.goto(buildUrl(baseURL, '/login.html#signup'), {
        waitUntil: 'domcontentloaded'
    });

    await page.locator('#email').fill('mom@example.com');
    await page.locator('#password').fill('secret123');
    await page.locator('#confirm-password').fill('secret123');
    await page.locator('#activation-code').fill('ab12cd34');
    await page.locator('#submit-btn').click();

    await expect(page.locator('#form-title')).toHaveText('Login');
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('pendingLoginInviteCode'))).toBe('AB12CD34');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator('#email').fill('mom@example.com');
    await page.locator('#password').fill('secret123');
    await page.locator('#submit-btn').click();

    await expect(page).toHaveURL(/\/accept-invite\.html\?code=AB12CD34$/);
});

test('manual invite code recovery survives reload before password login', async ({ page, baseURL }) => {
    await mockInviteLoginModules(page);
    await page.addInitScript(() => {
        window.sessionStorage.setItem('pendingLoginInviteCode', 'AB12CD34');
    });

    await page.goto(buildUrl(baseURL, '/login.html'), {
        waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('#form-title')).toHaveText('Login');
    await page.locator('#email').fill('mom@example.com');
    await page.locator('#password').fill('secret123');
    await page.locator('#submit-btn').click();

    await expect(page).toHaveURL(/\/accept-invite\.html\?code=AB12CD34$/);
});

test('manual invite code recovery survives reload before Google login', async ({ page, baseURL }) => {
    await mockInviteLoginModules(page, {
        googleLoginResult: {
            user: {
                uid: 'google-user-321',
                email: 'mom@example.com'
            }
        }
    });
    await page.addInitScript(() => {
        window.sessionStorage.setItem('pendingLoginInviteCode', 'AB12CD34');
    });

    await page.goto(buildUrl(baseURL, '/login.html'), {
        waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('#form-title')).toHaveText('Login');
    await page.locator('#google-btn').click();

    await expect(page).toHaveURL(/\/accept-invite\.html\?code=AB12CD34$/);
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('__googleActivationCode'))).toBe('');
});

test('Google invite login prefers current link over stale recovery code', async ({ page, baseURL }) => {
    await mockInviteLoginModules(page, {
        googleLoginResult: {
            user: {
                uid: 'google-user-654',
                email: 'mom@example.com'
            }
        },
        defaultRedirect: 'parent-dashboard.html'
    });
    await page.addInitScript(() => {
        window.sessionStorage.setItem('pendingLoginInviteCode', 'STALE999');
    });

    await page.goto(buildUrl(baseURL, '/login.html?code=cd34ef56&type=parent'), {
        waitUntil: 'domcontentloaded'
    });

    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('pendingLoginInviteCode'))).toBe(null);
    await expect(page.locator('#form-title')).toHaveText('Sign Up');
    await page.locator('#toggle-btn').click();
    await expect(page.locator('#form-title')).toHaveText('Login');
    await page.locator('#google-btn').click();

    await expect(page).toHaveURL(/\/accept-invite\.html\?code=CD34EF56&type=parent$/);
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('__googleActivationCode'))).toBe('');
});

test('failed Google recovery keeps manual invite for password login retry', async ({ page, baseURL }) => {
    await mockInviteLoginModules(page, {
        googleLoginError: {
            code: 'auth/popup-closed-by-user',
            message: 'Google popup was closed.'
        }
    });
    await page.addInitScript(() => {
        window.sessionStorage.setItem('pendingLoginInviteCode', 'AB12CD34');
    });

    await page.goto(buildUrl(baseURL, '/login.html'), {
        waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('#form-title')).toHaveText('Login');
    await page.locator('#google-btn').click();
    await expect(page.locator('#error-message')).toHaveText('Google popup was closed.');
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('pendingLoginInviteCode'))).toBe('AB12CD34');

    await page.locator('#email').fill('mom@example.com');
    await page.locator('#password').fill('secret123');
    await page.locator('#submit-btn').click();

    await expect(page).toHaveURL(/\/accept-invite\.html\?code=AB12CD34$/);
});

test('manual invite recovery clears stale code before new Google signup', async ({ page, baseURL }) => {
    await mockInviteLoginModules(page, {
        googleLoginResult: {
            user: {
                uid: 'google-user-789',
                email: 'mom@example.com'
            }
        },
        signupError: {
            code: 'auth/email-already-in-use',
            message: 'Firebase: Error (auth/email-already-in-use).'
        }
    });

    await page.goto(buildUrl(baseURL, '/login.html#signup'), {
        waitUntil: 'domcontentloaded'
    });

    await page.locator('#email').fill('mom@example.com');
    await page.locator('#password').fill('secret123');
    await page.locator('#confirm-password').fill('secret123');
    await page.locator('#activation-code').fill('oldcode1');
    await page.locator('#submit-btn').click();

    await expect(page.locator('#form-title')).toHaveText('Login');
    await page.locator('#toggle-btn').click();
    await page.locator('#activation-code').fill('newcode2');
    await page.locator('#google-btn').click();

    await expect(page).toHaveURL(/\/dashboard\.html$/);
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('__googleActivationCode'))).toBe('NEWCODE2');
});

test('manual invite code existing-account recovery redeems the typed code after Google login', async ({ page, baseURL }) => {
    await mockInviteLoginModules(page, {
        googleLoginResult: {
            user: {
                uid: 'google-user-123',
                email: 'mom@example.com'
            }
        },
        signupError: {
            code: 'auth/email-already-in-use',
            message: 'Firebase: Error (auth/email-already-in-use).'
        }
    });

    await page.goto(buildUrl(baseURL, '/login.html#signup'), {
        waitUntil: 'domcontentloaded'
    });

    await expect(page.locator('#form-title')).toHaveText('Sign Up');
    await page.locator('#email').fill('mom@example.com');
    await page.locator('#password').fill('secret123');
    await page.locator('#confirm-password').fill('secret123');
    await page.locator('#activation-code').fill('ab12cd34');
    await page.locator('#submit-btn').click();

    await expect(page.locator('#form-title')).toHaveText('Login');
    await page.locator('#google-btn').click();

    await expect(page).toHaveURL(/\/accept-invite\.html\?code=AB12CD34$/);
    await expect.poll(() => page.evaluate(() => window.sessionStorage.getItem('__googleActivationCode'))).toBe('');
});
