import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
    collection,
    getDocs,
    limit,
    query,
    setDoc,
    where,
    doc
} from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

describe('firestore.rules architecture fixes', () => {
    it('requires platform-admin team and user list reads to carry a limit of at most 100', () => {
        const helperStart = rules.indexOf('function isBoundedGlobalAdminListQuery()');
        const helperEnd = rules.indexOf('\n    }', helperStart) + '\n    }'.length;
        const helperRules = rules.slice(helperStart, helperEnd);
        const usersStart = rules.indexOf('match /users/{userId}');
        const usersEnd = rules.indexOf('\n    }', usersStart) + '\n    }'.length;
        const userRules = rules.slice(usersStart, usersEnd);
        const teamsStart = rules.indexOf('match /teams/{teamId}');
        const teamsEnd = rules.indexOf('\n    }', teamsStart) + '\n    }'.length;
        const teamRules = rules.slice(teamsStart, teamsEnd);

        expect(helperRules).toContain('request.query.limit != null');
        expect(helperRules).toContain('request.query.limit > 0');
        expect(helperRules).toContain('request.query.limit <= 100');
        expect(userRules).toContain('allow get: if isGlobalAdmin() || isOwner(userId);');
        expect(userRules).toContain('allow list: if isBoundedGlobalAdminListQuery() || isOwner(userId);');
        expect(teamRules).toContain('allow get: if canReadTeamDocument(resource.data);');
        expect(teamRules).toContain('allow list: if isBoundedGlobalAdminListQuery() ||');
        expect(userRules).not.toContain('allow read: if isGlobalAdmin()');
        expect(teamRules).not.toContain('allow read: if canReadTeamDocument(resource.data);');
    });

    it('keeps exact user email lookups bounded under global-admin user list rules', () => {
        const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
        const getUserByEmailBody = dbSource.match(/export async function getUserByEmail\(email\) \{[\s\S]*?\n\}/)?.[0] || '';

        expect(getUserByEmailBody).toContain('where("email", "==", email), limitQuery(1)');
    });

    it('adds the strict projection while preserving unbounded legacy public team queries during rollout', () => {
        const teamsStart = rules.indexOf('match /teams/{teamId}');
        const teamsEnd = rules.indexOf('\n    }', teamsStart) + '\n    }'.length;
        const teamRules = rules.slice(teamsStart, teamsEnd);
        const projectionStart = rules.indexOf('match /publicTeamProfiles/{teamId}');
        const projectionEnd = rules.indexOf('\n    }', projectionStart) + '\n    }'.length;
        const projectionRules = rules.slice(projectionStart, projectionEnd);

        expect(rules).toContain('function canReadPublicTeamDocument(data)');
        expect(rules).toContain('function canListManagedTeamDocument(data)');
        expect(teamRules).toContain('allow list: if isBoundedGlobalAdminListQuery() ||');
        expect(teamRules).toContain('canListManagedTeamDocument(resource.data);');
        expect(teamRules).toContain('canReadPublicTeamDocument(resource.data) ||');
        expect(projectionRules).toContain('allow list: if false;');
        expect(projectionRules).toContain('allow get: if isPublicTeamProfilePayloadValid(resource.data) &&');
        expect(projectionRules).toContain('isCurrentTeamPubliclyDiscoverable(teamId);');
        expect(projectionRules).toContain('allow create, update, delete: if false;');
        expect(teamRules).not.toContain('(!isGlobalAdmin() && canReadTeamDocument(resource.data));');
    });

    // Duplicate-block regression coverage lives in tests/unit/team-fee-recipient-rules.test.js.
    it('keeps feeRecipients access scoped to the fee recipient or team owner/admin', () => {
        const start = rules.indexOf('match /{path=**}/feeRecipients/{recipientId}');
        const end = rules.indexOf('\n    }', start) + '\n    }'.length;
        const feeRecipientsRules = rules.slice(start, end);

        expect(feeRecipientsRules).toContain('isTeamFeeRecipientForCurrentParent(resource.data, resource.data.teamId)');
        expect(feeRecipientsRules).toContain('isTeamOwnerOrAdmin(resource.data.teamId)');
    });

    it('does not allow unauthenticated/public reads of roster field definitions', () => {
        const start = rules.indexOf('match /rosterFields/{fieldId}');
        const end = rules.indexOf('\n      }', start) + '\n      }'.length;
        const rosterFieldsRules = rules.slice(start, end);

        expect(rosterFieldsRules).not.toContain('allow read: if true;');
        expect(rosterFieldsRules).toContain('allow read: if isTeamOwnerOrAdmin(teamId) || isParentForTeam(teamId);');
    });

    it('keeps stat tracker configs publicly readable so shareable replay links keep working', () => {
        // Codex caught a regression here: live-game.js loads getConfigs(state.teamId)
        // for a specific shareable/public *game*, but that read isn't scoped to a
        // gameId, and a game can be individually shareable even when its team is
        // inactive/non-public (isShareableGameDocument, independent of team-level
        // isPublic/active). Requiring team-level public+active status broke replay
        // links for exactly the teams that need them. The data (sport type + column
        // names) has no meaningful sensitivity, so it stays open.
        const start = rules.indexOf('match /statTrackerConfigs/{configId}');
        const end = rules.indexOf('\n      }', start) + '\n      }'.length;
        const statTrackerConfigRules = rules.slice(start, end);

        expect(statTrackerConfigRules).toContain('allow read: if true;');
        expect(statTrackerConfigRules).toContain('allow write: if isTeamOwnerOrAdmin(teamId);');
    });

    describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('rules engine coverage for bounded admin lists and team discovery', () => {
        let testEnv;

        beforeAll(async () => {
            testEnv = await initializeTestEnvironment({
                projectId: `allplays-rules-architecture-${Date.now()}`,
                firestore: {
                    rules
                }
            });
        }, 30000);

        beforeEach(async () => {
            await testEnv.clearFirestore();
            await testEnv.withSecurityRulesDisabled(async (context) => {
                const adminDb = context.firestore();
                await setDoc(doc(adminDb, 'users/admin-1'), {
                    email: 'admin@example.com',
                    isAdmin: true
                });
                await setDoc(doc(adminDb, 'users/parent-1'), {
                    email: 'parent@example.com',
                    isAdmin: false
                });
                await setDoc(doc(adminDb, 'teams/public-team'), {
                    name: 'Public Team',
                    ownerId: 'owner-1',
                    adminEmails: [],
                    isPublic: true
                });
                await setDoc(doc(adminDb, 'teams/private-team'), {
                    name: 'Private Team',
                    ownerId: 'owner-2',
                    adminEmails: [],
                    isPublic: false
                });
            });
        });

        afterAll(async () => {
            await testEnv?.cleanup();
        });

        function adminFirestore() {
            return testEnv.authenticatedContext('admin-1', { email: 'admin@example.com' }).firestore();
        }

        it('allows platform admins to list users and teams only with a positive limit of at most 100', async () => {
            const adminDb = adminFirestore();

            await assertSucceeds(getDocs(query(collection(adminDb, 'users'), limit(100))));
            await assertSucceeds(getDocs(query(collection(adminDb, 'teams'), limit(100))));

            await assertFails(getDocs(collection(adminDb, 'users')));
            await assertFails(getDocs(query(collection(adminDb, 'users'), limit(101))));
            await assertFails(getDocs(collection(adminDb, 'teams')));
            await assertFails(getDocs(query(collection(adminDb, 'teams'), limit(101))));
        });

        it('allows public team browsing while denying private team list leakage', async () => {
            const publicDb = testEnv.unauthenticatedContext().firestore();

            await assertSucceeds(getDocs(query(
                collection(publicDb, 'teams'),
                where('isPublic', '==', true)
            )));
            await assertFails(getDocs(collection(publicDb, 'teams')));
            await assertFails(getDocs(query(
                collection(publicDb, 'teams'),
                where('isPublic', '==', false)
            )));
        });
    });
});
