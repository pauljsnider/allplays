import { expect, test } from '@playwright/test';

test.skip(
    process.env.SMOKE_SUITE === 'production',
    'Module-mocked app specs need the Vite dev server; production runs cover the deployed bundle via app-production-bootstrap.spec.js'
);

const appBaseUrl = process.env.SMOKE_APP_BASE_URL || '';
test.skip(!appBaseUrl, 'SMOKE_APP_BASE_URL is required for React app smoke tests');

function appUrl(baseURL, hashPath) {
    const url = new URL('/', appBaseUrl || baseURL);
    url.hash = hashPath;
    return url.toString();
}

async function waitForScheduleRoute(page, readyLocator) {
    await expect(async () => {
        await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 1000 });
        await expect(readyLocator).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 30000 });
}

function mobileScheduleHeader(page) {
    return page.locator('.schedule-header').first();
}

function mobileScheduleFilter(page) {
    return mobileScheduleHeader(page).getByLabel('Schedule filter', { exact: true });
}

function mobilePlayerFilter(page) {
    return mobileScheduleHeader(page).getByLabel('Player filter', { exact: true });
}

async function mockScheduleModules(page, options = {}) {
    const gameDate = options.gameDate || '2030-05-28T18:00:00Z';
    const practiceDate = options.practiceDate || '2030-05-29T19:00:00Z';
    const authRoles = options.isAdmin ? ['parent', 'admin'] : options.isCoach ? ['parent', 'coach'] : ['parent'];
    const scheduleLoadError = options.scheduleLoadError || '';
    const rideshareLoadError = options.rideshareLoadError || '';
    const assignmentClaimError = options.assignmentClaimError || '';
    const staffManageable = options.staffManageable === true;
    const gameStatus = options.gameStatus || 'scheduled';
    const gameLiveStatus = options.gameLiveStatus || null;
    const gameHomeScore = options.gameHomeScore ?? null;
    const gameAwayScore = options.gameAwayScore ?? null;
    const gameMyRsvp = options.gameMyRsvp || 'not_responded';
    const gameMyRsvpNote = options.gameMyRsvpNote || '';
    const extraUpcomingEvents = Array.from({ length: options.extraUpcomingEvents || 0 }, (_, index) => {
        const day = String(index + 1).padStart(2, '0');
        return `baseEvent({ eventKey: 'bulk-upcoming-${index}', id: 'bulk-upcoming-${index}', childId: 'player-1', childName: 'Pat', date: new Date('2030-06-${day}T18:00:00Z'), opponent: 'Team ${index + 1}', location: 'Field ${index + 1}' })`;
    }).join(',\n                            ');
    const extraPastEvents = Array.from({ length: options.extraPastEvents || 0 }, (_, index) => {
        const day = String(index + 1).padStart(2, '0');
        return `baseEvent({ eventKey: 'bulk-past-${index}', id: 'bulk-past-${index}', childId: 'player-1', childName: 'Pat', date: new Date('2026-01-${day}T18:00:00Z'), opponent: 'Past ${index + 1}', location: 'Old Field ${index + 1}' })`;
    }).join(',\n                            ');

    await page.addInitScript(() => {
        window.localStorage.clear();
        window.sessionStorage.clear();
        const RealDate = Date;
        const fixedNow = new RealDate('2026-05-20T12:00:00Z').getTime();
        class FixedDate extends RealDate {
            constructor(...args) {
                if (args.length === 0) {
                    super(fixedNow);
                } else {
                    super(...args);
                }
            }
            static now() {
                return fixedNow;
            }
            static parse(value) {
                return RealDate.parse(value);
            }
            static UTC(...args) {
                return RealDate.UTC(...args);
            }
        }
        window.Date = FixedDate;
        window.__scheduleCalls = {
            loads: 0,
            rsvps: [],
            rideshare: [],
            assignments: [],
            packets: []
        };
        window.__trackerCalls = {
            recordEvents: [],
            undoEvents: []
        };
        window.__openedPublicUrls = [];
        window.__sharedPayloads = [];
        window.__copiedAgenda = '';
        Object.defineProperty(navigator, 'clipboard', {
            configurable: true,
            value: {
                writeText: async (text) => {
                    window.__copiedAgenda = text;
                }
            }
        });
        Object.defineProperty(navigator, 'share', {
            configurable: true,
            value: async (payload) => {
                window.__sharedPayloads.push(payload);
            }
        });
        window.open = (url) => {
            window.__openedPublicUrls.push(String(url));
            return { closed: false };
        };
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
                        roles: ${JSON.stringify(authRoles)},
                        parentOf: [
                            { teamId: 'team-1', playerId: 'player-1', playerName: 'Pat', teamName: 'Bears' },
                            { teamId: 'team-1', playerId: 'player-2', playerName: 'Sam', teamName: 'Bears' }
                        ]
                    };
                    return {
                        user,
                        profile: { parentOf: user.parentOf },
                        loading: false,
                        error: null,
                        roles: user.roles,
                        isParent: true,
                        isCoach: ${JSON.stringify(options.isCoach === true)},
                        isAdmin: ${JSON.stringify(options.isAdmin === true)},
                        isPlatformAdmin: ${JSON.stringify(options.isPlatformAdmin === true)},
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
                function baseEvent(overrides) {
                    const linkedOpponent = ${JSON.stringify(options.linkedOpponent === true)};
                    return {
                        eventKey: overrides.eventKey,
                        id: overrides.id,
                        teamId: 'team-1',
                        teamName: 'Bears',
                        type: overrides.type || 'game',
                        date: overrides.date,
                        endDate: overrides.endDate || new Date(overrides.date.getTime() + 60 * 60 * 1000),
                        location: overrides.location || 'Main Gym',
                        opponent: overrides.opponent || 'Falcons',
                        opponentTeamId: overrides.opponentTeamId ?? (linkedOpponent ? 'opp-team-1' : null),
                        opponentTeamName: overrides.opponentTeamName || (linkedOpponent ? 'Ravens Academy' : null),
                        opponentTeamPhoto: overrides.opponentTeamPhoto || (linkedOpponent ? 'https://allplays.ai/ravens.png' : null),
                        title: overrides.title || null,
                        childId: overrides.childId,
                        childName: overrides.childName,
                        isDbGame: overrides.isDbGame !== false,
                        isCancelled: false,
                        canUpdateScore: overrides.canUpdateScore !== false,
                        statTrackerConfigId: overrides.statTrackerConfigId || 'tracker-config-1',
                        status: overrides.status || 'scheduled',
                        liveStatus: overrides.liveStatus || null,
                        homeScore: overrides.homeScore ?? null,
                        awayScore: overrides.awayScore ?? null,
                        isHome: true,
                        kitColor: 'Blue',
                        arrivalTime: null,
                        notes: overrides.notes || null,
                        seasonLabel: overrides.seasonLabel || 'Spring 2026',
                        competitionType: overrides.competitionType || 'league',
                        countsTowardSeasonRecord: true,
                        sourceType: overrides.sourceType || 'db',
                        sourceLabel: overrides.sourceLabel || 'ALL PLAYS schedule',
                        isImported: overrides.isImported === true,
                        visibility: 'team',
                        myRsvp: overrides.myRsvp || ${JSON.stringify(gameMyRsvp)},
                        myRsvpNote: overrides.myRsvpNote || ${JSON.stringify(gameMyRsvpNote)},
                        rsvpSummary: overrides.rsvpSummary || { going: 1, maybe: 0, notGoing: 0, notResponded: 1 },
                        rideshareSummary: overrides.rideshareSummary || { offerCount: 1, seatsLeft: 2, requests: 1, pending: 1, confirmed: 0, isFull: false },
                        assignments: overrides.assignments || getAssignments(),
                        isTeamStaff: overrides.isTeamStaff === true,
                        availabilityLocked: false,
                        availabilityCutoffLabel: 'No cutoff',
                        availabilityPreferences: { cutoffMinutesBeforeStart: 0, noteVisibility: 'team' },
                        availabilityNoteVisibility: 'team',
                        availabilityNotesVisible: true,
                        availabilityNotes: overrides.availabilityNotes || [
                            { displayName: 'Dana Parent', response: 'maybe', note: 'May arrive from another field.' }
                        ],
                        practiceAttendanceSummary: null,
                        practiceHomePacketSummary: overrides.practiceHomePacketSummary || null,
                        practiceSessionId: overrides.practiceSessionId || null,
                        practiceHomePacket: overrides.practiceHomePacket || null,
                        practicePacketCompletions: []
                    };
                }

                function initialRideOffers() {
                    return [
                        {
                            id: 'offer-away',
                            sourceGameId: 'game-1',
                            driverUserId: 'driver-2',
                            driverName: 'Dana Driver',
                            seatCapacity: 3,
                            seatCountConfirmed: 1,
                            direction: 'to',
                            note: 'Leaving from the school lot',
                            status: 'open',
                            requests: [
                                { id: 'user-1__player-2', parentUserId: 'user-1', childId: 'player-2', childName: 'Sam', status: 'pending' }
                            ]
                        },
                        {
                            id: 'offer-own',
                            sourceGameId: 'game-1',
                            driverUserId: 'user-1',
                            driverName: 'Pat Parent',
                            seatCapacity: 2,
                            seatCountConfirmed: 0,
                            direction: 'round-trip',
                            note: 'Can take two after work',
                            status: 'open',
                            requests: [
                                { id: 'other-parent__player-3', parentUserId: 'other-parent', childId: 'player-3', childName: 'Taylor', status: 'pending' }
                            ]
                        }
                    ];
                }

                function getRideOffers() {
                    if (!window.__mockRideOffers) {
                        window.__mockRideOffers = initialRideOffers();
                    }
                    return window.__mockRideOffers;
                }

                function initialAssignments() {
                    return [
                        { role: 'Snacks', value: '', claimable: true, claim: null },
                        { role: 'Scorebook', value: 'Jamie', claimable: false, claim: null },
                        { role: 'Drinks', value: '', claimable: true, claim: { id: 'Drinks', claimedByUserId: 'user-1', claimedByName: 'Pat Parent' } },
                        { role: 'Setup', value: '', claimable: true, claim: { id: 'Setup', claimedByUserId: 'other-parent', claimedByName: 'Taylor' } }
                    ];
                }

                function getAssignments() {
                    if (!window.__mockAssignments) {
                        window.__mockAssignments = initialAssignments();
                    }
                    return window.__mockAssignments;
                }

                function summarizeRideOffers(offers) {
                    const openOffers = offers.filter((offer) => offer.status === 'open');
                    const totals = openOffers.reduce((acc, offer) => {
                        acc.seatsLeft += Math.max(0, Number(offer.seatCapacity || 0) - Number(offer.seatCountConfirmed || 0));
                        acc.requests += offer.requests.length;
                        acc.pending += offer.requests.filter((request) => request.status !== 'confirmed' && request.status !== 'waitlisted' && request.status !== 'declined').length;
                        acc.confirmed += offer.requests.filter((request) => request.status === 'confirmed').length;
                        return acc;
                    }, { seatsLeft: 0, requests: 0, pending: 0, confirmed: 0 });
                    return {
                        offerCount: openOffers.length,
                        seatsLeft: totals.seatsLeft,
                        requests: totals.requests,
                        pending: totals.pending,
                        confirmed: totals.confirmed,
                        isFull: openOffers.length > 0 && totals.seatsLeft === 0
                    };
                }

                export async function addTeamCalendarUrl(teamId, url) {
                    window.__scheduleCalls.calendarUrls = (window.__scheduleCalls.calendarUrls || []).concat({ action: 'add', teamId, url });
                    return { calendarUrls: [url], added: true };
                }

                export async function removeTeamCalendarUrl(teamId, url) {
                    window.__scheduleCalls.calendarUrls = (window.__scheduleCalls.calendarUrls || []).concat({ action: 'remove', teamId, url });
                    return { calendarUrls: [], removed: true };
                }

                export async function createScheduleImportGame(teamId, row, user) {
                    window.__scheduleCalls.csvImports = (window.__scheduleCalls.csvImports || []).concat({ type: 'game', teamId, row, userId: user?.uid || null });
                    return 'imported-game';
                }

                export async function createScheduleImportPractice(teamId, row, user) {
                    window.__scheduleCalls.csvImports = (window.__scheduleCalls.csvImports || []).concat({ type: 'practice', teamId, row, userId: user?.uid || null });
                    return 'imported-practice';
                }

                export async function finalizeScheduleImportBatch() {
                    return { ok: true };
                }

                export async function createScheduledGameForApp(teamId, form, user) {
                    window.__scheduleCalls.gameCreates = (window.__scheduleCalls.gameCreates || []).concat({ teamId, form, userId: user?.uid || null });
                    return { id: 'game-created' };
                }

                export async function createScheduledTournamentBlockForApp(teamId, form, user) {
                    window.__scheduleCalls.tournamentCreates = (window.__scheduleCalls.tournamentCreates || []).concat({ teamId, form, userId: user?.uid || null });
                    return { id: 'tournament-created' };
                }

                export async function createScheduledPracticeForApp(teamId, form, user) {
                    window.__scheduleCalls.practiceCreates = (window.__scheduleCalls.practiceCreates || []).concat({ teamId, form, userId: user?.uid || null });
                    return { id: 'practice-created' };
                }

                export async function loadScheduleStatTrackerConfigsForApp() {
                    return [
                        { id: 'tracker-config-1', label: 'Basketball Standard', sport: 'basketball', defaultGameTitle: 'Game' }
                    ];
                }

                export async function loadScorekeeperStatTrackerConfigsForApp() {
                    return [
                        {
                            id: 'tracker-config-1',
                            name: 'Basketball Standard',
                            baseType: 'Basketball',
                            columns: ['GOALS', 'SHOTS'],
                            statDefinitions: [
                                { id: 'goals', label: 'GOALS' },
                                { id: 'shots', label: 'SHOTS' }
                            ]
                        }
                    ];
                }

                export async function loadScheduledPracticeSeriesForEdit(teamId, eventId, user) {
                    window.__scheduleCalls.practiceSeriesLoads = (window.__scheduleCalls.practiceSeriesLoads || []).concat({ teamId, eventId, userId: user?.uid || null });
                    return {
                        seriesId: 'series-1',
                        eventId,
                        input: {
                            title: 'Practice',
                            startDate: new Date(${JSON.stringify(practiceDate)}),
                            endDate: new Date(new Date(${JSON.stringify(practiceDate)}).getTime() + 90 * 60 * 1000),
                            location: 'Main Gym',
                            notes: '',
                            recurrence: { isRecurring: true, byDays: ['WE'], interval: 1, endType: 'never' }
                        }
                    };
                }

                export async function updateScheduledGameForApp(teamId, gameId, input, user) {
                    window.__scheduleCalls.gameUpdates = (window.__scheduleCalls.gameUpdates || []).concat({ teamId, gameId, input, userId: user?.uid || null });
                    return { success: true };
                }

                export async function updateScheduledPracticeForApp(teamId, input, user, options) {
                    window.__scheduleCalls.practiceUpdates = (window.__scheduleCalls.practiceUpdates || []).concat({ teamId, input, userId: user?.uid || null, options });
                    return { success: true };
                }

                export async function revertScheduledPracticeOccurrenceForApp(teamId, eventId, user) {
                    window.__scheduleCalls.practiceReverts = (window.__scheduleCalls.practiceReverts || []).concat({ teamId, eventId, userId: user?.uid || null });
                    return { success: true };
                }

                export async function loadHomeScoringPlayers(teamId = 'team-1', gameId = 'game-1') {
                    window.__scheduleCalls.trackerRosters = (window.__scheduleCalls.trackerRosters || []).concat({ teamId, gameId });
                    return [
                        { id: 'player-1', name: 'Pat', number: '7', points: 12, fouls: 0, stats: { goals: 1, shots: 2 } },
                        { id: 'player-2', name: 'Sam', number: '8', points: 4, fouls: 0, stats: { goals: 0, shots: 1 } }
                    ];
                }

                export async function loadOpponentScoringPlayers(teamId = '') {
                    window.__scheduleCalls.opponentRosters = (window.__scheduleCalls.opponentRosters || []).concat({ teamId });
                    if (teamId === 'opp-team-1') {
                        return [
                            { id: 'opp-9', name: 'Taylor Guard', number: '9', photoUrl: 'https://allplays.ai/opp-9.png', points: 0, fouls: 0, stats: {} }
                        ];
                    }
                    return [];
                }

                export async function loadOpponentStatsForGame(teamId = 'team-1', gameId = 'game-1') {
                    window.__scheduleCalls.opponentStats = (window.__scheduleCalls.opponentStats || []).concat({ teamId, gameId });
                    return {
                        'opp-9': {
                            name: 'Taylor Guard',
                            number: '9',
                            playerId: 'opp-9',
                            photoUrl: 'https://allplays.ai/opp-9.png',
                            goals: 0,
                            shots: 0,
                            fouls: 0
                        }
                    };
                }

                export async function recordPlayerScoringStat(teamId, gameId, playerId, stat) {
                    const player = (await loadHomeScoringPlayers()).find((candidate) => candidate.id === playerId);
                    const points = Number(stat?.value || 0);
                    window.__scheduleCalls.playerScoring = (window.__scheduleCalls.playerScoring || []).concat({ teamId, gameId, playerId, stat });
                    return {
                        homeScore: (${JSON.stringify(gameHomeScore)} ?? 0) + points,
                        awayScore: ${JSON.stringify(gameAwayScore)} ?? 0,
                        playerPoints: Number(player?.points || 0) + points,
                        liveEventId: 'live-player-score'
                    };
                }

                export async function recordPlayerGameStat(teamId, gameId, playerId, stat) {
                    const player = (await loadHomeScoringPlayers()).find((candidate) => candidate.id === playerId);
                    const foulValue = Math.max(0, Number(stat?.value || 0) || 0);
                    const liveEventId = 'live-' + playerId + '-foul-' + Date.now();
                    const trackerEventId = 'tracker-' + playerId + '-foul-' + Date.now();
                    window.__scheduleCalls.playerGameStats = (window.__scheduleCalls.playerGameStats || []).concat({
                        action: 'record',
                        teamId,
                        gameId,
                        playerId,
                        stat,
                        liveEventId,
                        trackerEventId
                    });
                    return {
                        trackerEventId,
                        liveEventId,
                        playerId,
                        playerName: player?.name || '',
                        playerNumber: player?.number || '',
                        statKey: String(stat?.statKey || ''),
                        value: foulValue,
                        playerStatTotal: Math.max(0, Number(player?.fouls || 0) + foulValue),
                        liveEvent: {
                            eventId: liveEventId,
                            type: 'stat',
                            statKey: String(stat?.statKey || ''),
                            value: foulValue,
                            period: 'H1',
                            isOpponent: false
                        }
                    };
                }

                export async function undoRecordedPlayerGameStat(teamId, gameId, stat) {
                    const player = (await loadHomeScoringPlayers()).find((candidate) => candidate.id === stat?.playerId);
                    window.__scheduleCalls.playerGameStats = (window.__scheduleCalls.playerGameStats || []).concat({
                        action: 'undo',
                        teamId,
                        gameId,
                        stat
                    });
                    return {
                        playerStatTotal: Math.max(0, Number(player?.fouls || 0) - Math.max(0, Number(stat?.value || 0) || 0))
                    };
                }

                export async function loadParentSchedule() {
                    if (${JSON.stringify(scheduleLoadError)}) {
                        throw new Error(${JSON.stringify(scheduleLoadError)});
                    }
                    window.__scheduleCalls.loads += 1;
                    const rideshareSummary = summarizeRideOffers(getRideOffers());
                    return {
                        children: [
                            { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat' },
                            { teamId: 'team-1', teamName: 'Bears', playerId: 'player-2', playerName: 'Sam' }
                        ],
                        events: [
                            baseEvent({ eventKey: 'game-1-player-1', id: 'game-1', childId: 'player-1', childName: 'Pat', date: new Date(${JSON.stringify(gameDate)}), rideshareSummary, status: ${JSON.stringify(gameStatus)}, liveStatus: ${JSON.stringify(gameLiveStatus)}, homeScore: ${JSON.stringify(gameHomeScore)}, awayScore: ${JSON.stringify(gameAwayScore)}, isTeamStaff: ${JSON.stringify(staffManageable)} }),
                            baseEvent({ eventKey: 'game-1-player-2', id: 'game-1', childId: 'player-2', childName: 'Sam', date: new Date(${JSON.stringify(gameDate)}), myRsvp: 'maybe', rideshareSummary, status: ${JSON.stringify(gameStatus)}, liveStatus: ${JSON.stringify(gameLiveStatus)}, homeScore: ${JSON.stringify(gameHomeScore)}, awayScore: ${JSON.stringify(gameAwayScore)}, isTeamStaff: ${JSON.stringify(staffManageable)} }),
                            baseEvent({
                                eventKey: 'practice-1-player-1',
                                id: 'practice-1',
                                type: 'practice',
                                childId: 'player-1',
                                childName: 'Pat',
                                date: new Date('${practiceDate}'),
                                title: 'Practice',
                                opponent: 'TBD',
                                practiceSessionId: 'session-1',
                                practiceHomePacketSummary: '2 drills · 20 min',
                                practiceHomePacket: {
                                    totalMinutes: 20,
                                    blocks: [
                                        { type: 'Drill', duration: 10, drillTitle: 'Ball Mastery', description: '100 touches at home.' },
                                        { type: 'Drill', duration: 10, drillTitle: 'Passing Wall', description: 'Two-touch passing.' }
                                    ]
                                }
                            })
                            ${extraUpcomingEvents ? `,\n                            ${extraUpcomingEvents}` : ''}
                            ${extraPastEvents ? `,\n                            ${extraPastEvents}` : ''}
                        ]
                    };
                }

                export async function loadParentScheduleChildren() {
                    return [
                        { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat' },
                        { teamId: 'team-1', teamName: 'Bears', playerId: 'player-2', playerName: 'Sam' }
                    ];
                }

                export async function loadParentScheduleScope(user) {
                    return {
                        profile: { uid: user?.uid || 'user-1' },
                        children: await loadParentScheduleChildren()
                    };
                }

                export async function hydrateParentScheduleDetails(schedule) {
                    return schedule;
                }

                export function resolveCachedParentScheduleEvents() {
                    return [];
                }

                export async function loadParentScheduleEventDetail(user, { teamId, eventId }) {
                    const result = await loadParentSchedule(user);
                    return {
                        ...result,
                        events: result.events.filter((event) => event.teamId === teamId && event.id === eventId)
                    };
                }

                export async function submitParentScheduleRsvp(event, user, response, note = '') {
                    window.__scheduleCalls.rsvps.push({ eventKey: event.eventKey, childId: event.childId, userId: user.uid, response, note });
                    return { going: 2, maybe: 0, notGoing: 0, notResponded: 0 };
                }

                export async function updateGameScore(teamId, gameId, score, user) {
                    const payload = {
                        homeScore: Number(score?.homeScore ?? 0),
                        awayScore: Number(score?.awayScore ?? 0),
                        scoreUpdatedBy: user?.uid || null
                    };
                    window.__scheduleCalls.scoreUpdates = (window.__scheduleCalls.scoreUpdates || []).concat({ teamId, gameId, payload });
                    return payload;
                }

                export async function adjustGameScore(teamId, gameId, scoreDelta, user) {
                    const delta = {
                        homeScore: Number(scoreDelta?.homeScore ?? 0),
                        awayScore: Number(scoreDelta?.awayScore ?? 0)
                    };
                    window.__scheduleCalls.scoreAdjustments = (window.__scheduleCalls.scoreAdjustments || []).concat({ teamId, gameId, delta, adjustedBy: user?.uid || null });
                    return { homeScore: delta.homeScore, awayScore: delta.awayScore, shared: false };
                }

                export async function publishLiveScoreUpdateEvent(teamId, gameId, score, user, previousScore) {
                    const payload = {
                        homeScore: Number(score?.homeScore ?? 0),
                        awayScore: Number(score?.awayScore ?? 0),
                        previousHomeScore: Number(previousScore?.homeScore ?? 0),
                        previousAwayScore: Number(previousScore?.awayScore ?? 0),
                        userId: user?.uid || null
                    };
                    window.__scheduleCalls.liveScoreEvents = (window.__scheduleCalls.liveScoreEvents || []).concat({ teamId, gameId, payload });
                    return { type: 'score_update', ...payload };
                }

                export function buildLiveGameClockPeriods(game = {}) {
                    const requested = String(game?.liveClockPeriod || game?.period || '').trim();
                    return requested ? [requested, 'H2'].filter((period, index, list) => list.indexOf(period) === index) : ['H1', 'H2'];
                }

                export function resolveLiveGameClockSnapshot(game = {}, now = new Date()) {
                    const persistedClockMs = Math.max(0, Number(game?.liveClockMs ?? game?.gameClockMs ?? 0) || 0);
                    const running = game?.liveClockRunning === true;
                    const updatedAt = game?.liveClockUpdatedAt ? new Date(game.liveClockUpdatedAt) : now;
                    const elapsedMs = running ? Math.max(0, now.getTime() - updatedAt.getTime()) : 0;
                    const periods = buildLiveGameClockPeriods(game);
                    const requested = String(game?.liveClockPeriod || game?.period || '').trim();
                    const period = periods.includes(requested) ? requested : periods[0] || 'H1';
                    return {
                        persistedClockMs,
                        effectiveClockMs: persistedClockMs + elapsedMs,
                        running,
                        period,
                        updatedAt
                    };
                }

                export async function updateLiveGameClockState(teamId, gameId, clock, user) {
                    const payload = {
                        liveClockMs: Math.max(0, Number(clock?.liveClockMs ?? 0) || 0),
                        liveClockRunning: clock?.liveClockRunning === true,
                        liveClockPeriod: String(clock?.liveClockPeriod || clock?.currentGame?.liveClockPeriod || clock?.currentGame?.period || 'H1').trim() || 'H1',
                        liveClockUpdatedAt: new Date(),
                        liveClockUpdatedBy: user?.uid || null,
                        period: String(clock?.liveClockPeriod || clock?.currentGame?.liveClockPeriod || clock?.currentGame?.period || 'H1').trim() || 'H1',
                        liveStatus: 'live',
                        liveHasData: true
                    };
                    window.__scheduleCalls.liveClock = (window.__scheduleCalls.liveClock || []).concat({ teamId, gameId, payload, userId: user?.uid || null });
                    return payload;
                }

                export async function cancelScheduledGameForApp(teamId, gameId, user) {
                    window.__scheduleCalls.cancellations = (window.__scheduleCalls.cancellations || []).concat({ teamId, gameId, userId: user?.uid || null });
                    return { status: 'cancelled', isCancelled: true };
                }

                export async function cancelPracticeOccurrenceForApp(event, user) {
                    window.__scheduleCalls.practiceCancellations = (window.__scheduleCalls.practiceCancellations || []).concat({
                        teamId: event?.teamId || null,
                        eventId: event?.id || null,
                        userId: user?.uid || null
                    });
                    return { status: 'cancelled', isCancelled: true };
                }

                export async function loadAutoFilledLineupDraftPreviewForApp(event, user, formationId) {
                    return {
                        formationId,
                        formationName: '5v5 Basketball',
                        numPeriods: 4,
                        positions: [
                            { id: 'pg', name: 'Point guard', playerId: 'player-1', playerName: 'Pat', playerNumber: '7' },
                            { id: 'sg', name: 'Shooting guard', playerId: 'player-2', playerName: 'Sam', playerNumber: '8' }
                        ],
                        goingPlayers: [
                            { id: 'player-1', name: 'Pat', number: '7' },
                            { id: 'player-2', name: 'Sam', number: '8' }
                        ],
                        gamePlan: { ...(event?.gamePlan || {}), formationId, lineups: { pg: 'player-1', sg: 'player-2' } }
                    };
                }

                export async function saveScheduledGameLineupDraftForApp(event, user, formationId) {
                    const preview = await loadAutoFilledLineupDraftPreviewForApp(event, user, formationId);
                    window.__scheduleCalls.lineupDrafts = (window.__scheduleCalls.lineupDrafts || []).concat({ eventId: event?.id || null, userId: user?.uid || null, formationId });
                    return preview;
                }

                export async function loadGameDayLiveEventsForApp(teamId, gameId) {
                    window.__scheduleCalls.liveEvents = (window.__scheduleCalls.liveEvents || []).concat({ action: 'load', teamId, gameId });
                    return [];
                }

                export async function saveGameDaySubstitutionForApp(teamId, gameId, user, payload) {
                    window.__scheduleCalls.liveEvents = (window.__scheduleCalls.liveEvents || []).concat({ action: 'substitution', teamId, gameId, userId: user?.uid || null, payload });
                    return {
                        rotationPlan: payload?.rotationPlan || {},
                        rotationActual: payload?.rotationActual || {},
                        coachingNotes: payload?.coachingNotes || []
                    };
                }

                export async function completeGameWrapupForApp(teamId, gameId, payload, user) {
                    window.__scheduleCalls.wrapup = (window.__scheduleCalls.wrapup || []).concat({
                        teamId,
                        gameId,
                        payload,
                        userId: user?.uid || null
                    });
                    return {
                        ...(payload || {}),
                        status: 'completed',
                        liveStatus: 'completed'
                    };
                }

                export async function publishGamePlanForApp(event, user) {
                    const version = Number.parseInt(String(event?.gamePlan?.publishedVersion || ''), 10) || 0;
                    const gamePlan = {
                        ...(event?.gamePlan || {}),
                        isPublished: true,
                        publishedVersion: version + 1,
                        publishedLineups: event?.gamePlan?.lineups || {},
                        publishedReadBy: []
                    };
                    window.__scheduleCalls.lineupPublishes = (window.__scheduleCalls.lineupPublishes || []).concat({ eventId: event?.id || null, userId: user?.uid || null });
                    return { gamePlan, notificationError: '' };
                }

                export async function loadParentPracticePacket(event, childEvents) {
                    window.__scheduleCalls.packets.push({ action: 'load', eventId: event.id, sessionId: event.practiceSessionId });
                    if (!event.practiceHomePacket) return null;
                    return {
                        sessionId: event.practiceSessionId || event.id,
                        teamId: event.teamId,
                        eventId: event.id,
                        title: event.title || 'Practice',
                        date: event.date,
                        location: event.location || 'TBD',
                        homePacket: event.practiceHomePacket,
                        completions: window.__mockPacketCompletions || [],
                        children: childEvents.map((childEvent) => ({ id: childEvent.childId, name: childEvent.childName }))
                    };
                }

                export async function loadStaffPracticePacket(event, childEvents) {
                    window.__scheduleCalls.packets.push({ action: 'staff-load', eventId: event.id, sessionId: event.practiceSessionId });
                    return {
                        sessionId: event.practiceSessionId || event.id,
                        teamId: event.teamId,
                        eventId: event.id,
                        title: event.title || 'Practice',
                        date: event.date,
                        location: event.location || 'TBD',
                        homePacket: event.practiceHomePacket || { blocks: [], totalMinutes: 0 },
                        completions: window.__mockPacketCompletions || [],
                        children: childEvents.map((childEvent) => ({ id: childEvent.childId, name: childEvent.childName })),
                        packetTitle: event.practiceHomePacket?.packetTitle || ((event.title || 'Practice') + ' home packet'),
                        dueDate: event.practiceHomePacket?.dueDate || null,
                        totalMinutes: event.practiceHomePacket?.totalMinutes || 0
                    };
                }

                export async function loadStaffPracticeAttendance(event) {
                    window.__scheduleCalls.attendance = (window.__scheduleCalls.attendance || []).concat({ action: 'load', eventId: event?.id || null });
                    return [];
                }

                export async function saveStaffPracticeAttendance(event, user, attendance) {
                    const saved = Array.isArray(attendance) ? attendance.map((entry) => ({ ...entry })) : [];
                    window.__scheduleCalls.attendance = (window.__scheduleCalls.attendance || []).concat({
                        action: 'save',
                        eventId: event?.id || null,
                        userId: user?.uid || null,
                        count: saved.length
                    });
                    return saved;
                }

                export async function saveStaffPracticePacket(event, user, input, childEvents) {
                    const blocks = Array.isArray(input?.blocks)
                        ? input.blocks.map((block, index) => ({
                            drillId: block?.drillId || null,
                            drillTitle: block?.drillTitle || ('Home Drill ' + (index + 1)),
                            type: block?.type || 'Technical',
                            duration: Number.parseInt(String(block?.duration || 10), 10) || 10,
                            description: block?.description || '',
                            notes: block?.notes || ''
                        }))
                        : [];
                    const homePacket = {
                        packetTitle: input?.packetTitle || ((event.title || 'Practice') + ' home packet'),
                        dueDate: input?.dueDate || null,
                        totalMinutes: blocks.reduce((sum, block) => sum + block.duration, 0),
                        blocks
                    };
                    window.__scheduleCalls.packets.push({ action: 'staff-save', eventId: event?.id || null, userId: user?.uid || null, blockCount: blocks.length });
                    return {
                        sessionId: event.practiceSessionId || event.id,
                        teamId: event.teamId,
                        eventId: event.id,
                        title: event.title || 'Practice',
                        date: event.date,
                        location: event.location || 'TBD',
                        homePacket,
                        completions: window.__mockPacketCompletions || [],
                        children: childEvents.map((childEvent) => ({ id: childEvent.childId, name: childEvent.childName })),
                        packetTitle: homePacket.packetTitle,
                        dueDate: homePacket.dueDate,
                        totalMinutes: homePacket.totalMinutes
                    };
                }

                export async function markParentPracticePacketComplete(packet, user, child) {
                    const completion = {
                        id: user.uid + '__' + child.id,
                        parentUserId: user.uid,
                        parentName: user.displayName || user.email,
                        childId: child.id,
                        childName: child.name,
                        status: 'completed'
                    };
                    window.__mockPacketCompletions = (window.__mockPacketCompletions || []).filter((item) => item.id !== completion.id).concat(completion);
                    window.__scheduleCalls.packets.push({ action: 'complete', sessionId: packet.sessionId, childId: child.id });
                    return completion;
                }

                export async function loadParentScheduleAssignments() {
                    window.__scheduleCalls.assignments.push({ action: 'load' });
                    return getAssignments();
                }

                export async function claimParentScheduleAssignmentSlot(event, user, role) {
                    if (${JSON.stringify(assignmentClaimError)}) {
                        throw new Error(${JSON.stringify(assignmentClaimError)});
                    }
                    const assignment = getAssignments().find((item) => item.role === role);
                    if (!assignment) throw new Error('Assignment not found');
                    if (assignment.claim) throw new Error('This slot has already been claimed.');
                    assignment.claim = { id: role, claimedByUserId: user.uid, claimedByName: user.displayName || user.email };
                    window.__scheduleCalls.assignments.push({ action: 'claim', role, userId: user.uid });
                }

                export async function releaseParentScheduleAssignmentClaim(event, role) {
                    const assignment = getAssignments().find((item) => item.role === role);
                    if (assignment) assignment.claim = null;
                    window.__scheduleCalls.assignments.push({ action: 'release', role });
                }

                export async function loadParentScheduleRideOffers() {
                    if (${JSON.stringify(rideshareLoadError)}) {
                        throw new Error(${JSON.stringify(rideshareLoadError)});
                    }
                    window.__scheduleCalls.rideshare.push({ action: 'load' });
                    return getRideOffers();
                }

                export async function createParentScheduleRideOffer(event, user, input) {
                    const offer = {
                        id: 'offer-created-' + getRideOffers().length,
                        sourceGameId: event.id,
                        driverUserId: user.uid,
                        driverName: user.displayName || user.email,
                        seatCapacity: input.seatCapacity,
                        seatCountConfirmed: 0,
                        direction: input.direction,
                        note: input.note || null,
                        status: 'open',
                        requests: []
                    };
                    getRideOffers().unshift(offer);
                    window.__scheduleCalls.rideshare.push({ action: 'create', eventId: event.id, userId: user.uid, input });
                    return offer.id;
                }

                export async function requestParentScheduleRideSpot(event, offer, user, child) {
                    const found = getRideOffers().find((item) => item.id === offer.id);
                    if (!found) throw new Error('Offer not found');
                    const request = {
                        id: user.uid + '__' + child.childId,
                        parentUserId: user.uid,
                        childId: child.childId,
                        childName: child.childName,
                        status: 'pending'
                    };
                    found.requests = found.requests.filter((item) => item.id !== request.id).concat(request);
                    window.__scheduleCalls.rideshare.push({ action: 'request', offerId: offer.id, childId: child.childId, childName: child.childName });
                    return request.id;
                }

                export async function cancelParentScheduleRideRequest(event, offer, requestId) {
                    const found = getRideOffers().find((item) => item.id === offer.id);
                    if (found) {
                        found.requests = found.requests.filter((request) => request.id !== requestId);
                    }
                    window.__scheduleCalls.rideshare.push({ action: 'cancel', offerId: offer.id, requestId });
                }

                export async function updateParentScheduleRideRequestStatus(event, offer, requestId, status) {
                    const found = getRideOffers().find((item) => item.id === offer.id);
                    const request = found?.requests.find((item) => item.id === requestId);
                    if (request) request.status = status;
                    if (found) {
                        found.seatCountConfirmed = found.requests.filter((item) => item.status === 'confirmed').length;
                    }
                    window.__scheduleCalls.rideshare.push({ action: 'decision', offerId: offer.id, requestId, status });
                }

                export async function setParentScheduleRideOfferStatus(event, offer, status) {
                    const found = getRideOffers().find((item) => item.id === offer.id);
                    if (found) found.status = status;
                    window.__scheduleCalls.rideshare.push({ action: 'status', offerId: offer.id, status });
                }

                export async function loadStaffScheduleRsvpBreakdown() {
                    return {
                        counts: { going: 1, maybe: 0, notGoing: 0, notResponded: 1 },
                        grouped: {
                            not_responded: [],
                            going: [],
                            maybe: [],
                            not_going: []
                        }
                    };
                }

                export async function submitStaffScheduleRsvpOverride(event, user, playerId, response) {
                    window.__scheduleCalls.staffRsvps = (window.__scheduleCalls.staffRsvps || []).concat({
                        eventId: event?.id || null,
                        userId: user?.uid || null,
                        playerId,
                        response
                    });
                    return { playerId, response };
                }

                export async function loadStaffRsvpReminderPreview() {
                    return { missingPlayerCount: 0, eligibleEmailCount: 0, players: [] };
                }

                export async function sendStaffRsvpReminder() {
                    return { missingPlayerCount: 0, eligibleEmailCount: 0, emailSentCount: 0, players: [] };
                }

                export function createStaffRsvpAvailabilityLoader() {
                    return {
                        loadBreakdown(event, user) {
                            return loadStaffScheduleRsvpBreakdown(event, user);
                        },
                        loadReminderPreview(event, user) {
                            return loadStaffRsvpReminderPreview(event, user);
                        },
                        invalidateEvent() {}
                    };
                }

                export function summarizeParentScheduleRideOffers(offers) {
                    return summarizeRideOffers(offers);
                }
            `
        });
    });

    await page.route(/\/src\/lib\/statTrackingService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                function normalizeScore(score = {}) {
                    return {
                        homeScore: Math.max(0, Number(score.homeScore || 0)),
                        awayScore: Math.max(0, Number(score.awayScore || 0))
                    };
                }

                function normalizeStatKey(value) {
                    return String(value || '').trim().toLowerCase();
                }

                function isScoringStatKey(statKey) {
                    return ['pts', 'points', 'goals', 'goal'].includes(statKey);
                }

                export function createDefaultStatTrackingService(options = {}) {
                    let currentScore = normalizeScore(options.initialScore);
                    const log = Array.isArray(options.initialEventLog) ? [...options.initialEventLog] : [];
                    return {
                        async recordEvent(teamId, gameId, input, user) {
                            const statKey = normalizeStatKey(input?.undoData?.statKey);
                            const value = Number(input?.undoData?.value || 0);
                            const scoreBefore = { ...currentScore };
                            const scoreAfter = { ...currentScore };
                            if (isScoringStatKey(statKey)) {
                                if (input?.teamSide === 'away') scoreAfter.awayScore += value;
                                else scoreAfter.homeScore += value;
                            }
                            const entry = {
                                eventId: 'smoke-event-' + (log.length + 1),
                                event: {
                                    text: input?.text || '',
                                    period: input?.period || '',
                                    statKey,
                                    value,
                                    isOpponent: input?.undoData?.isOpponent === true
                                },
                                scoreBefore,
                                scoreAfter,
                                aggregateStatKey: statKey,
                                aggregateDelta: value,
                                aggregatePlayerId: input?.undoData?.playerId || null,
                                isOpponent: input?.undoData?.isOpponent === true,
                                opponentStatsEntryId: input?.opponentStatsEntryId || null,
                                opponentStatsEntryBefore: input?.opponentStatsEntryBefore || null,
                                opponentStatsEntryAfter: input?.opponentStatsEntryAfter || null,
                                playerName: input?.playerName || 'Player',
                                playerNumber: input?.playerNumber || ''
                            };
                            currentScore = scoreAfter;
                            log.push(entry);
                            window.__trackerCalls.recordEvents.push({ teamId, gameId, input, userId: user?.uid || null, scoreAfter });
                            return entry;
                        },
                        async undoLastEvent(teamId, gameId, user) {
                            const entry = log.pop() || null;
                            if (entry) currentScore = { ...entry.scoreBefore };
                            window.__trackerCalls.undoEvents.push({ teamId, gameId, userId: user?.uid || null, entry });
                            return entry;
                        },
                        getEventLog() {
                            return log.map((entry) => ({ ...entry, event: { ...entry.event } }));
                        },
                        getCurrentScore() {
                            return { ...currentScore };
                        }
                    };
                }

                export function buildTrackerEventDocument(input, user) {
                    return {
                        text: input?.text || '',
                        gameTime: input?.clock || input?.gameTime || '',
                        period: input?.period || 'Q1',
                        timestamp: Number(input?.timestamp || Date.now()),
                        type: input?.undoData?.type || 'game_log',
                        playerId: input?.undoData?.playerId || null,
                        statKey: normalizeStatKey(input?.undoData?.statKey) || null,
                        value: Number(input?.undoData?.value || 0),
                        isOpponent: input?.undoData?.isOpponent === true,
                        createdBy: user?.uid || ''
                    };
                }
            `
        });
    });

    await page.route(/\/src\/lib\/gameReportService\.ts(\?.*)?$/, async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/javascript',
            body: `
                export async function loadGameReportSections(teamId, gameId) {
                    window.__scheduleCalls.gameReport = { teamId, gameId };
                    return {
                        team: { id: teamId, name: 'Bears' },
                        game: {
                            id: gameId,
                            opponent: 'Falcons',
                            status: 'completed',
                            liveStatus: 'completed',
                            homeScore: 4,
                            awayScore: 2,
                            summary: '**Strong start**\\nPat helped set the tone early and the team finished strong.\\n- Shared the ball well'
                        },
                        summary: '**Strong start**\\nPat helped set the tone early and the team finished strong.\\n- Shared the ball well',
                        statKeys: ['pts', 'reb'],
                        statLabels: { pts: 'PTS', reb: 'REB' },
                        hasPlayingTime: true,
                        playerRows: [
                            { playerId: 'player-1', playerName: 'Pat', number: '7', stats: { pts: 12, reb: 5 }, timeMs: 1200000, didNotPlay: false },
                            { playerId: 'player-2', playerName: 'Sam', number: '9', stats: { pts: 4, reb: 2 }, timeMs: 900000, didNotPlay: false }
                        ],
                        opponentStatKeys: ['pts', 'fouls'],
                        opponentStatLabels: { pts: 'PTS', fouls: 'FOULS' },
                        opponentRows: [
                            { id: 'opp-1', name: 'Opp Guard', number: '2', stats: { pts: 8, fouls: 1 } }
                        ],
                        teamStatKeys: ['turnovers', 'assists'],
                        teamStatLabels: { turnovers: 'Turnovers', assists: 'Assists' },
                        teamStats: { turnovers: 6, assists: 11 },
                        statSheetPhotoUrl: 'https://allplays.ai/mock-statsheet.jpg',
                        highlightClips: [
                            { title: 'Fast break', description: 'Pat scores in transition', period: 'Q1', gameTime: '8:12', startMs: 1000, endMs: 5000, url: 'https://allplays.ai/live-game.html?teamId=team-1&gameId=game-1&replay=true&clipStart=1000&clipEnd=5000' }
                        ],
                        plays: [
                            { id: 'play-1', text: 'Pat scored in transition', period: 'Q1', clock: '8:12', timestamp: new Date('2026-05-21T18:05:00Z') },
                            { id: 'play-2', text: 'Sam grabbed a rebound', period: 'Q2', clock: '4:30', timestamp: new Date('2026-05-21T18:22:00Z') }
                        ],
                        teamInsights: [
                            { title: 'Offensive catalyst', body: 'Pat led the scoring with 12 points.', tone: 'positive' }
                        ],
                        playerInsightRows: [
                            { playerId: 'player-1', playerName: 'Pat', insights: [{ title: 'Closing presence', body: 'Pat stayed involved late.', tone: 'positive' }] }
                        ],
                        emptyInsightsMessage: ''
                    };
                }
            `
        });
    });
}

