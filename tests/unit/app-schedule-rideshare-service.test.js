import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
    getAssignmentClaims: vi.fn(),
    getGames: vi.fn(),
    getPracticePacketCompletions: vi.fn(),
    getPracticeSessions: vi.fn(),
    getRsvps: vi.fn(),
    getRsvpSummaries: vi.fn(),
    getTeam: vi.fn(),
    getTrackedCalendarEventUids: vi.fn(),
    createRideOffer: vi.fn(),
    claimAssignmentSlot: vi.fn(),
    requestRideSpot: vi.fn(),
    listRideOffersForEvent: vi.fn(),
    updateRideRequestStatus: vi.fn(),
    closeRideOffer: vi.fn(),
    cancelRideRequest: vi.fn(),
    releaseAssignmentClaim: vi.fn(),
    submitRsvpForPlayer: vi.fn(),
    upsertPracticePacketCompletion: vi.fn(),
    updateGame: vi.fn()
}));

const profileMocks = vi.hoisted(() => ({
    loadProfileDocument: vi.fn(),
    saveProfileDocument: vi.fn()
}));

const authMocks = vi.hoisted(() => ({
    firebaseAuth: {
        app: {
            options: {
                projectId: 'demo-allplays'
            }
        }
    },
    getNativeAuthIdToken: vi.fn()
}));

