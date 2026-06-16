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
        googleRedirectResult = null,
        defaultRedirect = 'dashboard.html'
    } = options;
    const encodedLoginResult = encodeModuleValue(loginResult);
    const encodedGoogleLoginResult = encodeModuleValue(googleLoginResult);
    const encodedGoogleRedirectResult = encodeModuleValue(googleRedirectResult);
    const encodedDefaultRedirect = encodeModuleValue(defaultRedirect);
    const encodedProfile = encodeModuleValue(profile);

    await page.route(/\/js\/auth\.js\?v=\d+$/, async (route) => {
        const moduleSource = `
            const loginResult = JSON.parse(atob('${encodedLoginResult}'));
            const googleLoginResult = JSON.parse(atob('${encodedGoogleLoginResult}'));
            const googleRedirectResult = JSON.parse(atob('${encodedGoogleRedirectResult}'));
            const defaultRedirect = JSON.parse(atob('${encodedDefaultRedirect}'));

            export async function login(email, password) {
                window.__authMock = { email, password };
                return loginResult;
            }

            export async function signup() {
                throw new Error('signup not mocked');
            }

            export function checkAuth(callback) {
                callback(null);
            }

            export async function loginWithGoogle(activationCode) {
                window.__googleActivationCode = activationCode;
                window.sessionStorage.setItem('__googleActivationCode', activationCode || '');
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

    await page.goto(buildUrl(baseURL, '/login.html#signup'), {
        waitUntil: 'domcontentloaded'
    });

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
