import { test, expect } from '@playwright/test';

const GTAG_STUB = '';
const TAILWIND_STUB = 'window.tailwind = window.tailwind || { config: {} };';
const TELEMETRY_STUB = '';

const UTILS_STUB = `
function escape(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function renderHeader(container) {
    if (container) {
        container.innerHTML = '<header data-testid="mock-header"></header>';
    }
}

export function renderFooter(container) {
    if (container) {
        container.innerHTML = '<footer data-testid="mock-footer"></footer>';
    }
}

export function escapeHtml(value = '') {
    return escape(value);
}
`;

const AUTH_STUB = `
export function checkAuth(callback) {
    Promise.resolve()
        .then(() => callback({
            uid: 'user-1',
            email: 'parent@example.com',
            emailVerified: true
        }))
        .catch((error) => {
            const state = window.__profileSmoke || {};
            state.authErrors = state.authErrors || [];
            state.authErrors.push(error?.message || String(error));
            window.__profileSmoke = state;
        });
}

export async function setUserPassword() {}
export async function resendVerificationEmail() {}
`;

const NOTIFICATION_PREFERENCES_STUB = `
const DEFAULT_PREFERENCES = {
    liveScore: false,
    liveChat: false,
    scheduleChanges: false
};

export const NOTIFICATION_PREFERENCE_GROUPS = [
    {
        label: 'Game-day alerts',
        categories: [
            { id: 'liveScore', label: 'Live Score' },
            { id: 'liveChat', label: 'Live Chat' },
            { id: 'scheduleChanges', label: 'Schedule Changes' }
        ]
    }
];

export function normalizeTeamNotificationPreferences(preferences) {
    return {
        ...DEFAULT_PREFERENCES,
        ...(preferences || {})
    };
}
`;

const PUSH_NOTIFICATIONS_STUB = `
export async function registerPushNotifications() {
    return { token: 'push-token' };
}
`;

const DB_STUB = `
function getState() {
    const state = window.__profileSmoke || {};
    state.savedPreferences = state.savedPreferences || [];
    state.preferenceLoads = state.preferenceLoads || [];
    state.accessCodeLoads = state.accessCodeLoads || 0;
    window.__profileSmoke = state;
    return state;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

export async function getUserProfile() {
    return {
        fullName: 'Pat Parent',
        phone: '555-0100',
        updatedAt: { toDate: () => new Date('2026-06-28T10:25:00Z') }
    };
}

export async function updateUserProfile() {}
export async function createAccessCode() { return { code: 'CODE123' }; }
export async function createAccountMergeRequest() {}
export async function uploadUserPhoto() { return 'https://example.test/photo.png'; }
export async function upsertNotificationDeviceToken() {}

export async function getUserAccessCodes() {
    const state = getState();
    state.accessCodeLoads += 1;
    return [];
}

export async function getUserTeamsWithAccess() {
    const state = getState();
    if (state.failTeamLoad) {
        throw new Error('team load failed');
    }
    return clone(state.memberTeams || []);
}

export async function getParentTeams() {
    const state = getState();
    return clone(state.parentTeams || []);
}

export async function getNotificationPreferencesForTeam(userId, teamId) {
    const state = getState();
    state.preferenceLoads.push(teamId);
    if ((state.failPreferenceTeamIds || []).includes(teamId)) {
        throw new Error('preference load failed');
    }
    return clone((state.preferencesByTeam || {})[teamId] || {});
}

export async function saveNotificationPreferencesForTeam(userId, teamId, preferences) {
    const state = getState();
    const saved = clone(preferences || {});
    state.savedPreferences.push({ userId, teamId, preferences: saved });
    state.preferencesByTeam = state.preferencesByTeam || {};
    state.preferencesByTeam[teamId] = saved;
    return saved;
}
`;

