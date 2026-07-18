import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const projectId = process.env.FIRESTORE_EMULATOR_PROJECT_ID || `allplays-public-registration-rules-${Date.now()}`;

describe('public registration Firestore boundary', () => {
  it('keeps registration writes server-only and stages verified guardian read enforcement', () => {
    const helper = rules.slice(
      rules.indexOf('function canUseRegistrationGuardianEmailClaim()'),
      rules.indexOf('function isRegistrationPaymentSettingsPayloadValid')
    );
    const registrationBlock = rules.slice(
      rules.indexOf('match /registrationForms/{formId}'),
      rules.indexOf('match /trackingItems/{itemId}')
    );
    expect(helper).toContain("get(policyPath).data.get('mode', 'observe') != 'enforce'");
    expect(helper).toContain("data.get('submittedByUserId', '') == request.auth.uid");
    expect(registrationBlock).toContain("allow create: if isTeamOwnerOrAdmin(teamId) && request.resource.data.status == 'pending';");
    expect(registrationBlock).not.toContain('allow create: if request.auth == null');
  });

  describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('rules engine coverage', () => {
    let testEnv;

    beforeAll(async () => {
      testEnv = await initializeTestEnvironment({ projectId, firestore: { rules } });
    }, 30000);

    beforeEach(async () => {
      await testEnv.clearFirestore();
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await setDoc(doc(db, 'teams', 'team-1'), {
          ownerId: 'owner-1',
          adminEmails: [],
          isPublic: true
        });
        await setDoc(doc(db, 'teams', 'team-1', 'registrationForms', 'published-form'), {
          published: true,
          status: 'published'
        });
        await setDoc(doc(db, 'teams', 'team-1', 'registrationForms', 'private-form'), {
          published: false,
          status: 'draft'
        });
        await setDoc(doc(db, 'teams', 'team-1', 'registrationForms', 'published-form', 'registrations', 'email-owned'), {
          source: 'public-registration',
          guardian: { email: 'victim@example.com' },
          status: 'pending'
        });
        await setDoc(doc(db, 'teams', 'team-1', 'registrationForms', 'published-form', 'registrations', 'uid-owned'), {
          source: 'public-registration',
          guardian: { email: 'other@example.com' },
          submittedByUserId: 'submitter-1',
          status: 'pending'
        });
      });
    }, 30000);

    afterAll(async () => {
      await testEnv?.cleanup();
    }, 30000);

    it('allows only published form reads and denies direct anonymous registration writes', async () => {
      const anonymousDb = testEnv.unauthenticatedContext().firestore();
      await assertSucceeds(getDoc(doc(anonymousDb, 'teams', 'team-1', 'registrationForms', 'published-form')));
      await assertFails(getDoc(doc(anonymousDb, 'teams', 'team-1', 'registrationForms', 'private-form')));
      await assertFails(setDoc(
        doc(anonymousDb, 'teams', 'team-1', 'registrationForms', 'published-form', 'registrations', 'direct-write'),
        { guardian: { email: 'attacker@example.com' }, status: 'pending' }
      ));
    });

    it('preserves current guardian reads until enforcement is explicitly enabled', async () => {
      const unverifiedDb = testEnv.authenticatedContext('unverified-1', {
        email: 'victim@example.com',
        email_verified: false
      }).firestore();
      await assertSucceeds(getDoc(doc(
        unverifiedDb,
        'teams', 'team-1', 'registrationForms', 'published-form', 'registrations', 'email-owned'
      )));
    });

    it('requires verified email claims in enforce mode while preserving authoritative submitter ownership', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'securityPolicies', 'verifiedEmail'), {
          mode: 'enforce',
          exemptUserIds: []
        });
      });
      const registrationPath = ['teams', 'team-1', 'registrationForms', 'published-form', 'registrations', 'email-owned'];
      const unverifiedDb = testEnv.authenticatedContext('unverified-1', {
        email: 'victim@example.com', email_verified: false
      }).firestore();
      const verifiedDb = testEnv.authenticatedContext('verified-1', {
        email: 'victim@example.com', email_verified: true
      }).firestore();
      const wrongVerifiedDb = testEnv.authenticatedContext('wrong-1', {
        email: 'attacker@example.com', email_verified: true
      }).firestore();
      const submitterDb = testEnv.authenticatedContext('submitter-1', {
        email: 'unverified@example.com', email_verified: false
      }).firestore();

      await assertFails(getDoc(doc(unverifiedDb, ...registrationPath)));
      await assertSucceeds(getDoc(doc(verifiedDb, ...registrationPath)));
      await assertFails(getDoc(doc(wrongVerifiedDb, ...registrationPath)));
      await assertSucceeds(getDoc(doc(
        submitterDb,
        'teams', 'team-1', 'registrationForms', 'published-form', 'registrations', 'uid-owned'
      )));
    });
  });
});
