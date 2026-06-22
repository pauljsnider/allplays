import { expect, test } from '@playwright/test';

const appBaseUrl = process.env.SMOKE_APP_BASE_URL || '';

test.skip(!appBaseUrl, 'SMOKE_APP_BASE_URL is required for React app smoke tests');
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

function appUrl(baseURL, hashPath) {
    const url = new URL('/', appBaseUrl || baseURL);
    url.hash = hashPath;
    return url.toString();
}

async function mockParentToolsModules(page) {
    await page.addInitScript(() => {
        window.__openedPublicUrls = [];
        window.__sharedUrls = [];
        window.__accessRequests = [];
        window.__publicTeamLoads = 0;
        window.__playerLoads = [];
        window.__downloads = [];
        window.__familyCreates = [];
        window.__mediaUploads = [];
        window.__mediaLinks = [];
        window.__mediaDeletes = [];
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: async (value) => {
                    window.__copiedText = String(value);
                }
            }
        });
    });

    await page.route(/\/src\/lib\/useAuth\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export function useAuth() {
                    const user = {
                        uid: 'user-1',
                        email: 'parent@example.com',
                        displayName: 'Pat Parent',
                        roles: ['parent'],
                        parentOf: [{ teamId: 'team-1', playerId: 'player-1', playerName: 'Pat Star', teamName: 'Bears' }]
                    };
                    return {
                        user,
                        profile: { parentOf: user.parentOf },
                        loading: false,
                        error: null,
                        roles: user.roles,
                        isParent: true,
                        isCoach: false,
                        isAdmin: false,
                        isPlatformAdmin: false,
                        refresh: async () => {},
                        signOut: async () => {}
                    };
                }
            `
        });
    });

    await page.route(/\/src\/lib\/publicActions\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export async function openPublicUrl(url) {
                    window.__openedPublicUrls.push(String(url));
                }
                export async function copyPublicText(value) {
                    window.__copiedText = String(value);
                    return 'copied';
                }
                export async function sharePublicUrl(input) {
                    window.__sharedUrls.push(input);
                    return 'shared';
                }
                export async function exportCalendarIcsFile(filename, text) {
                    window.__downloads.push({ filename, text });
                    return 'downloaded';
                }
            `
        });
    });

    await page.route(/\/src\/lib\/parentToolsAccessService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export async function loadParentAccessModel() {
                    return {
                        requests: [{ id: 'request-1', teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star', relation: 'Parent', status: 'pending' }]
                    };
                }
                export async function loadParentAccessTeams() {
                    window.__publicTeamLoads += 1;
                    return [{ id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210' }];
                }
                export async function loadParentAccessPlayers(teamId) {
                    window.__playerLoads.push(String(teamId));
                    return [{ id: 'player-1', name: 'Pat Star', number: '9', photoUrl: null }];
                }
                export async function submitParentAccessRequest(teamId, playerId, relation) {
                    window.__accessRequests.push({ teamId, playerId, relation });
                    return { success: true };
                }
            `
        });
    });

    await page.route(/\/src\/lib\/parentToolsService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export async function loadParentAccessModel() {
                    return {
                        requests: [{ id: 'request-1', teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star', relation: 'Parent', status: 'pending' }]
                    };
                }
                export async function loadParentAccessTeams() {
                    window.__publicTeamLoads += 1;
                    return [{ id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210' }];
                }
                export async function loadParentAccessPlayers(teamId) {
                    window.__playerLoads.push(String(teamId));
                    return [{ id: 'player-1', name: 'Pat Star', number: '9', photoUrl: null }];
                }
                export async function submitParentAccessRequest(teamId, playerId, relation) {
                    window.__accessRequests.push({ teamId, playerId, relation });
                    return { success: true };
                }
                export async function loadParentHouseholdInviteModel() {
                    return {
                        linkedPlayers: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star', playerNumber: '9' }],
                        members: []
                    };
                }
                export async function createParentHouseholdMemberInvite() {
                    return { code: 'HOUSE123', inviteUrl: 'https://allplays.ai/accept-invite.html?code=HOUSE123' };
                }
                export async function loadParentFeesForApp() {
                    return [{
                        id: 'fee-1',
                        title: 'Team dues',
                        teamId: 'team-1',
                        teamName: 'Bears',
                        playerName: 'Pat Star',
                        status: 'open',
                        amountLabel: '$120',
                        dueLabel: 'Jun 1',
                        statusLabel: 'Open',
                        balanceDueCents: 12000,
                        checkoutUrl: 'https://pay.example.test/fee',
                        canPay: true,
                        lineItems: [{ title: 'Season', amountCents: 12000 }],
                        installments: [{ label: 'Deposit', amountCents: 6000 }],
                        ledgerEntries: [{ label: 'Adjustment', amountCents: -1000 }]
                    }];
                }
                export async function initiateParentTeamFeeCheckout() {
                    return { success: true, checkoutUrl: 'https://pay.example.test/created-fee' };
                }
                export async function loadParentCalendarTools() {
                    return {
                        events: [{ teamId: 'team-1', teamName: 'Bears', title: 'Practice', opponent: '', date: new Date('2100-06-01T18:00:00Z') }],
                        teams: [{ teamId: 'team-1', teamName: 'Bears', eventCount: 1 }]
                    };
                }
                export function buildParentScheduleIcs() {
                    return 'BEGIN:VCALENDAR\\r\\nEND:VCALENDAR';
                }
                export function downloadIcs(filename, text) {
                    window.__downloads.push({ filename, text });
                }
                export function getCalendarEventShareText(event) {
                    return event.teamName + ' ' + event.title;
                }
                export async function getPrivateTeamCalendarFeedUrl() {
                    return 'https://feed.example.test/team-1.ics';
                }
                export function getAppleCalendarFeedUrl(url) {
                    return 'webcal://' + url.replace(/^https?:\\/\\//, '');
                }
                export function getGoogleCalendarFeedUrl(url) {
                    return 'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(url);
                }
                export async function loadFamilyShareModel() {
                    return {
                        children: [{ teamId: 'team-1', playerId: 'player-1', playerName: 'Pat Star' }],
                        tokens: [{ id: 'token-1', label: 'Grandma', url: 'https://allplays.ai/family.html?token=token-1', childCount: 1, extraCalendarUrls: [] }]
                    };
                }
                export async function createParentFamilyShare(user, label, urls) {
                    window.__familyCreates.push({ label, urls });
                    return { tokenId: 'token-2', url: 'https://allplays.ai/family.html?token=token-2' };
                }
                export async function revokeParentFamilyShare() {}
                export async function updateParentFamilyShareCalendars() {}
                export async function loadParentRegistrations() {
                    return [{
                        id: 'form-1',
                        teamId: 'team-1',
                        teamName: 'Bears',
                        programName: 'Summer Camp',
                        description: 'Skills week',
                        season: 'Summer',
                        feeLabel: '$75.00',
                        paymentNotice: 'Online checkout available.',
                        onlineCheckout: true,
                        options: [{ id: 'opt-1' }],
                        url: 'https://allplays.ai/registration.html?teamId=team-1&formId=form-1'
                    }];
                }
                export async function loadParentRegistrationDetail() {
                    return {
                        teamName: 'Bears',
                        isPublished: true,
                        onlineCheckout: true,
                        legacyUrl: 'https://allplays.ai/registration.html?teamId=team-1&formId=form-1',
                        form: {
                            programName: 'Summer Camp',
                            description: 'Skills week',
                            season: 'Summer',
                            currency: 'USD',
                            participantFields: [],
                            guardianFields: [],
                            waiverText: '',
                            registrationOptionCounts: {}
                        },
                        options: [{ id: 'opt-1', title: 'Full week', description: 'Skills week', capacityLimit: 20, waitlistEnabled: true }],
                        feeSnapshot: { finalAmountDueCents: 7500 },
                        paymentNotice: 'Online checkout available.',
                        paymentPlans: []
                    };
                }
                export async function loadParentCertificates() {
                    return [{
                        id: 'cert-1',
                        teamId: 'team-1',
                        teamName: 'Bears',
                        playerId: 'player-1',
                        playerName: 'Pat Star',
                        title: 'Hustle Award',
                        narrative: 'Great effort.',
                        url: 'https://allplays.ai/certificates.html#teamId=team-1&certificateId=cert-1'
                    }];
                }
                export async function loadTeamMediaForApp() {
                    return {
                        team: { id: 'team-1', name: 'Bears' },
                        canManage: false,
                        canContribute: true,
                        folders: [{
                            id: 'folder-1',
                            name: 'Game photos',
                            visibility: 'team',
                            itemCount: 1,
                            items: [{ id: 'photo-1', title: 'Tipoff', type: 'photo', uploadedBy: 'user-1', url: 'https://img.example.test/tipoff.jpg' }]
                        }]
                    };
                }
                export async function createTeamMediaAlbumForApp() {
                    return 'folder-2';
                }
                export async function uploadParentTeamMediaPhoto(teamId, folderId, file) {
                    window.__mediaUploads.push({ type: 'photo', teamId, folderId, name: file.name });
                    return 'photo-2';
                }
                export async function uploadParentTeamMediaFile(teamId, folderId, file) {
                    window.__mediaUploads.push({ type: 'file', teamId, folderId, name: file.name });
                    return 'file-1';
                }
                export async function addParentTeamMediaLink(teamId, folderId, title, url) {
                    window.__mediaLinks.push({ teamId, folderId, title, url });
                    return 'link-1';
                }
                export async function deleteTeamMediaItemForApp(teamId, item) {
                    window.__mediaDeletes.push({ teamId, itemId: item.id });
                    await new Promise((resolve) => setTimeout(resolve, 50));
                    return undefined;
                }
                export async function bulkDeleteTeamMediaItemsForApp() {
                    return undefined;
                }
                export async function updateTeamMediaItemForApp() {
                    return undefined;
                }
                export async function moveTeamMediaItemForApp() {
                    return undefined;
                }
                export async function setTeamMediaAlbumCoverForApp() {
                    return undefined;
                }
            `
        });
    });
}

