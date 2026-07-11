import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

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

    it('denies private non-shareable games while allowing explicitly shareable game metadata', async () => {
        const selectedDb = authedDb('selected-1', 'selected@example.com');
        await assertFails(getDoc(gameRef(selectedDb, 'private-team', 'private-game')));
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
});
