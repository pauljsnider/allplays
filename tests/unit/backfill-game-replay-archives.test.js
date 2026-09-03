import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    activateAthleteProfileProjectionBoundary,
    backfillGameReplayArchives,
    collectPersistedReplayClipIdentityInventory,
    collectProtectedReplayIdentityInventory,
    collectReplayCompatibilityReceiptInventory,
    collectReadableReplayClipIdentityInventory,
    collectStructuredReplayClipIdentityReport,
    migrateStructuredReplayAutomatedCopies,
    runReplayArchiveMigration,
    scrubReplayArchiveAttribution,
    verifyAthleteProfileProjectionBoundary,
    verifyNoReplayArchiveAttribution,
    verifyProtectedReplayIdentityInventory,
    verifyReplayClipIdentityInventory,
    verifyReadableReplayArchiveInventory,
    verifyNoReplayCompatibilityReceipts,
    verifyStructuredReplayClipIdentityInventory
} from '../../_migration/backfill-game-replay-archives.js';
import {
    createRequire
} from 'node:module';

const require = createRequire(import.meta.url);
const {
    REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH,
    REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA,
    REPLAY_COMPATIBILITY_SCHEMA,
    getReplayCompatibilityParentFingerprint,
    getReplayCompatibilityReceiptPath,
    getReplayIdentityHash,
    getReplayClipYouTubeIdentityRecord,
    getReplayProtectedYouTubeIdentityRecord,
    getReplayProtectedYouTubeIdentityRecordFromHash
} = require('../../functions/replay-private-archive-core.cjs');
const {
    ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH,
    ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_SCHEMA,
    ATHLETE_PROFILE_PROJECTION_SCHEMA_VERSION
} = require('../../functions/athlete-profile-projection-core.cjs');

const DELETE = Symbol('delete');
const fieldValue = {
    delete: () => DELETE,
    serverTimestamp: () => 'server-now'
};

function makeFirestore(seed, { beforeTransaction, beforeTransactionRead } = {}) {
    const state = new Map(Object.entries(seed));
    let transactionIndex = 0;

    function ref(path) {
        return {
            path,
            collection: (name) => ({ doc: (id) => ref(`${path}/${name}/${id}`) }),
            get: async () => snapshot(path)
        };
    }

    function snapshot(path) {
        const value = state.get(path);
        return {
            id: path.split('/').at(-1),
            exists: value !== undefined,
            data: () => value,
            ref: ref(path)
        };
    }

    function collectionGroupDocs(collectionId) {
        return [...state.keys()]
            .filter((path) => {
                const segments = path.split('/');
                return segments.length % 2 === 0 && segments.at(-2) === collectionId;
            })
            .sort()
            .map(snapshot);
    }

    function buildQuery(collectionId, options = {}) {
        return {
            orderBy: () => buildQuery(collectionId, options),
            limit: (limit) => buildQuery(collectionId, { ...options, limit }),
            startAfter: (cursor) => buildQuery(collectionId, { ...options, after: cursor.ref.path }),
            get: async () => {
                let docs = collectionGroupDocs(collectionId);
                if (options.after) docs = docs.filter((entry) => entry.ref.path > options.after);
                if (options.limit) docs = docs.slice(0, options.limit);
                return { docs };
            }
        };
    }

    function applySet(documentRef, value, options) {
        const next = options?.merge ? { ...(state.get(documentRef.path) || {}), ...value } : { ...value };
        for (const [key, entry] of Object.entries(next)) {
            if (entry === DELETE) delete next[key];
        }
        state.set(documentRef.path, next);
    }

    return {
        state,
        doc: vi.fn((path) => ref(path)),
        collection: vi.fn((name) => buildQuery(name)),
        collectionGroup: vi.fn((name) => buildQuery(name)),
        runTransaction: vi.fn(async (handler) => {
            transactionIndex += 1;
            if (beforeTransaction) {
                await beforeTransaction({ state, transactionIndex });
            }
            const writes = [];
            const result = await handler({
                get: async (documentRef) => {
                    if (beforeTransactionRead) {
                        await beforeTransactionRead({
                            state,
                            transactionIndex,
                            documentPath: documentRef.path
                        });
                    }
                    return snapshot(documentRef.path);
                },
                set: (documentRef, value, options) => writes.push({
                    kind: 'set', documentRef, value, options
                }),
                delete: (documentRef) => writes.push({ kind: 'delete', documentRef })
            });
            writes.forEach(({ kind, documentRef, value, options }) => {
                if (kind === 'delete') state.delete(documentRef.path);
                else applySet(documentRef, value, options);
            });
            return result;
        })
    };
}

function completedGame(overrides = {}) {
    return {
        type: 'game',
        status: 'completed',
        liveStatus: 'scheduled',
        ...overrides
    };
}

function athleteProfileProjectionBoundaryReady() {
    return {
        schema: ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_SCHEMA,
        version: ATHLETE_PROFILE_PROJECTION_SCHEMA_VERSION,
        status: 'ready'
    };
}

function withAthleteProfileProjectionBoundary(seed = {}) {
    return {
        [ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH]: athleteProfileProjectionBoundaryReady(),
        ...seed
    };
}

function migrationOptions(db, apply = true) {
    let counter = 0;
    return {
        db,
        apply,
        fieldValue,
        randomUUID: () => `00000000-0000-4000-8000-${String(counter += 1).padStart(12, '0')}`,
        logger: { log: vi.fn(), error: vi.fn() },
        pageSize: 1
    };
}

const replayUrl = 'https://www.youtube.com/watch?v=PK1HyC37doc';
const embedUrl = 'https://www.youtube.com/embed/PK1HyC37doc';

function replayCompatibilityReceipt({
    teamId = 'team-1',
    gameId = 'game-1',
    game,
    state = 'ready',
    revision = 'r:compatibility',
    mutationId = 'compatibility.mutation',
    mutationHash = 'a'.repeat(64),
    identityHashes = [getReplayIdentityHash('youtube', 'PK1HyC37doc')]
}) {
    return {
        schema: REPLAY_COMPATIBILITY_SCHEMA,
        version: 1,
        teamId,
        gameId,
        state,
        revision,
        lastMutationId: mutationId,
        lastMutationHash: mutationHash,
        beforeStateHash: 'b'.repeat(64),
        afterStateHash: getReplayCompatibilityParentFingerprint(game),
        protectedIdentityHashes: identityHashes
    };
}

