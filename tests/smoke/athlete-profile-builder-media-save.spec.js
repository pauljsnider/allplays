import { test, expect } from '@playwright/test';

function buildUrl(baseURL, path) {
    const url = new URL(path, `${baseURL}/`);
    url.searchParams.set('cb', String(Date.now()));
    return url.toString();
}

const TAILWIND_STUB = `
window.tailwind = window.tailwind || { config: {} };
const style = document.createElement('style');
style.textContent = '.hidden{display:none!important}';
document.head.appendChild(style);
`;
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

export function getUrlParams() {
    return Object.fromEntries(new URLSearchParams(window.location.search).entries());
}

export function escapeHtml(value = '') {
    return escape(value);
}

export async function shareOrCopy(payload) {
    window.__athleteProfileSmoke.shared.push(payload);
}
`;

const AUTH_STUB = `
export async function requireAuth() {
    return { uid: 'parent-1', email: 'parent@example.com', displayName: 'Pat Parent' };
}

export function checkAuth(callback) {
    callback({ uid: 'parent-1', email: 'parent@example.com', displayName: 'Pat Parent' });
}
`;

const ATHLETE_PROFILE_UTILS_STUB = `
export function buildAthleteProfileShareUrl(origin, profileId) {
    return origin + '/athlete-profile.html?profileId=' + encodeURIComponent(profileId);
}
`;

const DB_STUB = `
function getState() {
    const state = window.__athleteProfileSmoke || {};
    state.uploads = state.uploads || [];
    state.saveCalls = state.saveCalls || [];
    state.deletes = state.deletes || [];
    state.reservations = state.reservations || [];
    state.releasedReservations = state.releasedReservations || [];
    state.events = state.events || [];
    state.shared = state.shared || [];
    window.__athleteProfileSmoke = state;
    return state;
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

const parentLinks = [
    { teamId: 'team-1', playerId: 'player-1', playerName: 'Pat Star', teamName: 'Bears', photoUrl: 'https://media.example.test/linked-headshot.jpg' },
    { teamId: 'team-2', playerId: 'player-2', playerName: 'Pat Star JV', teamName: 'Bears JV' }
];

export async function getUserProfile() {
    return { parentOf: clone(parentLinks) };
}

export async function getAthleteProfile(profileId) {
    const state = getState();
    return clone((state.profiles || {})[profileId] || null);
}

export async function listAthleteProfilesForParent() {
    const state = getState();
    return clone(state.savedProfiles || []);
}

export async function reserveAthleteProfileMediaOwnership(userId, profileId) {
    const state = getState();
    state.reservations.push({ userId, profileId });
    state.events.push('reserve:' + profileId);
    return { id: profileId, created: true };
}

export async function releaseAthleteProfileMediaReservation(userId, profileId) {
    const state = getState();
    state.releasedReservations.push({ userId, profileId });
    state.events.push('release:' + profileId);
    return true;
}

export async function uploadAthleteProfileMedia(userId, profileId, file, options = {}) {
    const state = getState();
    const uploadNumber = state.uploads.length + 1;
    if (state.failUploadKind === options.kind) {
        throw new Error('mock ' + options.kind + ' upload failed');
    }

    const storagePath = 'athleteProfiles/' + profileId + '/' + options.kind + '/' + file.name;
    const uploaded = {
        url: 'https://media.example.test/' + options.kind + '/' + file.name,
        storagePath,
        mediaType: String(file.type || '').startsWith('video/') ? 'video' : 'image',
        mimeType: file.type || '',
        sizeBytes: file.size,
        uploadedAtMs: 1800000000000 + uploadNumber
    };
    state.uploads.push({ userId, profileId, kind: options.kind, name: file.name, type: file.type, size: file.size, storagePath });
    state.events.push('upload:' + options.kind + ':' + profileId);
    return uploaded;
}

export async function saveAthleteProfile(userId, draft, options = {}) {
    const state = getState();
    if (state.failSave) {
        throw new Error('mock save failed');
    }

    const saved = {
        id: 'profile-public-1',
        ...clone(draft),
        parentUserId: userId,
        seasons: draft.selectedSeasonKeys.map((seasonKey) => ({ seasonKey })),
        profilePhotoUrl: draft.profilePhoto?.url || '',
        profilePhotoPath: draft.profilePhoto?.storagePath || '',
        profilePhotoMimeType: draft.profilePhoto?.mimeType || '',
        profilePhotoSizeBytes: draft.profilePhoto?.sizeBytes ?? null,
        profilePhotoUploadedAtMs: draft.profilePhoto?.uploadedAtMs ?? null,
        clips: clone(draft.clips || []),
        careerSummary: {
            gamesPlayed: 12,
            totalMinutes: 240,
            statTotals: { PTS: 144 },
            statAverages: { PTS: '12.0' }
        }
    };

    state.saveCalls.push({ userId, draft: clone(draft), options: clone(options) });
    state.events.push('save:' + options.profileId);
    state.savedProfiles = [saved];
    state.profiles = { ...(state.profiles || {}), [saved.id]: saved };
    return clone(saved);
}

export async function deleteAthleteProfileMediaByPath(path) {
    const state = getState();
    state.deletes.push(path);
    state.events.push('delete:' + path);
}
`;

async function mockBuilderModules(page, scenario = {}) {
    await page.addInitScript((value) => {
        window.__athleteProfileSmoke = {
            uploads: [],
            saveCalls: [],
            deletes: [],
            reservations: [],
            releasedReservations: [],
            events: [],
            shared: [],
            ...value
        };
    }, scenario);

    await page.route('https://www.googletagmanager.com/**', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: ''
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
    await page.route('**/js/athlete-profile-utils.js?v=*', (route) => route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: ATHLETE_PROFILE_UTILS_STUB
    }));
}

async function uploadHeadshotAndClip(page) {
    await page.locator('#profile-photo-input').setInputFiles({
        name: 'headshot.png',
        mimeType: 'image/png',
        buffer: Buffer.from('fake-png')
    });
    await expect(page.locator('#save-status')).toHaveText('Headshot ready to upload on save.');

    await page.locator('#clip-upload-input').setInputFiles({
        name: 'highlight.mp4',
        mimeType: 'video/mp4',
        buffer: Buffer.from('fake-video')
    });
    await expect(page.locator('#save-status')).toHaveText('Clip ready to upload on save.');
    await page.locator('[data-clip-field="title"]').fill('Fast break finish');
    await page.locator('[data-clip-field="label"]').fill('Summer league');
}

test('standalone athlete profile builder uploads media, saves public profile, and exposes share controls', async ({ page, baseURL }) => {
    await mockBuilderModules(page);
    await page.goto(buildUrl(baseURL, '/athlete-profile-builder.html?teamId=team-1&playerId=player-1'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Athlete Profile Builder' })).toBeVisible();
    await expect(page.locator('#athlete-name')).toHaveValue('Pat Star');
    await expect(page.getByLabel('Public')).not.toBeChecked();
    await expect(page.locator('#share-profile-btn')).toBeHidden();
    await expect(page.locator('input[name="seasonKey"][value="team-1::player-1"]')).toBeChecked();

    await page.getByLabel('Public').check();
    await uploadHeadshotAndClip(page);
    await page.getByRole('button', { name: 'Save Athlete Profile' }).click();

    await expect(page.locator('#save-status')).toHaveText('Athlete profile saved.');
    await expect(page).toHaveURL(/athlete-profile-builder\.html\?profileId=profile-public-1$/);
    await expect(page.locator('#preview-profile-link')).toBeVisible();
    await expect(page.locator('#preview-profile-link')).toHaveAttribute('href', `${baseURL}/athlete-profile.html?profileId=profile-public-1`);
    await expect(page.locator('#share-profile-btn')).toBeVisible();

    const smokeState = await page.evaluate(() => window.__athleteProfileSmoke);
    expect(smokeState.reservations).toHaveLength(1);
    expect(smokeState.reservations[0]).toEqual(expect.objectContaining({ userId: 'parent-1' }));
    expect(smokeState.uploads).toEqual([
        expect.objectContaining({ userId: 'parent-1', kind: 'profile-photo', name: 'headshot.png', type: 'image/png' }),
        expect.objectContaining({ userId: 'parent-1', kind: 'clip', name: 'highlight.mp4', type: 'video/mp4' })
    ]);
    expect(smokeState.uploads[0].profileId).toBe(smokeState.reservations[0].profileId);
    expect(smokeState.events.slice(0, 4)).toEqual([
        `reserve:${smokeState.reservations[0].profileId}`,
        `upload:profile-photo:${smokeState.reservations[0].profileId}`,
        `upload:clip:${smokeState.reservations[0].profileId}`,
        `save:${smokeState.reservations[0].profileId}`
    ]);
    expect(smokeState.saveCalls).toHaveLength(1);
    expect(smokeState.saveCalls[0].draft).toMatchObject({
        privacy: 'public',
        selectedSeasonKeys: ['team-1::player-1'],
        profilePhoto: {
            url: 'https://media.example.test/profile-photo/headshot.png',
            storagePath: expect.stringMatching(/athleteProfiles\/.+\/profile-photo\/headshot\.png$/),
            mimeType: 'image/png',
            sizeBytes: 8
        },
        clips: [
            {
                source: 'upload',
                mediaType: 'video',
                title: 'Fast break finish',
                label: 'Summer league',
                url: 'https://media.example.test/clip/highlight.mp4',
                storagePath: expect.stringMatching(/athleteProfiles\/.+\/clip\/highlight\.mp4$/),
                mimeType: 'video/mp4',
                sizeBytes: 10
            }
        ]
    });
    expect(smokeState.deletes).toEqual([]);
});

test('standalone athlete profile builder cleans uploaded media when a later upload fails', async ({ page, baseURL }) => {
    await mockBuilderModules(page, { failUploadKind: 'clip' });
    await page.goto(buildUrl(baseURL, '/athlete-profile-builder.html?teamId=team-1&playerId=player-1'), { waitUntil: 'domcontentloaded' });

    await page.getByLabel('Public').check();
    await uploadHeadshotAndClip(page);
    await page.getByRole('button', { name: 'Save Athlete Profile' }).click();

    await expect(page.locator('#save-status')).toHaveText('mock clip upload failed');
    const smokeState = await page.evaluate(() => window.__athleteProfileSmoke);
    expect(smokeState.saveCalls).toEqual([]);
    expect(smokeState.deletes).toEqual([
        expect.stringMatching(/athleteProfiles\/.+\/profile-photo\/headshot\.png$/)
    ]);
    expect(smokeState.releasedReservations).toEqual([
        expect.objectContaining({ userId: 'parent-1', profileId: smokeState.reservations[0].profileId })
    ]);
    await expect(page.locator('#share-profile-btn')).toBeHidden();
    await expect(page).toHaveURL(/athlete-profile-builder\.html\?teamId=team-1&playerId=player-1&cb=\d+$/);
});