async function mockProfileDependencies(page, scenario) {
    await page.addInitScript((value) => {
        window.__profileSmoke = value;
    }, scenario);

    await page.route('https://www.googletagmanager.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: GTAG_STUB
    }));
    await page.route('https://cdn.tailwindcss.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: TAILWIND_STUB
    }));
    await page.route('**/js/telemetry.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: TELEMETRY_STUB
    }));
    await page.route('**/js/utils.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: UTILS_STUB
    }));
    await page.route('**/js/auth.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: AUTH_STUB
    }));
    await page.route('**/js/db.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: DB_STUB
    }));
    await page.route('**/js/notification-preferences.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: NOTIFICATION_PREFERENCES_STUB
    }));
    await page.route('**/js/push-notifications.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: PUSH_NOTIFICATIONS_STUB
    }));
}

test('legacy profile team alerts load, switch, and save per-team preferences', async ({ page, baseURL }) => {
    await mockProfileDependencies(page, {
        memberTeams: [
            { id: 'team-2', name: 'Bravo' },
            { id: 'team-1', name: 'Alpha' }
        ],
        parentTeams: [
            { id: 'team-3', name: 'Cougars' }
        ],
        preferencesByTeam: {
            'team-1': { liveScore: true, liveChat: false, scheduleChanges: true },
            'team-2': { liveScore: false, liveChat: true, scheduleChanges: false },
            'team-3': { liveScore: true, liveChat: true, scheduleChanges: false }
        }
    });

    await page.goto(`${baseURL}/profile.html`, { waitUntil: 'domcontentloaded' });

    await expect(page.locator('#fullName')).toHaveValue('Pat Parent');
    await expect(page.locator('#notification-team-select')).toHaveValue('team-1');
    await expect(page.locator('#notification-team-select option')).toHaveCount(4);
    await expect(page.getByLabel('Live Score')).toBeChecked();
    await expect(page.getByLabel('Live Chat')).not.toBeChecked();
    await expect(page.getByLabel('Schedule Changes')).toBeChecked();

    await page.locator('#notification-team-select').selectOption('team-2');
    await expect(page.getByLabel('Live Score')).not.toBeChecked();
    await expect(page.getByLabel('Live Chat')).toBeChecked();
    await expect(page.getByLabel('Schedule Changes')).not.toBeChecked();

    await page.getByLabel('Live Score').check();
    await page.getByLabel('Schedule Changes').check();
    await page.locator('#save-notification-prefs-btn').click();

    await expect(page.locator('#notification-status')).toHaveText('Notification preferences saved.');
    await expect(page.locator('#notification-status')).toHaveClass(/text-green-600/);

    await expect.poll(() => page.evaluate(() => window.__profileSmoke.savedPreferences)).toEqual([
        {
            userId: 'user-1',
            teamId: 'team-2',
            preferences: {
                liveScore: true,
                liveChat: true,
                scheduleChanges: true
            }
        }
    ]);
});

test('legacy profile preserves the rest of the page when notification bootstrap fails', async ({ page, baseURL }) => {
    await mockProfileDependencies(page, {
        memberTeams: [
            { id: 'team-2', name: 'Bravo' },
            { id: 'team-1', name: 'Alpha' }
        ],
        parentTeams: [
            { id: 'team-3', name: 'Cougars' }
        ],
        preferencesByTeam: {
            'team-1': { liveScore: true, liveChat: false, scheduleChanges: true }
        },
        failPreferenceTeamIds: ['team-1']
    });

    await page.goto(`${baseURL}/profile.html`, { waitUntil: 'domcontentloaded' });

    await expect.poll(() => page.evaluate(() => window.__profileSmoke.preferenceLoads)).toEqual(['team-1']);
    await expect(page.locator('#notification-team-select')).toHaveValue('team-1');
    await expect(page.locator('#save-notification-prefs-btn')).toBeDisabled();
    await expect.poll(() => page.evaluate(() => window.__profileSmoke.savedPreferences)).toEqual([]);
    await expect(page.locator('#fullName')).toHaveValue('Pat Parent');
});