describe('game replay private archive backfill', () => {
    it.each([
        ['replayVideo.videoId', { replayVideo: { provider: 'youtube', videoId: 'PK1HyC37doc' } }],
        ['replayVideo.publicUrl', { replayVideo: { provider: 'youtube', publicUrl: replayUrl } }],
        ['replayVideo.embedUrl', { replayVideo: { provider: 'youtube', embedUrl } }],
        ['recordedVideo.url', { recordedVideo: { url: replayUrl } }],
        ['recordedVideo.src', { recordedVideo: { src: replayUrl } }],
        ['videoReplay.videoId', { videoReplay: { videoId: 'PK1HyC37doc' } }],
        ['replayVideoUrl', { replayVideoUrl: replayUrl }],
        ['recordedVideoUrl', { recordedVideoUrl: replayUrl }],
        ['videoReplayUrl', { videoReplayUrl: replayUrl }],
        ['archivedVideoUrl', { archivedVideoUrl: replayUrl }],
        ['replayVideoPublicUrl', { replayVideoPublicUrl: replayUrl }],
        ['completed videoUrl', { videoUrl: replayUrl }]
    ])('moves and scrubs %s when it is the only replay identity', async (_label, patch) => {
        const gamePath = 'teams/team-1/games/game-1';
        const privatePath = `${gamePath}/privateReplay/archive`;
        const db = makeFirestore({ [gamePath]: completedGame(patch) });

        await expect(backfillGameReplayArchives(migrationOptions(db))).resolves.toMatchObject({
            matched: 1,
            migrated: 1,
            blocked: 0
        });

        expect(db.state.get(privatePath)).toMatchObject({
            schemaVersion: 1,
            state: 'ready',
            provider: 'youtube',
            videoId: 'PK1HyC37doc'
        });
        expect(db.state.get(privatePath)).not.toHaveProperty('updatedBy');
        const game = db.state.get(gamePath);
        expect(game.hasRecordedReplay).toBe(true);
        expect(game.replayArchiveRevision).toMatch(/^r:/);
        for (const field of Object.keys(patch)) expect(game).not.toHaveProperty(field);
        await expect(verifyReadableReplayArchiveInventory(migrationOptions(db))).resolves.toEqual({ remaining: 0 });
    });

    it.each(['complete', 'finished'])(
        'migrates the exact historical %s lifecycle videoUrl compatibility alias',
        async (status) => {
            const gamePath = `teams/team-1/games/${status}`;
            const db = makeFirestore({
                [gamePath]: {
                    type: 'game',
                    status,
                    liveStatus: 'scheduled',
                    videoUrl: replayUrl
                }
            });

            await backfillGameReplayArchives(migrationOptions(db));

            expect(db.state.get(`${gamePath}/privateReplay/archive`)).toMatchObject({
                state: 'ready',
                videoId: 'PK1HyC37doc'
            });
            expect(db.state.get(gamePath)).not.toHaveProperty('videoUrl');
            await expect(verifyReadableReplayArchiveInventory(migrationOptions(db))).resolves.toEqual({ remaining: 0 });
        }
    );

    it.each([
        ['scheduled', 'scheduled'],
        ['cancelled', 'cancelled']
    ])('blocks a ready legacy replay on the nonfinal %s lifecycle', async (status, liveStatus) => {
        const gamePath = `teams/team-1/games/nonfinal-${status}`;
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [gamePath]: {
                type: 'game',
                status,
                liveStatus,
                replayVideoUrl: replayUrl
            }
        }));

        await expect(runReplayArchiveMigration(migrationOptions(db))).rejects.toThrow(
            'Replay archive migration blocked for 1 document(s).'
        );

        expect(db.state.get(gamePath).replayVideoUrl).toBe(replayUrl);
        expect(db.state.has(`${gamePath}/privateReplay/archive`)).toBe(false);
        expect(db.state.get(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH).status).toBe('migrating');
    });

    it('blocks an existing ready private archive after the parent lifecycle becomes nonfinal', async () => {
        const gamePath = 'teams/team-1/games/nonfinal-private';
        const privatePath = `${gamePath}/privateReplay/archive`;
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [gamePath]: {
                type: 'game',
                status: 'scheduled',
                liveStatus: 'scheduled',
                hasRecordedReplay: true,
                replayArchiveRevision: 'r:existing'
            },
            [privatePath]: {
                schemaVersion: 1,
                state: 'ready',
                revision: 'r:existing',
                provider: 'youtube',
                videoId: 'PK1HyC37doc',
                protectedVideoIdHashes: []
            }
        }));

        await expect(runReplayArchiveMigration(migrationOptions(db))).rejects.toThrow(
            'Replay archive migration blocked for 1 document(s).'
        );

        expect(db.state.get(privatePath).videoId).toBe('PK1HyC37doc');
        expect(db.state.get(gamePath)).toMatchObject({
            status: 'scheduled',
            hasRecordedReplay: true,
            replayArchiveRevision: 'r:existing'
        });
        expect(db.state.get(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH).status).toBe('migrating');
    });

    it('does not retain legacy personal attribution in migrated private archives', async () => {
        const readyPath = 'teams/team-1/games/ready';
        const quarantinePath = 'teams/team-1/games/quarantine';
        const db = makeFirestore({
            [readyPath]: completedGame({
                replayVideo: {
                    provider: 'youtube',
                    videoId: 'PK1HyC37doc',
                    linkedBy: 'deleted-manager.uid'
                }
            }),
            [quarantinePath]: completedGame({
                replayVideo: {
                    provider: 'youtube',
                    videoId: 'PK1HyC37doc',
                    linkedBy: { uid: 'deleted-manager.uid' },
                    updatedBy: ['deleted-manager.uid']
                },
                recordedVideoUrl: 'https://youtu.be/dQw4w9WgXcQ'
            })
        });

        await backfillGameReplayArchives(migrationOptions(db));

        expect(db.state.get(`${readyPath}/privateReplay/archive`)).not.toHaveProperty('linkedBy');
        expect(db.state.get(`${quarantinePath}/privateReplay/archive`).legacyState).toEqual({
            replayVideo: {
                provider: 'youtube',
                videoId: 'PK1HyC37doc'
            },
            recordedVideoUrl: 'https://youtu.be/dQw4w9WgXcQ'
        });
    });

    it('scrubs personal attribution from existing and orphaned private archives before readiness', async () => {
        const gamePath = 'teams/team-1/games/existing';
        const privatePath = `${gamePath}/privateReplay/archive`;
        const orphanGamePath = 'teams/team-2/games/deleted/privateReplay/archive';
        const orphanSharedPath = 'organizations/org-1/sharedGames/deleted/privateReplay/archive';
        const invalidOrphanPath = 'tournaments/tournament-1/sharedGames/invalid/privateReplay/archive';
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [gamePath]: completedGame({
                hasRecordedReplay: true,
                replayArchiveRevision: 'r:existing'
            }),
            [privatePath]: {
                schemaVersion: 1,
                state: 'ready',
                revision: 'r:existing',
                provider: 'youtube',
                videoId: 'PK1HyC37doc',
                protectedVideoIdHashes: [],
                linkedBy: 'deleted-manager.uid',
                updatedBy: 'deleted-manager.uid',
                audit: { linkedBy: { uid: 'deleted-manager.uid' }, kept: true }
            },
            [orphanGamePath]: {
                schemaVersion: 1,
                state: 'removed',
                revision: 'r:orphan-game',
                protectedVideoIdHashes: [],
                linkedBy: 'deleted-manager.uid'
            },
            [orphanSharedPath]: {
                schemaVersion: 1,
                state: 'removed',
                revision: 'r:orphan-shared',
                protectedVideoIdHashes: [],
                updatedBy: ['deleted-manager.uid']
            },
            [invalidOrphanPath]: {
                state: 'malformed',
                legacyState: { updatedBy: { uid: 'deleted-manager.uid' }, kept: 'evidence' }
            }
        }));

        await expect(verifyNoReplayArchiveAttribution(migrationOptions(db))).rejects.toThrow(
            'Private replay attribution verification failed for 4 archive(s).'
        );

        const result = await runReplayArchiveMigration(migrationOptions(db));

        expect(result).toMatchObject({
            attributionMatched: 4,
            attributionScrubbed: 4
        });
        expect(db.state.get(privatePath)).toMatchObject({
            state: 'ready',
            videoId: 'PK1HyC37doc',
            audit: { kept: true }
        });
        expect(db.state.get(privatePath)).not.toHaveProperty('linkedBy');
        expect(db.state.get(privatePath)).not.toHaveProperty('updatedBy');
        expect(db.state.get(orphanGamePath)).not.toHaveProperty('linkedBy');
        expect(db.state.get(orphanSharedPath)).not.toHaveProperty('updatedBy');
        expect(db.state.get(invalidOrphanPath)).toEqual({
            state: 'malformed',
            legacyState: { kept: 'evidence' }
        });
        await expect(verifyNoReplayArchiveAttribution(migrationOptions(db))).resolves.toEqual({
            remaining: 0
        });
    });

    it('reports private replay attribution without mutating it during a dry run', async () => {
        const privatePath = 'teams/team-1/games/deleted/privateReplay/archive';
        const original = {
            schemaVersion: 1,
            state: 'removed',
            revision: 'r:dry-run',
            protectedVideoIdHashes: [],
            linkedBy: 'deleted-manager.uid'
        };
        const db = makeFirestore({ [privatePath]: original });

        await expect(scrubReplayArchiveAttribution({
            ...migrationOptions(db, false),
            apply: false
        })).resolves.toMatchObject({ matched: 1, scrubbed: 0 });
        expect(db.state.get(privatePath)).toEqual(original);
    });

    it('scrubs and reserves nested replay highlights before materializing them in one migration pass', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const highlights = [
            { id: 'protected', url: replayUrl, startMs: 1_000, endMs: 8_000 },
            { id: 'standalone', url: 'https://youtu.be/dQw4w9WgXcQ' }
        ];
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [gamePath]: completedGame({
                replayVideo: {
                    provider: 'youtube',
                    videoId: 'PK1HyC37doc',
                    publicUrl: replayUrl,
                    highlights
                }
            })
        }));

        await runReplayArchiveMigration(migrationOptions(db));

        expect(db.state.get(gamePath)).toMatchObject({
            replayHighlights: [
                { id: 'protected', startMs: 1_000, endMs: 8_000 },
                { id: 'standalone', url: 'https://youtu.be/dQw4w9WgXcQ' }
            ]
        });
        expect(db.state.get(gamePath)).not.toHaveProperty('replayVideo');
        expect(db.state.has(getReplayProtectedYouTubeIdentityRecord('PK1HyC37doc').path)).toBe(true);
        expect(db.state.has(getReplayClipYouTubeIdentityRecord('PK1HyC37doc').path)).toBe(false);
        expect(db.state.has(getReplayClipYouTubeIdentityRecord('dQw4w9WgXcQ').path)).toBe(true);
    });

    it('merges unique nested replay highlights with existing top-level highlights without duplicating equal entries', async () => {
        const gamePath = 'teams/team-1/games/game-merge-highlights';
        const equal = { id: 'same', startMs: 1_000, endMs: 8_000 };
        const db = makeFirestore({
            [gamePath]: completedGame({
                replayHighlights: [equal, { id: 'top-only', startMs: 9_000 }],
                replayVideo: {
                    provider: 'youtube',
                    videoId: 'PK1HyC37doc',
                    highlights: [
                        { endMs: 8_000, id: 'same', startMs: 1_000 },
                        { id: 'nested-only', startMs: 12_000 }
                    ]
                }
            })
        });

        await backfillGameReplayArchives(migrationOptions(db));

        expect(db.state.get(gamePath).replayHighlights).toEqual([
            equal,
            { id: 'top-only', startMs: 9_000 },
            { id: 'nested-only', startMs: 12_000 }
        ]);
        expect(db.state.get(gamePath)).not.toHaveProperty('replayVideo');
        await backfillGameReplayArchives(migrationOptions(db));
        expect(db.state.get(gamePath).replayHighlights).toHaveLength(3);
    });

    it('removes protected full-replay identities copied into readable game clip arrays', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const standaloneClipUrl = 'https://cdn.example.test/highlights/standalone.mp4';
        const db = makeFirestore({
            [gamePath]: completedGame({
                replayVideo: {
                    provider: 'youtube',
                    videoId: 'PK1HyC37doc',
                    highlights: [{ id: 'nested', url: replayUrl, startMs: 1_000, endMs: 5_000 }]
                },
                highlightClips: [
                    { id: 'protected', publicUrl: 'https://youtu.be/PK1HyC37doc', startMs: 2_000 },
                    { id: 'standalone', videoUrl: standaloneClipUrl }
                ],
                clipMetadata: [replayUrl, standaloneClipUrl]
            })
        });

        await backfillGameReplayArchives(migrationOptions(db));

        const game = db.state.get(gamePath);
        expect(game.replayHighlights).toEqual([{ id: 'nested', startMs: 1_000, endMs: 5_000 }]);
        expect(game.highlightClips).toEqual([
            { id: 'protected', startMs: 2_000 },
            { id: 'standalone', videoUrl: standaloneClipUrl }
        ]);
        expect(game.clipMetadata).toEqual([standaloneClipUrl]);
        await expect(verifyReadableReplayArchiveInventory(migrationOptions(db))).resolves.toEqual({ remaining: 0 });
    });

    it.each([
        ['videoUrl', (url) => ({ videoUrl: url }), 'https://youtu.be/PK1HyC37doc'],
        ['url', (url) => ({ url }), 'https://youtu.be/PK1HyC37doc'],
        ['publicUrl', (url) => ({ publicUrl: url }), 'https://youtu.be/PK1HyC37doc'],
        ['sourceUrl', (url) => ({ sourceUrl: url }), 'https://youtu.be/PK1HyC37doc'],
        ['downloadUrl', (url) => ({ downloadUrl: url }), 'https://youtu.be/PK1HyC37doc'],
        ['href', (url) => ({ href: url }), 'https://youtu.be/PK1HyC37doc'],
        ['embedUrl', (url) => ({ embedUrl: url }), 'https://youtu.be/PK1HyC37doc'],
        ['src', (url) => ({ src: url }), 'https://youtu.be/PK1HyC37doc'],
        ['mediaUrl', (url) => ({ mediaUrl: url }), 'https://youtu.be/PK1HyC37doc'],
        ['videoId', (videoId) => ({ videoId }), ' PK1HyC37doc '],
        ['video.url', (url) => ({ video: { url, posterUrl: 'https://cdn.example/poster.jpg' } }), 'https://youtu.be/PK1HyC37doc'],
        ['video.publicUrl', (url) => ({ video: { publicUrl: url, posterUrl: 'https://cdn.example/poster.jpg' } }), 'https://youtu.be/PK1HyC37doc'],
        ['video.sourceUrl', (url) => ({ video: { sourceUrl: url, posterUrl: 'https://cdn.example/poster.jpg' } }), 'https://youtu.be/PK1HyC37doc'],
        ['video.videoId', (videoId) => ({ video: { videoId, posterUrl: 'https://cdn.example/poster.jpg' } }), ' PK1HyC37doc ']
    ])('detects, scrubs, and verifies the live clip reader field %s', async (_field, makeClipPatch, protectedValue) => {
        const gamePath = 'teams/team-1/games/game-1';
        const privatePath = `${gamePath}/privateReplay/archive`;
        const db = makeFirestore({
            [gamePath]: completedGame({
                hasRecordedReplay: true,
                replayArchiveRevision: 'r:existing-private',
                gameClips: [{
                    id: 'protected-copy',
                    title: 'Keep metadata',
                    ...makeClipPatch(protectedValue)
                }]
            }),
            [privatePath]: {
                schemaVersion: 1,
                state: 'ready',
                provider: 'youtube',
                videoId: 'PK1HyC37doc',
                revision: 'r:existing-private',
                lastMutationId: 'existing-mutation'
            }
        });

        await expect(verifyReadableReplayArchiveInventory(migrationOptions(db))).rejects.toThrow(
            'Readable replay archive verification failed for 1 document(s).'
        );
        await expect(backfillGameReplayArchives(migrationOptions(db))).resolves.toMatchObject({
            matched: 0,
            migrated: 0,
            blocked: 0,
            secondaryMatched: 1,
            secondaryMigrated: 1
        });
        expect(db.state.get(gamePath).gameClips).toEqual([{
            id: 'protected-copy',
            title: 'Keep metadata',
            ...(_field.startsWith('video.')
                ? { video: { posterUrl: 'https://cdn.example/poster.jpg' } }
                : {})
        }]);
        await expect(verifyReadableReplayArchiveInventory(migrationOptions(db))).resolves.toEqual({ remaining: 0 });
    });

    it.each([
        [
            'nested map',
            { asset: { url: 'https://youtu.be/PK1HyC37doc', posterUrl: 'https://cdn.example/poster.jpg' } },
            { asset: { posterUrl: 'https://cdn.example/poster.jpg' } }
        ],
        [
            'nested arrays',
            { assets: [{ sources: [replayUrl, 'https://cdn.example/standalone.mp4'], label: 'keep' }] },
            { assets: [{ sources: ['https://cdn.example/standalone.mp4'], label: 'keep' }] }
        ],
        [
            'nested raw video id',
            { asset: { identity: { videoId: ' PK1HyC37doc ', label: 'keep' } } },
            { asset: { identity: { label: 'keep' } } }
        ]
    ])('recursively scrubs a protected replay identity from a %s', async (_label, clipPatch, expectedPatch) => {
        const gamePath = 'teams/team-1/games/game-1';
        const privatePath = `${gamePath}/privateReplay/archive`;
        const db = makeFirestore({
            [gamePath]: completedGame({
                hasRecordedReplay: true,
                replayArchiveRevision: 'r:existing-private',
                gameClips: [{ id: 'protected-copy', ...clipPatch }]
            }),
            [privatePath]: {
                schemaVersion: 1,
                state: 'ready',
                provider: 'youtube',
                videoId: 'PK1HyC37doc',
                revision: 'r:existing-private',
                lastMutationId: 'existing-mutation'
            }
        });

        await expect(verifyReadableReplayArchiveInventory(migrationOptions(db))).rejects.toThrow(
            'Readable replay archive verification failed for 1 document(s).'
        );
        await backfillGameReplayArchives(migrationOptions(db));
        expect(db.state.get(gamePath).gameClips).toEqual([{
            id: 'protected-copy',
            ...expectedPatch
        }]);
        await expect(verifyReadableReplayArchiveInventory(migrationOptions(db))).resolves.toEqual({ remaining: 0 });
    });

    it('recursively scrubs protected copies across shared games and athlete profile seasons', async () => {
        const sourcePath = 'teams/team-1/games/replay-source';
        const sharedPath = 'organizations/org-1/sharedGames/shared-1';
        const profilePath = 'athleteProfiles/profile-1';
        const db = makeFirestore({
            [sourcePath]: completedGame({ replayVideoUrl: replayUrl }),
            [sharedPath]: {
                gameClips: [{ id: 'shared', asset: { url: embedUrl, caption: 'keep' } }]
            },
            [profilePath]: {
                gameClips: [{ id: 'profile', nested: [{ publicUrl: replayUrl, caption: 'keep' }] }],
                seasons: [{
                    seasonKey: 'team-1::player-1',
                    gameClips: [{ id: 'season', asset: { identity: { videoId: 'PK1HyC37doc', label: 'keep' } } }]
                }]
            }
        });

        await backfillGameReplayArchives(migrationOptions(db));

        expect(db.state.get(sharedPath).gameClips).toEqual([
            { id: 'shared', asset: { caption: 'keep' } }
        ]);
        expect(db.state.get(profilePath)).toMatchObject({
            gameClips: [{ id: 'profile', nested: [{ caption: 'keep' }] }],
            seasons: [{
                seasonKey: 'team-1::player-1',
                gameClips: [{ id: 'season', asset: { identity: { label: 'keep' } } }]
            }]
        });
        await expect(verifyReadableReplayArchiveInventory(migrationOptions(db))).resolves.toEqual({ remaining: 0 });
    });

    it('blocks verification when a protected clip exceeds the bounded nesting depth', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const privatePath = `${gamePath}/privateReplay/archive`;
        let nested = replayUrl;
        for (let index = 0; index < 21; index += 1) nested = { child: nested };
        const db = makeFirestore({
            [gamePath]: completedGame({
                hasRecordedReplay: true,
                replayArchiveRevision: 'r:existing-private',
                gameClips: [nested]
            }),
            [privatePath]: {
                schemaVersion: 1,
                state: 'ready',
                provider: 'youtube',
                videoId: 'PK1HyC37doc',
                revision: 'r:existing-private',
                lastMutationId: 'existing-mutation'
            }
        });

        await expect(verifyReadableReplayArchiveInventory(migrationOptions(db))).rejects.toThrow(
            'Replay clip traversal exceeded Firestore nesting depth.'
        );
    });

    it('scrubs protected replay copies from top-level and nested athlete profile clips', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const profilePath = 'athleteProfiles/profile-1';
        const standaloneClipUrl = 'https://cdn.example.test/highlights/standalone.mp4';
        const db = makeFirestore({
            [gamePath]: completedGame({ replayVideoUrl: replayUrl }),
            [profilePath]: {
                gameClips: [
                    { id: 'protected', url: 'https://www.youtube.com/embed/PK1HyC37doc' },
                    { id: 'standalone', url: standaloneClipUrl }
                ],
                clips: [replayUrl],
                seasons: [{
                    seasonKey: 'team-1::player-1',
                    gameClips: [{ id: 'nested', videoUrl: 'https://youtu.be/PK1HyC37doc' }]
                }]
            }
        });

        await expect(backfillGameReplayArchives(migrationOptions(db))).resolves.toMatchObject({
            secondaryScanned: 2,
            secondaryMatched: 1,
            secondaryMigrated: 1
        });

        expect(db.state.get(profilePath)).toEqual({
            gameClips: [
                { id: 'protected' },
                { id: 'standalone', url: standaloneClipUrl }
            ],
            clips: [],
            seasons: [{
                seasonKey: 'team-1::player-1',
                gameClips: [{ id: 'nested' }]
            }]
        });
        await expect(verifyReadableReplayArchiveInventory(migrationOptions(db))).resolves.toEqual({ remaining: 0 });
    });

    it('uses one frozen inventory to scrub replay copies from different game documents', async () => {
        const sourcePath = 'teams/team-1/games/source-game';
        const copiedPath = 'teams/team-2/games/copied-game';
        const db = makeFirestore({
            [sourcePath]: completedGame({ replayVideoUrl: replayUrl }),
            [copiedPath]: completedGame({
                gameClips: [
                    { id: 'protected-copy', url: embedUrl },
                    { id: 'unrelated', url: 'https://youtu.be/dQw4w9WgXcQ' }
                ]
            })
        });

        await expect(backfillGameReplayArchives(migrationOptions(db))).resolves.toMatchObject({
            secondaryMatched: 1,
            secondaryMigrated: 1,
            blocked: 0
        });

        expect(db.state.get(copiedPath).gameClips).toEqual([
            { id: 'protected-copy' },
            { id: 'unrelated', url: 'https://youtu.be/dQw4w9WgXcQ' }
        ]);
        expect(db.state.get(`${sourcePath}/privateReplay/archive`)).toMatchObject({
            state: 'ready',
            videoId: 'PK1HyC37doc'
        });
    });

    it('preserves and privately reserves standalone YouTube clips without classifying them as replays', async () => {
        const profilePath = 'athleteProfiles/profile-clip-only';
        const nonYouTubeUrl = 'https://cdn.example.test/highlights/keep.mp4';
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [profilePath]: {
                clips: [
                    { id: 'youtube-url', url: 'https://youtu.be/dQw4w9WgXcQ' },
                    { id: 'youtube-id', provider: 'youtube', videoId: 'PK1HyC37doc' },
                    { id: 'other-provider', url: nonYouTubeUrl }
                ]
            }
        }));

        await runReplayArchiveMigration(migrationOptions(db));

        expect(db.state.get(profilePath).clips).toEqual([
            { id: 'youtube-url', url: 'https://youtu.be/dQw4w9WgXcQ' },
            { id: 'youtube-id', provider: 'youtube', videoId: 'PK1HyC37doc' },
            { id: 'other-provider', url: nonYouTubeUrl }
        ]);
        expect(db.state.has(getReplayClipYouTubeIdentityRecord('dQw4w9WgXcQ').path)).toBe(true);
        expect(db.state.has(getReplayClipYouTubeIdentityRecord('PK1HyC37doc').path)).toBe(true);
        expect(db.state.has(getReplayProtectedYouTubeIdentityRecord('dQw4w9WgXcQ').path)).toBe(false);
        expect(db.state.has(getReplayProtectedYouTubeIdentityRecord('PK1HyC37doc').path)).toBe(false);
        const readableIdentities = await collectReadableReplayClipIdentityInventory(db, 1);
        const persistedIdentities = await collectPersistedReplayClipIdentityInventory(db, 1);
        expect([...readableIdentities.youtubeVideoIds].sort()).toEqual([
            'PK1HyC37doc',
            'dQw4w9WgXcQ'
        ]);
        expect([...persistedIdentities.identityHashes].sort()).toEqual([
            getReplayClipYouTubeIdentityRecord('PK1HyC37doc').data.identityHash,
            getReplayClipYouTubeIdentityRecord('dQw4w9WgXcQ').data.identityHash
        ].sort());
        await expect(verifyReadableReplayArchiveInventory(migrationOptions(db))).resolves.toEqual({ remaining: 0 });
        await expect(verifyReplayClipIdentityInventory(migrationOptions(db))).resolves.toEqual({ remaining: 0 });
    });

    it('blocks when an intentional athlete clip already publishes a replay identity', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const profilePath = 'athleteProfiles/profile-overlap';
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [gamePath]: completedGame({ replayVideoUrl: replayUrl }),
            [profilePath]: {
                clips: [
                    { id: 'protected', url: 'https://youtu.be/PK1HyC37doc' },
                    { id: 'standalone', url: 'https://youtu.be/dQw4w9WgXcQ' }
                ]
            }
        }));

        await expect(runReplayArchiveMigration(migrationOptions(db))).rejects.toMatchObject({
            code: 'failed-precondition',
            overlapCount: 1
        });

        expect(db.state.get(profilePath).clips).toEqual([
            { id: 'protected', url: 'https://youtu.be/PK1HyC37doc' },
            { id: 'standalone', url: 'https://youtu.be/dQw4w9WgXcQ' }
        ]);
        expect(db.state.has(getReplayProtectedYouTubeIdentityRecord('PK1HyC37doc').path)).toBe(false);
        expect(db.state.has(getReplayClipYouTubeIdentityRecord('PK1HyC37doc').path)).toBe(false);
        expect(db.state.has(getReplayClipYouTubeIdentityRecord('dQw4w9WgXcQ').path)).toBe(false);
    });

    it('leaves the gate closed when a standalone YouTube clip lacks its exclusion record', async () => {
        const profilePath = 'athleteProfiles/profile-unreserved';
        const db = makeFirestore({
            [profilePath]: {
                clips: [{ id: 'standalone', url: 'https://youtu.be/dQw4w9WgXcQ' }]
            }
        });

        await expect(verifyReplayClipIdentityInventory(migrationOptions(db))).rejects.toThrow(
            'Replay clip identity verification failed for 1 video(s).'
        );
    });

    it('preserves and reserves every finite independent structured media source', async () => {
        const teamPath = 'teams/team-1';
        const activeGamePath = `${teamPath}/games/live-game`;
        const mediaPath = `${teamPath}/mediaItems/media-1`;
        const drillPath = 'drillLibrary/drill-1';
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [teamPath]: {
                youtubeVideoId: 'dQw4w9WgXcQ',
                streamEmbedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ'
            },
            [activeGamePath]: {
                type: 'game',
                status: 'scheduled',
                liveStatus: 'live',
                videoUrl: 'https://youtu.be/M7lc1UVf-VE'
            },
            [mediaPath]: {
                type: 'video-link',
                src: 'https://youtu.be/jNQXAC9IVRw'
            },
            [drillPath]: {
                resourceUrl: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ'
            }
        }));

        const report = await collectStructuredReplayClipIdentityReport({
            db,
            pageSize: 1,
            protectedIdentityInventory: { youtubeVideoIds: new Set() }
        });
        expect(report.independentVideoIds).toEqual([
            'M7lc1UVf-VE',
            'aqz-KE-bpKQ',
            'dQw4w9WgXcQ',
            'jNQXAC9IVRw'
        ]);

        await runReplayArchiveMigration(migrationOptions(db));

        for (const videoId of report.independentVideoIds) {
            expect(db.state.has(getReplayClipYouTubeIdentityRecord(videoId).path)).toBe(true);
            expect(db.state.has(getReplayProtectedYouTubeIdentityRecord(videoId).path)).toBe(false);
        }
        expect(db.state.get(teamPath).youtubeVideoId).toBe('dQw4w9WgXcQ');
        expect(db.state.get(activeGamePath).videoUrl).toContain('M7lc1UVf-VE');
        expect(db.state.get(mediaPath).src).toContain('jNQXAC9IVRw');
        expect(db.state.get(drillPath).resourceUrl).toContain('aqz-KE-bpKQ');
        await expect(verifyStructuredReplayClipIdentityInventory(migrationOptions(db)))
            .resolves.toEqual({ remaining: 0 });
    });

    it('blocks an independent structured source that already overlaps protected replay state', async () => {
        const gamePath = 'teams/team-1/games/replay-game';
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            'teams/team-1': {
                youtubeVideoId: 'PK1HyC37doc'
            },
            [gamePath]: completedGame({ replayVideoUrl: replayUrl })
        }));

        await expect(runReplayArchiveMigration(migrationOptions(db))).rejects.toMatchObject({
            code: 'failed-precondition',
            sourcePaths: ['teams/team-1#youtubeVideoId']
        });
        expect(db.state.get(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH)).toMatchObject({
            status: 'migrating'
        });
        expect(db.state.get('teams/team-1').youtubeVideoId).toBe('PK1HyC37doc');
        expect(db.state.has(`${gamePath}/privateReplay/archive`)).toBe(false);
    });

    it('scrubs protected automated structured copies while preserving unrelated metadata', async () => {
        const sourcePath = 'teams/team-1/games/replay-source';
        const providerCopyPath = 'teams/team-2/games/provider-copy';
        const activeCopyPath = 'teams/team-2/games/active-copy';
        const unrelatedCopyPath = 'teams/team-2/games/unrelated-copy';
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [sourcePath]: completedGame({ replayVideoUrl: replayUrl }),
            [providerCopyPath]: {
                type: 'game',
                status: 'scheduled',
                liveStatus: 'scheduled',
                isPublicProjection: true,
                youtubeVideoId: 'PK1HyC37doc',
                streamEmbedUrl: embedUrl,
                youtubeEmbedUrl: replayUrl,
                broadcastSession: {
                    status: 'ready',
                    provider: {
                        type: 'youtube',
                        name: 'YouTube',
                        channel: 'team-channel',
                        videoId: 'PK1HyC37doc',
                        embedUrl
                    }
                }
            },
            [activeCopyPath]: {
                type: 'game',
                status: 'scheduled',
                liveStatus: 'live',
                isPublicProjection: true,
                videoUrl: replayUrl
            },
            [unrelatedCopyPath]: {
                type: 'game',
                status: 'scheduled',
                liveStatus: 'scheduled',
                isPublicProjection: true,
                broadcastSession: {
                    status: 'ready',
                    provider: {
                        type: 'youtube',
                        name: 'YouTube',
                        videoId: 'dQw4w9WgXcQ'
                    }
                }
            }
        }));

        const result = await runReplayArchiveMigration(migrationOptions(db));

        expect(result).toMatchObject({
            structuredSecondaryMatched: 3,
            structuredSecondaryMigrated: 3
        });
        expect(db.state.get(providerCopyPath).broadcastSession).toEqual({
            status: 'ready',
            provider: {
                type: 'youtube',
                name: 'YouTube',
                channel: 'team-channel'
            }
        });
        expect(db.state.get(providerCopyPath)).not.toHaveProperty('youtubeVideoId');
        expect(db.state.get(providerCopyPath)).not.toHaveProperty('streamEmbedUrl');
        expect(db.state.get(providerCopyPath)).not.toHaveProperty('youtubeEmbedUrl');
        expect(db.state.get(activeCopyPath)).not.toHaveProperty('videoUrl');
        expect(db.state.get(unrelatedCopyPath).broadcastSession.provider).toEqual({
            type: 'youtube',
            name: 'YouTube'
        });
        expect(db.state.has(getReplayClipYouTubeIdentityRecord('PK1HyC37doc').path)).toBe(false);
        expect(db.state.has(getReplayClipYouTubeIdentityRecord('dQw4w9WgXcQ').path)).toBe(true);
        await expect(verifyStructuredReplayClipIdentityInventory(migrationOptions(db)))
            .resolves.toEqual({ remaining: 0 });
    });

    it('scrubs a canonical alias of a protected signed generic URL from an automated game copy', async () => {
        const sourcePath = 'teams/team-1/games/generic-replay-source';
        const copyPath = 'teams/team-2/games/generic-active-copy';
        const protectedRawUrl = 'https://cdn.example.test:443/private/../replay.mp4?sig=a%2Fb';
        const canonicalCopyUrl = 'https://cdn.example.test/replay.mp4?sig=a%2Fb';
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [sourcePath]: completedGame({ archivedVideoUrl: protectedRawUrl }),
            [copyPath]: {
                type: 'game',
                status: 'scheduled',
                liveStatus: 'live',
                isPublicProjection: true,
                sharedScheduleSourceTeamId: 'team-1',
                videoUrl: canonicalCopyUrl,
                opponent: 'Keep metadata'
            }
        }));

        await expect(runReplayArchiveMigration(migrationOptions(db))).rejects.toThrow(
            'Replay archive migration quarantined 1 document(s)'
        );
        expect(db.state.get(copyPath)).toMatchObject({ opponent: 'Keep metadata' });
        expect(db.state.get(copyPath)).not.toHaveProperty('videoUrl');
        await expect(verifyStructuredReplayClipIdentityInventory(migrationOptions(db)))
            .resolves.toEqual({ remaining: 0 });
    });

    it('leaves structured verification blocked when an independent source is not reserved', async () => {
        const db = makeFirestore({
            'teams/team-1': {
                youtubeEmbedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ'
            }
        });

        await expect(verifyStructuredReplayClipIdentityInventory(migrationOptions(db)))
            .rejects.toThrow('Structured replay identity verification failed for 1 video(s).');
    });

    it('rejects an automated source reintroduced after its identity was reserved', async () => {
        const copyPath = 'teams/team-2/games/reintroduced-copy';
        const identity = getReplayClipYouTubeIdentityRecord('dQw4w9WgXcQ');
        const db = makeFirestore({
            [identity.path]: identity.data,
            [copyPath]: {
                type: 'game',
                status: 'scheduled',
                liveStatus: 'scheduled',
                isPublicProjection: true,
                broadcastSession: {
                    provider: {
                        type: 'youtube',
                        name: 'YouTube',
                        videoId: 'dQw4w9WgXcQ'
                    }
                }
            }
        });

        await expect(verifyStructuredReplayClipIdentityInventory(migrationOptions(db)))
            .rejects.toThrow('0 protected overlap(s) and 1 automated copy source(s)');
    });

    it.each([
        [
            'malformed',
            'replayClipIdentities/youtube:dQw4w9WgXcQ',
            { schema: 'replay-clip-identity', version: 1, kind: 'youtube', videoId: 'short' },
            'Malformed replay clip identity'
        ],
        [
            'misbound',
            'replayClipIdentities/youtube:PK1HyC37doc',
            getReplayClipYouTubeIdentityRecord('dQw4w9WgXcQ').data,
            'Misbound replay clip identity'
        ]
    ])('rejects a %s standalone clip exclusion record', async (_label, identityPath, identity, message) => {
        const db = makeFirestore({ [identityPath]: identity });
        await expect(collectPersistedReplayClipIdentityInventory(db, 1)).rejects.toThrow(message);
    });

    it('retains the frozen identity when its source parent is deleted after capture', async () => {
        const sourcePath = 'teams/team-1/games/source-game';
        const copiedPath = 'organizations/org-1/sharedGames/copied-game';
        const db = makeFirestore({
            [sourcePath]: completedGame({ archivedVideoUrl: 'https://private.example/replay.mp4' }),
            [copiedPath]: completedGame({
                clips: [{ id: 'protected-copy', sourceUrl: 'https://private.example/replay.mp4' }]
            })
        });
        const protectedIdentityInventory = await collectProtectedReplayIdentityInventory(db, 1);

        db.state.delete(sourcePath);
        await expect(verifyReadableReplayArchiveInventory({
            ...migrationOptions(db),
            protectedIdentityInventory
        })).rejects.toThrow('Readable replay archive verification failed for 1 document(s).');
        await backfillGameReplayArchives({
            ...migrationOptions(db),
            protectedIdentityInventory
        });

        expect(db.state.get(copiedPath).clips).toEqual([{ id: 'protected-copy' }]);
        await expect(verifyReadableReplayArchiveInventory({
            ...migrationOptions(db),
            protectedIdentityInventory
        })).resolves.toEqual({ remaining: 0 });
    });

    it('matches generic replay URLs by both trimmed input and canonical URL href', async () => {
        const sourcePath = 'teams/team-1/games/source-game';
        const copiedPath = 'teams/team-2/games/copied-game';
        const db = makeFirestore({
            [sourcePath]: completedGame({ archivedVideoUrl: '  https://private.example  ' }),
            [copiedPath]: completedGame({
                mediaClips: [{ id: 'canonical-copy', publicUrl: 'https://private.example/' }]
            })
        });

        await backfillGameReplayArchives(migrationOptions(db));

        expect(db.state.get(copiedPath).mediaClips).toEqual([{ id: 'canonical-copy' }]);
    });

    it('matches generic replay URL fragment aliases as the same HTTP capability', async () => {
        const sourcePath = 'teams/team-1/games/source-game';
        const copiedPath = 'teams/team-2/games/copied-game';
        const protectedUrl = 'https://private.example/replay.mp4?token=secret';
        const db = makeFirestore({
            [sourcePath]: completedGame({ archivedVideoUrl: protectedUrl }),
            [copiedPath]: completedGame({
                mediaClips: [{
                    id: 'fragment-copy',
                    publicUrl: `${protectedUrl}#watch`,
                    title: 'Keep metadata'
                }]
            })
        });

        await backfillGameReplayArchives(migrationOptions(db));

        expect(db.state.get(copiedPath).mediaClips).toEqual([{
            id: 'fragment-copy',
            title: 'Keep metadata'
        }]);
    });

    it('converges when the complete migration is run repeatedly', async () => {
        const sourcePath = 'teams/team-1/games/source-game';
        const copiedPath = 'athleteProfiles/profile-1';
        const db = makeFirestore({
            [sourcePath]: completedGame({ replayVideoUrl: replayUrl }),
            [copiedPath]: {
                clips: [{ id: 'protected-copy', href: embedUrl }]
            }
        });

        const first = await backfillGameReplayArchives(migrationOptions(db));
        const stateAfterFirstRun = Object.fromEntries(db.state);
        const second = await backfillGameReplayArchives(migrationOptions(db));

        expect(first).toMatchObject({ migrated: 1, secondaryMigrated: 1, blocked: 0 });
        expect(second).toMatchObject({
            matched: 0,
            migrated: 0,
            quarantined: 0,
            blocked: 0,
            secondaryMatched: 0,
            secondaryMigrated: 0
        });
        expect(Object.fromEntries(db.state)).toEqual(stateAfterFirstRun);
        await expect(verifyReadableReplayArchiveInventory(migrationOptions(db))).resolves.toEqual({ remaining: 0 });
    });

    it('uses quarantined direct-media identities to scrub matching readable clip copies', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const directUrl = 'https://private.example/replay.mp4?token=secret';
        const db = makeFirestore({
            [gamePath]: completedGame({
                archivedVideoUrl: directUrl,
                gameClips: [{ id: 'copy', href: directUrl }]
            })
        });

        await expect(backfillGameReplayArchives(migrationOptions(db))).resolves.toMatchObject({
            quarantined: 1
        });

        expect(db.state.get(`${gamePath}/privateReplay/archive`)).toMatchObject({
            state: 'quarantine',
            legacyState: { archivedVideoUrl: directUrl }
        });
        expect(db.state.get(gamePath)).toMatchObject({ gameClips: [{ id: 'copy' }] });
        expect(db.state.get(gamePath)).not.toHaveProperty('hasRecordedReplay');
        expect(db.state.get(gamePath)).not.toHaveProperty('replayArchiveRevision');
        await expect(verifyReadableReplayArchiveInventory(migrationOptions(db))).resolves.toEqual({ remaining: 0 });
    });

    it.each([
        'http://youtu.be/PK1HyC37doc',
        'https://user:password@youtu.be/PK1HyC37doc',
        'https://youtu.be:8443/PK1HyC37doc'
    ])('protects one YouTube identity across an unsafe legacy source variant: %s', async (legacyUrl) => {
        const gamePath = 'teams/team-1/games/game-unsafe';
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [gamePath]: completedGame({
                archivedVideoUrl: legacyUrl,
                gameClips: [{ id: 'canonical-copy', url: replayUrl }]
            })
        }));

        await expect(runReplayArchiveMigration(migrationOptions(db))).rejects.toMatchObject({
            code: 'failed-precondition',
            overlapCount: 1
        });

        expect(db.state.get(gamePath).gameClips).toEqual([
            { id: 'canonical-copy', url: replayUrl }
        ]);
        expect(db.state.has(getReplayProtectedYouTubeIdentityRecord('PK1HyC37doc').path)).toBe(false);
        expect(db.state.has(getReplayClipYouTubeIdentityRecord('PK1HyC37doc').path)).toBe(false);
    });

    it('keeps the gate closed when one identity is already both a legacy replay and a clip reservation', async () => {
        const gamePath = 'teams/team-1/games/game-overlap';
        const clipIdentity = getReplayClipYouTubeIdentityRecord('PK1HyC37doc');
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [gamePath]: completedGame({ replayVideoUrl: replayUrl }),
            [clipIdentity.path]: clipIdentity.data
        }));

        await expect(runReplayArchiveMigration(migrationOptions(db))).rejects.toMatchObject({
            code: 'failed-precondition',
            overlapCount: 1
        });
        expect(db.state.get(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH)).toMatchObject({
            status: 'migrating'
        });
        expect(db.state.get(gamePath).replayVideoUrl).toBe(replayUrl);
        expect(db.state.has(getReplayProtectedYouTubeIdentityRecord('PK1HyC37doc').path)).toBe(false);
    });

    it('consumes a matching compatibility receipt atomically and preserves exact retry state', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const receiptPath = getReplayCompatibilityReceiptPath(gamePath);
        const compatGame = completedGame({
            replayVideo: {
                provider: 'youtube',
                videoId: 'PK1HyC37doc',
                publicUrl: replayUrl,
                embedUrl,
                status: 'ready'
            },
            hasRecordedReplay: true,
            replayArchiveRevision: 'r:compatibility'
        });
        const receipt = replayCompatibilityReceipt({ game: compatGame });
        const identityRecord = getReplayProtectedYouTubeIdentityRecordFromHash(
            receipt.protectedIdentityHashes[0]
        );
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [gamePath]: compatGame,
            [receiptPath]: receipt
        }));

        await runReplayArchiveMigration(migrationOptions(db));

        expect(db.state.has(receiptPath)).toBe(false);
        expect(db.state.get(`${gamePath}/privateReplay/archive`)).toMatchObject({
            state: 'ready',
            revision: 'r:compatibility',
            lastMutationId: 'compatibility.mutation',
            lastMutationHash: 'a'.repeat(64),
            videoId: 'PK1HyC37doc'
        });
        expect(db.state.get(identityRecord.path)).toMatchObject(identityRecord.data);
        expect(db.state.get(gamePath)).not.toHaveProperty('replayVideo');
        expect(db.state.get(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH).status).toBe('ready');
        await expect(verifyNoReplayCompatibilityReceipts(migrationOptions(db))).resolves.toEqual({
            remaining: 0
        });
    });

    it('keeps stale compatibility history while migrating the authoritative current parent', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const receiptPath = getReplayCompatibilityReceiptPath(gamePath);
        const originalGame = completedGame({
            replayVideo: { provider: 'youtube', videoId: 'PK1HyC37doc', status: 'ready' },
            hasRecordedReplay: true,
            replayArchiveRevision: 'r:compatibility'
        });
        const currentGame = completedGame({
            replayVideo: { provider: 'youtube', videoId: 'dQw4w9WgXcQ', status: 'ready' },
            hasRecordedReplay: true,
            replayArchiveRevision: 'stale-marker'
        });
        const receipt = replayCompatibilityReceipt({ game: originalGame });
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [gamePath]: currentGame,
            [receiptPath]: receipt
        }));

        await runReplayArchiveMigration(migrationOptions(db));

        expect(db.state.get(`${gamePath}/privateReplay/archive`)).toMatchObject({
            state: 'ready',
            videoId: 'dQw4w9WgXcQ'
        });
        expect(db.state.get(`${gamePath}/privateReplay/archive`).revision).not.toBe(
            'r:compatibility'
        );
        expect(db.state.has(getReplayProtectedYouTubeIdentityRecordFromHash(
            receipt.protectedIdentityHashes[0]
        ).path)).toBe(true);
        expect(db.state.has(getReplayProtectedYouTubeIdentityRecord('dQw4w9WgXcQ').path)).toBe(true);
        expect(db.state.has(receiptPath)).toBe(false);
    });

    it('blocks a raw replay identity that changes after the frozen inventory', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const firstRecord = getReplayProtectedYouTubeIdentityRecord('PK1HyC37doc');
        const secondRecord = getReplayProtectedYouTubeIdentityRecord('dQw4w9WgXcQ');
        let driftInjected = false;
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [gamePath]: completedGame({ replayVideoUrl: replayUrl })
        }), {
            beforeTransaction({ state }) {
                if (!driftInjected && state.has(firstRecord.path)) {
                    driftInjected = true;
                    state.set(gamePath, completedGame({
                        replayVideoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
                    }));
                }
            }
        });

        await expect(runReplayArchiveMigration(migrationOptions(db))).rejects.toThrow(
            'Replay identity changed after the frozen migration inventory.'
        );

        expect(driftInjected).toBe(true);
        expect(db.state.get(gamePath).replayVideoUrl).toContain('dQw4w9WgXcQ');
        expect(db.state.has(`${gamePath}/privateReplay/archive`)).toBe(false);
        expect(db.state.has(secondRecord.path)).toBe(false);
        expect(db.state.get(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH).status).toBe('migrating');
    });

    it('blocks late raw replay drift even when a frozen private archive already exists', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const privatePath = `${gamePath}/privateReplay/archive`;
        const firstRecord = getReplayProtectedYouTubeIdentityRecord('PK1HyC37doc');
        let driftInjected = false;
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [gamePath]: completedGame({
                replayVideoUrl: replayUrl,
                hasRecordedReplay: true,
                replayArchiveRevision: 'r:existing'
            }),
            [privatePath]: {
                schemaVersion: 1,
                state: 'ready',
                revision: 'r:existing',
                provider: 'youtube',
                videoId: 'PK1HyC37doc',
                protectedVideoIdHashes: [],
                updatedAt: 'prior-update',
                linkedAt: 'prior-link'
            }
        }), {
            beforeTransaction({ state }) {
                if (!driftInjected && state.has(firstRecord.path)) {
                    driftInjected = true;
                    state.set(gamePath, completedGame({
                        replayVideoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                        hasRecordedReplay: true,
                        replayArchiveRevision: 'r:existing'
                    }));
                }
            }
        });

        await expect(runReplayArchiveMigration(migrationOptions(db))).rejects.toThrow(
            'Replay identity changed after the frozen migration inventory.'
        );

        expect(driftInjected).toBe(true);
        expect(db.state.get(gamePath).replayVideoUrl).toContain('dQw4w9WgXcQ');
        expect(db.state.get(privatePath).videoId).toBe('PK1HyC37doc');
        expect(db.state.get(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH).status).toBe('migrating');
    });

    it('blocks per-document replay drift even when both identities were frozen globally', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const otherGamePath = 'teams/team-1/games/game-2';
        const privatePath = `${gamePath}/privateReplay/archive`;
        const firstRecord = getReplayProtectedYouTubeIdentityRecord('PK1HyC37doc');
        const secondRecord = getReplayProtectedYouTubeIdentityRecord('dQw4w9WgXcQ');
        let driftInjected = false;
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [gamePath]: completedGame({
                replayVideoUrl: replayUrl,
                hasRecordedReplay: true,
                replayArchiveRevision: 'r:existing'
            }),
            [privatePath]: {
                schemaVersion: 1,
                state: 'ready',
                revision: 'r:existing',
                provider: 'youtube',
                videoId: 'PK1HyC37doc',
                protectedVideoIdHashes: []
            },
            [otherGamePath]: completedGame({
                replayVideoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
            })
        }), {
            beforeTransactionRead({ state, documentPath }) {
                if (!driftInjected
                    && documentPath === gamePath
                    && state.has(firstRecord.path)
                    && state.has(secondRecord.path)) {
                    driftInjected = true;
                    state.set(gamePath, completedGame({
                        replayVideoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
                        hasRecordedReplay: true,
                        replayArchiveRevision: 'r:existing'
                    }));
                }
            }
        });

        await expect(runReplayArchiveMigration(migrationOptions(db))).rejects.toThrow(
            'Replay archive migration blocked for 1 document(s).'
        );

        expect(driftInjected).toBe(true);
        expect(db.state.get(gamePath).replayVideoUrl).toContain('dQw4w9WgXcQ');
        expect(db.state.get(privatePath).videoId).toBe('PK1HyC37doc');
        expect(db.state.get(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH).status).toBe('migrating');
    });

    it('fails final verification when a private replay has no protected ledger record', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const record = getReplayProtectedYouTubeIdentityRecord('PK1HyC37doc');
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [gamePath]: completedGame({ replayVideoUrl: replayUrl })
        }));

        await runReplayArchiveMigration(migrationOptions(db));
        db.state.delete(record.path);

        await expect(verifyProtectedReplayIdentityInventory(migrationOptions(db))).rejects.toThrow(
            'Protected replay identity verification failed for 1 document(s).'
        );
    });

    it('materializes removed state when an old writer clears a receipt-backed parent', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const receiptPath = getReplayCompatibilityReceiptPath(gamePath);
        const priorGame = completedGame({
            replayVideo: { provider: 'youtube', videoId: 'PK1HyC37doc', status: 'ready' },
            hasRecordedReplay: true,
            replayArchiveRevision: 'r:compatibility'
        });
        const receipt = replayCompatibilityReceipt({ game: priorGame });
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [gamePath]: completedGame({
                hasRecordedReplay: true,
                replayArchiveRevision: 'r:compatibility'
            }),
            [receiptPath]: receipt
        }));

        await runReplayArchiveMigration(migrationOptions(db));

        expect(db.state.get(`${gamePath}/privateReplay/archive`)).toMatchObject({
            state: 'removed'
        });
        expect(db.state.get(`${gamePath}/privateReplay/archive`).revision).not.toBe(
            'r:compatibility'
        );
        expect(db.state.get(gamePath)).toMatchObject({ hasRecordedReplay: false });
        expect(db.state.has(receiptPath)).toBe(false);
    });

    it('persists and consumes an orphan compatibility receipt only after collision checks pass', async () => {
        const gamePath = 'teams/team-1/games/orphan';
        const receiptPath = getReplayCompatibilityReceiptPath(gamePath);
        const priorGame = completedGame({
            replayVideo: { provider: 'youtube', videoId: 'PK1HyC37doc', status: 'ready' },
            hasRecordedReplay: true,
            replayArchiveRevision: 'r:compatibility'
        });
        const receipt = replayCompatibilityReceipt({ gameId: 'orphan', game: priorGame });
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [receiptPath]: receipt
        }));

        await runReplayArchiveMigration(migrationOptions(db));

        expect(db.state.has(receiptPath)).toBe(false);
        expect(db.state.has(getReplayProtectedYouTubeIdentityRecordFromHash(
            receipt.protectedIdentityHashes[0]
        ).path)).toBe(true);
        expect(db.state.get(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH).status).toBe('ready');
    });

    it('blocks receipt history that collides with an intentional clip before writing a ledger', async () => {
        const gamePath = 'teams/team-1/games/orphan';
        const receiptPath = getReplayCompatibilityReceiptPath(gamePath);
        const priorGame = completedGame({
            replayVideo: { provider: 'youtube', videoId: 'PK1HyC37doc', status: 'ready' },
            hasRecordedReplay: true,
            replayArchiveRevision: 'r:compatibility'
        });
        const receipt = replayCompatibilityReceipt({ gameId: 'orphan', game: priorGame });
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [receiptPath]: receipt,
            'athleteProfiles/intentional': {
                clips: [{ id: 'published', url: replayUrl }]
            }
        }));

        await expect(runReplayArchiveMigration(migrationOptions(db))).rejects.toMatchObject({
            code: 'failed-precondition',
            overlapCount: 1
        });

        expect(db.state.has(receiptPath)).toBe(true);
        expect(db.state.has(getReplayProtectedYouTubeIdentityRecordFromHash(
            receipt.protectedIdentityHashes[0]
        ).path)).toBe(false);
        expect(db.state.get(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH).status).toBe('migrating');
    });

    it('scrubs a proven generated profile copy before consuming an orphan receipt', async () => {
        const gamePath = 'teams/team-1/games/orphan';
        const receiptPath = getReplayCompatibilityReceiptPath(gamePath);
        const priorGame = completedGame({
            replayVideo: { provider: 'youtube', videoId: 'PK1HyC37doc', status: 'ready' },
            hasRecordedReplay: true,
            replayArchiveRevision: 'r:compatibility'
        });
        const receipt = replayCompatibilityReceipt({ gameId: 'orphan', game: priorGame });
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [receiptPath]: receipt,
            'athleteProfiles/generated': {
                gameClips: [{ id: 'generated', asset: { url: replayUrl, poster: 'keep.jpg' } }]
            }
        }));

        await runReplayArchiveMigration(migrationOptions(db));

        expect(db.state.get('athleteProfiles/generated').gameClips).toEqual([
            { id: 'generated', asset: { poster: 'keep.jpg' } }
        ]);
        expect(db.state.has(receiptPath)).toBe(false);
    });

    it('rejects malformed or misbound compatibility receipts without consuming them', async () => {
        const receiptPath = 'teams/team-1/games/game-1/privateReplay/compatibility';
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [receiptPath]: {
                ...replayCompatibilityReceipt({
                    game: completedGame({ replayVideoUrl: replayUrl })
                }),
                teamId: 'different-team'
            }
        }));

        await expect(runReplayArchiveMigration(migrationOptions(db))).rejects.toMatchObject({
            code: 'failed-precondition'
        });
        expect(db.state.has(receiptPath)).toBe(true);
        expect(db.state.get(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH).status).toBe('migrating');
    });

    it.each([
        ['processing', 'processing'],
        ['pending', 'pending'],
        ['failed', 'failed'],
        ['error', 'error'],
        ['unknown', 'unknown'],
        ['ready plus failed', 'ready', 'failed']
    ])('quarantines replay URL evidence with %s availability', async (_label, replayStatus, recordedReplayStatus) => {
        const gamePath = 'teams/team-1/games/game-status';
        const db = makeFirestore({
            [gamePath]: completedGame({
                replayVideoUrl: replayUrl,
                replayStatus,
                ...(recordedReplayStatus ? { recordedReplayStatus } : {})
            })
        });

        await expect(backfillGameReplayArchives(migrationOptions(db))).resolves.toMatchObject({
            migrated: 1,
            quarantined: 1
        });
        expect(db.state.get(`${gamePath}/privateReplay/archive`)).toMatchObject({
            state: 'quarantine',
            legacyState: {
                replayVideoUrl: replayUrl,
                replayStatus,
                ...(recordedReplayStatus ? { recordedReplayStatus } : {})
            }
        });
        expect(db.state.get(gamePath)).not.toHaveProperty('hasRecordedReplay');
        expect(db.state.get(gamePath)).not.toHaveProperty('replayArchiveRevision');
    });

    it.each(['ready', 'complete'])('migrates replay URL evidence with %s availability', async (replayStatus) => {
        const gamePath = `teams/team-1/games/game-${replayStatus}`;
        const db = makeFirestore({
            [gamePath]: completedGame({ replayVideoUrl: replayUrl, replayStatus })
        });

        await expect(backfillGameReplayArchives(migrationOptions(db))).resolves.toMatchObject({
            migrated: 1,
            quarantined: 0
        });
        expect(db.state.get(`${gamePath}/privateReplay/archive`)).toMatchObject({
            state: 'ready',
            videoId: 'PK1HyC37doc'
        });
    });

    it('writes a durable removed tombstone and scrubs the legacy suppression flag', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const db = makeFirestore({
            [gamePath]: completedGame({ replayVideoFallbackDisabled: true })
        });

        await backfillGameReplayArchives(migrationOptions(db));

        expect(db.state.get(`${gamePath}/privateReplay/archive`)).toMatchObject({
            state: 'removed'
        });
        expect(db.state.get(gamePath)).toMatchObject({ hasRecordedReplay: false });
        expect(db.state.get(gamePath)).not.toHaveProperty('replayVideoFallbackDisabled');
    });

    it('quarantines conflicting and unsupported identities before scrubbing them', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const db = makeFirestore({
            [gamePath]: completedGame({
                replayVideoUrl: replayUrl,
                recordedVideoUrl: 'https://youtu.be/dQw4w9WgXcQ',
                archivedVideoUrl: 'https://private.example/replay.mp4?token=secret'
            })
        });

        await expect(backfillGameReplayArchives(migrationOptions(db))).resolves.toMatchObject({
            quarantined: 1,
            blocked: 0
        });

        const privateArchive = db.state.get(`${gamePath}/privateReplay/archive`);
        expect(privateArchive).toMatchObject({
            state: 'quarantine',
            legacyState: {
                replayVideoUrl: replayUrl,
                recordedVideoUrl: 'https://youtu.be/dQw4w9WgXcQ'
            }
        });
        expect(db.state.get(gamePath)).not.toHaveProperty('hasRecordedReplay');
        expect(db.state.get(gamePath)).not.toHaveProperty('replayArchiveRevision');
        expect(db.state.get(gamePath)).not.toHaveProperty('archivedVideoUrl');
    });

    it('gives existing private state precedence and repairs readable markers idempotently', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const privatePath = `${gamePath}/privateReplay/archive`;
        const privateArchive = {
            schemaVersion: 1,
            state: 'ready',
            provider: 'youtube',
            videoId: 'PK1HyC37doc',
            revision: 'r:existing-private',
            lastMutationId: 'existing-mutation'
        };
        const db = makeFirestore({
            [gamePath]: completedGame({
                replayVideoUrl: 'https://youtu.be/dQw4w9WgXcQ',
                hasRecordedReplay: false,
                replayArchiveRevision: 'r:stale'
            }),
            [privatePath]: privateArchive
        });

        await backfillGameReplayArchives(migrationOptions(db));
        await backfillGameReplayArchives(migrationOptions(db));

        expect(db.state.get(privatePath)).toEqual(privateArchive);
        expect(db.state.get(gamePath)).toMatchObject({
            hasRecordedReplay: true,
            replayArchiveRevision: 'r:existing-private'
        });
        expect(db.state.get(gamePath)).not.toHaveProperty('replayVideoUrl');
    });

    it('preserves an active live videoUrl and does not misclassify it as a replay', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const liveUrl = 'https://www.youtube.com/embed/live_stream?channel=UC123';
        const db = makeFirestore({
            [gamePath]: {
                type: 'game',
                status: 'scheduled',
                liveStatus: 'live',
                videoUrl: liveUrl
            }
        });

        await expect(backfillGameReplayArchives(migrationOptions(db))).resolves.toMatchObject({
            matched: 0,
            migrated: 0
        });
        expect(db.state.get(gamePath).videoUrl).toBe(liveUrl);
        expect(db.state.has(`${gamePath}/privateReplay/archive`)).toBe(false);
    });

    it('migrates collection-group shared games into an exact private child', async () => {
        const gamePath = 'organizations/org-1/sharedGames/game-1';
        const db = makeFirestore({
            [gamePath]: completedGame({ replayVideoPublicUrl: replayUrl })
        });

        await backfillGameReplayArchives(migrationOptions(db));

        expect(db.state.get(`${gamePath}/privateReplay/archive`)).toMatchObject({
            state: 'ready',
            videoId: 'PK1HyC37doc'
        });
        expect(db.state.get(gamePath)).not.toHaveProperty('replayVideoPublicUrl');
    });

    it('keeps dry-run inventory read-only across paginated game groups', async () => {
        const seed = {
            'teams/team-1/games/game-1': completedGame({ replayVideoUrl: replayUrl }),
            'teams/team-1/games/game-2': completedGame({ replayVideoUrl: replayUrl }),
            'organizations/org-1/sharedGames/game-3': completedGame({ replayVideoUrl: replayUrl })
        };
        const db = makeFirestore(seed);

        await expect(backfillGameReplayArchives(migrationOptions(db, false))).resolves.toMatchObject({
            scanned: 3,
            matched: 3,
            migrated: 0
        });
        expect(db.runTransaction).not.toHaveBeenCalled();
        expect(Object.fromEntries(db.state)).toEqual(seed);
    });

    it('activates and verifies the exact athlete profile projection boundary marker', async () => {
        const db = makeFirestore({});

        await activateAthleteProfileProjectionBoundary({ db, fieldValue });

        expect(db.state.get(ATHLETE_PROFILE_PROJECTION_BOUNDARY_CONTROL_PATH)).toMatchObject(
            athleteProfileProjectionBoundaryReady()
        );
        await expect(verifyAthleteProfileProjectionBoundary(db)).resolves.toBe(true);
    });

    it('refuses apply before mutating the replay gate when the athlete profile boundary is absent', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const db = makeFirestore({
            [gamePath]: completedGame({ replayVideoUrl: replayUrl })
        });

        await expect(runReplayArchiveMigration(migrationOptions(db))).rejects.toThrow(
            'The athlete profile replay projection boundary is not ready.'
        );
        expect(db.state.has(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH)).toBe(false);
        expect(db.state.get(gamePath).replayVideoUrl).toBe(replayUrl);
    });

    it('closes the gate before inventory and marks it ready only after a verified apply', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [gamePath]: completedGame({ replayVideoUrl: replayUrl })
        }));
        const originalCollectionGroup = db.collectionGroup;
        db.collectionGroup = vi.fn((name) => {
            expect(db.state.get(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH)).toMatchObject({
                schema: REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA,
                status: 'migrating',
                version: 1
            });
            return originalCollectionGroup(name);
        });

        await runReplayArchiveMigration(migrationOptions(db));

        expect(db.state.get(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH)).toMatchObject({
            schema: REPLAY_ARCHIVE_MIGRATION_CONTROL_SCHEMA,
            status: 'ready',
            version: 1
        });
        const protectedIdentity = getReplayProtectedYouTubeIdentityRecord('PK1HyC37doc');
        expect(db.state.get(protectedIdentity.path)).toMatchObject(protectedIdentity.data);
    });

    it('leaves the durable gate migrating when apply or verification cannot complete', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [gamePath]: completedGame({ replayVideoUrl: replayUrl }),
            [`${gamePath}/privateReplay/archive`]: {
                schemaVersion: 1,
                state: 'ready',
                provider: 'youtube',
                videoId: 'bad',
                revision: 'r:invalid'
            }
        }));

        await expect(runReplayArchiveMigration(migrationOptions(db))).rejects.toThrow(
            'Replay archive migration blocked for 1 document(s).'
        );
        expect(db.state.get(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH)).toMatchObject({
            status: 'migrating',
            version: 1
        });
    });

    it('keeps the gate closed and parent marker-free until every quarantine is explicitly resolved', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [gamePath]: completedGame({
                replayVideoUrl: replayUrl,
                recordedVideoUrl: 'https://youtu.be/dQw4w9WgXcQ'
            })
        }));

        await expect(runReplayArchiveMigration(migrationOptions(db))).rejects.toThrow(
            'Replay archive migration quarantined 1 document(s)'
        );

        expect(db.state.get(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH)).toMatchObject({
            status: 'migrating',
            version: 1
        });
        expect(db.state.get(`${gamePath}/privateReplay/archive`)).toMatchObject({
            state: 'quarantine',
            reason: 'conflicting-video-identities'
        });
        expect(db.state.get(gamePath)).not.toHaveProperty('hasRecordedReplay');
        expect(db.state.get(gamePath)).not.toHaveProperty('replayArchiveRevision');
        expect(db.state.get(gamePath)).not.toHaveProperty('replayVideoUrl');
        expect(db.state.get(gamePath)).not.toHaveProperty('recordedVideoUrl');
    });

    it('keeps orchestration dry runs fully read-only, including the control gate and identity ledger', async () => {
        const seed = {
            'teams/team-1/games/game-1': completedGame({ replayVideoUrl: replayUrl })
        };
        const db = makeFirestore(seed);

        await runReplayArchiveMigration(migrationOptions(db, false));

        expect(db.runTransaction).not.toHaveBeenCalled();
        expect(Object.fromEntries(db.state)).toEqual(seed);
    });

    it('retains A across an already-deployed A-to-B replacement before retry inventory', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const privatePath = `${gamePath}/privateReplay/archive`;
        const lateCopyPath = 'athleteProfiles/late-copy';
        const db = makeFirestore(withAthleteProfileProjectionBoundary({
            [gamePath]: completedGame({ replayVideoUrl: replayUrl })
        }));

        await runReplayArchiveMigration(migrationOptions(db));
        const firstControl = db.state.get(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH);
        expect(firstControl.status).toBe('ready');

        // Model the exact atomic result of the already-deployed writer while
        // the prior gate is ready: parent/private move to B and B is ledgered.
        // A remains protected by the ledger written before the initial scrub.
        const replacementId = 'dQw4w9WgXcQ';
        const replacementRevision = 'r:replacement';
        db.state.set(gamePath, completedGame({
            hasRecordedReplay: true,
            replayArchiveRevision: replacementRevision
        }));
        db.state.set(privatePath, {
            schemaVersion: 1,
            state: 'ready',
            provider: 'youtube',
            videoId: replacementId,
            revision: replacementRevision,
            lastMutationId: 'replace.before.retry',
            lastMutationHash: 'hash'
        });
        const replacementIdentity = getReplayProtectedYouTubeIdentityRecord(replacementId);
        db.state.set(replacementIdentity.path, replacementIdentity.data);
        db.state.set(lateCopyPath, {
            gameClips: [{ id: 'old-a', url: replayUrl }]
        });

        await runReplayArchiveMigration(migrationOptions(db));

        expect(db.state.get(lateCopyPath).gameClips).toEqual([{ id: 'old-a' }]);
        expect(db.state.has(getReplayProtectedYouTubeIdentityRecord('PK1HyC37doc').path)).toBe(true);
        expect(db.state.has(replacementIdentity.path)).toBe(true);
        expect(db.state.get(REPLAY_ARCHIVE_MIGRATION_CONTROL_PATH).status).toBe('ready');
    });

    it('blocks rather than overwriting an invalid pre-existing private archive', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const db = makeFirestore({
            [gamePath]: completedGame({ replayVideoUrl: replayUrl }),
            [`${gamePath}/privateReplay/archive`]: {
                schemaVersion: 1,
                state: 'ready',
                provider: 'youtube',
                videoId: 'bad',
                revision: 'r:invalid'
            }
        });

        await expect(backfillGameReplayArchives(migrationOptions(db))).rejects.toThrow(
            'Replay archive migration blocked for 1 document(s).'
        );
        expect(db.state.get(gamePath).replayVideoUrl).toBe(replayUrl);
    });

    it('blocks a canonical parent marker whose private archive is missing', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const db = makeFirestore({
            [gamePath]: completedGame({
                hasRecordedReplay: true,
                replayArchiveRevision: 'r:missing-private'
            })
        });

        await expect(backfillGameReplayArchives(migrationOptions(db))).rejects.toThrow(
            'Replay archive migration blocked for 1 document(s).'
        );
        expect(db.state.get(gamePath)).toMatchObject({
            hasRecordedReplay: true,
            replayArchiveRevision: 'r:missing-private'
        });
    });

    it('scrubs obsolete readable replay marker aliases without manufacturing a private archive', async () => {
        const gamePath = 'teams/team-1/games/game-1';
        const db = makeFirestore({
            [gamePath]: completedGame({
                hasReplayVideo: true,
                replayMediaState: 'ready',
                replayMediaRevision: 'content-derived-value'
            })
        });

        await expect(backfillGameReplayArchives(migrationOptions(db))).resolves.toMatchObject({
            matched: 1,
            migrated: 1,
            blocked: 0
        });
        expect(db.state.get(gamePath)).not.toHaveProperty('hasReplayVideo');
        expect(db.state.get(gamePath)).not.toHaveProperty('replayMediaState');
        expect(db.state.get(gamePath)).not.toHaveProperty('replayMediaRevision');
        expect(db.state.has(`${gamePath}/privateReplay/archive`)).toBe(false);
        await expect(verifyReadableReplayArchiveInventory(migrationOptions(db))).resolves.toEqual({ remaining: 0 });
    });

    it('deploys clip callables and Hosting before freezing raw writes, then migrates and republishes the application', () => {
        const workflow = readFileSync(
            new URL('../../.github/workflows/deploy-prod.yml', import.meta.url),
            'utf8'
        );
        const compatibilityReaders = workflow.indexOf('replay-private-archive-reader-compatibility');
        const compatibilityCleanup = workflow.indexOf('replay-private-archive-cleanup-compatibility');
        const cacheDrain = workflow.indexOf('sleep "$replay_public_cache_drain_seconds"');
        const compatibilityHosting = workflow.indexOf('replay-callable-client-compatibility');
        const closeGate = workflow.indexOf('backfill-game-replay-archives.mjs" --close-gate');
        const rulesBoundary = workflow.indexOf('Exact replay-final Firestore rules are active before the migration gate closes.');
        const migration = workflow.indexOf('backfill-game-replay-archives.mjs" --apply');
        const certificateInventory = workflow.indexOf('"certificate-signature-inventory-producer"');
        const application = workflow.indexOf('retry_firebase_deploy "hosting,functions" "application"');

        expect(workflow).toContain('replay_archive_backfill_needed: ${{ steps.firestore_config.outputs.replay_archive_backfill_needed }}');
        expect(workflow).toContain('replay_archive_reader_compatibility_targets="functions:getReplayPrivacyMigrationStatus,functions:manageGameReplayArchive,functions:saveGameHighlightClips,functions:saveAthleteProfileProjection,functions:mutateStructuredMediaIdentity,functions:getGameReplayPlayback');
        expect(workflow).toContain('functions:cleanupPrivateReplayArchiveOnGameDelete');
        expect(workflow).toContain('functions:cleanupPrivateReplayArchiveOnSharedGameDelete');
        expect(workflow).toContain('replay_public_cache_drain_seconds=330');
        expect(workflow).toContain('timeout-minutes: 60');
        expect(workflow).toContain('cp _migration/backfill-game-replay-archives.js');
        expect(workflow).toContain('cp --no-dereference js/replay-clip-sanitizer.js');
        expect(workflow).toContain('sha256sum -c js/replay-clip-sanitizer.sha256');
        expect(compatibilityReaders).toBeGreaterThan(-1);
        expect(compatibilityCleanup).toBeGreaterThan(compatibilityReaders);
        expect(cacheDrain).toBeGreaterThan(compatibilityCleanup);
        expect(compatibilityHosting).toBeGreaterThan(cacheDrain);
        expect(rulesBoundary).toBeGreaterThan(compatibilityHosting);
        expect(closeGate).toBeGreaterThan(rulesBoundary);
        expect(migration).toBeGreaterThan(closeGate);
        expect(certificateInventory).toBeGreaterThan(migration);
        expect(application).toBeGreaterThan(migration);
    });
});
