import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { deleteDoc, deleteField, doc, getDoc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

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
                ['owner-1', 'owner@example.com', []],
                ['selected-1', 'selected@example.com', []],
                ['confirmed-1', 'confirmed@example.com', []],
                ['unrelated-1', 'unrelated@example.com', []],
                ['legacy-1', 'legacy@example.com', []],
                ['videographer-1', 'videographer@example.com', []],
                ['parent-1', 'parent@example.com', ['replay-team']]
            ];
            for (const [uid, email, parentTeamIds] of users) {
                await setDoc(doc(firestore, `users/${uid}`), { email, isAdmin: false, parentTeamIds });
            }
            await setDoc(doc(firestore, 'users/global-admin-1'), {
                email: 'global-admin@example.com',
                isAdmin: true,
                parentTeamIds: []
            });
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

    function privateReplayRef(firestore, teamId, gameId) {
        return doc(firestore, `teams/${teamId}/games/${gameId}/privateReplay/archive`);
    }

    function sharedPrivateReplayRef(firestore, teamId, gameId) {
        return doc(firestore, `teams/${teamId}/sharedGames/${gameId}/privateReplay/archive`);
    }

    function replayMigrationControlRef(firestore) {
        return doc(firestore, 'systemControls/replayPrivateArchiveMigration');
    }

    function replayProtectedIdentityRef(firestore, videoId = '0IuY8Oryi1k') {
        return doc(firestore, `replayProtectedIdentities/youtube:${videoId}`);
    }

    function replayClipIdentityRef(firestore, videoId = '0IuY8Oryi1k') {
        return doc(firestore, `replayClipIdentities/youtube:${videoId}`);
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

    it('denies every direct client replay mutation after the archive moves server-side', async () => {
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

        await assertFails(updateDoc(videographerRef, {
            replayVideo: firstReplay,
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(videographerRef, {
            replayVideo: replacementReplay,
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(videographerRef, {
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
        await assertFails(updateDoc(gameRef(ownerDb, 'replay-team', 'replay-game'), {
            replayVideo: { ...firstReplay, linkedBy: 'owner-1' },
            replayVideoFallbackDisabled: deleteField(),
            updatedAt: nowTimestamp()
        }));
    });

    it('keeps private replay archives unreadable and unwritable for every client role', async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const firestore = context.firestore();
            await setDoc(privateReplayRef(firestore, 'replay-team', 'replay-game'), {
                schemaVersion: 1,
                state: 'ready',
                provider: 'youtube',
                videoId: '0IuY8Oryi1k',
                revision: 'opaque-revision-1'
            });
            await updateDoc(gameRef(firestore, 'replay-team', 'replay-game'), {
                hasRecordedReplay: true,
                replayArchiveRevision: 'opaque-revision-1'
            });
            await setDoc(doc(firestore, 'teams/replay-team/sharedGames/shared-replay-game'), {
                type: 'game',
                status: 'completed',
                liveStatus: 'completed',
                visibility: 'public',
                hasRecordedReplay: true,
                replayArchiveRevision: 'opaque-shared-revision-1'
            });
            await setDoc(sharedPrivateReplayRef(firestore, 'replay-team', 'shared-replay-game'), {
                schemaVersion: 1,
                state: 'ready',
                provider: 'youtube',
                videoId: '0IuY8Oryi1k',
                revision: 'opaque-shared-revision-1'
            });
            await setDoc(replayMigrationControlRef(firestore), {
                schema: 'replay-private-archive-migration',
                status: 'ready',
                version: 1,
                attemptId: 'migration:seed'
            });
            await setDoc(replayProtectedIdentityRef(firestore), {
                schema: 'replay-protected-identity',
                version: 1,
                kind: 'youtube',
                videoId: '0IuY8Oryi1k'
            });
            await setDoc(replayClipIdentityRef(firestore), {
                schema: 'replay-clip-identity',
                version: 1,
                kind: 'youtube',
                videoId: '0IuY8Oryi1k'
            });
        });

        for (const [uid, email] of [
            ['owner-1', 'owner@example.com'],
            ['videographer-1', 'videographer@example.com'],
            ['parent-1', 'parent@example.com'],
            ['unrelated-1', 'unrelated@example.com']
        ]) {
            const firestore = authedDb(uid, email);
            const archiveRef = privateReplayRef(firestore, 'replay-team', 'replay-game');
            await assertFails(getDoc(archiveRef));
            await assertFails(setDoc(archiveRef, {
                schemaVersion: 1,
                state: 'ready',
                provider: 'youtube',
                videoId: 'dQw4w9WgXcQ',
                revision: 'forged-revision'
            }));
            const sharedArchiveRef = sharedPrivateReplayRef(
                firestore,
                'replay-team',
                'shared-replay-game'
            );
            await assertFails(getDoc(sharedArchiveRef));
            await assertFails(setDoc(sharedArchiveRef, {
                schemaVersion: 1,
                state: 'ready',
                provider: 'youtube',
                videoId: 'dQw4w9WgXcQ',
                revision: 'forged-shared-revision'
            }));
            const controlRef = replayMigrationControlRef(firestore);
            await assertFails(getDoc(controlRef));
            await assertFails(setDoc(controlRef, {
                schema: 'replay-private-archive-migration',
                status: 'ready',
                version: 1,
                attemptId: 'migration:forged'
            }));
            const identityRef = replayProtectedIdentityRef(firestore);
            await assertFails(getDoc(identityRef));
            await assertFails(setDoc(identityRef, {
                schema: 'replay-protected-identity',
                version: 1,
                kind: 'youtube',
                videoId: '0IuY8Oryi1k'
            }));
            const clipIdentityRef = replayClipIdentityRef(firestore);
            await assertFails(getDoc(clipIdentityRef));
            await assertFails(setDoc(clipIdentityRef, {
                schema: 'replay-clip-identity',
                version: 1,
                kind: 'youtube',
                videoId: '0IuY8Oryi1k'
            }));
        }

        const ownerGameRef = gameRef(authedDb('owner-1', 'owner@example.com'), 'replay-team', 'replay-game');
        await assertFails(updateDoc(ownerGameRef, { hasRecordedReplay: false, updatedAt: nowTimestamp() }));
        await assertFails(updateDoc(ownerGameRef, { replayArchiveRevision: 'forged-revision', updatedAt: nowTimestamp() }));

        const parentGame = await assertSucceeds(getDoc(gameRef(
            authedDb('parent-1', 'parent@example.com'),
            'replay-team',
            'replay-game'
        )));
        const parentGameData = parentGame.data();
        expect(parentGameData.hasRecordedReplay).toBe(true);
        expect(parentGameData.replayArchiveRevision).toBe('opaque-revision-1');
        expect(parentGameData).not.toHaveProperty('replayVideo');
        expect(parentGameData).not.toHaveProperty('videoId');
    });

    it('prevents a readable live URL from becoming a completed replay fallback', async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const firestore = context.firestore();
            for (const terminalStatus of ['completed', 'final', 'complete', 'finished']) {
                await seedTeamAndGame(firestore, 'replay-team', `active-video-fallback-${terminalStatus}`, {}, {
                    status: 'scheduled',
                    liveStatus: 'live',
                    videoUrl: 'https://www.youtube.com/watch?v=0IuY8Oryi1k'
                });
            }
        });
        const ownerDb = authedDb('owner-1', 'owner@example.com');
        for (const terminalStatus of ['completed', 'final', 'complete', 'finished']) {
            const ref = gameRef(ownerDb, 'replay-team', `active-video-fallback-${terminalStatus}`);
            await assertSucceeds(updateDoc(ref, {
                summary: 'The legacy public live source remains unchanged.',
                updatedAt: nowTimestamp()
            }));
            await assertFails(updateDoc(ref, {
                status: terminalStatus,
                liveStatus: 'scheduled',
                updatedAt: nowTimestamp()
            }));
        }

        const ref = gameRef(ownerDb, 'replay-team', 'active-video-fallback-completed');
        await assertSucceeds(updateDoc(ref, {
            videoUrl: deleteField(),
            status: 'completed',
            liveStatus: 'scheduled',
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(ref, {
            videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            updatedAt: nowTimestamp()
        }));
    });

    it('rejects broadcast provider capabilities on create, dedicated updates, and mixed owner updates', async () => {
        const ownerDb = authedDb('owner-1', 'owner@example.com');
        const unsafeProvider = {
            type: 'youtube',
            name: 'YouTube',
            videoId: '0IuY8Oryi1k',
            embedUrl: 'https://www.youtube.com/embed/0IuY8Oryi1k'
        };
        await assertFails(setDoc(gameRef(ownerDb, 'replay-team', 'provider-create'), {
            type: 'game',
            status: 'scheduled',
            liveStatus: 'scheduled',
            broadcastSession: readySession({ provider: unsafeProvider }),
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(gameRef(ownerDb, 'replay-team', 'replay-game'), {
            broadcastSession: readySession({ provider: unsafeProvider }),
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(gameRef(ownerDb, 'replay-team', 'replay-game'), {
            summary: 'Mixed update must not bypass the provider boundary.',
            broadcastSession: readySession({ provider: unsafeProvider }),
            updatedAt: nowTimestamp()
        }));
        await assertSucceeds(updateDoc(gameRef(ownerDb, 'replay-team', 'replay-game'), {
            broadcastSession: readySession({
                provider: { type: 'youtube', name: 'YouTube', channel: 'team-channel' }
            }),
            updatedAt: nowTimestamp()
        }));
    });

    it('grandfathers historical game stream aliases while making them server-migration-only', async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await seedTeamAndGame(context.firestore(), 'replay-team', 'legacy-game-stream-aliases', {}, {
                streamEmbedUrl: 'https://www.youtube.com/embed/0IuY8Oryi1k',
                youtubeEmbedUrl: 'https://www.youtube.com/embed/0IuY8Oryi1k',
                youtubeVideoId: '0IuY8Oryi1k'
            });
        });
        const ownerDb = authedDb('owner-1', 'owner@example.com');
        const ref = gameRef(ownerDb, 'replay-team', 'legacy-game-stream-aliases');
        await assertSucceeds(updateDoc(ref, {
            summary: 'Existing public stream remains unchanged.',
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(ref, {
            youtubeVideoId: 'dQw4w9WgXcQ',
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(gameRef(ownerDb, 'replay-team', 'replay-game'), {
            streamEmbedUrl: 'https://www.youtube.com/embed/dQw4w9WgXcQ',
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(ref, {
            streamEmbedUrl: deleteField(),
            youtubeEmbedUrl: deleteField(),
            youtubeVideoId: deleteField(),
            updatedAt: nowTimestamp()
        }));
    });

    it('blocks deletion until readable replay identities are migrated', async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const firestore = context.firestore();
            await seedTeamAndGame(firestore, 'delete-replay-team', 'raw-replay-game', {}, {
                status: 'completed',
                liveStatus: 'completed',
                replayVideoUrl: 'https://www.youtube.com/watch?v=0IuY8Oryi1k'
            });
            await seedTeamAndGame(firestore, 'delete-replay-team', 'terminal-video-game', {}, {
                status: 'finished',
                liveStatus: 'scheduled',
                videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
            });
            await seedTeamAndGame(firestore, 'delete-replay-team', 'migrated-marker-game', {}, {
                status: 'complete',
                liveStatus: 'scheduled',
                hasRecordedReplay: true,
                replayArchiveRevision: 'opaque-migrated-revision'
            });
            await setDoc(privateReplayRef(firestore, 'delete-replay-team', 'migrated-marker-game'), {
                schemaVersion: 1,
                state: 'ready',
                provider: 'youtube',
                videoId: '0IuY8Oryi1k',
                revision: 'opaque-migrated-revision'
            });
        });

        const ownerDb = authedDb('owner-1', 'owner@example.com');
        await assertFails(deleteDoc(gameRef(ownerDb, 'delete-replay-team', 'raw-replay-game')));
        await assertFails(deleteDoc(gameRef(ownerDb, 'delete-replay-team', 'terminal-video-game')));
        await assertSucceeds(deleteDoc(gameRef(ownerDb, 'delete-replay-team', 'migrated-marker-game')));
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
        for (const markerPatch of [
            { hasRecordedReplay: true },
            { hasReplayVideo: true },
            { replayArchiveRevision: 'forged-revision' },
            { replayArchiveState: 'ready' },
            { replayMediaVersion: 1 },
            { replayMediaState: 'ready' },
            { replayMediaRevision: 'forged-revision' }
        ]) {
            await assertFails(setDoc(gameRef(ownerDb, 'replay-team', `marker-${Object.keys(markerPatch)[0]}`), {
                ...baseGame,
                ...markerPatch
            }));
        }
        await assertFails(setDoc(gameRef(ownerDb, 'replay-team', 'completed-video-url-create'), {
            ...baseGame,
            status: 'completed',
            liveStatus: 'scheduled',
            videoUrl: 'https://www.youtube.com/watch?v=0IuY8Oryi1k'
        }));
        await assertFails(setDoc(gameRef(ownerDb, 'replay-team', 'active-video-url-create'), {
            ...baseGame,
            liveStatus: 'live',
            videoUrl: 'https://www.youtube.com/embed/live_stream?channel=UC123'
        }));
        for (const [field, value] of [
            ['streamEmbedUrl', 'https://www.youtube.com/embed/0IuY8Oryi1k'],
            ['youtubeEmbedUrl', 'https://www.youtube.com/embed/0IuY8Oryi1k'],
            ['youtubeVideoId', '0IuY8Oryi1k']
        ]) {
            await assertFails(setDoc(gameRef(ownerDb, 'replay-team', `fixed-video-${field}`), {
                ...baseGame,
                [field]: value
            }));
        }
    });

    it('freezes every replay clip container and server mutation marker on game create and update', async () => {
        const fields = [
            'highlightClips',
            'clipRecords',
            'gameClips',
            'videoClips',
            'clips',
            'mediaClips',
            'clipMetadata',
            'replayHighlights',
            'highlightClipsRevision',
            'highlightClipsLastMutationId'
        ];
        const baseGame = {
            type: 'game',
            status: 'scheduled',
            liveStatus: 'scheduled',
            visibility: 'public',
            updatedAt: nowTimestamp()
        };
        const ownerDb = authedDb('owner-1', 'owner@example.com');
        const globalAdminDb = authedDb('global-admin-1', 'global-admin@example.com');
        const videographerDb = authedDb('videographer-1', 'videographer@example.com');

        for (const [index, field] of fields.entries()) {
            const value = field.startsWith('highlightClipsR') || field.endsWith('MutationId')
                ? `forged-${field}`
                : [{ mediaUrl: 'https://cdn.example.test/clip.mp4' }];
            await assertFails(setDoc(gameRef(ownerDb, 'replay-team', `owner-clip-create-${index}`), {
                ...baseGame,
                [field]: value
            }));
            await assertFails(setDoc(gameRef(globalAdminDb, 'replay-team', `admin-clip-create-${index}`), {
                ...baseGame,
                [field]: value
            }));
            await assertFails(updateDoc(gameRef(ownerDb, 'replay-team', 'replay-game'), {
                [field]: value,
                updatedAt: nowTimestamp()
            }));
            await assertFails(updateDoc(gameRef(videographerDb, 'replay-team', 'replay-game'), {
                [field]: value,
                updatedAt: nowTimestamp()
            }));
        }

        await assertSucceeds(updateDoc(gameRef(ownerDb, 'replay-team', 'replay-game'), {
            summary: 'An unrelated manager edit remains available.',
            updatedAt: nowTimestamp()
        }));
    });

    it('requires the server migration to replace historical replay aliases', async () => {
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
        await assertFails(updateDoc(gameRef(videographerDb, 'replay-team', 'replay-game'), {
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

    it('still denies direct replay writes for legacy null-compatible final lifecycles', async () => {
        const videographerDb = authedDb('videographer-1', 'videographer@example.com');
        for (const [teamId, gameId] of [
            ['nullable-status-replay-team', 'status-only-game'],
            ['nullable-live-replay-team', 'live-only-game']
        ]) {
            await assertFails(updateDoc(gameRef(videographerDb, teamId, gameId), {
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

    it('denies manager and videographer direct unlink after lifecycle corrections', async () => {
        const ownerDb = authedDb('owner-1', 'owner@example.com');
        const videographerDb = authedDb('videographer-1', 'videographer@example.com');
        const ref = gameRef(ownerDb, 'replay-team', 'replay-game');
        await assertFails(updateDoc(ref, {
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
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await updateDoc(gameRef(context.firestore(), 'replay-team', 'replay-game'), {
                hasRecordedReplay: true,
                replayArchiveRevision: 'r:ready-lifecycle',
                updatedAt: nowTimestamp()
            });
            await setDoc(privateReplayRef(context.firestore(), 'replay-team', 'replay-game'), {
                schemaVersion: 1,
                state: 'ready',
                revision: 'r:ready-lifecycle',
                provider: 'youtube',
                videoId: '0IuY8Oryi1k',
                protectedVideoIdHashes: []
            });
        });
        await assertFails(updateDoc(ref, {
            status: 'scheduled',
            liveStatus: 'scheduled',
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(gameRef(videographerDb, 'replay-team', 'replay-game'), {
            replayVideo: null,
            replayVideoFallbackDisabled: true,
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(ref, {
            status: 'cancelled',
            liveStatus: 'cancelled',
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(gameRef(videographerDb, 'replay-team', 'replay-game'), {
            replayVideo: null,
            replayVideoFallbackDisabled: true,
            updatedAt: nowTimestamp()
        }));
        await assertFails(updateDoc(ref, {
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

    it('keeps detached games on the server-only replay mutation path', async () => {
        const videographerDb = authedDb('videographer-1', 'videographer@example.com');
        await assertFails(updateDoc(gameRef(videographerDb, 'detached-replay-team', 'detached-game'), {
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
