import { test, expect } from '@playwright/test';

function buildUrl(baseURL, path) {
    const url = new URL(path, `${baseURL}/`);
    url.searchParams.set('cb', String(Date.now()));
    return url.toString();
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
        googleRedirectResult = null,
        defaultRedirect = 'dashboard.html'
    } = options;

    await page.route(/\/js\/auth\.js\?v=\d+$/, async (route) => {
        const moduleSource = `
            const loginResult = ${JSON.stringify(loginResult)};
            const googleRedirectResult = ${JSON.stringify(googleRedirectResult)};
            const defaultRedirect = ${JSON.stringify(defaultRedirect)};

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

            export async function loginWithGoogle() {
                return null;
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
                    return ${JSON.stringify(profile)};
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

test('email/password login from an invite link redirects existing parents to accept-invite', async ({ page, baseURL }) => {
    await mockInviteLoginModules(page, {
        profile: {
            parentOf: [{ teamId: 'team-1' }]
        },
        defaultRedirect: 'parent-dashboard.html'
    });

    await page.goto(buildUrl(baseURL, '/login.html?code=ab12cd34&type=parent'), {
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

    await expect(page).toHaveURL(/\/accept-invite\.html\?code=AB12CD34$/);
});
