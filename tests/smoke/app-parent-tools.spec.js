import { expect, test } from '@playwright/test';

test.skip(
    process.env.SMOKE_SUITE === 'production',
    'Module-mocked app specs need the Vite dev server; production runs cover the deployed bundle via app-production-bootstrap.spec.js'
);

const appBaseUrl = process.env.SMOKE_APP_BASE_URL || '';

test.skip(!appBaseUrl, 'SMOKE_APP_BASE_URL is required for React app smoke tests');
test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });

function appUrl(baseURL, hashPath) {
    const url = new URL('/', appBaseUrl || baseURL);
    url.hash = hashPath;
    return url.toString();
}

const parentHouseholdServiceMock = `
    export async function loadParentHouseholdInviteModel() {
        window.__parentToolLoadCounts.household += 1;
        return {
            linkedPlayers: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star', playerNumber: '9' }],
            members: []
        };
    }
    export async function createParentHouseholdMemberInvite() {
        return { code: 'HOUSE123', inviteUrl: 'https://allplays.ai/accept-invite.html?code=HOUSE123' };
    }
`;

const parentFeesServiceMock = `
    export async function loadParentFeesForApp() {
        window.__parentToolLoadCounts.fees += 1;
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
`;

const parentCalendarServiceMock = `
    export async function loadParentCalendarTools() {
        window.__parentToolLoadCounts.calendar += 1;
        return {
            events: [{ teamId: 'team-1', teamName: 'Bears', title: 'Practice', opponent: '', date: new Date('2100-06-01T18:00:00Z') }],
            teams: [{ teamId: 'team-1', teamName: 'Bears', eventCount: 1 }]
        };
    }
    export function buildParentScheduleIcs() {
        return 'BEGIN:VCALENDAR\\r\\nEND:VCALENDAR';
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
`;

const parentFamilyShareServiceMock = `
    export async function loadFamilyShareModel() {
        window.__parentToolLoadCounts.share += 1;
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
`;

const parentRegistrationsServiceMock = `
    export async function loadParentRegistrations() {
        window.__parentToolLoadCounts.registrations += 1;
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
    export async function submitOfflineRegistration() {
        return { status: 'pending', registrationId: 'registration-1' };
    }
    export async function initiateRegistrationCheckout() {
        return { success: true, checkoutUrl: 'https://pay.example.test/registration-checkout' };
    }
    export async function cancelRegistrationCheckout() {
        return { released: true };
    }
    function buildRegistrationDetail() {
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
                participantFields: [{ id: 'name', label: 'Player name', type: 'text', required: false }],
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
    export async function loadParentRegistrationDetail() {
        return buildRegistrationDetail();
    }
    export async function loadPublicRegistrationDetail() {
        return buildRegistrationDetail();
    }
    export async function loadStaffRegistrationDetail() {
        return buildRegistrationDetail();
    }
    export async function loadTeamRegistrationQueuePage() {
        return { reviews: [], lastDoc: null, hasMore: false, totalWaitlisted: 0 };
    }
    export async function loadTeamRegistrationRosterPlayers() {
        return [];
    }
    export async function approveTeamRegistrationForApp() {
        return { success: true };
    }
    export async function rejectTeamRegistrationForApp() {
        return { success: true };
    }
    export async function extendTeamRegistrationOfferForApp() {
        return { success: true };
    }
    export async function acceptTeamRegistrationOfferForApp() {
        return { success: true };
    }
`;

const parentCertificatesServiceMock = `
    export async function loadParentCertificates() {
        window.__parentToolLoadCounts.certificates += 1;
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
`;

