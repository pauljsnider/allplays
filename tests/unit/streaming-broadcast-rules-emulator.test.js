import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { deleteField, doc, getDoc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const nowTimestamp = () => Timestamp.now();

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('streaming broadcast rules engine coverage', () => {
    let testEnv;

    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: `allplays-streaming-broadcast-${Date.now()}`,
            firestore: { rules }
        });
    }, 30_000);

    beforeEach(async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const firestore = context.firestore();
            const users = [
                ['owner-1', 'owner@example.com'],
                ['selected-1', 'selected@example.com'],
                ['confirmed-1', 'confirmed@example.com'],
                ['unrelated-1', 'unrelated@example.com'],
                ['legacy-1', 'legacy@example.com'],
                ['videographer-1', 'videographer@example.com']
            ];
            for (const [uid, email] of users) {
                await setDoc(doc(firestore, `users/${uid}`), { email, isAdmin: false, parentTeamIds: [] });
            }
            await seedTeamAndGame(firestore, 'selected-team', 'selected-game', {
                teamPermissions: { streaming: { mode: 'selected', memberIds: ['selected-1'] } }
            });
            await seedTeamAndGame(firestore, 'confirmed-team', 'confirmed-game', {
                teamPermissions: { streaming: { mode: 'all_confirmed', memberIds: [] } }
            });
            await setDoc(doc(firestore, 'teams/confirmed-team/games/confirmed-game/rsvps/confirmed-1'), {
                response: 'going'
            });
            await seedTeamAndGame(firestore, 'legacy-team', 'legacy-game', {
                streamAccessMode: 'selected_volunteers',
                streamVolunteerEmails: ['legacy@example.com']
            });
            await seedTeamAndGame(firestore, 'private-team', 'private-game', {
                isPublic: false
            }, {
                visibility: 'private'
            });
            await seedTeamAndGame(firestore, 'videographer-team', 'videographer-game', {
                teamPermissions: { videography: { mode: 'selected', memberIds: ['videographer-1'] } }
            });
            await seedTeamAndGame(firestore, 'replay-team', 'replay-game', {
                teamPermissions: { videography: { mode: 'selected', memberIds: ['videographer-1'] } }
            }, {
                status: 'completed',
                liveStatus: 'scheduled'
            });
            await seedTeamAndGame(firestore, 'contradictory-replay-team', 'contradictory-replay-game', {
                teamPermissions: { videography: { mode: 'selected', memberIds: ['videographer-1'] } }
            }, {
                status: 'completed',
                liveStatus: 'live'
            });
            await seedTeamAndGame(firestore, 'cancelled-replay-team', 'cancelled-replay-game', {
                teamPermissions: { videography: { mode: 'selected', memberIds: ['videographer-1'] } }
            }, {
                status: 'completed',
                liveStatus: 'cancelled'
            });
            await seedTeamAndGame(firestore, 'shared-replay-team', 'shared-replay-game', {
                teamPermissions: { videography: { mode: 'selected', memberIds: ['videographer-1'] } }
            }, {
                status: 'completed',
                liveStatus: 'completed',
                sharedScheduleId: 'shared-schedule-1',
                sharedScheduleOpponentTeamId: 'opponent-team',
                sharedScheduleOpponentGameId: 'opponent-game'
            });
            await seedTeamAndGame(firestore, 'legacy-shared-replay-team', 'legacy-shared-replay-game', {
                teamPermissions: { videography: { mode: 'selected', memberIds: ['videographer-1'] } }
            }, {
                status: 'completed',
                liveStatus: 'completed',
                sharedGameId: 'central-shared-game'
            });
            await seedTeamAndGame(firestore, 'nullable-status-replay-team', 'status-only-game', {
                teamPermissions: { videography: { mode: 'selected', memberIds: ['videographer-1'] } }
            }, {
                status: 'completed',
                liveStatus: null
            });
            await seedTeamAndGame(firestore, 'nullable-live-replay-team', 'live-only-game', {
                teamPermissions: { videography: { mode: 'selected', memberIds: ['videographer-1'] } }
            }, {
                status: null,
                liveStatus: 'final'
            });
            await seedTeamAndGame(firestore, 'detached-replay-team', 'detached-game', {
                teamPermissions: { videography: { mode: 'selected', memberIds: ['videographer-1'] } }
            }, {
                status: 'completed',
                liveStatus: 'completed',
                isSharedGame: false,
                sharedScheduleId: null,
                sharedScheduleSourceTeamId: null,
                sharedScheduleOpponentTeamId: null,
                sharedScheduleOpponentGameId: null
            });
            await seedTeamAndGame(firestore, 'private-videographer-team', 'private-videographer-game', {
                isPublic: false,
                teamPermissions: { videography: { mode: 'selected', memberIds: ['videographer-1'] } }
            }, {
                visibility: 'private'
            });
            await seedTeamAndGame(firestore, 'shareable-team', 'shareable-game', {
                isPublic: false,
                teamPermissions: { streaming: { mode: 'selected', memberIds: ['selected-1'] } }
            }, {
                shareable: true
            });
        });
    });

    afterAll(async () => {
        await testEnv?.cleanup();
    });

    function authedDb(uid, email) {
        return testEnv.authenticatedContext(uid, { email }).firestore();
    }

    function gameRef(firestore, teamId, gameId) {
        return doc(firestore, `teams/${teamId}/games/${gameId}`);
    }

    function readySession(overrides = {}) {
        const timestamp = nowTimestamp();
        return {
            id: 'broadcast-1',
            name: 'Game broadcast setup',
            status: 'ready_for_managed_stream',
            provider: { type: 'managed_setup', name: 'ALL PLAYS managed setup' },
            permissions: { camera: true, microphone: true },
            createdAt: Timestamp.fromMillis(1_700_000_000_000),
            updatedAt: timestamp,
            updatedBy: 'owner-1',
            ...overrides
        };
    }

    function liveSession(uid, email, overrides = {}) {
        const timestamp = nowTimestamp();
        return readySession({
            updatedAt: timestamp,
            updatedBy: uid,
            localStreamStatus: 'live',
            localStreamActive: true,
            localStreamUpdatedAt: timestamp,
            localStreamLeaseExpiresAt: Timestamp.fromMillis(Date.now() + 45_000),
            ...overrides
        });
    }

    function startingSession(uid, email, overrides = {}) {
        const timestamp = nowTimestamp();
        return readySession({
            updatedAt: timestamp,
            updatedBy: uid,
            localStreamStatus: 'starting',
            localStreamActive: false,
            localStreamUpdatedAt: timestamp,
            ...overrides
        });
    }

    async function seedTeamAndGame(firestore, teamId, gameId, teamOverrides = {}, gameOverrides = {}) {
        await setDoc(doc(firestore, `teams/${teamId}`), {
            ownerId: 'owner-1',
            adminEmails: ['owner@example.com'],
            isPublic: true,
            active: true,
            teamPermissions: { streaming: { mode: 'selected', memberIds: ['selected-1'] } },
            ...teamOverrides
        });
        await setDoc(gameRef(firestore, teamId, gameId), {
            type: 'game',
            status: 'scheduled',
            liveStatus: 'scheduled',
            visibility: 'public',
            broadcastSession: readySession(),
            updatedAt: nowTimestamp(),
            ...gameOverrides
        });
    }

    async function writeLive(firestore, teamId, gameId, uid, email, extra = {}) {
        return updateDoc(gameRef(firestore, teamId, gameId), {
            broadcastSession: liveSession(uid, email),
            updatedAt: nowTimestamp(),
            ...extra
        });
    }

    it('allows selected, confirmed-RSVP, and retained legacy helpers on readable games', async () => {
        const selectedDb = authedDb('selected-1', 'selected@example.com');
        await assertSucceeds(getDoc(gameRef(selectedDb, 'selected-team', 'selected-game')));
        await assertSucceeds(updateDoc(gameRef(selectedDb, 'selected-team', 'selected-game'), {
            broadcastSession: startingSession('selected-1', 'selected@example.com'),
            updatedAt: nowTimestamp()
        }));
        await assertSucceeds(writeLive(selectedDb, 'selected-team', 'selected-game', 'selected-1', 'selected@example.com'));

        const confirmedDb = authedDb('confirmed-1', 'confirmed@example.com');
        await assertSucceeds(writeLive(confirmedDb, 'confirmed-team', 'confirmed-game', 'confirmed-1', 'confirmed@example.com'));

        const legacyDb = authedDb('legacy-1', 'legacy@example.com');
        await assertSucceeds(writeLive(legacyDb, 'legacy-team', 'legacy-game', 'legacy-1', 'legacy@example.com'));
    });

    it('denies missing or wrong RSVP, unrelated users, and revoked selected grants', async () => {
        const unrelatedDb = authedDb('unrelated-1', 'unrelated@example.com');
        await assertFails(writeLive(unrelatedDb, 'selected-team', 'selected-game', 'unrelated-1', 'unrelated@example.com'));
        await assertFails(writeLive(unrelatedDb, 'confirmed-team', 'confirmed-game', 'unrelated-1', 'unrelated@example.com'));

        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'teams/confirmed-team/games/confirmed-game/rsvps/unrelated-1'), {
                response: 'not_going'
            });
            await updateDoc(doc(context.firestore(), 'teams/selected-team'), {
                'teamPermissions.streaming.memberIds': []
            });
        });
        await assertFails(writeLive(unrelatedDb, 'confirmed-team', 'confirmed-game', 'unrelated-1', 'unrelated@example.com'));
        const selectedDb = authedDb('selected-1', 'selected@example.com');
        await assertFails(writeLive(selectedDb, 'selected-team', 'selected-game', 'selected-1', 'selected@example.com'));
    });

    it('denies starting until camera and microphone setup is verified', async () => {
        const selectedDb = authedDb('selected-1', 'selected@example.com');
        await assertFails(updateDoc(gameRef(selectedDb, 'selected-team', 'selected-game'), {
            broadcastSession: startingSession('selected-1', 'selected@example.com', {
                status: 'permission_failed',
                permissions: { camera: false, microphone: false }
            }),
            updatedAt: nowTimestamp()
        }));
    });

    it('denies extra top-level fields, malformed sessions, clears, spoofed attribution, and protected-field changes', async () => {
        const selectedDb = authedDb('selected-1', 'selected@example.com');
        await assertFails(writeLive(selectedDb, 'selected-team', 'selected-game', 'selected-1', 'selected@example.com', { homeScore: 99 }));
        await assertFails(updateDoc(gameRef(selectedDb, 'selected-team', 'selected-game'), {
            broadcastSession: liveSession('selected-1', 'selected@example.com', { localStreamActive: 'yes' }),
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(gameRef(selectedDb, 'selected-team', 'selected-game'), {
            broadcastSession: liveSession('selected-1', 'selected@example.com', {
                status: 'permission_failed',
                permissions: { camera: false, microphone: false }
            }),
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(gameRef(selectedDb, 'selected-team', 'selected-game'), {
            broadcastSession: null,
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(gameRef(selectedDb, 'selected-team', 'selected-game'), {
            broadcastSession: liveSession('attacker-1', 'selected@example.com'),
            updatedAt: nowTimestamp()
        }));

        for (const protectedOverride of [
            { id: 'replacement-id' },
            { provider: { type: 'youtube', name: 'Injected provider', videoId: 'abc' } },
            { createdAt: Timestamp.fromMillis(Date.now() + 1_000) }
        ]) {
            await assertFails(updateDoc(gameRef(selectedDb, 'selected-team', 'selected-game'), {
                broadcastSession: liveSession('selected-1', 'selected@example.com', protectedOverride),
                updatedAt: nowTimestamp()
            }));
        }
    });

    it('denies expired or overlong leases', async () => {
        const selectedDb = authedDb('selected-1', 'selected@example.com');
        for (const lease of [
            Timestamp.fromMillis(Date.now() - 1_000),
            Timestamp.fromMillis(Date.now() + 61_000)
        ]) {
            await assertFails(updateDoc(gameRef(selectedDb, 'selected-team', 'selected-game'), {
                broadcastSession: liveSession('selected-1', 'selected@example.com', { localStreamLeaseExpiresAt: lease }),
                updatedAt: nowTimestamp()
            }));
        }
    });

    it('denies every client-ended status and live status spelling', async () => {
        const selectedDb = authedDb('selected-1', 'selected@example.com');
        await testEnv.withSecurityRulesDisabled(async (context) => {
            for (const status of ['cancelled', 'canceled', 'completed', 'final', 'deleted']) {
                await seedTeamAndGame(context.firestore(), 'ended-team', `status-${status}`, {}, { status });
                await seedTeamAndGame(context.firestore(), 'ended-team', `live-${status}`, {}, { liveStatus: status });
            }
        });
        for (const status of ['cancelled', 'canceled', 'completed', 'final', 'deleted']) {
            await assertFails(writeLive(selectedDb, 'ended-team', `status-${status}`, 'selected-1', 'selected@example.com'));
            await assertFails(writeLive(selectedDb, 'ended-team', `live-${status}`, 'selected-1', 'selected@example.com'));
        }
    });

    it('allows scoped private-game reads while requiring shareable metadata for streaming writes', async () => {
        const selectedDb = authedDb('selected-1', 'selected@example.com');
        await assertSucceeds(getDoc(gameRef(selectedDb, 'private-team', 'private-game')));
        await assertFails(writeLive(selectedDb, 'private-team', 'private-game', 'selected-1', 'selected@example.com'));

        await assertSucceeds(getDoc(gameRef(selectedDb, 'shareable-team', 'shareable-game')));
        await assertSucceeds(writeLive(selectedDb, 'shareable-team', 'shareable-game', 'selected-1', 'selected@example.com'));
    });

    it('lets a private-game videographer read without permitting broadcast metadata writes', async () => {
        const videographerDb = authedDb('videographer-1', 'videographer@example.com');
        await assertSucceeds(getDoc(gameRef(videographerDb, 'private-videographer-team', 'private-videographer-game')));
        await assertFails(writeLive(
            videographerDb,
            'private-videographer-team',
            'private-videographer-game',
            'videographer-1',
            'videographer@example.com'
        ));
    });

    it('denies videographer mixed clip and broadcast-session bypass attempts', async () => {
        const videographerDb = authedDb('videographer-1', 'videographer@example.com');
        const ref = gameRef(videographerDb, 'videographer-team', 'videographer-game');
        for (const broadcastSession of [
            null,
            liveSession('videographer-1', 'videographer@example.com', { localStreamActive: 'yes' }),
            liveSession('attacker-1', 'videographer@example.com')
        ]) {
            await assertFails(updateDoc(ref, {
                videoClips: [{ id: 'clip-1' }],
                broadcastSession,
                updatedAt: nowTimestamp()
            }));
        }
    });

    it('allows completed-game replay links only for managers and selected videographers', async () => {
        const linkedAt = nowTimestamp();
        const firstReplay = {
            provider: 'youtube',
            videoId: '0IuY8Oryi1k',
            embedUrl: 'https://www.youtube.com/embed/0IuY8Oryi1k',
            publicUrl: 'https://www.youtube.com/watch?v=0IuY8Oryi1k',
            status: 'ready',
            linkedBy: 'videographer-1',
            linkedAt
        };
        const replacementReplay = {
            provider: 'youtube',
            videoId: 'dQw4w9WgXcQ',
            embedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
            publicUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            status: 'ready',
            linkedBy: 'videographer-1',
            linkedAt
        };
        const videographerDb = authedDb('videographer-1', 'videographer@example.com');
        const videographerRef = gameRef(videographerDb, 'replay-team', 'replay-game');

        await assertSucceeds(updateDoc(videographerRef, {
            replayVideo: firstReplay,
            updatedAt: nowTimestamp()
        }));
        await assertSucceeds(updateDoc(videographerRef, {
            replayVideo: replacementReplay,
            updatedAt: nowTimestamp()
        }));
        await assertSucceeds(updateDoc(videographerRef, {
            replayVideo: null,
            replayVideoFallbackDisabled: true,
            updatedAt: nowTimestamp()
        }));

        const unrelatedDb = authedDb('unrelated-1', 'unrelated@example.com');
        await assertFails(updateDoc(gameRef(unrelatedDb, 'replay-team', 'replay-game'), {
            replayVideo: firstReplay,
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(videographerRef, {
            replayVideo: firstReplay,
            summary: 'Changed through a mixed-field replay update.',
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(gameRef(videographerDb, 'legacy-shared-replay-team', 'legacy-shared-replay-game'), {
            replayVideo: firstReplay,
            updatedAt: nowTimestamp()
        }));

        const ownerDb = authedDb('owner-1', 'owner@example.com');
        await assertFails(updateDoc(gameRef(ownerDb, 'replay-team', 'replay-game'), {
            replayVideo: { ...firstReplay, linkedBy: 'owner-1' },
            updatedAt: nowTimestamp()
        }));
        await assertSucceeds(updateDoc(gameRef(ownerDb, 'replay-team', 'replay-game'), {
            replayVideo: { ...firstReplay, linkedBy: 'owner-1' },
            replayVideoFallbackDisabled: deleteField(),
            updatedAt: nowTimestamp()
        }));
    });

    it('forbids replay archive fields on game creation while allowing ordinary owner-created games', async () => {
        const ownerDb = authedDb('owner-1', 'owner@example.com');
        const canonicalReplay = {
            provider: 'youtube',
            videoId: '0IuY8Oryi1k',
            embedUrl: 'https://www.youtube.com/embed/0IuY8Oryi1k',
            publicUrl: 'https://www.youtube.com/watch?v=0IuY8Oryi1k',
            status: 'ready',
            linkedBy: 'owner-1',
            linkedAt: nowTimestamp()
        };
        const baseGame = {
            type: 'game',
            status: 'scheduled',
            liveStatus: 'scheduled',
            visibility: 'public',
            updatedAt: nowTimestamp()
        };

        await assertSucceeds(setDoc(gameRef(ownerDb, 'replay-team', 'ordinary-created-game'), baseGame));
        await assertFails(setDoc(gameRef(ownerDb, 'replay-team', 'scheduled-replay-create'), {
            ...baseGame,
            replayVideo: canonicalReplay
        }));
        await assertFails(setDoc(gameRef(ownerDb, 'replay-team', 'shared-replay-create'), {
            ...baseGame,
            status: 'completed',
            liveStatus: 'completed',
            sharedScheduleSourceTeamId: 'source-team',
            replayVideo: canonicalReplay
        }));
        await assertFails(setDoc(gameRef(ownerDb, 'replay-team', 'legacy-replay-create'), {
            ...baseGame,
            status: 'completed',
            liveStatus: 'completed',
            recordedVideo: { url: 'https://cdn.example/replay.mp4' }
        }));
    });

    it('atomically replaces every historical replay alias with the canonical replay', async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await updateDoc(gameRef(context.firestore(), 'replay-team', 'replay-game'), {
                recordedVideo: { url: 'https://cdn.example/recorded.mp4' },
                videoReplay: { src: 'https://cdn.example/video-replay.mp4' },
                replayVideoUrl: 'https://cdn.example/replay-url.mp4',
                recordedVideoUrl: 'https://cdn.example/recorded-url.mp4',
                videoReplayUrl: 'https://cdn.example/video-replay-url.mp4',
                archivedVideoUrl: 'https://cdn.example/archive.mp4',
                replayVideoPublicUrl: 'https://video.example/replay',
                replayVideoPosterUrl: 'https://cdn.example/poster.jpg',
                replayVideoTitle: 'Older replay',
                replayVideoDurationMs: 123_000,
                replayStatus: 'failed',
                recordedReplayStatus: 'processing',
                videoReplayStatus: 'ready'
            });
        });

        const videographerDb = authedDb('videographer-1', 'videographer@example.com');
        await assertSucceeds(updateDoc(gameRef(videographerDb, 'replay-team', 'replay-game'), {
            replayVideo: {
                provider: 'youtube',
                videoId: '0IuY8Oryi1k',
                embedUrl: 'https://www.youtube.com/embed/0IuY8Oryi1k',
                publicUrl: 'https://www.youtube.com/watch?v=0IuY8Oryi1k',
                status: 'ready',
                linkedBy: 'videographer-1',
                linkedAt: nowTimestamp()
            },
            recordedVideo: deleteField(),
            videoReplay: deleteField(),
            replayVideoUrl: deleteField(),
            recordedVideoUrl: deleteField(),
            videoReplayUrl: deleteField(),
            archivedVideoUrl: deleteField(),
            replayVideoPublicUrl: deleteField(),
            replayVideoPosterUrl: deleteField(),
            replayVideoTitle: deleteField(),
            replayVideoDurationMs: deleteField(),
            replayStatus: deleteField(),
            recordedReplayStatus: deleteField(),
            videoReplayStatus: deleteField(),
            updatedAt: nowTimestamp()
        }));
    });

    it('accepts a final lifecycle when the unused status field is null', async () => {
        const videographerDb = authedDb('videographer-1', 'videographer@example.com');
        for (const [teamId, gameId] of [
            ['nullable-status-replay-team', 'status-only-game'],
            ['nullable-live-replay-team', 'live-only-game']
        ]) {
            await assertSucceeds(updateDoc(gameRef(videographerDb, teamId, gameId), {
                replayVideo: {
                    provider: 'youtube',
                    videoId: '0IuY8Oryi1k',
                    embedUrl: 'https://www.youtube.com/embed/0IuY8Oryi1k',
                    publicUrl: 'https://www.youtube.com/watch?v=0IuY8Oryi1k',
                    status: 'ready',
                    linkedBy: 'videographer-1',
                    linkedAt: nowTimestamp()
                },
                updatedAt: nowTimestamp()
            }));
        }
    });

    it('allows only a full manager to unlink stale replay state after lifecycle corrections', async () => {
        const ownerDb = authedDb('owner-1', 'owner@example.com');
        const videographerDb = authedDb('videographer-1', 'videographer@example.com');
        const ref = gameRef(ownerDb, 'replay-team', 'replay-game');
        await assertSucceeds(updateDoc(ref, {
            replayVideo: {
                provider: 'youtube',
                videoId: '0IuY8Oryi1k',
                embedUrl: 'https://www.youtube.com/embed/0IuY8Oryi1k',
                publicUrl: 'https://www.youtube.com/watch?v=0IuY8Oryi1k',
                status: 'ready',
                linkedBy: 'owner-1',
                linkedAt: nowTimestamp()
            },
            updatedAt: nowTimestamp()
        }));
        await assertSucceeds(updateDoc(ref, {
            status: 'scheduled',
            liveStatus: 'scheduled',
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(gameRef(videographerDb, 'replay-team', 'replay-game'), {
            replayVideo: null,
            replayVideoFallbackDisabled: true,
            updatedAt: nowTimestamp()
        }));
        await assertSucceeds(updateDoc(ref, {
            status: 'cancelled',
            liveStatus: 'cancelled',
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(gameRef(videographerDb, 'replay-team', 'replay-game'), {
            replayVideo: null,
            replayVideoFallbackDisabled: true,
            updatedAt: nowTimestamp()
        }));
        await assertSucceeds(updateDoc(ref, {
            replayVideo: null,
            replayVideoFallbackDisabled: true,
            updatedAt: nowTimestamp()
        }));
    });

    it('rejects replay links outside the completed canonical delegated contract', async () => {
        const videographerDb = authedDb('videographer-1', 'videographer@example.com');
        const completedRef = gameRef(videographerDb, 'replay-team', 'replay-game');
        const canonicalReplay = {
            provider: 'youtube',
            videoId: '0IuY8Oryi1k',
            embedUrl: 'https://www.youtube.com/embed/0IuY8Oryi1k',
            publicUrl: 'https://www.youtube.com/watch?v=0IuY8Oryi1k',
            status: 'ready',
            linkedBy: 'videographer-1',
            linkedAt: nowTimestamp()
        };

        await assertFails(updateDoc(gameRef(videographerDb, 'videographer-team', 'videographer-game'), {
            replayVideo: canonicalReplay,
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(gameRef(videographerDb, 'contradictory-replay-team', 'contradictory-replay-game'), {
            replayVideo: canonicalReplay,
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(gameRef(videographerDb, 'cancelled-replay-team', 'cancelled-replay-game'), {
            replayVideo: canonicalReplay,
            updatedAt: nowTimestamp()
        }));

        await testEnv.withSecurityRulesDisabled(async (context) => {
            const firestore = context.firestore();
            for (const [gameId, extra] of [
                ['flag-cancelled', { isCancelled: true }],
                ['flag-deleted', { deleted: true }],
                ['flag-is-deleted', { isDeleted: true }],
                ['practice-final', { type: 'practice' }]
            ]) {
                await setDoc(gameRef(firestore, 'replay-team', gameId), {
                    type: 'game',
                    status: 'completed',
                    liveStatus: 'scheduled',
                    visibility: 'public',
                    updatedAt: nowTimestamp(),
                    ...extra
                });
            }
        });
        for (const gameId of ['flag-cancelled', 'flag-deleted', 'flag-is-deleted', 'practice-final']) {
            await assertFails(updateDoc(gameRef(videographerDb, 'replay-team', gameId), {
                replayVideo: canonicalReplay,
                updatedAt: nowTimestamp()
            }));
        }

        for (const aliasPatch of [
            { recordedVideo: { url: 'https://cdn.example/replay.mp4' } },
            { videoReplay: { src: 'https://cdn.example/replay.mp4' } },
            { replayVideoUrl: 'https://cdn.example/replay.mp4' },
            { recordedVideoUrl: 'https://cdn.example/replay.mp4' },
            { videoReplayUrl: 'https://cdn.example/replay.mp4' },
            { archivedVideoUrl: 'https://cdn.example/replay.mp4' },
            { replayVideoPublicUrl: 'https://video.example/replay' },
            { replayVideoPosterUrl: 'https://cdn.example/poster.jpg' },
            { replayVideoTitle: 'Injected replay' },
            { replayVideoDurationMs: 123_000 },
            { replayStatus: 'ready' },
            { recordedReplayStatus: 'processing' },
            { videoReplayStatus: 'failed' }
        ]) {
            await assertFails(updateDoc(completedRef, {
                ...aliasPatch,
                updatedAt: nowTimestamp()
            }));
            await assertFails(updateDoc(gameRef(videographerDb, 'videographer-team', 'videographer-game'), {
                ...aliasPatch,
                updatedAt: nowTimestamp()
            }));
        }

        for (const invalidReplay of [
            { ...canonicalReplay, provider: 'vimeo' },
            { ...canonicalReplay, videoId: 'too-short' },
            { ...canonicalReplay, embedUrl: 'https://evil.example/embed/0IuY8Oryi1k' },
            { ...canonicalReplay, publicUrl: 'https://youtu.be/0IuY8Oryi1k' },
            { ...canonicalReplay, linkedBy: 'attacker-1' },
            { ...canonicalReplay, linkedAt: '2026-08-30T12:00:00.000Z' },
            { ...canonicalReplay, title: 'x'.repeat(121) },
            { ...canonicalReplay, unexpected: true }
        ]) {
            await assertFails(updateDoc(completedRef, {
                replayVideo: invalidReplay,
                updatedAt: nowTimestamp()
            }));
        }

        await testEnv.withSecurityRulesDisabled(async (context) => {
            await updateDoc(gameRef(context.firestore(), 'replay-team', 'replay-game'), {
                status: 'FINAL',
                liveStatus: 'FINAL'
            });
        });
        await assertFails(updateDoc(completedRef, {
            replayVideo: canonicalReplay,
            updatedAt: nowTimestamp()
        }));

        await testEnv.withSecurityRulesDisabled(async (context) => {
            await updateDoc(doc(context.firestore(), 'teams/replay-team'), {
                'teamPermissions.videography.mode': 'disabled'
            });
        });
        await assertFails(updateDoc(completedRef, {
            replayVideo: canonicalReplay,
            updatedAt: nowTimestamp()
        }));
    });

    it('rejects replay mutations on shared schedule copies', async () => {
        const replay = {
            provider: 'youtube',
            videoId: '0IuY8Oryi1k',
            embedUrl: 'https://www.youtube.com/embed/0IuY8Oryi1k',
            publicUrl: 'https://www.youtube.com/watch?v=0IuY8Oryi1k',
            status: 'ready',
            linkedBy: 'videographer-1',
            linkedAt: nowTimestamp()
        };
        const videographerDb = authedDb('videographer-1', 'videographer@example.com');
        await assertFails(updateDoc(gameRef(videographerDb, 'shared-replay-team', 'shared-replay-game'), {
            replayVideo: replay,
            updatedAt: nowTimestamp()
        }));

        const ownerDb = authedDb('owner-1', 'owner@example.com');
        await assertFails(updateDoc(gameRef(ownerDb, 'shared-replay-team', 'shared-replay-game'), {
            replayVideo: { ...replay, linkedBy: 'owner-1' },
            updatedAt: nowTimestamp()
        }));
    });

    it('allows replay mutation after shared-schedule markers are detached to null', async () => {
        const videographerDb = authedDb('videographer-1', 'videographer@example.com');
        await assertSucceeds(updateDoc(gameRef(videographerDb, 'detached-replay-team', 'detached-game'), {
            replayVideo: {
                provider: 'youtube',
                videoId: '0IuY8Oryi1k',
                embedUrl: 'https://www.youtube.com/embed/0IuY8Oryi1k',
                publicUrl: 'https://www.youtube.com/watch?v=0IuY8Oryi1k',
                status: 'ready',
                linkedBy: 'videographer-1',
                linkedAt: nowTimestamp()
            },
            updatedAt: nowTimestamp()
        }));
    });
});
