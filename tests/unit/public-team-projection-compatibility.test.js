import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, limit, query, setDoc, where } from 'firebase/firestore';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
const dbSource = readFileSync(resolve(process.cwd(), 'js/db.js'), 'utf8');

describe('public team projection compatibility contract', () => {
    it('keeps strict projection detail reads and callable-only collection discovery', () => {
        expect(dbSource).toContain("doc(db, 'publicTeamProfiles', normalizedTeamId)");
        expect(dbSource).toContain("httpsCallable(functions, 'discoverPublicTeamProfiles')");
        expect(dbSource).toContain("httpsCallable(functions, 'getPublicTeamProfile')");
        expect(dbSource).toContain('if (!isPublicProjectionFallbackError(error)) throw error;');
        expect(dbSource).toMatch(/discoverPublicTeams[\s\S]*discoverPublicTeamsFromCallable/);
    });
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('public team projection compatibility rules', () => {
    let testEnv;

    beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
            projectId: `allplays-public-team-compat-${Date.now()}`,
            firestore: { rules }
        });
    }, 30000);

    beforeEach(async () => {
        await testEnv.clearFirestore();
        await testEnv.withSecurityRulesDisabled(async (context) => {
            const db = context.firestore();
            await setDoc(doc(db, 'teams/public-team'), {
                name: 'Public Team', isPublic: true, active: true, ownerId: 'owner-1'
            });
            await setDoc(doc(db, 'publicTeamProfiles/public-team'), {
                publicSchemaVersion: 1,
                name: 'Public Team', isPublic: true, active: true, publicSearchName: 'public team'
            });
        });
    });

    afterAll(async () => testEnv?.cleanup());

    it('lets old and new clients read the same public team during rollout', async () => {
        const db = testEnv.unauthenticatedContext().firestore();
        await assertSucceeds(getDoc(doc(db, 'teams/public-team')));
        await assertSucceeds(getDocs(query(collection(db, 'teams'), where('isPublic', '==', true))));
        const projection = await assertSucceeds(getDoc(doc(db, 'publicTeamProfiles/public-team')));
        expect(projection.data()).toMatchObject({ name: 'Public Team', isPublic: true });
        await assertFails(getDocs(query(
            collection(db, 'publicTeamProfiles'),
            where('publicSchemaVersion', '==', 1),
            where('isPublic', '==', true),
            where('active', '==', true),
            limit(100)
        )));
        await assertFails(getDocs(query(collection(db, 'publicTeamProfiles'), limit(101))));
    });

    it('fails closed if a privileged writer ever creates a malformed projection', async () => {
        await testEnv.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'publicTeamProfiles/malformed-team'), {
                publicSchemaVersion: 1,
                name: 'Malformed Team', isPublic: true, active: true,
                unexpectedSecret: 'must-not-list'
            });
        });
        const db = testEnv.unauthenticatedContext().firestore();
        await assertFails(getDoc(doc(db, 'publicTeamProfiles/malformed-team')));
        await assertFails(getDocs(query(
            collection(db, 'publicTeamProfiles'),
            where('publicSchemaVersion', '==', 1),
            where('isPublic', '==', true),
            where('active', '==', true),
            limit(100)
        )));
    });

    it('keeps projection writes server-only', async () => {
        const ownerDb = testEnv.authenticatedContext('owner-1').firestore();
        await assertFails(setDoc(doc(ownerDb, 'publicTeamProfiles/injected'), {
            name: 'Injected', isPublic: true, active: true
        }));
    });
});
