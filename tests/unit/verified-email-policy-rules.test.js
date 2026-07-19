import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, Timestamp } from 'firebase/firestore';

const firestoreRules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const storageRules = readFileSync(new URL('../../storage.rules', import.meta.url), 'utf8');
const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

describe('staged verified-email policy rules', () => {
  it('defines a shared observe/enforce policy and retains explicit account-bootstrap exceptions', () => {
    expect(firestoreRules).toContain('function isVerifiedForSensitiveWrite()');
    expect(firestoreRules).toContain("get(policyPath).data.get('mode', 'observe') != 'enforce'");
    expect(firestoreRules).toContain('match /securityPolicies/{policyId}');
    expect(firestoreRules).toContain('allow create: if isVerifiedForSensitiveWrite() && request.resource.data.ownerId == request.auth.uid;');
    expect(firestoreRules).toContain('allow create: if isVerifiedForSensitiveWrite() &&\n                           canAccessChatConversation');
    expect(firestoreRules.match(/allow update: if isVerifiedForSensitiveWrite\(\) &&\n                           canAccessChatConversation/g)).toHaveLength(3);
    expect(firestoreRules).toContain('allow delete: if (resource == null && isOwnRsvpNoteId() && isParentForTeam(teamId)) ||\n                           (isVerifiedForSensitiveWrite() &&');
    expect(firestoreRules).toContain('allow create: if isGlobalAdmin() ||\n                    (isOwner(userId) && isOwnerUserCreatePayloadValid(request.resource.data));');
    expect(firestoreRules).toContain('allow create: if isVerifiedForSensitiveWrite() &&\n                       ((isGlobalAdmin() && isPublicUserProfilePayloadValid');
    expect(dbSource).toContain("console.warn('[public-user-profile] Presentation sync deferred:', error);");
    expect(dbSource).toContain("console.warn('[public-user-profile] Trusted projection sync deferred:', callableError);");
    expect(storageRules).toContain('function isVerifiedForSensitiveWrite()');
  });

  it('gates every direct auth-only write rule except mixed invite redemption/revocation', () => {
    const directSignedInWriteLines = firestoreRules.split('\n')
      .filter((line) => /allow\s+(?:create|update|delete|write|create, update|update, delete).*isSignedIn\(\)/.test(line.trim()));
    expect(directSignedInWriteLines).toEqual([
      '      allow update: if isSignedIn() &&'
    ]);
    expect(firestoreRules).toContain('isParentInviteRedemptionUpdate() ||');
    expect(firestoreRules).toContain('isHouseholdInviteRedemptionUpdate() ||');
    expect(firestoreRules).toContain('isStandardAccessCodeRedemptionUpdate() ||');
  });

  describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_STORAGE_EMULATOR_HOST)(
    'rules-engine enforcement coverage',
    () => {
      let testEnv;

      beforeAll(async () => {
        testEnv = await initializeTestEnvironment({
          projectId: 'demo-allplays',
          firestore: { rules: firestoreRules },
          storage: { rules: storageRules }
        });
      }, 30_000);

      beforeEach(async () => {
        await testEnv.clearFirestore();
        await testEnv.clearStorage();
        await testEnv.withSecurityRulesDisabled(async (context) => {
          const db = context.firestore();
          await setDoc(doc(db, 'teams/team-a'), {
            ownerId: 'owner-a',
            adminEmails: [],
            isPublic: true
          });
          await setDoc(doc(db, 'securityPolicies/verifiedEmail'), {
            mode: 'observe',
            exemptUserIds: []
          });
        });
      });

      afterAll(async () => {
        await testEnv?.cleanup();
      });

      async function setPolicy(mode, exemptUserIds = []) {
        await testEnv.withSecurityRulesDisabled(async (context) => {
          await setDoc(doc(context.firestore(), 'securityPolicies/verifiedEmail'), { mode, exemptUserIds });
        });
      }

      function user(uid, { verified = false, email = `${uid}@example.com`, claimExempt = false } = {}) {
        const claims = { email_verified: verified, email_verification_exempt: claimExempt };
        if (email) claims.email = email;
        return testEnv.authenticatedContext(uid, claims);
      }

      it('preserves current authenticated writes in observe mode', async () => {
        const context = user('owner-a');
        await assertSucceeds(setDoc(doc(context.firestore(), 'teams/observe-team'), { ownerId: 'owner-a' }));
        await assertSucceeds(context.storage().ref(
          'team-email-attachments/team-a/draft-a/owner-a/observe.txt'
        ).put(
          new Uint8Array([1]),
          { contentType: 'text/plain' }
        ));
      });

      it('enforce mode blocks unverified writes while preserving reads and verified/no-email identities', async () => {
        await setPolicy('enforce');
        const unverified = user('owner-a');
        const verified = user('verified-owner', { verified: true });
        const noEmail = user('phone-owner', { email: '' });

        await assertFails(setDoc(doc(unverified.firestore(), 'teams/blocked-team'), { ownerId: 'owner-a' }));
        await assertFails(unverified.storage().ref(
          'team-email-attachments/team-a/draft-a/owner-a/blocked.txt'
        ).put(
          new Uint8Array([1]),
          { contentType: 'text/plain' }
        ));
        await assertSucceeds(getDoc(doc(unverified.firestore(), 'teams/team-a')));
        await assertSucceeds(setDoc(doc(verified.firestore(), 'teams/verified-team'), { ownerId: 'verified-owner' }));
        await assertSucceeds(setDoc(doc(noEmail.firestore(), 'teams/phone-team'), { ownerId: 'phone-owner' }));
      });

      it('supports bounded migration and custom-claim exemptions', async () => {
        await setPolicy('enforce', ['legacy-owner']);
        const legacy = user('legacy-owner');
        const claimExempt = user('claim-owner', { claimExempt: true });

        await assertSucceeds(setDoc(doc(legacy.firestore(), 'teams/legacy-team'), { ownerId: 'legacy-owner' }));
        await assertSucceeds(setDoc(doc(claimExempt.firestore(), 'teams/claim-team'), { ownerId: 'claim-owner' }));
      });

      it('keeps the self-profile bootstrap path open so verification and recovery can complete', async () => {
        await setPolicy('enforce');
        const context = user('new-user');
        const verified = user('verified-user', { verified: true });

        await assertSucceeds(setDoc(doc(context.firestore(), 'users/new-user'), {
          email: 'new-user@example.com',
          displayName: 'New User'
        }));
        await assertFails(setDoc(doc(context.firestore(), 'publicUserProfiles/new-user'), {
          displayName: 'New User',
          fullName: 'New User',
          photoUrl: null,
          updatedAt: Timestamp.now()
        }));
        await assertSucceeds(setDoc(doc(verified.firestore(), 'publicUserProfiles/verified-user'), {
          displayName: 'Verified User',
          fullName: 'Verified User',
          photoUrl: null,
          updatedAt: Timestamp.now()
        }));
      });
    }
  );
});
