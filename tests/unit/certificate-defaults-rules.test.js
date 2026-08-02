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
import { buildCertificateDefaultsCompatibilityRules } from '../../scripts/build-certificate-defaults-compat-rules.mjs';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const compatibilityRules = compactFirestoreRules(buildCertificateDefaultsCompatibilityRules(rules));
const deployWorkflow = readFileSync(new URL('../../.github/workflows/deploy-prod.yml', import.meta.url), 'utf8');

describe('certificate defaults Firestore rules', () => {
    it('keeps shared defaults readable to team admins but server-writable only', () => {
        expect(rules).toMatch(/match \/settings\/\{settingId\}[\s\S]*allow read:[\s\S]*certificateDefaults/);
        expect(rules).toMatch(/match \/settings\/\{settingId\}[\s\S]*allow create, update, delete: if false;/);
    });

    it('builds a narrowly scoped transitional ruleset', () => {
        const sourceCompatibilityRules = buildCertificateDefaultsCompatibilityRules(rules);

        expect(sourceCompatibilityRules).toContain(
            "allow read, create, update, delete: if settingId == 'certificateDefaults'"
        );
        expect(sourceCompatibilityRules).not.toContain(
            '// All writes must cross the callable\'s trusted provenance/tombstone checks.'
        );
        expect(() => buildCertificateDefaultsCompatibilityRules(sourceCompatibilityRules)).toThrow(
            'Expected exactly one server-only certificate defaults rules block.'
        );
    });

    it('deploys the writer and compatibility rules before callers, then activates the denial', () => {
        const compatibilityFunction = deployWorkflow.indexOf('certificate-defaults-writer-compatibility');
        const compatibilityRules = deployWorkflow.indexOf('certificate-defaults-rules-compatibility');
        const application = deployWorkflow.indexOf('retry_firebase_deploy "hosting,functions" "application"');
        const finalRules = deployWorkflow.indexOf('certificate-defaults-rules-final');

        expect(compatibilityFunction).toBeGreaterThan(-1);
        expect(compatibilityRules).toBeGreaterThan(compatibilityFunction);
        expect(application).toBeGreaterThan(compatibilityRules);
        expect(finalRules).toBeGreaterThan(application);
    });

    describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('transitional emulator coverage', () => {
        let compatibilityEnv;

        beforeAll(async () => {
            compatibilityEnv = await initializeTestEnvironment({
                projectId: `allplays-certificate-defaults-compat-${Date.now()}`,
                firestore: { rules: compatibilityRules }
            });
        }, 30000);

        beforeEach(async () => {
            await compatibilityEnv.clearFirestore();
            await compatibilityEnv.withSecurityRulesDisabled(async (context) => {
                await setDoc(doc(context.firestore(), 'teams/team-a'), {
                    ownerId: 'owner-a',
                    adminEmails: []
                });
            });
        });

        afterAll(async () => {
            await compatibilityEnv?.cleanup();
        });

        it('keeps only authorized legacy defaults writes open during caller rollout', async () => {
            const ownerDb = compatibilityEnv.authenticatedContext('owner-a').firestore();
            const outsiderDb = compatibilityEnv.authenticatedContext('outsider').firestore();
            const defaultsPath = 'teams/team-a/settings/certificateDefaults';

            await assertSucceeds(setDoc(doc(ownerDb, defaultsPath), { signers: [] }));
            await assertFails(setDoc(doc(outsiderDb, defaultsPath), { signers: [] }));
        });
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
