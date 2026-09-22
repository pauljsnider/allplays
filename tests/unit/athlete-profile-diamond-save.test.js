import { beforeEach, describe, expect, it, vi } from 'vitest';

const firebaseMocks = vi.hoisted(() => ({
    auth: { currentUser: null },
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    setDoc: vi.fn(),
    collection: vi.fn((_database, ...segments) => ({
        kind: 'collection',
        path: segments.join('/')
    })),
    collectionGroup: vi.fn((_database, name) => ({
        kind: 'collection-group',
        path: `collection-group:${name}`
    })),
    doc: vi.fn((databaseOrCollection, ...segments) => {
        if (databaseOrCollection?.kind === 'collection' && segments.length === 0) {
            return { id: 'profile-new', path: `${databaseOrCollection.path}/profile-new` };
        }
        const base = databaseOrCollection?.kind === 'collection' ? databaseOrCollection.path : '';
        const path = [base, ...segments].filter(Boolean).join('/');
        return { id: path.split('/').at(-1), path };
    }),
    query: vi.fn((collectionRef, ...constraints) => ({
        kind: 'query',
        path: collectionRef.path,
        collectionRef,
        constraints
    })),
    where: vi.fn((field, op, value) => ({ field, op, value })),
    orderBy: vi.fn((field, direction) => ({ field, direction })),
    limit: vi.fn((value) => ({ type: 'limit', value })),
    serverTimestamp: vi.fn(() => ({ __serverTimestamp: true })),
    deleteField: vi.fn(() => ({ __deleteField: true }))
}));

vi.mock('../../js/firebase.js?v=33', () => ({
    db: { kind: 'db' },
    auth: firebaseMocks.auth,
    storage: {},
    collection: firebaseMocks.collection,
    collectionGroup: firebaseMocks.collectionGroup,
    doc: firebaseMocks.doc,
    getDoc: firebaseMocks.getDoc,
    getDocs: firebaseMocks.getDocs,
    setDoc: firebaseMocks.setDoc,
    addDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    query: firebaseMocks.query,
    where: firebaseMocks.where,
    orderBy: firebaseMocks.orderBy,
    Timestamp: { now: vi.fn(), fromDate: vi.fn((date) => date) },
    increment: vi.fn(),
    arrayUnion: vi.fn(),
    arrayRemove: vi.fn(),
    deleteField: firebaseMocks.deleteField,
    limit: firebaseMocks.limit,
    startAfter: vi.fn(),
    getCountFromServer: vi.fn(),
    onSnapshot: vi.fn(),
    serverTimestamp: firebaseMocks.serverTimestamp,
    documentId: vi.fn(() => '__name__'),
    writeBatch: vi.fn(),
    runTransaction: vi.fn(),
    functions: {},
    httpsCallable: vi.fn(),
    ref: vi.fn(),
    uploadBytes: vi.fn(),
    getDownloadURL: vi.fn(),
    deleteObject: vi.fn()
}));

vi.mock('../../js/firebase-images.js?v=18', () => ({
    imageStorage: {},
    ensureImageAuth: vi.fn(),
    requireImageAuth: vi.fn()
}));

const instanceId = '00000000-0000-4000-8000-000000000001';
const checkpointHash = `sha256:${'a'.repeat(64)}`;
const statConfigSnapshotHash = `sha256:${'b'.repeat(64)}`;
const projectionHash = `sha256:${'c'.repeat(64)}`;

function diamondGame(id = 'diamond-game') {
    return {
        id,
        status: 'completed',
        date: new Date('2026-05-02T12:00:00Z'),
        trackingEngine: 'diamond-v2',
        diamondProjectionStatus: 'current',
        diamondProjectionComplete: true,
        diamondScorebookInstanceId: instanceId,
        diamondProjectionRevision: 12,
        diamondProjectionCheckpointHash: checkpointHash,
        diamondStatConfigSnapshotHash: statConfigSnapshotHash,
        diamondProjectionHash: projectionHash
    };
}

function publicPlayerDocument() {
    return {
        id: 'player-1',
        data: () => ({
            schemaVersion: 1,
            trackingEngine: 'diamond-v2',
            projectionSchemaVersion: 1,
            playerId: 'player-1',
            playerName: 'Sam',
            playerNumber: '12',
            participated: true,
            participationStatus: 'appeared',
            participationSource: 'diamond-v2',
            complete: true,
            publicStatIds: ['ab'],
            stats: { ab: 4 },
            observedStats: {},
            derivedStats: {},
            observedDerivedStats: {},
            statCoverage: { ab: 'complete' },
            statSources: { ab: ['play-1'] },
            sourcePlayIds: ['play-1'],
            unavailableDerivedStats: [],
            missingStatFamilies: [],
            coverage: { batting: 'complete' },
            teamId: 'team-1',
            diamondGameId: 'diamond-game',
            instanceId,
            diamondScorebookInstanceId: instanceId,
            projectionGeneration: instanceId,
            sourceRevision: 12,
            checkpointHash,
            statConfigSnapshotHash,
            projectionHash
        })
    };
}