test('app schedule loads agenda filters, player select, calendar, export, and game detail link', async ({ page, baseURL }) => {
    await mockScheduleModules(page);
    await page.goto(appUrl(baseURL, '/schedule'), { waitUntil: 'domcontentloaded' });

    await waitForScheduleRoute(page, page.getByRole('heading', { name: 'Games, practices, RSVP' }));
    await expect(page.locator('.schedule-header').getByText('RSVP Needed', { exact: true })).toBeVisible();
    await expect(page.getByText('Family agenda')).toBeVisible();
    await expect(page.getByText('Parent queue')).toBeVisible();
    await expect(page.getByText('Next up')).toBeVisible();
    await expect(page.getByText('For Pat · Bears').first()).toBeVisible();
    await expect(page.locator('article').getByText('RSVP needed').first()).toBeVisible();
    await expect(page.getByText('Snacks: Open')).toHaveCount(0);
    await expect(page.getByText('Rideshare')).toHaveCount(0);
    expect(await page.evaluate(() => window.__scheduleCalls.loads)).toBeGreaterThanOrEqual(1);

    await page.getByRole('button', { name: 'Upcoming Practices' }).click();
    await expect(page.getByRole('heading', { name: 'Practice', exact: true })).toBeVisible();
    await expect(page.getByText('Home packet: 2 drills · 20 min')).toHaveCount(0);
    await expect(page.getByText('vs. Falcons')).not.toBeVisible();

    await page.getByRole('button', { name: 'All Upcoming' }).click();
    await page.getByLabel('Player', { exact: true }).selectOption('player-2');
    await expect(page.getByText('For Sam · Bears')).toBeVisible();
    await expect(page.getByText('For Pat · Bears')).not.toBeVisible();

    const detailLink = page.getByRole('link', { name: 'Game details' }).first();
    await expect(detailLink).toHaveAttribute('href', /#\/schedule\/team-1\/game-1\?childId=player-2&section=assignments$/);
    expect(await page.evaluate(() => window.__scheduleCalls.rsvps)).toEqual([]);

    await page.getByRole('button', { name: 'Calendar', exact: true }).click();
    await expect(page.getByText('May 2030')).toBeVisible();
    await expect(page.getByText('vs. Falcons').first()).toBeVisible();

    await page.getByRole('button', { name: '.ics' }).click();
    await expect(page.getByText('Calendar export started.')).toBeVisible();

    await page.getByLabel('Player', { exact: true }).selectOption('');
    await page.getByRole('button', { name: 'Copy agenda' }).click();
    await expect(page.getByText('Schedule details copied.')).toBeVisible();
    expect(await page.evaluate(() => window.__copiedAgenda)).toContain('vs. Falcons');

    await page.locator('.schedule-web-sidebar').getByRole('button', { name: 'Packets' }).click();
    await expect(page.getByText('1 practice packet needs review')).toBeVisible();
    await expect(page.getByText('2 drills · 20 min')).toBeVisible();
});

test('app standard tracker records linked opponent stat entry', async ({ page, baseURL }) => {
    await mockScheduleModules(page, { isCoach: true, linkedOpponent: true });
    await page.goto(appUrl(baseURL, '/schedule/team-1/game-1/track'), { waitUntil: 'domcontentloaded' });

    await waitForScheduleRoute(page, page.getByTestId('standard-tracker-opponent-grid'));
    await expect(page.getByText('Ravens Academy')).toBeVisible();
    await page.getByRole('button', { name: 'Opponent #9 Taylor Guard GOALS add one' }).click();

    await expect(page.getByText('0-1')).toBeVisible();
    await expect(page.getByText('Opponent #9 Taylor Guard GOALS +1 recorded.')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.__trackerCalls.recordEvents[0]?.input)).toMatchObject({
        text: 'Opponent #9 Taylor Guard GOALS +1',
        teamSide: 'away',
        opponentStatsEntryId: 'opp-9',
        opponentStatsEntryBefore: {
            name: 'Taylor Guard',
            number: '9',
            playerId: 'opp-9',
            photoUrl: 'https://allplays.ai/opp-9.png',
            goals: 0,
            shots: 0,
            fouls: 0
        },
        opponentStatsEntryAfter: {
            name: 'Taylor Guard',
            number: '9',
            playerId: 'opp-9',
            photoUrl: 'https://allplays.ai/opp-9.png',
            goals: 1,
            shots: 0,
            fouls: 0
        },
        undoData: {
            type: 'stat',
            playerId: 'opp-9',
            statKey: 'goals',
            value: 1,
            isOpponent: true
        }
    });
});

