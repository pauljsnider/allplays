import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { expectVisualSnapshot, installVisualNetworkGuard } from './helpers/visual-regression.js';

test.skip(
    process.env.SMOKE_SUITE === 'production',
    'The deterministic legacy login fixture is a pull-request visual regression check.'
);

async function mockLegacyLoginModules(page) {
    await page.route(/\/js\/auth\.js\?v=\d+$/, (route) => route.fulfill({
        contentType: 'application/javascript',
        body: `
            export function checkAuth(callback) { callback(null); }
            export function getRedirectUrl() { return 'dashboard.html'; }
            export async function handleGoogleRedirectResult() { return null; }
            export async function login() { return null; }
            export async function loginWithGoogle() { return null; }
            export async function resetPassword() {}
            export async function signup() { return null; }
        `
    }));
    await page.route(/\/js\/db\.js\?v=\d+$/, (route) => route.fulfill({
        contentType: 'application/javascript',
        body: 'export async function getUserProfile() { return null; }'
    }));
    await page.route(/\/js\/utils\.js\?v=\d+$/, (route) => route.fulfill({
        contentType: 'application/javascript',
        body: `
            export function renderHeader(container) {
                if (container) container.innerHTML = '<header aria-label="ALL PLAYS"></header>';
            }
            export function renderFooter(container) {
                if (container) container.innerHTML = '<footer aria-label="ALL PLAYS"></footer>';
            }
        `
    }));
    await page.route(/\/js\/invite-redirect\.js\?v=\d+$/, (route) => route.fulfill({
        contentType: 'application/javascript',
        body: 'export function getPostAuthRedirectUrl(value) { return value; }'
    }));
    await page.route(/\/js\/login-page\.js\?v=\d+$/, (route) => route.fulfill({
        contentType: 'application/javascript',
        body: `
            export function createForgotPasswordHandler() { return () => {}; }
            export function createLoginRedirectCoordinator() {
                return {
                    urlCodeParam: null,
                    shouldRedeemInviteFromLogin: false,
                    getAutoRedirectUrl() { return 'dashboard.html'; },
                    getGoogleRedirectUrl() { return 'dashboard.html'; },
                    getPostAuthRedirect() { return 'dashboard.html'; }
                };
            }
            export function shouldInitializeSignupMode() { return false; }
            export function createLoginAuthStateManager() {
                return {
                    beginProcessing() {},
                    finishProcessing() {},
                    captureAuthenticatedUser() { return false; },
                    consumePendingRedirectUser() { return null; }
                };
            }
        `
    }));
}

test('@visual legacy login preserves the primary sign-in layout', async ({ page, baseURL }) => {
    const url = new URL('/login.html', `${baseURL}/`).toString();
    await installVisualNetworkGuard(page, url);
    await mockLegacyLoginModules(page);
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const fixtureCss = await readFile(
        path.resolve(import.meta.dirname, '../fixtures/legacy-login-tailwind.css'),
        'utf8'
    );
    await page.addStyleTag({ content: fixtureCss });

    await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
    await expectVisualSnapshot(page, 'legacy-login.png');
});