test('parent tools hub completes access, fees, calendars, share, registration, and awards flows', async ({ page, baseURL }) => {
    await mockParentToolsModules(page);
    await page.goto(appUrl(baseURL, '/parent-tools/access'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Family workflows' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Request player access')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request access without a code' })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__publicTeamLoads)).toBe(0);
    await expect.poll(() => page.evaluate(() => window.__playerLoads.length)).toBe(0);
    await expect(page.getByText('Pat Star')).toBeVisible();
    await page.getByRole('button', { name: 'Request access without a code' }).click();
    await expect.poll(() => page.evaluate(() => window.__publicTeamLoads)).toBe(1);
    await expect(page.getByLabel('Team')).toBeVisible();
    await page.getByLabel('Team').selectOption('team-1');
    await expect.poll(() => page.evaluate(() => window.__playerLoads)).toEqual(['team-1']);
    await page.getByLabel('Player').selectOption('player-1');
    await page.getByRole('button', { name: /Send request/ }).click();
    await expect.poll(() => page.evaluate(() => window.__accessRequests.at(-1))).toEqual({ teamId: 'team-1', playerId: 'player-1', relation: 'Parent' });

    await page.getByRole('button', { name: 'Fees' }).click();
    await expect(page.getByText('Team dues')).toBeVisible();
    await expect(page.getByText('Line items')).toBeVisible();
    await page.getByRole('button', { name: /Pay fee/ }).click();
    await expect.poll(() => page.evaluate(() => window.__openedPublicUrls.at(-1))).toBe('https://pay.example.test/fee');

    await page.getByRole('button', { name: 'Calendar' }).click();
    await expect(page.getByText('Calendar tools')).toBeVisible();
    await page.getByRole('button', { name: /Download/ }).click();
    await expect.poll(() => page.evaluate(() => window.__downloads.at(-1)?.filename)).toBe('all-plays-family-schedule.ics');
    await page.getByRole('button', { name: /Copy agenda/ }).click();
    await expect.poll(() => page.evaluate(() => window.__copiedText)).toBe('Bears Practice');
    await page.getByRole('button', { name: 'Apple' }).click();
    await expect.poll(() => page.evaluate(() => window.__openedPublicUrls.at(-1))).toBe('webcal://feed.example.test/team-1.ics');

    await page.getByRole('button', { name: 'Share' }).first().click();
    await expect(page.getByText('Family share')).toBeVisible();
    await page.getByPlaceholder(/Label/).fill('Grandpa');
    await page.getByRole('button', { name: /Create share link/ }).click();
    await expect.poll(() => page.evaluate(() => window.__familyCreates.at(-1))).toEqual({ label: 'Grandpa', urls: [] });

    await page.getByRole('button', { name: 'Register' }).click();
    await expect(page.getByText('Summer Camp')).toBeVisible();
    await expect(page.getByRole('link', { name: /Review/ })).toBeVisible();
    await page.getByRole('button', { name: /Legacy form/ }).click();
    await expect.poll(() => page.evaluate(() => window.__openedPublicUrls.at(-1))).toBe('https://allplays.ai/registration.html?teamId=team-1&formId=form-1');

    await page.getByRole('button', { name: 'Awards' }).click();
    await expect(page.getByText('Hustle Award')).toBeVisible();
    await page.getByRole('button', { name: 'Share' }).last().click();
    await expect.poll(() => page.evaluate(() => window.__sharedUrls.at(-1)?.url)).toBe('https://allplays.ai/certificates.html#teamId=team-1&certificateId=cert-1');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('team media route supports photo upload, file upload, link add, and media open', async ({ page, baseURL }) => {
    await mockParentToolsModules(page);
    await page.goto(appUrl(baseURL, '/teams/team-1/media'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'Bears media' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Game photos' })).toBeVisible();
    await expect(page.getByText('Tipoff')).toBeVisible();

    await page.locator('input[accept="image/*"]').setInputFiles({
        name: 'photo.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from('photo')
    });
    await expect.poll(() => page.evaluate(() => window.__mediaUploads.at(-1))).toEqual({ type: 'photo', teamId: 'team-1', folderId: 'folder-1', name: 'photo.jpg' });

    await page.locator('input[accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx"]').setInputFiles({
        name: 'packet.pdf',
        mimeType: 'application/pdf',
        buffer: Buffer.from('packet')
    });
    await expect.poll(() => page.evaluate(() => window.__mediaUploads.at(-1))).toEqual({ type: 'file', teamId: 'team-1', folderId: 'folder-1', name: 'packet.pdf' });

    await page.getByPlaceholder('Video or link title').fill('Replay');
    await page.getByPlaceholder('https://...').fill('https://video.example.test/replay');
    await page.getByRole('button', { name: /Add link/ }).click();
    await expect.poll(() => page.evaluate(() => window.__mediaLinks.at(-1))).toEqual({ teamId: 'team-1', folderId: 'folder-1', title: 'Replay', url: 'https://video.example.test/replay' });

    await page.getByRole('button', { name: 'Open Tipoff' }).click();
    await expect.poll(() => page.evaluate(() => window.__openedPublicUrls.at(-1))).toBe('https://img.example.test/tipoff.jpg');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /Delete Tipoff/ }).click();
    await expect(page.getByRole('button', { name: /Game photos/ })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.__mediaDeletes.at(-1))).toEqual({ teamId: 'team-1', itemId: 'photo-1' });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
