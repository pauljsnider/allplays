import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const rules = readFileSync(resolve(process.cwd(), 'firestore.rules'), 'utf8');
const familyShareTokenMatch = rules.match(/match \/familyShareTokens\/\{tokenId\} \{[\s\S]*?\n\s*}/);
const familyShareTokenRules = familyShareTokenMatch?.[0] || '';

describe('family share token Firestore rules', () => {
    it('denies anonymous source-document reads and reserves them for owner/admin control-plane access', () => {
        expect(familyShareTokenRules).toContain("match /familyShareTokens/{tokenId}");
        expect(familyShareTokenRules).toContain("resource.data.ownerUserId == request.auth.uid");
        expect(familyShareTokenRules).toContain('isGlobalAdmin()');
        expect(familyShareTokenRules).not.toContain("resource.data.get('active', true) == true");
        expect(familyShareTokenRules).not.toContain("resource.data.get('revoked', false)");
    });

    it('requires expiresAt on owner-created and owner-updated share tokens', () => {
        expect(familyShareTokenRules).toContain("request.resource.data.expiresAt is timestamp");
        expect(familyShareTokenRules).toContain("request.resource.data.expiresAt > request.time");
    });

    it('prevents token owners from reassigning bearer tokens to another user', () => {
        expect(familyShareTokenRules).toContain('request.resource.data.ownerUserId == resource.data.ownerUserId');
    });

    it('still reserves revoked-token control-plane access for owners and global admins', () => {
        expect(familyShareTokenRules).toContain("isSignedIn() && resource.data.ownerUserId == request.auth.uid");
        expect(familyShareTokenRules).toContain('isGlobalAdmin()');
    });

    describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('family token source-document actor matrix', () => {
        let testEnv;
        const tokenId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

        beforeAll(async () => {
            testEnv = await initializeTestEnvironment({
                projectId: `allplays-family-token-${Date.now()}`,
                firestore: { rules }
            });
        }, 30000);

        beforeEach(async () => {
            await testEnv.clearFirestore();
            await testEnv.withSecurityRulesDisabled(async (context) => {
                const db = context.firestore();
                await setDoc(doc(db, `familyShareTokens/${tokenId}`), {
                    ownerUserId: 'parent-1',
                    active: true,
                    label: 'Grandma',
                    extraCalendarUrls: ['https://calendar.example.test/feed.ics?secret=SENTINEL_SECRET']
                });
                await setDoc(doc(db, 'users/global-admin'), { isAdmin: true, email: 'global@example.com' });
            });
        });

        afterAll(async () => testEnv?.cleanup());

        it('denies anonymous and unrelated users while preserving owner/admin reads', async () => {
            const anonymousDb = testEnv.unauthenticatedContext().firestore();
            const unrelatedDb = testEnv.authenticatedContext('parent-2', { email: 'parent-2@example.com' }).firestore();
            const ownerDb = testEnv.authenticatedContext('parent-1', { email: 'parent-1@example.com' }).firestore();
            const adminDb = testEnv.authenticatedContext('global-admin', { email: 'global@example.com' }).firestore();

            await assertFails(getDoc(doc(anonymousDb, `familyShareTokens/${tokenId}`)));
            await assertFails(getDoc(doc(unrelatedDb, `familyShareTokens/${tokenId}`)));
            await assertSucceeds(getDoc(doc(ownerDb, `familyShareTokens/${tokenId}`)));
            await assertSucceeds(getDoc(doc(adminDb, `familyShareTokens/${tokenId}`)));
        });
    });
});