function snapshot(docs = [], { fromCache = false } = {}) {
    return {
        docs,
        metadata: { fromCache },
        forEach(callback) {
            docs.forEach(callback);
        }
    };
}

function documentSnapshot(path, data) {
    return {
        id: path.split('/').at(-1),
        exists: () => data !== undefined,
        data: () => data
    };
}

const { saveAthleteProfile } = await import('../../js/db.js?athlete-diamond-save');

describe('athlete profile Diamond season snapshots', () => {
    let games;
    let gameInventoryFromCache;
    let projectionSnapshots;
    let sharedGames;

    beforeEach(() => {
        vi.clearAllMocks();
        games = [
            { id: 'classic-game', status: 'completed', date: new Date('2026-05-01T12:00:00Z'), trackingEngine: 'classic' },
            diamondGame()
        ];
        gameInventoryFromCache = false;
        sharedGames = [];
        projectionSnapshots = [snapshot([publicPlayerDocument()])];

        firebaseMocks.getDoc.mockImplementation(async (ref) => {
            if (ref.path === 'users/parent-1') {
                return documentSnapshot(ref.path, {
                    parentOf: [{ teamId: 'team-1', playerId: 'player-1', playerName: 'Sam' }]
                });
            }
            if (ref.path === 'teams/team-1') return documentSnapshot(ref.path, { name: 'Bears', active: true });
            if (ref.path === 'teams/team-1/players/player-1') return documentSnapshot(ref.path, { name: 'Sam' });
            if (ref.path === 'teams/team-1/games/classic-game/aggregatedStats/player-1') {
                return documentSnapshot(ref.path, { stats: { ab: 1 }, timeMs: 60_000 });
            }
            if (ref.path === 'teams/team-1/games/diamond-game') {
                const canonical = games.find((game) => game.id === 'diamond-game');
                return documentSnapshot(ref.path, canonical);
            }
            return documentSnapshot(ref.path, undefined);
        });
        firebaseMocks.getDocs.mockImplementation(async (ref) => {
            if (ref.path === 'teams/team-1/games') {
                return snapshot(games.map((game) => ({
                    id: game.id,
                    ref: { path: `teams/team-1/games/${game.id}` },
                    data: () => game
                })), { fromCache: gameInventoryFromCache });
            }
            if (ref.path === 'collection-group:sharedGames') {
                return snapshot(sharedGames.map((game) => ({
                    id: game.id,
                    ref: { path: `tournaments/tournament-1/sharedGames/${game.id}` },
                    data: () => game
                })));
            }
            if (ref.path === `teams/team-1/games/diamond-game/diamondStatGenerations/${instanceId}/publicPlayerStats`) {
                return projectionSnapshots.shift() || snapshot([], { fromCache: true });
            }
            throw new Error(`Unexpected collection read: ${ref.path}`);
        });
        firebaseMocks.setDoc.mockResolvedValue(undefined);
    });

    it('persists mixed classic and exact-generation public Diamond stats while keeping Diamond minutes unknown', async () => {
        const result = await saveAthleteProfile('parent-1', {
            athlete: { name: 'Sam', headline: 'Catcher' },
            bio: {},
            privacy: 'public',
            clips: [],
            selectedSeasonKeys: ['team-1::player-1']
        }, { profileId: 'profile-new', isNewProfile: true });

        expect(result.id).toBe('profile-new');
        expect(firebaseMocks.setDoc).toHaveBeenCalledOnce();
        const payload = firebaseMocks.setDoc.mock.calls[0][1];
        expect(payload.seasons[0]).toMatchObject({
            gamesPlayed: 2,
            totalTimeMs: null,
            playingTimeComplete: false,
            statTotals: { ab: 5 },
            statEvidence: {
                complete: true,
                readComplete: true,
                visibility: 'public',
                completeStatKeys: ['ab'],
                omittedOrIncompleteStatKeys: []
            }
        });
        expect(payload.seasons[0].playingTimeEvidence).not.toHaveProperty('unavailableGameIds');
        expect(payload.seasons[0].statEvidence).not.toHaveProperty('diamondGameIds');
        expect(payload.seasons[0].statEvidence).not.toHaveProperty('diamondByGame');
        expect(JSON.stringify(payload.seasons[0])).not.toMatch(/checkpointHash|projectionHash|instanceId|sourceRevision/);
        expect(payload.careerSummary).toMatchObject({
            gamesPlayed: 2,
            totalMinutes: null,
            playingTimeComplete: false,
            statTotals: { ab: 5 }
        });
    });

    it('does not persist a profile when repeated partial-empty Diamond reads cannot prove absence', async () => {
        games = [diamondGame()];
        projectionSnapshots = [
            snapshot([], { fromCache: true }),
            snapshot([], { fromCache: true })
        ];

        await expect(saveAthleteProfile('parent-1', {
            athlete: { name: 'Sam' },
            bio: {},
            privacy: 'public',
            clips: [],
            selectedSeasonKeys: ['team-1::player-1']
        }, { profileId: 'profile-new', isNewProfile: true }))
            .rejects.toThrow(/complete public Diamond stats/i);

        expect(firebaseMocks.setDoc).not.toHaveBeenCalled();
    });

    it('persists a source-owned shared Diamond game only after resolving its authoritative canonical head', async () => {
        games = [{
            ...diamondGame(),
            sharedGameId: 'shared-game-1'
        }];
        sharedGames = [{
            id: 'shared-game-1',
            homeTeamId: 'team-1',
            awayTeamId: 'team-2',
            date: new Date('2026-05-02T12:00:00Z'),
            type: 'game',
            status: 'completed',
            trackingEngine: 'diamond-v2',
            diamondSourceTeamId: 'team-1',
            diamondSourceGameId: 'diamond-game',
            diamondProjectionStatus: 'current',
            diamondProjectionRevision: 12,
            diamondScorebookInstanceId: instanceId,
            diamondProjectionCheckpointHash: checkpointHash,
            diamondProjectionHash: projectionHash
        }];

        await saveAthleteProfile('parent-1', {
            athlete: { name: 'Sam' },
            bio: {},
            privacy: 'public',
            clips: [],
            selectedSeasonKeys: ['team-1::player-1']
        }, { profileId: 'profile-new', isNewProfile: true });

        const season = firebaseMocks.setDoc.mock.calls[0][1].seasons[0];
        expect(season).toMatchObject({
            gamesPlayed: 1,
            totalTimeMs: null,
            playingTimeComplete: false,
            statTotals: { ab: 4 }
        });
        expect(firebaseMocks.getDoc).toHaveBeenCalledWith(expect.objectContaining({
            path: 'teams/team-1/games/diamond-game'
        }));
    });

    it('does not persist an athlete snapshot for a foreign shared Diamond game with inaccessible player evidence', async () => {
        games = [{
            ...diamondGame(),
            sharedGameId: 'shared-game-1'
        }];
        sharedGames = [{
            id: 'shared-game-1',
            homeTeamId: 'team-1',
            awayTeamId: 'team-2',
            date: new Date('2026-05-02T12:00:00Z'),
            type: 'game',
            status: 'completed',
            trackingEngine: 'diamond-v2',
            diamondSourceTeamId: 'team-2',
            diamondSourceGameId: 'opponent-game'
        }];

        await expect(saveAthleteProfile('parent-1', {
            athlete: { name: 'Sam' },
            bio: {},
            privacy: 'public',
            clips: [],
            selectedSeasonKeys: ['team-1::player-1']
        }, { profileId: 'profile-new', isNewProfile: true }))
            .rejects.toMatchObject({
                code: 'diamond-public-stats-inaccessible',
                reason: 'shared-game-source-not-owned',
                retryable: false,
                evidence: { complete: false, absenceConfirmed: false }
            });

        expect(firebaseMocks.setDoc).not.toHaveBeenCalled();
        expect(firebaseMocks.getDoc).not.toHaveBeenCalledWith(expect.objectContaining({
            path: 'teams/team-2/games/opponent-game'
        }));
    });

    it('does not persist a profile when the season game inventory is cache-only', async () => {
        gameInventoryFromCache = true;

        await expect(saveAthleteProfile('parent-1', {
            athlete: { name: 'Sam' },
            bio: {},
            privacy: 'public',
            clips: [],
            selectedSeasonKeys: ['team-1::player-1']
        }, { profileId: 'profile-new', isNewProfile: true }))
            .rejects.toMatchObject({ code: 'allplays/game-inventory-cache-only' });

        expect(firebaseMocks.setDoc).not.toHaveBeenCalled();
    });

    it('preserves classic-only playing-time and profile-save behavior', async () => {
        games = [games[0]];

        await saveAthleteProfile('parent-1', {
            athlete: { name: 'Sam' },
            bio: {},
            privacy: 'public',
            clips: [],
            selectedSeasonKeys: ['team-1::player-1']
        }, { profileId: 'profile-new', isNewProfile: true });

        const season = firebaseMocks.setDoc.mock.calls[0][1].seasons[0];
        expect(season).toMatchObject({ gamesPlayed: 1, totalTimeMs: 60_000, statTotals: { ab: 1 } });
        expect(season).not.toHaveProperty('playingTimeComplete');
        expect(season).not.toHaveProperty('statEvidence');
    });
});
