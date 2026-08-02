import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    assertFails,
    assertSucceeds,
    initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
    deleteDoc,
    doc,
    getDoc,
    setDoc,
    updateDoc
} from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

describe('certificate defaults Firestore rules', () => {
    it('keeps shared defaults readable to team admins but server-writable only', () => {
        expect(rules).toMatch(/match \/settings\/\{settingId\}[\s\S]*allow read:[\s\S]*certificateDefaults/);
        expect(rules).toMatch(/match \/settings\/\{settingId\}[\s\S]*allow create, update, delete: if false;/);
    });

    describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('emulator authorization coverage', () => {
        let testEnv;

        beforeAll(async () => {
            testEnv = await initializeTestEnvironment({
                projectId: `allplays-certificate-defaults-${Date.now()}`,
                firestore: { rules }
            });
        }, 30000);

        beforeEach(async () => {
            await testEnv.clearFirestore();
            await testEnv.withSecurityRulesDisabled(async (context) => {
                const firestore = context.firestore();
                await setDoc(doc(firestore, 'teams/team-a'), {
                    ownerId: 'owner-a',
                    adminEmails: ['admin-a@example.com']
                });
                await setDoc(doc(firestore, 'teams/team-a/settings/certificateDefaults'), {
                    signers: [{
                        signatureImagePath: 'certificate-signatures/teams/team-a/current.png'
                    }]
                });
                await setDoc(doc(firestore, 'teams/team-a/certificateSignatureCleanup/server-job'), {
                    teamId: 'team-a',
                    storagePath: 'certificate-signatures/teams/team-a/retired.png',
                    status: 'completed'
                });
            });
        });

        afterAll(async () => {
            await testEnv?.cleanup();
        });

        it('allows owner/admin reads while denying every client defaults mutation', async () => {
            const ownerDb = testEnv.authenticatedContext('owner-a').firestore();
            const adminDb = testEnv.authenticatedContext('admin-a', { email: 'admin-a@example.com' }).firestore();
            const defaultsPath = 'teams/team-a/settings/certificateDefaults';

            await assertSucceeds(getDoc(doc(ownerDb, defaultsPath)));
            await assertSucceeds(getDoc(doc(adminDb, defaultsPath)));
            await assertFails(updateDoc(doc(ownerDb, defaultsPath), { signers: [] }));
            await assertFails(setDoc(doc(adminDb, defaultsPath), { signers: [] }));
            await assertFails(deleteDoc(doc(ownerDb, defaultsPath)));
        });

        it('keeps cleanup tombstones private and server-writable only', async () => {
            const ownerDb = testEnv.authenticatedContext('owner-a').firestore();
            const cleanupPath = 'teams/team-a/certificateSignatureCleanup/server-job';

            await assertFails(getDoc(doc(ownerDb, cleanupPath)));
            await assertFails(updateDoc(doc(ownerDb, cleanupPath), { status: 'pending' }));
            await assertFails(setDoc(doc(ownerDb, 'teams/team-a/certificateSignatureCleanup/forged'), {
                teamId: 'team-a',
                storagePath: 'certificate-signatures/users/victim/known.png',
                requestedBy: 'owner-a',
                status: 'pending'
            }));
        });
    });
});
