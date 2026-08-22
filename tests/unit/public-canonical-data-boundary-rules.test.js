import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
    collection,
    deleteField,
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
                adminEmails: ['owner@example.com', 'team-admin@example.com'],
                notificationEmail: 'private-notifications@example.com',
                streamAccessMode: 'selected_volunteers',
                streamVolunteerEmails: ['legacy-streamer@example.com'],
                teamPermissions: {
                    scorekeeping: { mode: 'selected', memberIds: ['scorekeeper-1', 'scorekeeper-2'] },
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
            await setDoc(doc(firestore, 'teams/public-team/games/private-officiating-game'), {
                type: 'game',
                visibility: 'private',
                status: 'scheduled',
                liveStatus: 'scheduled',
                officiatingAuthorizedUserIds: ['official-1'],
                officiatingAuthorizedEmails: ['official@example.com']
            });
            await setDoc(doc(firestore, 'teams/public-team/games/game-2/rsvps/confirmed-scorekeeper'), {
                response: 'confirmed'
            });
            await setDoc(doc(firestore, 'teams/public-team/games/game-1/liveEvents/event-1'), {
                type: 'score',
                points: 1
            });
            await setDoc(doc(
                firestore,
                'teams/public-team/games/private-officiating-game/events/private-event-1'
            ), {
                type: 'score',
                points: 1
            });
            await setDoc(doc(firestore, 'teams/public-team/officiatingNotifications/notification-1'), {
                recipientOfficialUserId: 'official-1',
                recipientOfficialEmail: 'official@example.com',
                type: 'officiating_assignment'
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
                'team-admin-1',
                'scorekeeper-1',
                'scorekeeper-2',
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

    function authedDb(uid, email = `${uid}@example.com`, emailVerified = true) {
        return testEnv.authenticatedContext(uid, {
            email,
            email_verified: emailVerified
        }).firestore();
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

    it('preserves canonical team reads for managers and parents while denying scoped helpers', async () => {
        for (const [uid, email] of [
            ['owner-1', 'owner@example.com'],
            ['team-admin-1', 'team-admin@example.com'],
            ['parent-1', 'parent@example.com'],
            ['admin-1', 'admin-1@example.com']
        ]) {
            try {
                await assertSucceeds(getDoc(doc(authedDb(uid, email), 'teams/public-team')));
            } catch (error) {
                throw new Error(`Expected ${uid} to read the team document: ${error.message}`);
            }
        }

        for (const [uid, email] of [
            ['scorekeeper-1', 'scorekeeper-1@example.com'],
            ['videographer-1', 'videographer-1@example.com'],
            ['streamer-1', 'streamer-1@example.com'],
            ['media-1', 'media-1@example.com'],
            ['legacy-streamer', 'legacy-streamer@example.com']
        ]) {
            try {
                await assertFails(getDoc(doc(authedDb(uid, email), 'teams/public-team')));
            } catch (error) {
                throw new Error(`Expected ${uid} to be denied the team document: ${error.message}`);
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

    it('denies unverified email-only officials game, protected event, notification, and update access', async () => {
        const unverifiedOfficialDb = authedDb('email-only-official', 'official@example.com', false);
        const gameRef = doc(unverifiedOfficialDb, 'teams/public-team/games/private-officiating-game');

        await assertFails(getDoc(gameRef));
        await assertFails(getDoc(doc(
            unverifiedOfficialDb,
            'teams/public-team/games/private-officiating-game/events/private-event-1'
        )));
        await assertFails(getDoc(doc(
            unverifiedOfficialDb,
            'teams/public-team/officiatingNotifications/notification-1'
        )));

        for (const update of [
            { homeScore: 7 },
            { status: 'completed' },
            { liveStatus: 'live' },
            { officiatingSlots: [] },
            { officiatingCoverageStatus: 'covered' }
        ]) {
            await assertFails(updateDoc(gameRef, update));
        }
    });

    it('preserves verified email-derived officiating access', async () => {
        const verifiedOfficialDb = authedDb('email-only-official', 'official@example.com', true);
        const gameRef = doc(verifiedOfficialDb, 'teams/public-team/games/private-officiating-game');

        await assertSucceeds(getDoc(gameRef));
        await assertSucceeds(getDoc(doc(
            verifiedOfficialDb,
            'teams/public-team/games/private-officiating-game/events/private-event-1'
        )));
        await assertSucceeds(getDoc(doc(
            verifiedOfficialDb,
            'teams/public-team/officiatingNotifications/notification-1'
        )));
        await assertSucceeds(updateDoc(gameRef, { homeScore: 2 }));
    });

    it('preserves UID-derived officiating access without a verified email claim', async () => {
        const uidAssignedOfficialDb = authedDb('official-1', 'other@example.com', false);
        const gameRef = doc(uidAssignedOfficialDb, 'teams/public-team/games/private-officiating-game');

        await assertSucceeds(getDoc(gameRef));
        await assertSucceeds(getDoc(doc(
            uidAssignedOfficialDb,
            'teams/public-team/games/private-officiating-game/events/private-event-1'
        )));
        await assertSucceeds(getDoc(doc(
            uidAssignedOfficialDb,
            'teams/public-team/officiatingNotifications/notification-1'
        )));
        await assertSucceeds(updateDoc(gameRef, { awayScore: 1 }));
    });

    it('preserves team-manager and platform-admin access to private officiating records', async () => {
        for (const [uid, email] of [
            ['team-admin-1', 'team-admin@example.com'],
            ['admin-1', 'admin-1@example.com']
        ]) {
            const authorizedDb = authedDb(uid, email);
            const gameRef = doc(authorizedDb, 'teams/public-team/games/private-officiating-game');

            await assertSucceeds(getDoc(gameRef));
            await assertSucceeds(getDoc(doc(
                authorizedDb,
                'teams/public-team/games/private-officiating-game/events/private-event-1'
            )));
            await assertSucceeds(getDoc(doc(
                authorizedDb,
                'teams/public-team/officiatingNotifications/notification-1'
            )));
            await assertSucceeds(updateDoc(gameRef, { homeScore: uid === 'admin-1' ? 4 : 3 }));
        }
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
            for (const value of ['deleted', 'cancelled', 'canceled', 'archived', null, 1]) {
                await assertFails(updateDoc(gameRef, { [field]: value }));
            }
        }
    });

    it('denies delegated scorekeepers deletion of either canonical lifecycle field', async () => {
        const gameRef = doc(authedDb('scorekeeper-1'), 'teams/public-team/games/game-1');
        for (const field of ['status', 'liveStatus']) {
            await assertFails(updateDoc(gameRef, { [field]: deleteField() }));
        }
    });

    it('preserves delegated score updates for legacy games that never had lifecycle fields', async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'teams/public-team/games/legacy-game'), {
                type: 'game',
                visibility: 'public'
            });
        });

        const legacyGameRef = doc(authedDb('scorekeeper-1'), 'teams/public-team/games/legacy-game');
        await assertSucceeds(updateDoc(legacyGameRef, { homeScore: 1 }));
    });

    it('denies delegated score and lifecycle updates when an existing lifecycle value is unsupported', async () => {
        const gameRef = doc(authedDb('scorekeeper-1'), 'teams/public-team/games/game-1');
        for (const field of ['status', 'liveStatus']) {
            const otherField = field === 'status' ? 'liveStatus' : 'status';
            for (const value of ['deleted', 'cancelled', 'canceled', 'archived']) {
                await testEnv.withSecurityRulesDisabled(async (context) => {
                    await updateDoc(doc(context.firestore(), 'teams/public-team/games/game-1'), {
                        status: field === 'status' ? value : 'scheduled',
                        liveStatus: field === 'liveStatus' ? value : 'scheduled'
                    });
                });

                await assertFails(updateDoc(gameRef, { homeScore: 9 }));
                await assertFails(updateDoc(gameRef, { [otherField]: 'completed' }));
            }
        }
    });

    it('requires delegated completion attribution to identify the scorekeeper on a completion transition', async () => {
        const gameRef = doc(authedDb('scorekeeper-1'), 'teams/public-team/games/game-1');
        await assertFails(updateDoc(gameRef, {
            status: 'completed',
            liveStatus: 'completed'
        }));
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
            liveStatus: 'completed',
            completedBy: 'scorekeeper-1',
            completedAt: serverTimestamp()
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

    it('preserves delegated completion attribution across a second partial transition', async () => {
        const firstScorekeeperRef = doc(authedDb('scorekeeper-1'), 'teams/public-team/games/game-1');
        await assertSucceeds(updateDoc(firstScorekeeperRef, {
            status: 'completed',
            completedBy: 'scorekeeper-1',
            completedByName: 'First Scorekeeper',
            completedAt: serverTimestamp()
        }));

        const secondScorekeeperRef = doc(authedDb('scorekeeper-2'), 'teams/public-team/games/game-1');
        await assertFails(updateDoc(secondScorekeeperRef, {
            liveStatus: 'completed',
            completedBy: 'scorekeeper-2',
            completedByName: 'Second Scorekeeper',
            completedAt: serverTimestamp()
        }));
        await assertSucceeds(updateDoc(secondScorekeeperRef, {
            liveStatus: 'completed'
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
