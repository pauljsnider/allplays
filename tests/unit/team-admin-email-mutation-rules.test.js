import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { doc, setDoc, updateDoc } from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

describe('team admin email mutation Firestore rules', () => {
    let testEnv;

    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: 'demo-team-admin-email-mutation',
            firestore: { rules }
        });
    }, 30_000);

    beforeEach(async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const firestore = context.firestore();
            await Promise.all([
                setDoc(doc(firestore, 'teams', 'team-a'), {
                    ownerId: 'owner-a',
                    name: 'Team A',
                    adminEmails: ['admin-a@example.com', 'admin-b@example.com']
                }),
                setDoc(doc(firestore, 'teams', 'team-b'), {
                    ownerId: 'owner-b',
                    name: 'Team B',
                    adminEmails: ['admin-c@example.com']
                }),
                setDoc(doc(firestore, 'users', 'platform-admin'), { isAdmin: true })
            ]);
        });
    });

    afterAll(async () => {
        await testEnv.cleanup();
    });

    function verifiedDb(uid, email) {
        return testEnv.authenticatedContext(uid, {
            email,
            email_verified: true
        }).firestore();
    }

    it('denies same-size adminEmail substitution by an ordinary team admin', async () => {
        const adminDb = verifiedDb('admin-a', 'admin-a@example.com');

        await assertFails(updateDoc(doc(adminDb, 'teams', 'team-a'), {
            adminEmails: ['admin-a@example.com', 'new-admin@example.com']
        }));
    });

    it('allows an ordinary team admin to update metadata while preserving adminEmails', async () => {
        const adminDb = verifiedDb('admin-a', 'admin-a@example.com');

        await assertSucceeds(updateDoc(doc(adminDb, 'teams', 'team-a'), {
            name: 'Updated Team A',
            adminEmails: ['admin-a@example.com', 'admin-b@example.com']
        }));
    });

    it('denies a cross-team admin metadata and grant mutation', async () => {
        const crossTeamAdminDb = verifiedDb('admin-c', 'admin-c@example.com');

        await assertFails(updateDoc(doc(crossTeamAdminDb, 'teams', 'team-a'), {
            name: 'Unauthorized update',
            adminEmails: ['admin-a@example.com', 'admin-c@example.com']
        }));
    });

    it('allows the owner to maintain the adminEmails grant set', async () => {
        const ownerDb = verifiedDb('owner-a', 'owner-a@example.com');

        await assertSucceeds(updateDoc(doc(ownerDb, 'teams', 'team-a'), {
            adminEmails: ['admin-a@example.com', 'owner-added@example.com']
        }));
    });

    it('allows a platform admin to maintain the adminEmails grant set', async () => {
        const platformAdminDb = verifiedDb('platform-admin', 'platform-admin@example.com');

        await assertSucceeds(updateDoc(doc(platformAdminDb, 'teams', 'team-a'), {
            adminEmails: ['platform-maintained@example.com']
        }));
    });
});
