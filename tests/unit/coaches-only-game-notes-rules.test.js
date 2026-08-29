import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
    collection,
    deleteDoc,
    doc,
    getDoc,
    getDocs,
    serverTimestamp,
    setDoc,
    Timestamp
} from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

describe('coaches-only game note rules contract', () => {
    it('keeps direct and shared notes behind exact manager-only document rules', () => {
        expect(rules).toContain('match /coachNotes/main {');
        expect(rules).toContain('match /organizations/{organizationId}/sharedGames/{gameId}/coachNotes/{teamId} {');
        expect(rules).toContain('match /tournaments/{tournamentId}/sharedGames/{gameId}/coachNotes/{teamId} {');
        expect(rules).toContain('function isSharedGameTeamManager(sharedGamePath, teamId)');
        expect(rules).toContain("data.keys().hasOnly(['text', 'updatedAt', 'updatedBy'])");
        expect(rules).toContain('data.text.size() <= 5000');
        expect(rules).toContain('data.updatedAt == request.time');
        expect(rules).toContain('data.updatedBy == request.auth.uid');
        expect(rules).toContain('allow list: if false;');
    });
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('coaches-only game note Firestore boundary', () => {
    let testEnv;

    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: `allplays-coaches-only-notes-${Date.now()}`,
            firestore: { rules }
        });
    }, 30_000);

    beforeEach(async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const firestore = context.firestore();
            await setDoc(doc(firestore, 'teams/team-1'), {
                ownerId: 'owner-1',
                adminEmails: ['team-admin@example.com'],
                teamPermissions: {
                    scorekeeping: { mode: 'selected', memberIds: ['scorekeeper-1'] },
                    videography: { mode: 'selected', memberIds: ['videographer-1'] },
                    streaming: { mode: 'selected', memberIds: ['streamer-1'] }
                }
            });
            await setDoc(doc(firestore, 'teams/team-2'), {
                ownerId: 'other-owner',
                adminEmails: []
            });
            await setDoc(doc(firestore, 'teams/team-1/games/game-1'), {
                type: 'game',
                status: 'scheduled',
                liveStatus: 'scheduled',
                officiatingAuthorizedUserIds: ['official-1'],
                officiatingAuthorizedEmails: ['official@example.com']
            });
            await setDoc(doc(firestore, 'teams/team-1/games/game-2'), {
                type: 'game',
                status: 'scheduled',
                liveStatus: 'scheduled'
            });
            await setDoc(doc(firestore, 'teams/team-1/games/game-1/coachNotes/main'), {
                text: 'Private shape and matchup notes',
                updatedAt: Timestamp.fromMillis(1_720_000_000_000),
                updatedBy: 'owner-1'
            });
            for (const path of [
                'organizations/org-1/sharedGames/shared-game-1',
                'tournaments/tournament-1/sharedGames/shared-game-2'
            ]) {
                await setDoc(doc(firestore, path), {
                    type: 'game',
                    status: 'scheduled',
                    homeTeamId: 'team-1',
                    awayTeamId: 'team-2'
                });
                await setDoc(doc(firestore, `${path}/coachNotes/team-1`), {
                    text: 'Team one shared-game plan',
                    updatedAt: Timestamp.fromMillis(1_720_000_000_000),
                    updatedBy: 'owner-1'
                });
                await setDoc(doc(firestore, `${path}/coachNotes/team-2`), {
                    text: 'Team two shared-game plan',
                    updatedAt: Timestamp.fromMillis(1_720_000_000_000),
                    updatedBy: 'other-owner'
                });
            }
            await setDoc(doc(firestore, 'users/parent-1'), {
                isAdmin: false,
                parentTeamIds: ['team-1'],
                parentPlayerKeys: ['team-1::player-1']
            });
            for (const uid of [
                'owner-1',
                'team-admin-1',
                'scorekeeper-1',
                'videographer-1',
                'streamer-1',
                'official-1',
                'legacy-coach-1',
                'unrelated-1',
                'other-owner'
            ]) {
                await setDoc(doc(firestore, `users/${uid}`), {
                    isAdmin: false,
                    parentTeamIds: [],
                    parentPlayerKeys: []
                }, { merge: true });
            }
            await setDoc(doc(firestore, 'users/platform-admin-1'), {
                isAdmin: true,
                parentTeamIds: [],
                parentPlayerKeys: []
            });
            await setDoc(doc(firestore, 'users/legacy-coach-1'), {
                isAdmin: false,
                coachOf: ['team-1'],
                parentTeamIds: [],
                parentPlayerKeys: []
            }, { merge: true });
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

    function directNoteRef(firestore, teamId = 'team-1', gameId = 'game-1', noteId = 'main') {
        return doc(firestore, `teams/${teamId}/games/${gameId}/coachNotes/${noteId}`);
    }

    function sharedNoteRef(
        firestore,
        root = 'organizations',
        scopeId = 'org-1',
        gameId = 'shared-game-1',
        teamId = 'team-1'
    ) {
        return doc(firestore, `${root}/${scopeId}/sharedGames/${gameId}/coachNotes/${teamId}`);
    }

    function validPayload(uid, text = 'Protect the top of the box.') {
        return {
            text,
            updatedAt: serverTimestamp(),
            updatedBy: uid
        };
    }

    it('allows canonical team managers to get and write direct, organization, and tournament notes', async () => {
        for (const [uid, email] of [
            ['owner-1', 'owner@example.com'],
            ['team-admin-1', 'team-admin@example.com'],
            ['platform-admin-1', 'platform-admin@example.com']
        ]) {
            const firestore = authedDb(uid, email);
            await assertSucceeds(getDoc(directNoteRef(firestore)));
            await assertSucceeds(setDoc(directNoteRef(firestore), validPayload(uid, `Direct save by ${uid}`)));
            await assertSucceeds(getDoc(sharedNoteRef(firestore)));
            await assertSucceeds(setDoc(sharedNoteRef(firestore), validPayload(uid, `Organization save by ${uid}`)));
            await assertSucceeds(getDoc(sharedNoteRef(firestore, 'tournaments', 'tournament-1', 'shared-game-2')));
            await assertSucceeds(setDoc(
                sharedNoteRef(firestore, 'tournaments', 'tournament-1', 'shared-game-2'),
                validPayload(uid, `Tournament save by ${uid}`)
            ));
        }
    });

    it('keeps each shared note private to the linked team manager represented by its document id', async () => {
        const teamOneOwner = authedDb('owner-1', 'owner@example.com');
        const teamTwoOwner = authedDb('other-owner', 'other-owner@example.com');
        await assertSucceeds(getDoc(sharedNoteRef(teamOneOwner)));
        await assertFails(getDoc(sharedNoteRef(teamOneOwner, 'organizations', 'org-1', 'shared-game-1', 'team-2')));
        await assertSucceeds(getDoc(sharedNoteRef(teamTwoOwner, 'organizations', 'org-1', 'shared-game-1', 'team-2')));
        await assertFails(getDoc(sharedNoteRef(teamTwoOwner)));
        await assertFails(setDoc(
            sharedNoteRef(teamOneOwner, 'organizations', 'org-1', 'shared-game-1', 'unlinked-team'),
            validPayload('owner-1')
        ));
    });

    it('denies parents, scoped helpers, officials, legacy coach grants, unrelated users, and anonymous callers', async () => {
        const deniedCallers = [
            ['parent-1', 'parent@example.com'],
            ['scorekeeper-1', 'scorekeeper@example.com'],
            ['videographer-1', 'videographer@example.com'],
            ['streamer-1', 'streamer@example.com'],
            ['official-1', 'official@example.com'],
            ['legacy-coach-1', 'legacy-coach@example.com'],
            ['unrelated-1', 'unrelated@example.com']
        ];

        for (const [uid, email] of deniedCallers) {
            const firestore = authedDb(uid, email);
            for (const reference of [directNoteRef(firestore), sharedNoteRef(firestore)]) {
                await assertFails(getDoc(reference));
                await assertFails(setDoc(reference, validPayload(uid)));
                await assertFails(deleteDoc(reference));
            }
        }

        const anonymousDb = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(directNoteRef(anonymousDb)));
        await assertFails(getDoc(sharedNoteRef(anonymousDb)));
        await assertFails(setDoc(directNoteRef(anonymousDb), {
            text: 'Anonymous',
            updatedAt: serverTimestamp(),
            updatedBy: 'anonymous'
        }));
    });

    it('lets a parent read direct and shared games without revealing either private note', async () => {
        const parentDb = authedDb('parent-1', 'parent@example.com');
        await assertSucceeds(getDoc(doc(parentDb, 'teams/team-1/games/game-1')));
        await assertSucceeds(getDoc(doc(parentDb, 'organizations/org-1/sharedGames/shared-game-1')));
        await assertFails(getDoc(directNoteRef(parentDb)));
        await assertFails(getDoc(sharedNoteRef(parentDb)));
    });

    it('denies note collection listing while allowing an exact missing note only beneath an existing game', async () => {
        const ownerDb = authedDb('owner-1', 'owner@example.com');
        await assertFails(getDocs(collection(ownerDb, 'teams/team-1/games/game-1/coachNotes')));
        await assertFails(getDocs(collection(ownerDb, 'organizations/org-1/sharedGames/shared-game-1/coachNotes')));
        const missingDirect = await assertSucceeds(getDoc(directNoteRef(ownerDb, 'team-1', 'game-2')));
        expect(missingDirect.exists()).toBe(false);
        await assertFails(getDoc(directNoteRef(ownerDb, 'team-1', 'missing-game')));
        await assertFails(getDoc(sharedNoteRef(ownerDb, 'organizations', 'org-1', 'missing-game')));
    });

    it('enforces the allowlisted payload, server timestamp, caller attribution, note id, and length limit', async () => {
        const ownerDb = authedDb('owner-1', 'owner@example.com');
        for (const reference of [directNoteRef(ownerDb), sharedNoteRef(ownerDb)]) {
            await assertSucceeds(setDoc(reference, validPayload('owner-1', 'x'.repeat(5000))));
            await assertSucceeds(setDoc(reference, validPayload('owner-1', '')));
            await assertFails(setDoc(reference, validPayload('owner-1', 'x'.repeat(5001))));
            await assertFails(setDoc(reference, {
                ...validPayload('owner-1'),
                publicSummary: 'do not allow this field'
            }));
            await assertFails(setDoc(reference, validPayload('another-user')));
            await assertFails(setDoc(reference, {
                text: 'Client timestamp',
                updatedAt: Timestamp.fromMillis(1_720_000_000_000),
                updatedBy: 'owner-1'
            }));
        }
        await assertFails(setDoc(directNoteRef(ownerDb, 'team-1', 'game-1', 'another-note'), validPayload('owner-1')));
    });

    it('revokes direct access after game deletion and shared access after team unlink or game deletion', async () => {
        const ownerDb = authedDb('owner-1', 'owner@example.com');
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const firestore = context.firestore();
            await deleteDoc(doc(firestore, 'teams/team-1/games/game-1'));
            await setDoc(doc(firestore, 'organizations/org-1/sharedGames/shared-game-1'), {
                type: 'game',
                status: 'scheduled',
                homeTeamId: 'team-3',
                awayTeamId: 'team-2'
            });
            await deleteDoc(doc(firestore, 'tournaments/tournament-1/sharedGames/shared-game-2'));
        });

        await assertFails(getDoc(directNoteRef(ownerDb)));
        await assertFails(setDoc(directNoteRef(ownerDb), validPayload('owner-1')));
        await assertFails(getDoc(sharedNoteRef(ownerDb)));
        await assertFails(setDoc(sharedNoteRef(ownerDb), validPayload('owner-1')));
        const deletedTournamentNote = sharedNoteRef(ownerDb, 'tournaments', 'tournament-1', 'shared-game-2');
        await assertFails(getDoc(deletedTournamentNote));
        await assertFails(setDoc(deletedTournamentNote, validPayload('owner-1')));
    });

    it('requires verified admin-email authority and honors enforced verified-email write policy', async () => {
        const unverifiedAdminDb = authedDb('team-admin-1', 'team-admin@example.com', false);
        await assertFails(getDoc(directNoteRef(unverifiedAdminDb)));
        await assertFails(getDoc(sharedNoteRef(unverifiedAdminDb)));
        await assertFails(setDoc(directNoteRef(unverifiedAdminDb), validPayload('team-admin-1')));

        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'securityPolicies/verifiedEmail'), {
                mode: 'enforce',
                exemptUserIds: []
            });
        });
        const unverifiedOwnerDb = authedDb('owner-1', 'owner@example.com', false);
        await assertSucceeds(getDoc(directNoteRef(unverifiedOwnerDb)));
        await assertSucceeds(getDoc(sharedNoteRef(unverifiedOwnerDb)));
        await assertFails(setDoc(directNoteRef(unverifiedOwnerDb), validPayload('owner-1')));
        await assertFails(setDoc(sharedNoteRef(unverifiedOwnerDb), validPayload('owner-1')));
    });
});
