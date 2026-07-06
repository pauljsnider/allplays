import { expect, test } from '@playwright/test';

test.skip(
    process.env.SMOKE_SUITE === 'production',
    'Module-mocked app specs need the Vite dev server; production runs cover the deployed bundle via app-production-bootstrap.spec.js'
);

const appBaseUrl = process.env.SMOKE_APP_BASE_URL || '';
test.skip(!appBaseUrl, 'SMOKE_APP_BASE_URL is required for React app performance timer smoke tests');

test.use({ viewport: { width: 1280, height: 900 } });

function appUrl(baseURL, hashPath) {
    const url = new URL('/', appBaseUrl || baseURL);
    url.hash = hashPath;
    return url.toString();
}

async function installTelemetryCapture(page) {
    await page.addInitScript(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        window.ALLPLAYS_PERFORMANCE_ENABLED = false;
        window.__capturedTelemetry = [];
        window.AllPlaysTelemetry = {
            capture(name, properties = {}, options = {}) {
                window.__capturedTelemetry.push({ name, properties, options });
            },
            flush() {
                return Promise.resolve();
            }
        };
    });
}

async function mockWebVitals(page) {
    await page.route(/\/node_modules\/\.vite\/deps\/web-vitals\.js(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                const report = (callback, metric) => {
                    window.setTimeout(() => callback(metric), 0);
                };
                export function onCLS(callback) {
                    report(callback, { name: 'CLS', value: 0.01, delta: 0.01, id: 'cls-functional', rating: 'good', navigationType: 'navigate' });
                }
                export function onFCP(callback) {
                    report(callback, { name: 'FCP', value: 123.4, delta: 123.4, id: 'fcp-functional', rating: 'good', navigationType: 'navigate' });
                }
                export function onINP(callback) {
                    report(callback, { name: 'INP', value: 42, delta: 42, id: 'inp-functional', rating: 'good', navigationType: 'navigate' });
                }
                export function onLCP(callback) {
                    report(callback, { name: 'LCP', value: 456.7, delta: 456.7, id: 'lcp-functional', rating: 'good', navigationType: 'navigate' });
                }
                export function onTTFB(callback) {
                    report(callback, { name: 'TTFB', value: 77.7, delta: 77.7, id: 'ttfb-functional', rating: 'good', navigationType: 'navigate' });
                }
            `
        });
    });
}

async function mockScheduleAppModules(page) {
    await page.addInitScript(() => {
        window.__scheduleCalls = {
            loads: 0,
            gameCreates: []
        };
    });

    await page.route(/\/src\/lib\/useAuth\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export function useAuth() {
                    const user = {
                        uid: 'coach-1',
                        email: 'coach@example.com',
                        displayName: 'Coach Pat',
                        roles: ['coach'],
                        parentOf: [{ teamId: 'team-1', playerId: 'player-1', playerName: 'Avery', teamName: 'Bears' }]
                    };
                    return {
                        user,
                        profile: { parentOf: user.parentOf },
                        loading: false,
                        error: null,
                        roles: user.roles,
                        isParent: false,
                        isCoach: true,
                        isAdmin: false,
                        isPlatformAdmin: false,
                        refresh: async () => {},
                        signOut: async () => {}
                    };
                }
            `
        });
    });

    await page.route(/\/src\/lib\/scheduleService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                function baseEvent(overrides = {}) {
                    return {
                        eventKey: overrides.eventKey || 'team-1::game-1::player-1',
                        id: overrides.id || 'game-1',
                        teamId: 'team-1',
                        teamName: 'Bears',
                        type: overrides.type || 'game',
                        date: overrides.date || new Date('2030-06-01T18:00:00Z'),
                        endDate: overrides.endDate || new Date('2030-06-01T19:00:00Z'),
                        location: overrides.location || 'Main Gym',
                        opponent: overrides.opponent || 'Falcons',
                        title: overrides.title || null,
                        childId: 'player-1',
                        childName: 'Avery',
                        isDbGame: true,
                        isCancelled: false,
                        canUpdateScore: true,
                        statTrackerConfigId: 'tracker-config-1',
                        status: 'scheduled',
                        liveStatus: null,
                        homeScore: null,
                        awayScore: null,
                        isHome: true,
                        kitColor: 'Blue',
                        arrivalTime: null,
                        notes: null,
                        seasonLabel: 'Spring 2030',
                        competitionType: 'league',
                        countsTowardSeasonRecord: true,
                        sourceType: 'db',
                        sourceLabel: 'ALL PLAYS schedule',
                        isImported: false,
                        visibility: 'team',
                        myRsvp: 'not_responded',
                        myRsvpNote: '',
                        rsvpSummary: { going: 0, maybe: 0, notGoing: 0, notResponded: 1 },
                        rideshareSummary: { offerCount: 0, seatsLeft: 0, requests: 0, pending: 0, confirmed: 0, isFull: false },
                        assignments: [],
                        isTeamStaff: true,
                        availabilityLocked: false,
                        availabilityCutoffLabel: 'No cutoff',
                        availabilityPreferences: { cutoffMinutesBeforeStart: 0, noteVisibility: 'team' },
                        availabilityNoteVisibility: 'team',
                        availabilityNotesVisible: true,
                        availabilityNotes: [],
                        practiceAttendanceSummary: null,
                        practiceHomePacketSummary: null,
                        practiceSessionId: null,
                        practiceHomePacket: null,
                        practicePacketCompletions: []
                    };
                }

                export async function loadParentSchedule() {
                    window.__scheduleCalls.loads += 1;
                    return {
                        children: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Avery' }],
                        events: [baseEvent()]
                    };
                }

                export async function createScheduledGameForApp(teamId, form, user) {
                    window.__scheduleCalls.gameCreates.push({ teamId, form, userId: user?.uid || null });
                    return { id: 'game-created' };
                }

                export async function createScheduledPracticeForApp() {
                    return { id: 'practice-created' };
                }

                export async function createScheduledTournamentBlockForApp() {
                    return { id: 'tournament-created' };
                }

                export async function createScheduleImportGame() {
                    return 'import-game';
                }

                export async function createScheduleImportPractice() {
                    return 'import-practice';
                }

                export async function finalizeScheduleImportBatch() {
                    return { ok: true };
                }

                export async function loadScheduleStatTrackerConfigsForApp() {
                    return [{ id: 'tracker-config-1', name: 'Basketball Standard', sport: 'basketball', defaultGameTitle: 'Game' }];
                }

                export async function addTeamCalendarUrl(_teamId, url) {
                    return { calendarUrls: [url], added: true };
                }

                export async function removeTeamCalendarUrl() {
                    return { calendarUrls: [], removed: true };
                }
            `
        });
    });
}

function getTelemetry(page) {
    return page.evaluate(() => window.__capturedTelemetry || []);
}

function getMeasures(page) {
    return page.evaluate(() => performance.getEntriesByType('measure').map((entry) => ({
        name: entry.name,
        duration: entry.duration
    })));
}

test('records observable app load and workflow timers', async ({ page, baseURL }) => {
    await installTelemetryCapture(page);
    await mockWebVitals(page);
    await mockScheduleAppModules(page);

    await page.goto(appUrl(baseURL, '/schedule?teamId=team-1'), { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 15000 });
    await expect(page.getByRole('heading', { name: 'Games, practices, RSVP' })).toBeVisible();
    await expect(page.getByRole('button', { name: /Manage schedule/ })).toBeVisible();

    await expect.poll(() => getTelemetry(page), { timeout: 15000 }).toEqual(expect.arrayContaining([
        expect.objectContaining({
            name: 'app_initial_load',
            properties: expect.objectContaining({
                loadName: 'schedule',
                outcome: 'success'
            })
        }),
        expect.objectContaining({
            name: 'app_ux_timing',
            properties: expect.objectContaining({
                label: 'schedule mount load',
                outcome: 'success'
            })
        }),
        expect.objectContaining({
            name: 'app_web_vital',
            properties: expect.objectContaining({
                name: 'LCP',
                id: 'lcp-functional'
            })
        })
    ]));

    await expect.poll(() => getMeasures(page), { timeout: 15000 }).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'allplays:ap_ux_app_startup' }),
        expect.objectContaining({ name: 'allplays:ap_initial_load_schedule_initial_load' }),
        expect.objectContaining({ name: 'allplays:ap_ux_schedule_mount_load' })
    ]));

    await page.getByRole('button', { name: /Manage schedule/ }).click();
    const createGamePanel = page.locator('section[aria-label="Create game"]');
    await expect(createGamePanel).toBeVisible();
    await createGamePanel.getByLabel('Opponent').fill('Ravens');
    await createGamePanel.getByLabel('Location').fill('North Field');
    await createGamePanel.getByRole('button', { name: 'Create game' }).click();

    await expect(page.getByText('Game created and schedule refreshed.')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__scheduleCalls.gameCreates), { timeout: 15000 }).toHaveLength(1);

    await expect.poll(() => getTelemetry(page), { timeout: 15000 }).toEqual(expect.arrayContaining([
        expect.objectContaining({
            name: 'app_workflow_timing',
            properties: expect.objectContaining({
                workflowName: 'schedule create game',
                outcome: 'success',
                refreshed: true
            })
        })
    ]));

    await expect.poll(() => getMeasures(page), { timeout: 15000 }).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'allplays:ap_workflow_schedule_create_game' })
    ]));
});
