// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function readProfilePage() {
    return readFileSync(path.join(repoRoot, 'profile.html'), 'utf8');
}

function extractProfileModuleScript(source) {
    const matches = [...source.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)];
    const moduleScript = matches.at(-1)?.[1];
    if (!moduleScript) {
        throw new Error('Could not find profile module script');
    }

    return moduleScript.replace(/^\s*import[\s\S]*?;\s*$/gm, '');
}

async function flushAsyncWork() {
    await Promise.resolve();
    await Promise.resolve();
}

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function createHarness({ user, profile, resendVerificationEmailImpl, setUserPasswordImpl }) {
    const dom = new JSDOM(readProfilePage(), {
        url: 'https://example.test/profile.html',
        runScripts: 'outside-only'
    });
    const profileScript = extractProfileModuleScript(readProfilePage());

    let authCallback = null;
    const mocks = {
        renderHeader: vi.fn(),
        renderFooter: vi.fn(),
        escapeHtml: (value = '') => String(value),
        checkAuth: vi.fn((callback) => {
            authCallback = callback;
        }),
        setUserPassword: setUserPasswordImpl || vi.fn().mockResolvedValue(undefined),
        resendVerificationEmail: resendVerificationEmailImpl || vi.fn().mockResolvedValue(undefined),
        getUserProfile: vi.fn().mockResolvedValue(profile),
        updateUserProfile: vi.fn().mockResolvedValue(undefined),
        createAccessCode: vi.fn().mockResolvedValue({ code: 'CODE123' }),
        createAccountMergeRequest: vi.fn().mockResolvedValue(undefined),
        getUserAccessCodes: vi.fn().mockResolvedValue([]),
        uploadUserPhoto: vi.fn().mockResolvedValue('https://example.test/photo.png'),
        getUserTeamsWithAccess: vi.fn().mockResolvedValue([]),
        getParentTeams: vi.fn().mockResolvedValue([]),
        getNotificationPreferencesForTeam: vi.fn().mockResolvedValue({}),
        saveNotificationPreferencesForTeam: vi.fn().mockResolvedValue({}),
        upsertNotificationDeviceToken: vi.fn().mockResolvedValue(undefined),
        normalizeTeamNotificationPreferences: vi.fn((preferences) => preferences || {}),
        NOTIFICATION_PREFERENCE_GROUPS: [],
        registerPushNotifications: vi.fn().mockResolvedValue({ token: 'push-token' })
    };

    const context = vm.createContext({
        ...mocks,
        window: dom.window,
        document: dom.window.document,
        navigator: dom.window.navigator,
        console: { error: vi.fn(), log: vi.fn() },
        alert: vi.fn(),
        FileReader: class {
            readAsDataURL() {}
        },
        setTimeout,
        clearTimeout,
        globalThis: {}
    });

    vm.runInContext(profileScript, context);

    if (!authCallback) {
        throw new Error('profile.html did not register an auth callback');
    }

    return {
        dom,
        document: dom.window.document,
        user,
        mocks,
        async boot() {
            await authCallback(user);
            await flushAsyncWork();
        }
    };
}

afterEach(() => {
    vi.useRealTimers();
});

describe('profile legacy security recovery flows', () => {
    it('executes the passwordless recovery flow in jsdom', async () => {
        vi.useFakeTimers();
        const setUserPassword = vi.fn().mockResolvedValue(undefined);
        const harness = createHarness({
            user: { uid: 'user-1', email: 'player@example.com', emailVerified: true },
            profile: { signInMethod: 'emailLink', hasPassword: false },
            setUserPasswordImpl: setUserPassword
        });

        await harness.boot();

        const section = harness.document.getElementById('set-password-section');
        const newPassword = harness.document.getElementById('new-password');
        const confirmPassword = harness.document.getElementById('confirm-password');
        const button = harness.document.getElementById('set-password-btn');
        const status = harness.document.getElementById('password-status');

        expect(section.classList.contains('hidden')).toBe(false);

        newPassword.value = '123';
        confirmPassword.value = '123';
        button.dispatchEvent(new harness.dom.window.MouseEvent('click', { bubbles: true }));
        await flushAsyncWork();

        expect(status.textContent).toBe('Password must be at least 6 characters');
        expect(setUserPassword).not.toHaveBeenCalled();

        newPassword.value = '123456';
        confirmPassword.value = '654321';
        button.dispatchEvent(new harness.dom.window.MouseEvent('click', { bubbles: true }));
        await flushAsyncWork();

        expect(status.textContent).toBe('Passwords do not match');
        expect(setUserPassword).not.toHaveBeenCalled();

        newPassword.value = 'hunter2';
        confirmPassword.value = 'hunter2';
        button.dispatchEvent(new harness.dom.window.MouseEvent('click', { bubbles: true }));
        await flushAsyncWork();

        expect(setUserPassword).toHaveBeenCalledWith('hunter2');
        expect(newPassword.value).toBe('');
        expect(confirmPassword.value).toBe('');
        expect(status.textContent).toBe('Password set successfully!');
        expect(status.className).toContain('text-green-600');
        expect(section.classList.contains('hidden')).toBe(false);

        await vi.advanceTimersByTimeAsync(2000);
        expect(section.classList.contains('hidden')).toBe(true);
    });

    it('executes resend verification success and throttling branches in jsdom', async () => {
        const resendDeferred = createDeferred();
        const resendVerificationEmail = vi.fn()
            .mockImplementationOnce(() => resendDeferred.promise)
            .mockRejectedValueOnce({ code: 'auth/too-many-requests' });
        const harness = createHarness({
            user: { uid: 'user-2', email: 'coach@example.com', emailVerified: false },
            profile: { signInMethod: 'password', hasPassword: true },
            resendVerificationEmailImpl: resendVerificationEmail
        });

        await harness.boot();

        const banner = harness.document.getElementById('email-unverified-banner');
        const button = harness.document.getElementById('resend-verify-btn');
        const status = harness.document.getElementById('resend-status');

        expect(banner.classList.contains('hidden')).toBe(false);

        button.dispatchEvent(new harness.dom.window.MouseEvent('click', { bubbles: true }));
        await flushAsyncWork();

        expect(button.disabled).toBe(true);
        expect(button.textContent.trim()).toBe('Sending...');
        expect(status.classList.contains('hidden')).toBe(true);
        expect(resendVerificationEmail).toHaveBeenCalledTimes(1);

        resendDeferred.resolve();
        await flushAsyncWork();

        expect(button.disabled).toBe(false);
        expect(button.textContent.trim()).toBe('Resend Email');
        expect(status.textContent).toBe('Verification email queued! Check your inbox shortly.');
        expect(status.className).toContain('text-green-700');
        expect(status.classList.contains('hidden')).toBe(false);

        button.dispatchEvent(new harness.dom.window.MouseEvent('click', { bubbles: true }));
        await flushAsyncWork();

        expect(resendVerificationEmail).toHaveBeenCalledTimes(2);
        expect(button.disabled).toBe(false);
        expect(button.textContent.trim()).toBe('Resend Email');
        expect(status.textContent).toBe('Too many requests. Please wait a few minutes.');
        expect(status.className).toContain('text-red-600');
        expect(status.classList.contains('hidden')).toBe(false);
    });
});