async function mockParentToolsModules(page) {
    await page.addInitScript(() => {
        window.__openedPublicUrls = [];
        window.__sharedUrls = [];
        window.__accessRequests = [];
        window.__publicTeamLoads = 0;
        window.__playerLoads = [];
        window.__downloads = [];
        window.__familyCreates = [];
        window.__clipboardShouldFail = false;
        window.__parentToolLoadCounts = {
            fees: 0,
            calendar: 0,
            household: 0,
            share: 0,
            registrations: 0,
            certificates: 0
        };
        window.__mediaUploads = [];
        window.__mediaLinks = [];
        window.__mediaDeletes = [];
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: async (value) => {
                    if (window.__clipboardShouldFail) throw new Error('Clipboard unavailable.');
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
                    window.__triggerSameUserRehydrate = () => {
                        window.location.hash = '/parent-tools/calendar?rehydrate=' + Date.now();
                    };
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
                export async function discoverParentAccessTeams(options = {}) {
                    window.__publicTeamLoads += 1;
                    if (options.cursor === 'cursor-2') {
                        return { teams: [{ id: 'team-2', name: 'Comets', sport: 'Soccer', city: 'Austin', state: 'TX' }], nextCursor: null };
                    }
                    return { teams: [{ id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210' }], nextCursor: 'cursor-2' };
                }
                export async function loadParentAccessPlayers(teamId) {
                    window.__playerLoads.push(String(teamId));
                    if (String(teamId) === 'team-2') {
                        return [{ id: 'player-2', name: 'Cam Comet', number: '22', photoUrl: null }];
                    }
                    return [{ id: 'player-1', name: 'Pat Star', number: '9', photoUrl: null }];
                }
                export async function submitParentAccessRequest(teamId, playerId, relation) {
                    window.__accessRequests.push({ teamId, playerId, relation });
                    return { success: true };
                }
            `
        });
    });

    await page.route(/\/src\/lib\/parentHouseholdService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: parentHouseholdServiceMock
        });
    });

    await page.route(/\/src\/lib\/parentFeesService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: parentFeesServiceMock
        });
    });

    await page.route(/\/src\/lib\/parentCalendarService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: parentCalendarServiceMock
        });
    });

    await page.route(/\/src\/lib\/parentFamilyShareService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: parentFamilyShareServiceMock
        });
    });

    await page.route(/\/src\/lib\/parentRegistrationsService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: parentRegistrationsServiceMock
        });
    });

    await page.route(/\/src\/lib\/parentCertificatesService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: parentCertificatesServiceMock
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
                export async function discoverParentAccessTeams(options = {}) {
                    window.__publicTeamLoads += 1;
                    if (options.cursor === 'cursor-2') {
                        return { teams: [{ id: 'team-2', name: 'Comets', sport: 'Soccer', city: 'Austin', state: 'TX' }], nextCursor: null };
                    }
                    return { teams: [{ id: 'team-1', name: 'Bears', sport: 'Basketball', zip: '66210' }], nextCursor: 'cursor-2' };
                }
                export async function loadParentAccessPlayers(teamId) {
                    window.__playerLoads.push(String(teamId));
                    if (String(teamId) === 'team-2') {
                        return [{ id: 'player-2', name: 'Cam Comet', number: '22', photoUrl: null }];
                    }
                    return [{ id: 'player-1', name: 'Pat Star', number: '9', photoUrl: null }];
                }
                export async function submitParentAccessRequest(teamId, playerId, relation) {
                    window.__accessRequests.push({ teamId, playerId, relation });
                    return { success: true };
                }
                export async function loadParentHouseholdInviteModel() {
                    window.__parentToolLoadCounts.household += 1;
                    return {
                        linkedPlayers: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat Star', playerNumber: '9' }],
                        members: []
                    };
                }
                export async function createParentHouseholdMemberInvite() {
                    return { code: 'HOUSE123', inviteUrl: 'https://allplays.ai/accept-invite.html?code=HOUSE123' };
                }
                export async function loadParentFeesForApp() {
                    window.__parentToolLoadCounts.fees += 1;
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
                    window.__parentToolLoadCounts.calendar += 1;
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
                    window.__parentToolLoadCounts.share += 1;
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
                export async function loadParentCertificates() {
                    window.__parentToolLoadCounts.certificates += 1;
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
                    const parsed = new URL(String(url || '').trim());
                    const host = parsed.hostname.toLowerCase();
                    if (!['youtube.com', 'youtu.be', 'vimeo.com'].some((allowed) => host === allowed || host.endsWith('.' + allowed))) {
                        throw new Error('Enter a valid YouTube or Vimeo URL.');
                    }
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
    await expect.poll(() => page.evaluate(() => window.__publicTeamLoads)).toBe(0);
    await page.getByRole('button', { name: 'Browse' }).click();
    await expect.poll(() => page.evaluate(() => window.__publicTeamLoads)).toBe(1);
    await expect(page.getByLabel('Team')).toBeVisible();
    await page.getByRole('button', { name: 'Load more teams' }).click();
    await expect.poll(() => page.evaluate(() => window.__publicTeamLoads)).toBe(2);
    await page.getByLabel('Team').selectOption('team-2');
    await expect.poll(() => page.evaluate(() => window.__playerLoads)).toEqual(['team-2']);
    await page.getByLabel('Player').selectOption('player-2');
    await page.getByRole('button', { name: /Send request/ }).click();
    await expect.poll(() => page.evaluate(() => window.__accessRequests.at(-1))).toEqual({ teamId: 'team-2', playerId: 'player-2', relation: 'Parent' });

    await page.getByRole('button', { name: 'Fees' }).click();
    await expect(page.getByText('Team dues')).toBeVisible();
    await expect(page.getByText('Line items')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Pay fee/ })).toBeVisible();
    await page.getByRole('button', { name: 'View details' }).click();
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
    await page.evaluate(() => {
        window.__clipboardShouldFail = true;
    });
    await page.getByRole('button', { name: /Create share link/ }).click();
    await expect.poll(() => page.evaluate(() => window.__familyCreates.at(-1))).toEqual({ label: 'Grandpa', urls: [] });
    await expect(page.getByText('https://allplays.ai/family.html?token=token-2')).toBeVisible();
    await page.getByRole('button', { name: 'Share newly created family link' }).click();
    await expect.poll(() => page.evaluate(() => window.__sharedUrls.at(-1)?.url)).toBe('https://allplays.ai/family.html?token=token-2');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);

    await page.getByRole('button', { name: 'Register' }).click();
    await expect(page.getByText('Summer Camp')).toBeVisible();
    await expect(page.getByRole('link', { name: /Review/ })).toBeVisible();
    await page.getByRole('button', { name: /Legacy form/ }).click();
    await expect.poll(() => page.evaluate(() => window.__openedPublicUrls.at(-1))).toBe('https://allplays.ai/registration.html?teamId=team-1&formId=form-1');
    await page.getByRole('link', { name: /Review/ }).click();
    const registrationDescription = page.getByLabel('Registration description');
    await expect(registrationDescription).toHaveText('Skills week');
    await expect(page.getByRole('heading', { name: 'Participant information' })).toBeVisible();
    expect(await page.evaluate(() => {
        const description = document.querySelector('[aria-label="Registration description"]');
        const participantHeading = Array.from(document.querySelectorAll('h2')).find((heading) => heading.textContent?.trim() === 'Participant information');
        return Boolean(description && participantHeading && (description.compareDocumentPosition(participantHeading) & Node.DOCUMENT_POSITION_FOLLOWING));
    })).toBe(true);
    await expect(page.getByRole('button', { name: 'Pay registration with Stripe' })).toBeVisible();
    await page.getByRole('button', { name: 'Pay registration with Stripe' }).click();
    await expect.poll(() => page.evaluate(() => window.__openedPublicUrls.at(-1))).toBe('https://pay.example.test/registration-checkout');

    await page.goto(appUrl(baseURL, '/parent-tools/certificates'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Hustle Award')).toBeVisible();
    await page.getByRole('button', { name: 'Share' }).last().click();
    await expect.poll(() => page.evaluate(() => window.__sharedUrls.at(-1)?.url)).toBe('https://allplays.ai/certificates.html#teamId=team-1&certificateId=cert-1');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});

test('parent fees workflow renders payment states and blocks overlapping checkout', async ({ page, baseURL }) => {
    await mockParentToolsModules(page);
    await page.addInitScript(() => {
        window.__teamFeeCheckoutCalls = [];
        window.__resolveTeamFeeCheckout = null;
    });
    await page.unroute(/\/src\/lib\/parentFeesService\.ts(\?.*)?$/);
    await page.route(/\/src\/lib\/parentFeesService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export async function loadParentFeesForApp() {
                    window.__parentToolLoadCounts.fees += 1;
                    return [{
                        id: 'fee-online',
                        title: 'Online registration',
                        teamId: 'team-1',
                        batchId: 'batch-online',
                        recipientId: 'recipient-online',
                        teamName: 'Bears',
                        playerName: 'Pat Star',
                        status: 'unpaid',
                        amountLabel: '$125',
                        dueLabel: 'Jul 1',
                        statusLabel: 'Open',
                        balanceDueCents: 12500,
                        checkoutUrl: '',
                        canPay: true,
                        checkoutInitiatable: true,
                        paymentAction: 'createCheckout',
                        lineItems: [],
                        installments: [],
                        ledgerEntries: []
                    }, {
                        id: 'fee-second-online',
                        title: 'Tournament fee',
                        teamId: 'team-1',
                        batchId: 'batch-second',
                        recipientId: 'recipient-second',
                        teamName: 'Bears',
                        playerName: 'Pat Star',
                        status: 'unpaid',
                        amountLabel: '$80',
                        dueLabel: 'Jul 8',
                        statusLabel: 'Open',
                        balanceDueCents: 8000,
                        checkoutUrl: '',
                        canPay: true,
                        checkoutInitiatable: true,
                        paymentAction: 'createCheckout',
                        lineItems: [],
                        installments: [],
                        ledgerEntries: []
                    }, {
                        id: 'fee-offline',
                        title: 'Cash registration',
                        teamId: 'team-1',
                        batchId: 'batch-offline',
                        recipientId: 'recipient-offline',
                        teamName: 'Bears',
                        playerName: 'Pat Star',
                        status: 'unpaid',
                        amountLabel: '$65',
                        dueLabel: 'Jul 15',
                        statusLabel: 'Open',
                        balanceDueCents: 6500,
                        checkoutUrl: '',
                        canPay: false,
                        checkoutInitiatable: false,
                        paymentAction: '',
                        offlinePaymentInstructions: 'Bring cash or check to practice.',
                        lineItems: [],
                        installments: [],
                        ledgerEntries: []
                    }, {
                        id: 'fee-paid',
                        title: 'Paid registration',
                        teamId: 'team-1',
                        batchId: 'batch-paid',
                        recipientId: 'recipient-paid',
                        teamName: 'Bears',
                        playerName: 'Pat Star',
                        status: 'paid',
                        amountLabel: '$125',
                        dueLabel: 'Paid',
                        statusLabel: 'Paid',
                        balanceDueCents: 0,
                        canPay: false,
                        checkoutInitiatable: false,
                        paymentAction: '',
                        lineItems: [],
                        installments: [],
                        ledgerEntries: [{ label: 'Paid by card', amountCents: 12500 }]
                    }, {
                        id: 'fee-canceled',
                        title: 'Canceled registration',
                        teamId: 'team-1',
                        batchId: 'batch-canceled',
                        recipientId: 'recipient-canceled',
                        teamName: 'Bears',
                        playerName: 'Pat Star',
                        status: 'canceled',
                        amountLabel: '$65',
                        dueLabel: 'Canceled',
                        statusLabel: 'Canceled',
                        balanceDueCents: 0,
                        canPay: false,
                        checkoutInitiatable: false,
                        paymentAction: '',
                        lineItems: [],
                        installments: [],
                        ledgerEntries: []
                    }];
                }
                export async function initiateParentTeamFeeCheckout(teamId, batchId, recipientId) {
                    window.__teamFeeCheckoutCalls.push({ teamId, batchId, recipientId });
                    return new Promise((resolve) => {
                        window.__resolveTeamFeeCheckout = () => resolve({ success: true, checkoutUrl: 'https://pay.example.test/online-registration' });
                    });
                }
            `
        });
    });

    await page.goto(appUrl(baseURL, '/parent-tools/fees'), { waitUntil: 'domcontentloaded' });
    await expect(page.getByText('Online registration')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Cash registration')).toBeVisible();
    await expect(page.getByText('Bring cash or check to practice.')).toBeVisible();
    await expect(page.getByText('Paid registration')).toBeHidden();
    await expect(page.getByText('Canceled registration')).toBeHidden();

    const onlineCard = page.locator('section.app-card', { hasText: 'Online registration' });
    const secondOnlineCard = page.locator('section.app-card', { hasText: 'Tournament fee' });
    const offlineCard = page.locator('section.app-card', { hasText: 'Cash registration' });
    await expect(onlineCard.getByRole('button', { name: /Pay fee/ })).toBeVisible();
    await expect(secondOnlineCard.getByRole('button', { name: /Pay fee/ })).toBeVisible();
    await expect(offlineCard.getByRole('button', { name: /Pay fee/ })).toHaveCount(0);

    await onlineCard.getByRole('button', { name: /Pay fee/ }).click();
    await expect(onlineCard.getByRole('button', { name: /Opening checkout/ })).toBeVisible();
    await expect(secondOnlineCard.getByRole('button', { name: /Pay fee/ })).toBeDisabled();
    await expect.poll(() => page.evaluate(() => window.__teamFeeCheckoutCalls)).toEqual([{
        teamId: 'team-1',
        batchId: 'batch-online',
        recipientId: 'recipient-online'
    }]);

    await page.evaluate(() => window.__resolveTeamFeeCheckout());
    await expect.poll(() => page.evaluate(() => window.__openedPublicUrls.at(-1))).toBe('https://pay.example.test/online-registration');

    await page.getByRole('button', { name: 'All' }).click();
    await expect(page.getByText('Paid registration')).toBeVisible();
    await expect(page.getByText('Canceled registration')).toBeVisible();
});

test('same-user parent auth rehydrate does not reload visited hidden panels', async ({ page, baseURL }) => {
    await mockParentToolsModules(page);
    await page.goto(appUrl(baseURL, '/parent-tools/access'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Request player access')).toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: 'Fees' }).click();
    await expect(page.getByText('Team dues')).toBeVisible();
    await page.getByRole('button', { name: 'Calendar' }).click();
    await expect(page.getByText('Calendar tools')).toBeVisible();

    const countsBeforeRehydrate = await page.evaluate(() => ({ ...window.__parentToolLoadCounts }));
    expect(countsBeforeRehydrate.fees).toBeGreaterThan(0);
    expect(countsBeforeRehydrate.calendar).toBeGreaterThan(0);

    await page.evaluate(() => window.__triggerSameUserRehydrate());
    await expect(page.getByText('Calendar tools')).toBeVisible();
    await expect.poll(() => page.evaluate(() => ({ ...window.__parentToolLoadCounts }))).toEqual(countsBeforeRehydrate);
});

test('awards deep links surface the requested certificate first on mobile', async ({ page, baseURL }) => {
    await mockParentToolsModules(page);
    await page.route(/\/src\/lib\/parentCertificatesService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export async function loadParentCertificates() {
                    return [{
                        id: 'cert-2',
                        teamId: 'team-2',
                        teamName: 'Falcons',
                        playerId: 'player-2',
                        playerName: 'Taylor Wings',
                        title: 'Leadership Award',
                        narrative: 'Great teammate.',
                        url: 'https://allplays.ai/certificates.html#teamId=team-2&certificateId=cert-2'
                    }, {
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
            `
        });
    });

    await page.goto(appUrl(baseURL, '/parent-tools/certificates?teamId=team-1&certificateId=cert-1'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Opened from a notification')).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Hustle Award', { exact: true })).toBeVisible();
    await expect(page.getByText('Leadership Award', { exact: true })).toHaveCount(0);
    const requestedAwardCard = page.locator('section.app-card', { hasText: 'Hustle Award' });
    const viewAwardButton = requestedAwardCard.getByRole('button', { name: 'View award' });
    await expect(viewAwardButton).toBeVisible();
    const box = await viewAwardButton.boundingBox();
    expect(box && box.y + box.height).toBeLessThanOrEqual(844);
    await expect(requestedAwardCard.getByRole('button', { name: 'Share' })).toBeVisible();
    await viewAwardButton.click();
    await expect.poll(() => page.evaluate(() => window.__openedPublicUrls.at(-1))).toBe('https://allplays.ai/certificates.html#teamId=team-1&certificateId=cert-1');

    await page.getByRole('button', { name: 'Show all awards' }).click();
    await expect(page.getByText('Leadership Award')).toBeVisible();
    await expect(requestedAwardCard.getByRole('button', { name: 'View award' })).toBeVisible();
    await expect(requestedAwardCard.getByRole('button', { name: 'Share' })).toBeVisible();
    const leadershipAwardCard = page.locator('section.app-card', { hasText: 'Leadership Award' });
    await expect(leadershipAwardCard.getByRole('button', { name: 'Open' })).toBeVisible();
    await expect(leadershipAwardCard.getByRole('button', { name: 'Share' })).toBeVisible();
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

    await page.getByPlaceholder('Video title').fill('Replay');
    await page.getByPlaceholder('https://...').fill('https://example.com/not-a-video');
    await page.getByRole('button', { name: /Add link/ }).click();
    await expect(page.getByText('Enter a valid YouTube or Vimeo URL.')).toBeVisible();
    await expect(page.getByPlaceholder('Video title')).toHaveValue('Replay');
    await expect(page.getByPlaceholder('https://...')).toHaveValue('https://example.com/not-a-video');
    expect(await page.evaluate(() => window.__mediaLinks)).toEqual([]);

    await page.getByPlaceholder('https://...').fill('https://youtu.be/replay123');
    await page.getByRole('button', { name: /Add link/ }).click();
    await expect.poll(() => page.evaluate(() => window.__mediaLinks.at(-1))).toEqual({ teamId: 'team-1', folderId: 'folder-1', title: 'Replay', url: 'https://youtu.be/replay123' });

    await page.getByRole('button', { name: 'Open Tipoff' }).click();
    await expect.poll(() => page.evaluate(() => window.__openedPublicUrls.at(-1))).toBe('https://img.example.test/tipoff.jpg');

    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', { name: /Delete Tipoff/ }).click();
    await expect(page.getByRole('button', { name: /Game photos/ })).toBeEnabled();
    await expect.poll(() => page.evaluate(() => window.__mediaDeletes.at(-1))).toEqual({ teamId: 'team-1', itemId: 'photo-1' });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