vi.mock('../../js/db.js', () => dbMocks);
vi.mock('../../apps/app/src/lib/profileService.ts', () => profileMocks);
vi.mock('../../apps/app/src/lib/authService.ts', () => authMocks);
vi.mock('../../js/utils.js', () => ({
    expandRecurrence: vi.fn(() => []),
    extractOpponent: vi.fn(() => 'TBD'),
    fetchAndParseCalendar: vi.fn(() => Promise.resolve([])),
    getCalendarEventTrackingId: vi.fn(() => ''),
    isPracticeEvent: vi.fn(() => false),
    isTrackedCalendarEvent: vi.fn(() => false)
}));
vi.mock('../../js/parent-dashboard-practice-sessions.js', () => ({
    filterVisiblePracticeSessions: vi.fn((sessions) => sessions || [])
}));
vi.mock('../../js/parent-dashboard-rsvp.js', () => ({
    resolveMyRsvpByChildForGame: vi.fn(() => ({}))
}));
vi.mock('../../js/availability-preferences.js', () => ({
    buildAvailabilityNoteRows: vi.fn(() => []),
    canViewAvailabilityNotes: vi.fn(() => false),
    formatAvailabilityCutoff: vi.fn(() => 'No cutoff'),
    isAvailabilityLocked: vi.fn(() => false),
    normalizeAvailabilityPreferences: vi.fn((preferences) => preferences || {})
}));
vi.mock('../../js/rideshare-helpers.js', () => ({
    getEventRideshareSummary: vi.fn((offers = []) => {
        const openOffers = offers.filter((offer) => offer.status !== 'closed' && offer.status !== 'cancelled');
        const totals = openOffers.reduce((acc, offer) => {
            const seatCapacity = Number(offer.seatCapacity || 0);
            const seatCountConfirmed = Number(offer.seatCountConfirmed || 0);
            const requests = Array.isArray(offer.requests) ? offer.requests : [];
            acc.seatsLeft += Math.max(0, seatCapacity - seatCountConfirmed);
            acc.requests += requests.length;
            acc.pending += requests.filter((request) => !['confirmed', 'waitlisted', 'declined'].includes(request.status)).length;
            acc.confirmed += requests.filter((request) => request.status === 'confirmed').length;
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
    })
}));
vi.mock('../../js/snack-helpers.js', () => ({
    mergeAssignmentsWithClaims: vi.fn((assignments) => assignments || [])
}));

import {
    cancelParentScheduleRideRequest,
    createParentScheduleRideOffer,
    loadParentScheduleRideOffers,
    requestParentScheduleRideSpot,
    setParentScheduleRideOfferStatus,
    updateParentScheduleRideRequestStatus
} from '../../apps/app/src/lib/scheduleService.ts';

function installWindow(protocol = 'http:') {
    vi.stubGlobal('window', {
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
        location: { protocol }
    });
}

function event(overrides = {}) {
    return {
        eventKey: 'team-1::game-1::player-1',
        id: 'game-1',
        teamId: 'team-1',
        teamName: 'Bears',
        type: 'game',
        date: new Date('2026-05-21T18:00:00Z'),
        location: 'Main Gym',
        opponent: 'Falcons',
        childId: 'player-1',
        childName: 'Pat',
        isDbGame: true,
        isCancelled: false,
        assignments: [],
        ...overrides
    };
}

function user(overrides = {}) {
    return {
        uid: 'user-1',
        email: 'parent@example.com',
        displayName: 'Pat Parent',
        roles: ['parent'],
        parentOf: [
            { teamId: 'team-1', playerId: 'player-1', playerName: 'Pat' }
        ],
        ...overrides
    };
}

function offer(overrides = {}) {
    return {
        id: 'offer-1',
        sourceGameId: 'legacy-game-1',
        driverUserId: 'driver-1',
        driverName: 'Dana Driver',
        seatCapacity: 3,
        seatCountConfirmed: 1,
        direction: 'to',
        note: null,
        status: 'open',
        requests: [],
        ...overrides
    };
}

function encodeFirestoreValue(value) {
    if (value === null || value === undefined) return { nullValue: 'NULL_VALUE' };
    if (typeof value === 'string') return { stringValue: value };
    if (typeof value === 'boolean') return { booleanValue: value };
    if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
    if (value instanceof Date) return { timestampValue: value.toISOString() };
    if (Array.isArray(value)) return { arrayValue: { values: value.map((entry) => encodeFirestoreValue(entry)) } };
    return {
        mapValue: {
            fields: Object.keys(value).reduce((acc, key) => {
                acc[key] = encodeFirestoreValue(value[key]);
                return acc;
            }, {})
        }
    };
}

function firestoreDoc(path, data) {
    return {
        name: `projects/demo-allplays/databases/(default)/documents/${path}`,
        fields: Object.keys(data).reduce((acc, key) => {
            acc[key] = encodeFirestoreValue(data[key]);
            return acc;
        }, {})
    };
}

function restOk(payload = {}) {
    return {
        ok: true,
        status: 200,
        json: async () => payload
    };
}

function restError(status = 404, message = 'Not found') {
    return {
        ok: false,
        status,
        json: async () => ({ error: { message } })
    };
}

function parseBody(call) {
    return JSON.parse(call[1]?.body || '{}');
}

let warnSpy;

beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    installWindow('http:');
    authMocks.getNativeAuthIdToken.mockResolvedValue('native-id-token');
    profileMocks.loadProfileDocument.mockResolvedValue({
        parentOf: [
            { teamId: 'team-1', playerId: 'player-1', playerName: 'Pat' }
        ],
        parentTeamIds: [],
        parentPlayerKeys: []
    });
    profileMocks.saveProfileDocument.mockResolvedValue(undefined);
});

afterEach(() => {
    warnSpy?.mockRestore();
    vi.unstubAllGlobals();
});

