import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
    collection,
    doc,
    getDoc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
    updateDoc,
    where
} from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('public canonical Firestore data boundary', () => {
    let testEnv;

    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: `allplays-public-boundary-${Date.now()}`,
            firestore: { rules }
        });
    }, 30_000);

    beforeEach(async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const firestore = context.firestore();
            await setDoc(doc(firestore, 'teams/public-team'), {
                name: 'Public Falcons',
                isPublic: true,
                active: true,
                ownerId: 'owner-1',
                ownerEmail: 'owner@example.com',
                adminEmails: ['owner@example.com'],
                notificationEmail: 'private-notifications@example.com',
                streamAccessMode: 'selected_volunteers',
                streamVolunteerEmails: ['legacy-streamer@example.com'],
                teamPermissions: {
                    scorekeeping: { mode: 'selected', memberIds: ['scorekeeper-1'] },
                    videography: { mode: 'selected', memberIds: ['videographer-1'] },
                    streaming: { mode: 'selected', memberIds: ['streamer-1'] },
                    teamMediaManagement: { mode: 'selected', memberIds: ['media-1'] }
                }
            });
            await setDoc(doc(firestore, 'teams/public-team/games/game-1'), {
                type: 'game',
                visibility: 'public',
                status: 'scheduled',
                liveStatus: 'scheduled',
                notes: 'private coach notes',
                assignments: [{ email: 'volunteer@example.com' }],
                officiatingAuthorizedUserIds: ['official-1'],
                officiatingAuthorizedEmails: ['official@example.com']
            });
            await setDoc(doc(firestore, 'teams/public-team/games/game-2'), {
                type: 'game',
                visibility: 'public',
                status: 'scheduled',
                liveStatus: 'scheduled'
            });
            await setDoc(doc(firestore, 'teams/public-team/games/game-2/rsvps/confirmed-scorekeeper'), {
                response: 'confirmed'
            });
            await setDoc(doc(firestore, 'teams/public-team/games/game-1/liveEvents/event-1'), {
                type: 'score',
                points: 1
            });
            await setDoc(doc(firestore, 'tournaments/tournament-1/sharedGames/shared-1'), {
                type: 'game',
                visibility: 'public',
                status: 'scheduled',
                liveStatus: 'scheduled',
                homeTeamId: 'public-team',
                awayTeamId: 'other-team',
                notes: 'private shared notes'
            });
            await setDoc(doc(firestore, 'tournaments/tournament-1/sharedGames/shared-1/liveEvents/event-1'), {
                type: 'score',
                points: 1
            });
            await setDoc(doc(firestore, 'users/parent-1'), {
                parentTeamIds: ['public-team'],
                parentPlayerKeys: ['public-team::player-1']
            });
            for (const uid of [
                'owner-1',
                'scorekeeper-1',
                'videographer-1',
                'streamer-1',
                'media-1',
                'official-1',
                'legacy-streamer',
                'confirmed-scorekeeper',
                'admin-1',
                'unrelated-1'
            ]) {
                await setDoc(doc(firestore, `users/${uid}`), {
                    isAdmin: uid === 'admin-1',
                    parentTeamIds: [],
                    parentPlayerKeys: []
                });
            }
        });
    });

    afterAll(async () => {
        await testEnv?.cleanup();
    });

    function authedDb(uid, email = `${uid}@example.com`) {
        return testEnv.authenticatedContext(uid, { email }).firestore();
    }

    it('denies anonymous and unrelated reads of public canonical team and game documents', async () => {
        const anonymousDb = testEnv.unauthenticatedContext().firestore();
        const unrelatedDb = authedDb('unrelated-1');
        await assertFails(getDoc(doc(anonymousDb, 'teams/public-team')));
        await assertFails(getDoc(doc(anonymousDb, 'teams/public-team/games/game-1')));
        await assertFails(getDoc(doc(unrelatedDb, 'teams/public-team')));
        await assertFails(getDoc(doc(unrelatedDb, 'teams/public-team/games/game-1')));
        await assertFails(getDocs(query(collection(anonymousDb, 'teams'), where('isPublic', '==', true))));
    });

    it('preserves canonical reads for managers, parents, scoped helpers, and assigned officials', async () => {
        for (const [uid, email] of [
            ['owner-1', 'owner@example.com'],
            ['parent-1', 'parent@example.com'],
            ['scorekeeper-1', 'scorekeeper-1@example.com'],
            ['videographer-1', 'videographer-1@example.com'],
            ['streamer-1', 'streamer-1@example.com'],
            ['media-1', 'media-1@example.com'],
            ['legacy-streamer', 'legacy-streamer@example.com']
        ]) {
            try {
                await assertSucceeds(getDoc(doc(authedDb(uid, email), 'teams/public-team')));
            } catch (error) {
                throw new Error(`Expected ${uid} to read the team document: ${error.message}`);
            }
        }

        for (const [uid, email] of [
            ['owner-1', 'owner@example.com'],
            ['parent-1', 'parent@example.com'],
            ['scorekeeper-1', 'scorekeeper-1@example.com'],
            ['videographer-1', 'videographer-1@example.com'],
            ['streamer-1', 'streamer-1@example.com'],
            ['official-1', 'official@example.com']
        ]) {
            try {
                await assertSucceeds(getDoc(doc(authedDb(uid, email), 'teams/public-team/games/game-1')));
            } catch (error) {
                throw new Error(`Expected ${uid} to read the game document: ${error.message}`);
            }
        }
    });

    it('preserves canonical game reads for confirmed videographers in all-confirmed mode', async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const firestore = context.firestore();
            await updateDoc(doc(firestore, 'teams/public-team'), {
                'teamPermissions.videography.mode': 'all_confirmed',
                'teamPermissions.videography.memberIds': []
            });
            await setDoc(doc(firestore, 'users/confirmed-videographer'), {
                isAdmin: false,
                parentTeamIds: [],
                parentPlayerKeys: []
            });
            await setDoc(doc(firestore, 'teams/public-team/games/game-1/rsvps/confirmed-videographer'), {
                response: 'confirmed'
            });
        });

        const confirmedVideographerDb = authedDb('confirmed-videographer');
        await assertSucceeds(getDoc(doc(confirmedVideographerDb, 'teams/public-team/games/game-1')));
        await assertFails(getDoc(doc(authedDb('unrelated-1'), 'teams/public-team/games/game-1')));
    });

    it('keeps intended public live-event reads without exposing the containing game document', async () => {
        const anonymousDb = testEnv.unauthenticatedContext().firestore();
        await assertSucceeds(getDoc(doc(anonymousDb, 'teams/public-team/games/game-1/liveEvents/event-1')));
        await assertFails(getDoc(doc(anonymousDb, 'tournaments/tournament-1/sharedGames/shared-1')));
        await assertSucceeds(getDoc(doc(
            anonymousDb,
            'tournaments/tournament-1/sharedGames/shared-1/liveEvents/event-1'
        )));
    });

    it('preserves scorekeeper writes while blocking unrelated writes', async () => {
        const scorekeeperDb = authedDb('scorekeeper-1');
        const unrelatedDb = authedDb('unrelated-1');
        await assertSucceeds(updateDoc(doc(scorekeeperDb, 'teams/public-team/games/game-1'), {
            homeScore: 1
        }));
        await assertFails(updateDoc(doc(unrelatedDb, 'teams/public-team/games/game-1'), {
            homeScore: 99
        }));
    });

    it('denies delegated scorekeepers destructive game lifecycle updates', async () => {
        const gameRef = doc(authedDb('scorekeeper-1'), 'teams/public-team/games/game-1');
        for (const field of ['status', 'liveStatus']) {
            for (const value of ['deleted', 'cancelled', 'canceled']) {
                await assertFails(updateDoc(gameRef, { [field]: value }));
            }
        }
    });

    it('requires delegated completion attribution to identify the scorekeeper on a completion transition', async () => {
        const gameRef = doc(authedDb('scorekeeper-1'), 'teams/public-team/games/game-1');
        await assertFails(updateDoc(gameRef, {
            status: 'completed',
            liveStatus: 'completed',
            completedBy: 'unrelated-1',
            completedAt: serverTimestamp()
        }));
        await assertFails(updateDoc(gameRef, {
            completedBy: 'scorekeeper-1',
            completedAt: serverTimestamp()
        }));
        await assertFails(updateDoc(gameRef, {
            status: 'completed',
            liveStatus: 'completed',
            completedBy: 'scorekeeper-1',
            completedAt: new Date(0)
        }));
    });

    it('allows score-only and supported completion updates for selected and confirmed scorekeepers', async () => {
        const selectedGameRef = doc(authedDb('scorekeeper-1'), 'teams/public-team/games/game-1');
        await assertSucceeds(updateDoc(selectedGameRef, {
            homeScore: 2,
            awayScore: 1
        }));
        await assertSucceeds(updateDoc(selectedGameRef, {
            status: 'completed',
            liveStatus: 'completed'
        }));

        await testEnv.withSecurityRulesDisabled(async (context) => {
            await updateDoc(doc(context.firestore(), 'teams/public-team'), {
                'teamPermissions.scorekeeping.mode': 'all_confirmed',
                'teamPermissions.scorekeeping.memberIds': []
            });
        });
        const confirmedGameRef = doc(authedDb('confirmed-scorekeeper'), 'teams/public-team/games/game-2');
        await assertSucceeds(updateDoc(confirmedGameRef, {
            homeScore: 3,
            awayScore: 2
        }));
        await assertSucceeds(updateDoc(confirmedGameRef, {
            status: 'completed',
            liveStatus: 'completed',
            completedBy: 'confirmed-scorekeeper',
            completedAt: serverTimestamp()
        }));
    });

    it('retains owner and administrator lifecycle authority denied to delegated scorekeepers', async () => {
        for (const [uid, email, gameId] of [
            ['owner-1', 'owner@example.com', 'game-1'],
            ['admin-1', 'admin-1@example.com', 'game-2']
        ]) {
            const gameRef = doc(authedDb(uid, email), `teams/public-team/games/${gameId}`);
            for (const field of ['status', 'liveStatus']) {
                for (const value of ['deleted', 'cancelled', 'canceled']) {
                    await assertSucceeds(updateDoc(gameRef, { [field]: value }));
                }
            }
        }
    });
});
