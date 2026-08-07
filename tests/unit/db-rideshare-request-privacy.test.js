import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

function buildRideOfferLoader({ auth, collection, doc, getDoc, getDocs }) {
    const start = dbSource.indexOf('function normalizeRideRequestReadOptions');
    const end = dbSource.indexOf('\nasync function resolveRideOffersGameId', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const source = `${dbSource.slice(start, end)}\nreturn loadRideOffersForGameId;`;
    return new Function(
        'db', 'auth', 'collection', 'doc', 'getDoc', 'getDocs', 'normalizeRideOfferStatus', 'toNonNegativeInteger', source
    )(
        {}, auth, collection, doc, getDoc, getDocs,
        (status) => status || 'open',
        (value, fallback = 0) => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : fallback
    );
}

function snapshot(id, data) {
    return {
        id,
        exists: () => Boolean(data),
        data: () => data
    };
}

function offerSnapshot(driverUserId = 'driver-1') {
    return snapshot('offer-1', {
        driverUserId,
        seatCapacity: 3,
        seatCountConfirmed: 1,
        status: 'open'
    });
}

describe('legacy rideshare request privacy loader', () => {
    it('uses exact deterministic gets and returns only the ordinary parent household request', async () => {
        const collection = vi.fn((_db, path) => ({ kind: 'collection', path }));
        const doc = vi.fn((_db, path, id) => ({ kind: 'doc', path: `${path}/${id}` }));
        const getDocs = vi.fn(async (ref) => {
            expect(ref.path).toBe('teams/team-1/games/game-1/rideOffers');
            return { docs: [offerSnapshot()] };
        });
        const getDoc = vi.fn(async (ref) => {
            if (ref.path.endsWith('/parent-1__player-a')) {
                return snapshot('parent-1__player-a', {
                    parentUserId: 'parent-1',
                    childId: 'player-a',
                    childName: 'Avery',
                    status: 'pending'
                });
            }
            const error = new Error('Missing or insufficient permissions.');
            error.code = 'permission-denied';
            throw error;
        });
        const loadRideOffersForGameId = buildRideOfferLoader({
            auth: { currentUser: { uid: 'parent-1' } }, collection, doc, getDoc, getDocs
        });

        const offers = await loadRideOffersForGameId('team-1', 'game-1', {
            requesterUserId: 'parent-1',
            childIds: ['player-a', 'player-b'],
            canManageTeamRequests: false
        });

        expect(getDocs).toHaveBeenCalledTimes(1);
        expect(getDoc.mock.calls.map(([ref]) => ref.path)).toEqual([
            'teams/team-1/games/game-1/rideOffers/offer-1/requests/parent-1__player-a',
            'teams/team-1/games/game-1/rideOffers/offer-1/requests/parent-1__player-b'
        ]);
        expect(offers[0].requests).toEqual([
            expect.objectContaining({ id: 'parent-1__player-a', parentUserId: 'parent-1', childId: 'player-a' })
        ]);
    });

    it.each([
        ['offer driver', { requesterUserId: 'driver-1', childIds: [], canManageTeamRequests: false }],
        ['team manager', { requesterUserId: 'owner-1', childIds: [], canManageTeamRequests: true }]
    ])('lists all nested requests for the %s', async (_label, options) => {
        const collection = vi.fn((_db, path) => ({ kind: 'collection', path }));
        const doc = vi.fn();
        const getDoc = vi.fn();
        const getDocs = vi.fn(async (ref) => {
            if (ref.path.endsWith('/rideOffers')) return { docs: [offerSnapshot()] };
            if (ref.path.endsWith('/requests')) {
                return {
                    docs: [
                        snapshot('parent-1__player-a', { parentUserId: 'parent-1', childId: 'player-a', status: 'pending' }),
                        snapshot('parent-2__player-b', { parentUserId: 'parent-2', childId: 'player-b', status: 'waitlisted' })
                    ]
                };
            }
            throw new Error(`Unexpected collection ${ref.path}`);
        });
        const loadRideOffersForGameId = buildRideOfferLoader({
            auth: { currentUser: { uid: options.requesterUserId } }, collection, doc, getDoc, getDocs
        });

        const offers = await loadRideOffersForGameId('team-1', 'game-1', options);

        expect(offers[0].requests).toHaveLength(2);
        expect(getDoc).not.toHaveBeenCalled();
        expect(getDocs).toHaveBeenCalledWith(expect.objectContaining({
            path: 'teams/team-1/games/game-1/rideOffers/offer-1/requests'
        }));
    });
});