describe('React app schedule rideshare service integration', () => {
    it('delegates web rideshare actions to the existing Firebase helpers with legacy source game IDs', async () => {
        dbMocks.listRideOffersForEvent.mockResolvedValue([
            offer({
                requests: [
                    { id: 'user-1__player-1', parentUserId: 'user-1', childId: 'player-1', status: 'pending' }
                ]
            })
        ]);
        dbMocks.createRideOffer.mockResolvedValue('offer-new');
        dbMocks.requestRideSpot.mockResolvedValue('user-1__player-1');
        dbMocks.updateRideRequestStatus.mockResolvedValue({ seatCountConfirmed: 2 });
        dbMocks.closeRideOffer.mockResolvedValue(undefined);
        dbMocks.cancelRideRequest.mockResolvedValue(undefined);

        const loaded = await loadParentScheduleRideOffers(event());
        expect(dbMocks.listRideOffersForEvent).toHaveBeenCalledWith('team-1', 'game-1', { fallbackGameIds: [] });
        expect(loaded[0]).toMatchObject({
            id: 'offer-1',
            sourceGameId: 'legacy-game-1',
            direction: 'to',
            status: 'open',
            requests: [{ id: 'user-1__player-1', status: 'pending' }]
        });

        await createParentScheduleRideOffer(event(), user(), {
            seatCapacity: 4,
            direction: 'round-trip',
            note: ' Leaving after snacks '
        });
        expect(profileMocks.saveProfileDocument).toHaveBeenCalledWith('user-1', expect.objectContaining({
            parentTeamIds: ['team-1'],
            parentPlayerKeys: ['team-1::player-1']
        }));
        expect(dbMocks.createRideOffer).toHaveBeenCalledWith('team-1', 'game-1', {
            seatCapacity: 4,
            direction: 'round-trip',
            note: 'Leaving after snacks',
            driverName: 'Pat Parent'
        });

        await requestParentScheduleRideSpot(event(), offer(), user(), { childId: 'player-1', childName: 'Pat' });
        expect(dbMocks.requestRideSpot).toHaveBeenCalledWith('team-1', 'legacy-game-1', 'offer-1', {
            childId: 'player-1',
            childName: 'Pat'
        });

        await updateParentScheduleRideRequestStatus(event(), offer(), 'request-1', 'confirmed');
        expect(dbMocks.updateRideRequestStatus).toHaveBeenCalledWith('team-1', 'legacy-game-1', 'offer-1', 'request-1', 'confirmed');

        await setParentScheduleRideOfferStatus(event(), offer(), 'closed');
        expect(dbMocks.closeRideOffer).toHaveBeenCalledWith('team-1', 'legacy-game-1', 'offer-1', 'closed');

        await cancelParentScheduleRideRequest(event(), offer(), 'request-1');
        expect(dbMocks.cancelRideRequest).toHaveBeenCalledWith('team-1', 'legacy-game-1', 'offer-1', 'request-1');
    });

    it('loads ride offers through native Firestore REST fallback when the web helper fails in Capacitor', async () => {
        installWindow('capacitor:');
        dbMocks.listRideOffersForEvent.mockRejectedValue(new Error('web unavailable'));
        const fetchMock = vi.fn(async (url) => {
            const href = String(url);
            if (href.endsWith('/teams/team-1/games/game-1/rideOffers')) {
                return restOk({
                    documents: [
                        firestoreDoc('teams/team-1/games/game-1/rideOffers/offer-native', {
                            driverUserId: 'driver-1',
                            driverName: 'Dana Driver',
                            seatCapacity: 3,
                            seatCountConfirmed: 1,
                            direction: 'from',
                            status: 'open'
                        })
                    ]
                });
            }
            if (href.endsWith('/teams/team-1/games/game-1/rideOffers/offer-native/requests')) {
                return restOk({
                    documents: [
                        firestoreDoc('teams/team-1/games/game-1/rideOffers/offer-native/requests/request-1', {
                            parentUserId: 'user-1',
                            childId: 'player-1',
                            childName: 'Pat',
                            status: 'pending'
                        })
                    ]
                });
            }
            return restError();
        });
        vi.stubGlobal('fetch', fetchMock);

        const loaded = await loadParentScheduleRideOffers(event());

        expect(authMocks.getNativeAuthIdToken).toHaveBeenCalledWith(true);
        expect(loaded).toEqual([
            expect.objectContaining({
                id: 'offer-native',
                sourceGameId: 'game-1',
                driverName: 'Dana Driver',
                direction: 'from',
                requests: [
                    expect.objectContaining({ id: 'request-1', childId: 'player-1', status: 'pending' })
                ]
            })
        ]);
    });

    it('creates and requests rides through native Firestore REST fallback when web writes fail', async () => {
        installWindow('capacitor:');
        profileMocks.loadProfileDocument.mockResolvedValue({
            parentOf: [{ teamId: 'team-1', playerId: 'player-1' }],
            parentTeamIds: ['team-1'],
            parentPlayerKeys: ['team-1::player-1']
        });
        dbMocks.createRideOffer.mockRejectedValue(new Error('web create failed'));
        dbMocks.requestRideSpot.mockRejectedValue(new Error('web request failed'));

        const fetchMock = vi.fn(async (url, init = {}) => {
            const href = String(url);
            const method = init.method || 'GET';
            if (method === 'POST' && href.endsWith('/teams/team-1/games/game-1/rideOffers')) {
                return restOk(firestoreDoc('teams/team-1/games/game-1/rideOffers/offer-native', {}));
            }
            if (method === 'GET' && href.includes('/teams/team-1/games/legacy-game-1/rideOffers/offer-1') && !href.includes('/requests/')) {
                return restOk(firestoreDoc('teams/team-1/games/legacy-game-1/rideOffers/offer-1', {
                    seatCapacity: 3,
                    seatCountConfirmed: 1,
                    status: 'open'
                }));
            }
            if (method === 'GET' && href.includes('/teams/team-1/games/legacy-game-1/rideOffers/offer-1/requests/user-1__player-1')) {
                return restError(404, 'not found');
            }
            if (method === 'PATCH' && href.includes('/teams/team-1/games/legacy-game-1/rideOffers/offer-1/requests/user-1__player-1')) {
                return restOk({});
            }
            return restError();
        });
        vi.stubGlobal('fetch', fetchMock);

        const newOfferId = await createParentScheduleRideOffer(event(), user(), {
            seatCapacity: 2,
            direction: 'to',
            note: 'Pickup at school'
        });
        expect(newOfferId).toBe('offer-native');
        const createCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith('/rideOffers') && init?.method === 'POST');
        expect(parseBody(createCall).fields).toMatchObject({
            driverUserId: { stringValue: 'user-1' },
            driverName: { stringValue: 'Pat Parent' },
            seatCapacity: { integerValue: '2' },
            direction: { stringValue: 'to' },
            note: { stringValue: 'Pickup at school' },
            status: { stringValue: 'open' }
        });

        const requestId = await requestParentScheduleRideSpot(event(), offer(), user(), { childId: 'player-1', childName: 'Pat' });
        expect(requestId).toBe('user-1__player-1');
        const requestPatchCall = fetchMock.mock.calls.find(([url, init]) =>
            String(url).includes('/requests/user-1__player-1') && init?.method === 'PATCH'
        );
        expect(parseBody(requestPatchCall).fields).toMatchObject({
            parentUserId: { stringValue: 'user-1' },
            childId: { stringValue: 'player-1' },
            childName: { stringValue: 'Pat' },
            status: { stringValue: 'pending' }
        });
    });

    it('waitlists native REST fallback ride requests when the offer is full', async () => {
        installWindow('capacitor:');
        dbMocks.requestRideSpot.mockRejectedValue(new Error('web request failed'));

        const fetchMock = vi.fn(async (url, init = {}) => {
            const href = String(url);
            const method = init.method || 'GET';
            if (method === 'GET' && href.includes('/teams/team-1/games/legacy-game-1/rideOffers/offer-1') && !href.includes('/requests/')) {
                return restOk(firestoreDoc('teams/team-1/games/legacy-game-1/rideOffers/offer-1', {
                    seatCapacity: 2,
                    seatCountConfirmed: 2,
                    status: 'open'
                }));
            }
            if (method === 'GET' && href.includes('/teams/team-1/games/legacy-game-1/rideOffers/offer-1/requests/user-1__player-1')) {
                return restError(404, 'not found');
            }
            if (method === 'PATCH' && href.includes('/teams/team-1/games/legacy-game-1/rideOffers/offer-1/requests/user-1__player-1')) {
                return restOk({});
            }
            return restError();
        });
        vi.stubGlobal('fetch', fetchMock);

        const requestId = await requestParentScheduleRideSpot(
            event(),
            offer({ seatCapacity: 2, seatCountConfirmed: 2 }),
            user(),
            { childId: 'player-1', childName: 'Pat' }
        );

        expect(requestId).toBe('user-1__player-1');
        const requestPatchCall = fetchMock.mock.calls.find(([url, init]) =>
            String(url).includes('/requests/user-1__player-1') && init?.method === 'PATCH'
        );
        expect(parseBody(requestPatchCall).fields.status).toEqual({ stringValue: 'waitlisted' });
    });

    it('updates, closes, and cancels rides through native Firestore REST fallback with seat count protection', async () => {
        installWindow('capacitor:');
        dbMocks.updateRideRequestStatus.mockRejectedValue(new Error('web decision failed'));
        dbMocks.closeRideOffer.mockRejectedValue(new Error('web close failed'));
        dbMocks.cancelRideRequest.mockRejectedValue(new Error('web cancel failed'));
        let seatCountConfirmed = 1;
        let requestStatus = 'pending';
        const patchCalls = [];

        const fetchMock = vi.fn(async (url, init = {}) => {
            const href = String(url);
            const method = init.method || 'GET';
            if (method === 'GET' && href.includes('/teams/team-1/games/legacy-game-1/rideOffers/offer-1/requests/request-1')) {
                return restOk(firestoreDoc('teams/team-1/games/legacy-game-1/rideOffers/offer-1/requests/request-1', {
                    parentUserId: 'user-2',
                    childId: 'player-2',
                    childName: 'Sam',
                    status: requestStatus
                }));
            }
            if (method === 'GET' && href.includes('/teams/team-1/games/legacy-game-1/rideOffers/offer-1')) {
                return restOk(firestoreDoc('teams/team-1/games/legacy-game-1/rideOffers/offer-1', {
                    seatCapacity: 2,
                    seatCountConfirmed,
                    status: 'open'
                }));
            }
            if (method === 'PATCH') {
                patchCalls.push([url, init]);
                const fields = parseBody([url, init]).fields || {};
                if (fields.seatCountConfirmed) seatCountConfirmed = Number(fields.seatCountConfirmed.integerValue || fields.seatCountConfirmed.doubleValue || 0);
                if (fields.status?.stringValue && href.includes('/requests/request-1')) requestStatus = fields.status.stringValue;
                return restOk({});
            }
            if (method === 'DELETE' && href.includes('/requests/request-1')) {
                return restOk({});
            }
            return restError();
        });
        vi.stubGlobal('fetch', fetchMock);

        await updateParentScheduleRideRequestStatus(event(), offer(), 'request-1', 'confirmed');
        expect(seatCountConfirmed).toBe(2);
        expect(requestStatus).toBe('confirmed');
        expect(patchCalls.some(([url, init]) =>
            String(url).includes('/requests/request-1') &&
            parseBody([url, init]).fields.status.stringValue === 'confirmed'
        )).toBe(true);
        expect(patchCalls.some(([url, init]) =>
            String(url).includes('/rideOffers/offer-1?') &&
            parseBody([url, init]).fields.seatCountConfirmed.integerValue === '2'
        )).toBe(true);

        await setParentScheduleRideOfferStatus(event(), offer(), 'closed');
        expect(patchCalls.some(([url, init]) =>
            String(url).includes('/rideOffers/offer-1?') &&
            parseBody([url, init]).fields.status?.stringValue === 'closed'
        )).toBe(true);

        await cancelParentScheduleRideRequest(event(), offer(), 'request-1');
        expect(seatCountConfirmed).toBe(1);
        expect(fetchMock.mock.calls.some(([url, init]) =>
            String(url).includes('/requests/request-1') && init?.method === 'DELETE'
        )).toBe(true);
    });
});
