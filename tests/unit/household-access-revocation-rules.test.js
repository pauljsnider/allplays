import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('household access revocation rules', () => {
    let testEnv;

    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: `allplays-household-revocation-${Date.now()}`,
            firestore: { rules }
        });
    }, 30000);

    beforeEach(async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'users/organizer-1/familyMemberships/member-1'), {
                email: 'contact@example.com',
                organizerUserId: 'organizer-1',
                status: 'pending',
                teamId: 'team-1',
                playerId: 'player-1'
            });
        });
    });

    afterAll(async () => {
        await testEnv?.cleanup();
    });

    it('blocks organizer shell-only revocation while preserving setup and invited-user acceptance writes', async () => {
        const organizerDb = testEnv.authenticatedContext('organizer-1', { email: 'organizer@example.com' }).firestore();
        const invitedDb = testEnv.authenticatedContext('contact-1', { email: 'contact@example.com' }).firestore();
        const membershipPath = 'users/organizer-1/familyMemberships/member-1';

        await assertSucceeds(updateDoc(doc(organizerDb, membershipPath), {
            accessCodeId: 'code-1',
            accessCode: 'HOME1234',
            inviteUrl: 'accept-invite.html?code=HOME1234',
            updatedAt: 'now'
        }));
        await assertFails(updateDoc(doc(organizerDb, membershipPath), {
            status: 'removed',
            accessStatus: 'revoked',
            removedAt: 'now',
            updatedAt: 'now'
        }));
        await assertSucceeds(updateDoc(doc(invitedDb, membershipPath), {
            status: 'active',
            userId: 'contact-1',
            acceptedAt: 'now',
            updatedAt: 'now'
        }));
    });

    it('keeps unauthenticated and unrelated users from mutating the membership', async () => {
        const unrelatedDb = testEnv.authenticatedContext('other-user', { email: 'other@example.com' }).firestore();
        const publicDb = testEnv.unauthenticatedContext().firestore();
        const membershipPath = 'users/organizer-1/familyMemberships/member-1';

        await assertFails(updateDoc(doc(unrelatedDb, membershipPath), { status: 'removed' }));
        await assertFails(updateDoc(doc(publicDb, membershipPath), { status: 'removed' }));
    });
});