test('calendar day selection opens a visible event picker for multiple events', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockScheduleModules(page, { practiceDate: '2030-05-28T19:00:00Z' });
    await page.goto(appUrl(baseURL, '/schedule'), { waitUntil: 'domcontentloaded' });

    const calendarToggle = page.getByRole('button', { name: 'Calendar', exact: true });
    await waitForScheduleRoute(page, mobileScheduleFilter(page));
    await expect(calendarToggle).toBeVisible();
    await calendarToggle.click();
    await page.getByRole('button', { name: /May 2030 28, 2 events/ }).click();

    const picker = page.getByRole('dialog', { name: /Tuesday, May 28/ });
    await expect(picker).toBeVisible();
    await expect(picker.getByText('2 events')).toBeVisible();
    await expect(picker.getByText('vs. Falcons')).toBeVisible();
    await expect(picker.getByText('Practice').first()).toBeVisible();
    await expect(picker.getByText('Open game')).toBeVisible();
    await expect(picker.getByText('Open practice')).toBeVisible();
    expect(await picker.evaluate((node) => window.getComputedStyle(node).position)).toBe('fixed');

    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);

    await page.getByRole('button', { name: /May 2030 28, 2 events/ }).click();
    const pickerAfterEscape = page.getByRole('dialog', { name: /Tuesday, May 28/ });
    await expect(pickerAfterEscape).toBeVisible();
    await pickerAfterEscape.getByLabel('Close calendar events').click({ position: { x: 4, y: 4 } });
    await expect(pickerAfterEscape).toHaveCount(0);

    await page.getByRole('button', { name: /May 2030 28, 2 events/ }).click();
    const pickerForClose = page.getByRole('dialog', { name: /Tuesday, May 28/ });
    await pickerForClose.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(pickerForClose).toHaveCount(0);

    await page.getByRole('button', { name: /May 2030 28, 2 events/ }).click();
    const pickerForNavigation = page.getByRole('dialog', { name: /Tuesday, May 28/ });
    await pickerForNavigation.locator('a').filter({ hasText: 'Open practice' }).click();
    await expect(page).toHaveURL(/#\/schedule\/team-1\/practice-1\?childId=player-1&section=game$/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('web schedule desktop layout stays dense and keeps schedule workflows visible', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await mockScheduleModules(page, { extraUpcomingEvents: 4 });
    await page.goto(appUrl(baseURL, '/schedule'), { waitUntil: 'domcontentloaded' });

    await waitForScheduleRoute(page, page.getByRole('heading', { name: 'Games, practices, RSVP' }));
    await expect(page.locator('.schedule-web-sidebar')).toBeVisible();
    await expect(page.getByText('Family agenda')).toBeVisible();
    await expect(page.getByText('Parent queue')).toBeVisible();
    await expect(page.getByText('Next up')).toBeVisible();
    await expect(page.getByRole('button', { name: 'All Upcoming' })).toBeVisible();
    await expect(page.getByLabel('Player', { exact: true })).toBeVisible();

    const headerHeight = await page.locator('.schedule-header').first().evaluate((node) => node.getBoundingClientRect().height);
    expect(headerHeight).toBeLessThanOrEqual(210);

    const visibleCards = await page.locator('.schedule-event-card').evaluateAll((cards) => cards.filter((card) => {
        const rect = card.getBoundingClientRect();
        return rect.top < window.innerHeight && rect.bottom > 0;
    }).length);
    expect(visibleCards).toBeGreaterThanOrEqual(4);

    const firstCard = page.locator('.schedule-event-card').first();
    await expect(firstCard.getByText('Availability needed')).toBeVisible();
    await expect(firstCard.getByText('1 task open')).toBeVisible();
    await expect(firstCard.getByText('4 seats open')).toBeVisible();
    await expect(firstCard.getByRole('link', { name: 'Game details' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('iOS-sized schedule smoke covers list, event nav, and rideshare without overflow', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockScheduleModules(page);
    await page.goto(appUrl(baseURL, '/schedule'), { waitUntil: 'domcontentloaded' });

    await expect(mobileScheduleFilter(page)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.schedule-web-sidebar')).toBeHidden();
    const firstScheduleRow = page.locator('.schedule-list > a').first();
    await expect(firstScheduleRow).toBeVisible();
    await expect(firstScheduleRow.getByText('1 task open')).toBeVisible();
    await expect(firstScheduleRow.getByText('4 seats open')).toBeVisible();
    const scheduleRowCount = await page.locator('.schedule-list > a').count();
    expect(scheduleRowCount).toBeGreaterThanOrEqual(2);
    expect(scheduleRowCount).toBeLessThanOrEqual(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

    await page.goto(appUrl(baseURL, '/schedule/team-1/game-1?childId=player-1'), { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.event-summary-card').getByRole('heading', { name: 'vs. Falcons' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Availability', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Rideshare', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Rideshare', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Rideshare' })).toBeVisible();
    await expect(page.getByText('Dana Driver')).toBeVisible();
    await expect(page.getByText('Request spot')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('iOS-sized staff schedule keeps tools collapsed below the event list', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockScheduleModules(page, { isCoach: true, staffManageable: true });
    await page.goto(appUrl(baseURL, '/schedule'), { waitUntil: 'domcontentloaded' });

    await expect(mobileScheduleFilter(page)).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.schedule-list > a').first()).toBeVisible();
    await expect(page.getByRole('button', { name: /Manage schedule/ })).toBeVisible();
    await expect(page.getByText('Add external calendar')).toHaveCount(0);
    await expect(page.getByText('Draft schedule with AI')).toHaveCount(0);
    await expect(page.getByText('Import schedule CSV')).toHaveCount(0);

    await page.getByRole('button', { name: /Manage schedule/ }).click();
    await expect(page.getByText('Add external calendar')).toBeVisible();
    await expect(page.getByText('Draft schedule with AI')).toBeVisible();
    await expect(page.getByText('Import schedule CSV')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('Android-sized schedule smoke covers practice packet and More workflow without overflow', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 412, height: 915 });
    await mockScheduleModules(page);
    await page.goto(appUrl(baseURL, '/schedule/team-1/practice-1?childId=player-1'), { waitUntil: 'domcontentloaded' });

    await waitForScheduleRoute(page, page.locator('.event-summary-card'));
    await expect(page.getByRole('button', { name: 'Practice packet ready, review packet' })).toBeVisible();

    await page.getByRole('button', { name: 'Practice packet ready, review packet' }).click();
    await expect(page.getByRole('heading', { name: 'Practice hub' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Packet ready' })).toBeVisible();
    await expect(page.getByText('Ball Mastery')).toBeVisible();
    await expect(page.getByText('Passing Wall')).toBeVisible();
    await page.getByRole('button', { name: 'Mark complete: Pat' }).click();
    await expect(page.getByText('Pat marked complete.')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('app schedule event detail exposes parent actions and RSVP', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockScheduleModules(page, {
        gameStatus: 'completed',
        gameLiveStatus: 'completed',
        gameHomeScore: 4,
        gameAwayScore: 2
    });
    await page.goto(appUrl(baseURL, '/schedule/team-1/game-1?childId=player-1&section=availability'), { waitUntil: 'domcontentloaded' });

    const eventSummaryCard = page.locator('.event-summary-card');
    await expect(eventSummaryCard.getByRole('heading', { name: 'vs. Falcons' })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('Pat · Bears')).toBeVisible();
    await expect(page.getByText('Availability needed')).toBeVisible();
    await expect(page.getByText('Is Pat going?')).toBeVisible();
    await expect(page.getByText('Needs attention', { exact: true })).toBeVisible();
    await expect(page.getByText('Review assignments')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Availability' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
    const eventSummaryBox = await page.locator('.event-summary-card').boundingBox();
    const eventNavBox = await page.locator('.event-section-nav').boundingBox();
    expect(eventSummaryBox?.height || 0).toBeLessThanOrEqual(220);
    expect(eventNavBox?.y || 0).toBeLessThanOrEqual(360);

    await page.getByRole('button', { name: 'Rideshare', exact: true }).click();
    const rideshareSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Rideshare' }) });
    await expect(rideshareSection.getByText('Seats open')).toBeVisible();
    await expect(rideshareSection.getByText('4', { exact: true }).first()).toBeVisible();
    await expect(rideshareSection.getByText('Dana Driver')).toBeVisible();
    await expect(rideshareSection.getByText('Leaving from the school lot')).toBeVisible();
    await expect(rideshareSection.getByText('Pat Parent')).toBeVisible();
    await expect(rideshareSection.getByText('Taylor')).toBeVisible();
    await expect(rideshareSection.locator('article').filter({ hasText: 'Dana Driver' }).getByRole('button', { name: 'Close' })).toHaveCount(0);
    await expect(rideshareSection.locator('article').filter({ hasText: 'Dana Driver' }).getByRole('button', { name: 'Confirm' })).toHaveCount(0);

    await rideshareSection.locator('article').filter({ hasText: 'Dana Driver' }).getByRole('button', { name: 'Request spot' }).click();
    await expect(rideshareSection.getByText('Ride requested for Pat.')).toBeVisible();
    expect(await page.evaluate(() => window.__scheduleCalls.rideshare.some((call) => call.action === 'request' && call.offerId === 'offer-away' && call.childId === 'player-1'))).toBe(true);
    await expect(rideshareSection.getByText('Your request for Pat: pending')).toBeVisible();
    await rideshareSection.locator('article').filter({ hasText: 'Dana Driver' }).getByRole('button', { name: 'Cancel' }).click();
    await expect(rideshareSection.getByText('Ride request cancelled.')).toBeVisible();

    await rideshareSection.locator('article').filter({ hasText: 'Pat Parent' }).getByRole('button', { name: 'Confirm' }).click();
    await expect(rideshareSection.getByText('Ride request confirmed.')).toBeVisible();
    expect(await page.evaluate(() => window.__scheduleCalls.rideshare.some((call) => call.action === 'decision' && call.offerId === 'offer-own' && call.status === 'confirmed'))).toBe(true);

    await rideshareSection.getByRole('button', { name: 'Offer Ride' }).click();
    await rideshareSection.getByLabel('Seats').fill('4');
    await rideshareSection.getByLabel('Direction').selectOption('round-trip');
    await rideshareSection.getByLabel('Note').fill('Leaving after the team talk');
    await rideshareSection.getByRole('button', { name: 'Save' }).click();
    await expect(rideshareSection.getByText('Ride offer saved.')).toBeVisible();
    await expect(rideshareSection.getByText('Leaving after the team talk')).toBeVisible();
    expect(await page.evaluate(() => window.__scheduleCalls.rideshare.some((call) => call.action === 'create' && call.input.seatCapacity === 4 && call.input.direction === 'round-trip'))).toBe(true);

    await page.getByRole('button', { name: 'Assignments', exact: true }).click();
    const assignmentsSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Assignments' }) });
    await expect(assignmentsSection.getByText('4 posted · 1 open')).toBeVisible();
    await expect(assignmentsSection.getByText('Snacks')).toBeVisible();
    await expect(assignmentsSection.getByText('Drinks')).toBeVisible();
    await expect(assignmentsSection.getByText('You')).toBeVisible();
    await expect(assignmentsSection.getByText('Scorebook: Jamie')).toHaveCount(0);
    await expect(assignmentsSection.getByRole('button', { name: 'Show filled assignments (2)' })).toBeVisible();
    await assignmentsSection.getByRole('button', { name: 'Show filled assignments (2)' }).click();
    await expect(assignmentsSection.getByText('Setup')).toBeVisible();
    await expect(assignmentsSection.getByText('Taylor')).toBeVisible();
    await expect(assignmentsSection.getByText('Scorebook: Jamie')).toBeVisible();
    await assignmentsSection.locator('article').filter({ hasText: 'Snacks' }).getByRole('button', { name: 'Sign up' }).click();
    await expect(assignmentsSection.getByText('Snacks claimed.')).toBeVisible();
    expect(await page.evaluate(() => window.__scheduleCalls.assignments.some((call) => call.action === 'claim' && call.role === 'Snacks'))).toBe(true);
    await expect(assignmentsSection.locator('article').filter({ hasText: 'Snacks' }).getByText('You')).toBeVisible();
    await assignmentsSection.locator('article').filter({ hasText: 'Snacks' }).getByRole('button', { name: 'Release' }).click();
    await expect(assignmentsSection.getByText('Snacks released.')).toBeVisible();
    expect(await page.evaluate(() => window.__scheduleCalls.assignments.some((call) => call.action === 'release' && call.role === 'Snacks'))).toBe(true);

    await page.getByRole('button', { name: 'Game', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Game hub' })).toBeVisible();
    await expect(page.getByText('Report sections')).toBeVisible();
    await page.getByRole('button', { name: 'Report sections' }).click();
    await expect(page.getByText('Pat helped set the tone early and the team finished strong.')).toBeVisible();
    const reportSections = page.locator('.app-card').filter({ has: page.getByText('Report sections') });
    await expect(reportSections.locator('strong').filter({ hasText: 'Strong start' })).toBeVisible();
    await expect(reportSections.getByText('**Strong start**')).toHaveCount(0);
    await expect(reportSections.locator('li').filter({ hasText: 'Shared the ball well' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Team chat/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Watch replay' }).click();
    expect(await page.evaluate(() => window.__openedPublicUrls)).toContain('https://allplays.ai/live-game.html?teamId=team-1&gameId=game-1&replay=true');
    await page.getByRole('button', { name: 'Share replay' }).click();
    expect(await page.evaluate(() => window.__sharedPayloads[0]?.url)).toBe('https://allplays.ai/live-game.html?teamId=team-1&gameId=game-1&replay=true');
    expect(await page.evaluate(() => window.__sharedPayloads[0]?.text)).toContain('https://allplays.ai/live-game.html?teamId=team-1&gameId=game-1&replay=true');
    await expect(page.getByRole('button', { name: 'Open report' })).toBeVisible();
    await page.getByRole('button', { name: 'Share match report' }).click();
    expect(await page.evaluate(() => window.__sharedPayloads[1]?.url)).toBe('https://allplays.ai/game.html#teamId=team-1&gameId=game-1');
    expect(await page.evaluate(() => window.__sharedPayloads[1]?.text)).toContain('https://allplays.ai/game.html#teamId=team-1&gameId=game-1');
    expect(await page.evaluate(() => window.__scheduleCalls.gameReport)).toEqual({ teamId: 'team-1', gameId: 'game-1' });
    await page.getByRole('button', { name: 'Players' }).click();
    const playerLink = page.getByRole('link', { name: /#7 Pat/ });
    await expect(playerLink).toBeVisible();
    await expect(playerLink).toContainText('12');
    await expect(playerLink).toHaveAttribute('href', /https:\/\/allplays\.ai\/player\.html#teamId=team-1&gameId=game-1&playerId=player-1/);
    await page.getByRole('button', { name: 'Plays' }).click();
    await expect(page.getByText('Pat scored in transition')).toBeVisible();
    await page.getByRole('button', { name: 'Opponent' }).click();
    await expect(page.getByText('Opp Guard')).toBeVisible();
    await page.getByRole('button', { name: 'Insights' }).click();
    await expect(page.getByText('Offensive catalyst')).toBeVisible();
    await page.getByRole('button', { name: 'Media' }).click();
    await expect(page.getByText('Pat scores in transition')).toBeVisible();
    await expect(page.getByText('Score sheet photo')).toBeVisible();
    await expect(page.getByText('Turnovers')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);

    await page.getByRole('button', { name: 'Availability', exact: true }).click();
    const availabilitySection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Availability' }) });
    await expect(availabilitySection.getByRole('heading', { name: 'Availability' })).toBeVisible();
    await expect(availabilitySection.getByText('Dana Parent')).toBeVisible();
    await availabilitySection.getByLabel('Availability note').fill('Arriving after school pickup.');
    await availabilitySection.getByRole('button', { name: 'Going' }).click();
    expect(await page.evaluate(() => window.__scheduleCalls.rsvps)).toEqual([
        { eventKey: 'game-1-player-1', childId: 'player-1', userId: 'user-1', response: 'going', note: 'Arriving after school pickup.' }
    ]);
    await expect(page.getByText('Pat marked going.')).toBeVisible();
});

test('app schedule saves edited availability notes without re-tapping RSVP', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockScheduleModules(page, {
        gameMyRsvp: 'going',
        gameMyRsvpNote: 'Original note'
    });
    await page.goto(appUrl(baseURL, '/schedule/team-1/game-1?childId=player-1&section=availability'), { waitUntil: 'domcontentloaded' });

    const availabilitySection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Availability' }) });
    await waitForScheduleRoute(page, availabilitySection.getByRole('heading', { name: 'Availability' }));
    await expect(availabilitySection.getByText('Availability saved')).toBeVisible();

    const noteInput = availabilitySection.getByLabel('Availability note');
    await noteInput.fill('Running late from pickup.');
    await expect(availabilitySection.getByText('Unsaved note changes')).toBeVisible();
    await availabilitySection.getByRole('button', { name: 'Save note' }).click();

    await expect(page.getByText('Pat availability note saved.')).toBeVisible();
    expect(await page.evaluate(() => window.__scheduleCalls.rsvps)).toEqual([
        { eventKey: 'game-1-player-1', childId: 'player-1', userId: 'user-1', response: 'going', note: 'Running late from pickup.' }
    ]);

    await page.getByRole('button', { name: 'Rideshare', exact: true }).click();
    await page.getByRole('button', { name: 'Availability', exact: true }).click();
    await expect(availabilitySection.getByLabel('Availability note')).toHaveValue('Running late from pickup.');
    await expect(availabilitySection.getByRole('button', { name: 'Save note' })).toHaveCount(0);
});

test('app practice more tab uses hub cards and shares event details without a link', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockScheduleModules(page);
    await page.goto(appUrl(baseURL, '/schedule/team-1/practice-1?childId=player-1'), { waitUntil: 'domcontentloaded' });

    await waitForScheduleRoute(page, page.locator('.event-summary-card'));
    await expect(page.locator('.event-summary-card')).toContainText('Practice');
    await expect(page.getByRole('button', { name: 'Practice packet ready, review packet' })).toBeVisible();
    await page.getByRole('button', { name: 'Practice packet ready, review packet' }).click();
    await expect(async () => {
        await expect(page.getByText('Loading ALL PLAYS')).toBeHidden({ timeout: 1000 });
        await expect(page.getByRole('heading', { name: 'Practice hub' })).toBeVisible({ timeout: 1000 });
        await expect(page.getByText('2 drills · 20 min · Main Gym')).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 30000 });
    const practiceHub = page.locator('.app-card').filter({ has: page.getByRole('heading', { name: 'Practice hub' }) });
    await expect(practiceHub.locator('article').first().getByRole('heading', { name: 'Share practice' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open packet' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Open team' })).toBeVisible();
    await expect(page.getByRole('link', { name: /Team chat/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Packet ready' })).toBeVisible();
    await expect(page.getByText('Ball Mastery')).toBeVisible();
    await expect(page.getByText('Passing Wall')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark complete: Pat' })).toBeVisible();

    await page.getByRole('button', { name: 'Share practice' }).first().click();
    const payload = await page.evaluate(() => window.__sharedPayloads[0]);
    expect(payload.url).toBeUndefined();
    expect(payload.text).toContain('Bears Practice');
    expect(payload.text).toContain('Main Gym');
    expect(payload.text).toContain('Packet: 2 drills · 20 min');
    expect(payload.text).not.toContain('allplays.ai');

    await page.getByRole('button', { name: 'Mark complete: Pat' }).click();
    await expect(page.getByText('Pat marked complete.')).toBeVisible();
    expect(await page.evaluate(() => window.__scheduleCalls.packets.some((call) => call.action === 'complete' && call.childId === 'player-1'))).toBe(true);
});

test('app schedule assignments supports parent sign up and release', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockScheduleModules(page);
    await page.goto(appUrl(baseURL, '/schedule/team-1/game-1?childId=player-1'), { waitUntil: 'domcontentloaded' });

    const assignmentsSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Assignments' }) });
    await expect(async () => {
        await page.getByRole('button', { name: 'Assignments', exact: true }).click();
        await expect(assignmentsSection.getByText('4 posted · 1 open')).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15000 });
    const snacksCard = assignmentsSection.locator('article').filter({ hasText: 'Snacks' });
    const drinksCard = assignmentsSection.locator('article').filter({ hasText: 'Drinks' });
    const setupCard = assignmentsSection.locator('article').filter({ hasText: 'Setup' });

    await expect(assignmentsSection.getByText('4 posted · 1 open')).toBeVisible();
    await expect(assignmentsSection.getByText('Scorebook: Jamie')).toHaveCount(0);
    await expect(snacksCard.getByRole('button', { name: 'Sign up' })).toBeVisible();
    await expect(drinksCard.getByText('You')).toBeVisible();
    await expect(assignmentsSection.getByRole('button', { name: 'Show filled assignments (2)' })).toBeVisible();
    await assignmentsSection.getByRole('button', { name: 'Show filled assignments (2)' }).click();
    await expect(setupCard.getByText('Taylor')).toBeVisible();
    await expect(assignmentsSection.getByText('Scorebook: Jamie')).toBeVisible();

    await snacksCard.getByRole('button', { name: 'Sign up' }).click();
    await expect(assignmentsSection.getByText('Snacks claimed.')).toBeVisible();
    await expect(assignmentsSection.getByText('4 posted · 0 open')).toBeVisible();
    await expect(snacksCard.getByText('You')).toBeVisible();
    expect(await page.evaluate(() => window.__scheduleCalls.assignments.some((call) => call.action === 'claim' && call.role === 'Snacks'))).toBe(true);

    await snacksCard.getByRole('button', { name: 'Release' }).click();
    await expect(assignmentsSection.getByText('Snacks released.')).toBeVisible();
    await expect(assignmentsSection.getByText('4 posted · 1 open')).toBeVisible();
    await expect(snacksCard.getByRole('button', { name: 'Sign up' })).toBeVisible();
    expect(await page.evaluate(() => window.__scheduleCalls.assignments.some((call) => call.action === 'release' && call.role === 'Snacks'))).toBe(true);
});

test('app schedule keeps filters compact on phone', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockScheduleModules(page);
    await page.goto(appUrl(baseURL, '/schedule'), { waitUntil: 'domcontentloaded' });

    const scheduleFilter = mobileScheduleFilter(page);
    await waitForScheduleRoute(page, scheduleFilter);

    const mobileRows = page.locator('.schedule-list > a');
    await expect(async () => {
        await expect(scheduleFilter).toBeVisible({ timeout: 1000 });
        await expect(page.getByRole('button', { name: 'Upcoming Practices' })).toBeHidden();
        await expect(page.getByRole('link', { name: /Game details/i })).toHaveCount(0);
        await expect(mobileRows.first()).toBeVisible({ timeout: 1000 });

        const compactRowCount = await mobileRows.count();
        expect(compactRowCount).toBeGreaterThanOrEqual(2);
        expect(compactRowCount).toBeLessThanOrEqual(3);

        const rowHeights = await mobileRows.evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
        for (const rowHeight of rowHeights) {
            expect(rowHeight).toBeLessThanOrEqual(104);
        }
    }).toPass({ timeout: 30000 });

    await scheduleFilter.selectOption('upcoming-practices');
    await expect(page.getByRole('heading', { name: 'Practice', exact: true })).toBeVisible();
    await expect(page.getByText('Home packet: 2 drills · 20 min')).toHaveCount(0);
    await expect(page.getByText('vs. Falcons')).not.toBeVisible();

    await expect(page.locator('.schedule-header').getByText('1 event · 1 RSVP · 1 packets')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1)).toBe(true);
});

test('app schedule paginates long agenda lists and resets on filter changes', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockScheduleModules(page, { extraUpcomingEvents: 22, extraPastEvents: 12 });
    await page.goto(appUrl(baseURL, '/schedule'), { waitUntil: 'domcontentloaded' });

    await waitForScheduleRoute(page, mobileScheduleFilter(page));
    const mobileRows = page.locator('.schedule-list > a');
    await expect(async () => {
        await expect(mobileRows.first()).toBeVisible({ timeout: 1000 });
        await expect(mobileRows).toHaveCount(20, { timeout: 1000 });
        await expect(page.getByText(/Showing 20 of 2[45] events/)).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15000 });
    await page.getByRole('button', { name: /Show [45] more/ }).click();
    const expandedRowCount = await mobileRows.count();
    expect(expandedRowCount).toBeGreaterThanOrEqual(24);
    expect(expandedRowCount).toBeLessThanOrEqual(25);
    await expect(page.getByRole('button', { name: /Show .* more/ })).toHaveCount(0);

    await mobileScheduleFilter(page).selectOption('past-all');
    await expect(mobileRows).toHaveCount(10);
    await expect(page.getByText('Showing 10 of 12 events')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Show 2 more' })).toBeVisible();

    await mobilePlayerFilter(page).selectOption('player-2');
    await expect(mobileRows).toHaveCount(0);
    await expect(page.getByText('No events in this filter')).toBeVisible();
    await expect(page.getByRole('button', { name: /Show .* more/ })).toHaveCount(0);
});

test('schedule role permissions let admins manage non-owned rideshare requests', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockScheduleModules(page, { isAdmin: true });
    await page.goto(appUrl(baseURL, '/schedule/team-1/game-1?childId=player-1'), { waitUntil: 'domcontentloaded' });

    const rideshareTab = page.getByRole('button', { name: 'Rideshare', exact: true });
    await waitForScheduleRoute(page, rideshareTab);
    await rideshareTab.click();
    const rideshareSection = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Rideshare' }) });
    const danaCard = rideshareSection.locator('article').filter({ hasText: 'Dana Driver' });
    await expect(danaCard.getByRole('button', { name: 'Close' })).toBeVisible();
    await expect(danaCard.getByRole('button', { name: 'Confirm' })).toBeVisible();
    await expect(danaCard.getByRole('button', { name: 'Waitlist' })).toBeVisible();
    await expect(danaCard.getByRole('button', { name: 'Decline' })).toBeVisible();

    await danaCard.getByRole('button', { name: 'Confirm' }).click();
    await expect(rideshareSection.getByText('Ride request confirmed.')).toBeVisible();
    expect(await page.evaluate(() => window.__scheduleCalls.rideshare.some((call) => call.action === 'decision' && call.offerId === 'offer-away' && call.status === 'confirmed'))).toBe(true);
});

test('schedule failure states show errors without trapping users in spinners', async ({ page, baseURL }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockScheduleModules(page, { scheduleLoadError: 'Schedule unavailable.' });
    await page.goto(appUrl(baseURL, '/schedule'), { waitUntil: 'domcontentloaded' });

    const scheduleError = page.getByText('Unable to load schedule while offline. Check your connection and try again.');
    await waitForScheduleRoute(page, scheduleError);
    await expect(page.getByText('Loading schedule')).toHaveCount(0);

    const errorPage = await page.context().newPage();
    await errorPage.setViewportSize({ width: 390, height: 844 });
    await mockScheduleModules(errorPage, {
        rideshareLoadError: 'Rideshare unavailable.',
        assignmentClaimError: 'Slot already taken.'
    });
    await errorPage.goto(appUrl(baseURL, '/schedule/team-1/game-1?childId=player-1'), { waitUntil: 'domcontentloaded' });

    const rideshareTab = errorPage.getByRole('button', { name: 'Rideshare', exact: true });
    await waitForScheduleRoute(errorPage, rideshareTab);
    await rideshareTab.click();
    await expect(errorPage.getByText('Rideshare unavailable.')).toBeVisible({ timeout: 15000 });
    await expect(errorPage.getByText('Loading rideshare offers')).toHaveCount(0);

    await errorPage.getByRole('button', { name: 'Assignments', exact: true }).click();
    const assignmentsSection = errorPage.locator('section').filter({ has: errorPage.getByRole('heading', { name: 'Assignments' }) });
    await assignmentsSection.locator('article').filter({ hasText: 'Snacks' }).getByRole('button', { name: 'Sign up' }).click();
    await expect(assignmentsSection.getByText('Slot already taken.')).toBeVisible({ timeout: 15000 });
    await errorPage.close();
});
