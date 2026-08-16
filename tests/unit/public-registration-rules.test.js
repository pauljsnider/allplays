import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import {
  collectionGroup,
  doc,
  documentId,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
  updateDoc,
  where
} from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const projectId = process.env.FIRESTORE_EMULATOR_PROJECT_ID || `allplays-public-registration-rules-${Date.now()}`;

describe('public registration Firestore boundary', () => {
  it('keeps registration writes server-only and requires verified guardian-email ownership', () => {
    const helper = rules.slice(
      rules.indexOf('function isCurrentUserRegistrationGuardian(data)'),
      rules.indexOf('function isRegistrationPaymentSettingsPayloadValid')
    );
    const registrationBlock = rules.slice(
      rules.indexOf('match /registrationForms/{formId}'),
      rules.indexOf('match /trackingItems/{itemId}')
    );
    expect(helper).toContain("request.auth.token.get('email_verified', false) == true");
    expect(helper).toContain("data.get('submittedByUserId', '') == request.auth.uid");
    expect(helper).not.toContain('securityPolicies/verifiedEmail');
    expect(rules).not.toContain('function canUseRegistrationGuardianEmailClaim()');
    expect(registrationBlock).toContain('hasNoServerOwnedRegistrationCheckoutFields(request.resource.data);');
    expect(registrationBlock).toContain('hasNoChangedServerOwnedRegistrationCheckoutFields();');
    expect(registrationBlock).toContain('match /checkoutAttempts/{attemptId}');
    expect(registrationBlock).toContain('allow read, create, update, delete: if false;');
    expect(registrationBlock).not.toContain('allow create: if request.auth == null');
    expect(rules.match(/'checkoutAttemptToken'/g)).toHaveLength(4);
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
          adminEmails: ['manager@example.com'],
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

    it('keeps team owner and administrator review access without letting clients forge checkout reservations', async () => {
      const ownerDb = testEnv.authenticatedContext('owner-1', {
        email: 'owner@example.com',
        email_verified: true
      }).firestore();
      const managerDb = testEnv.authenticatedContext('manager-1', {
        email: 'manager@example.com',
        email_verified: true
      }).firestore();
      const existingRef = doc(
        ownerDb,
        'teams', 'team-1', 'registrationForms', 'published-form', 'registrations', 'email-owned'
      );

      await assertSucceeds(getDoc(doc(
        managerDb,
        'teams', 'team-1', 'registrationForms', 'published-form', 'registrations', 'email-owned'
      )));
      await assertSucceeds(updateDoc(existingRef, { decisionNote: 'Reviewed by coach' }));
      await assertFails(updateDoc(existingRef, {
        checkoutCreationReservationId: 'forged-reservation',
        checkoutCreationRequest: { idempotencyKey: 'forged' }
      }));
      await assertFails(updateDoc(existingRef, {
        checkoutAttemptToken: 'forgedcheckouttoken123'
      }));
      await assertFails(setDoc(
        doc(ownerDb, 'teams', 'team-1', 'registrationForms', 'published-form', 'registrations', 'forged-checkout'),
        {
          status: 'pending',
          checkoutCreationReservationId: 'forged-reservation',
          checkoutCreationRequest: { idempotencyKey: 'forged' }
        }
      ));

      const attemptRef = doc(existingRef, 'checkoutAttempts', 'current');
      await assertFails(getDoc(attemptRef));
      await assertFails(setDoc(attemptRef, {
        reservationId: 'forged-reservation',
        checkoutCreationRequest: { idempotencyKey: 'forged' }
      }));
    });

    it('denies guardians access to private provider checkout attempts', async () => {
      const guardianDb = testEnv.authenticatedContext('guardian-1', {
        email: 'victim@example.com',
        email_verified: true
      }).firestore();
      const attemptRef = doc(
        guardianDb,
        'teams', 'team-1', 'registrationForms', 'published-form', 'registrations', 'email-owned',
        'checkoutAttempts', 'current'
      );
      await assertFails(getDoc(attemptRef));
      await assertFails(setDoc(attemptRef, {
        reservationId: 'forged-reservation',
        checkoutCreationRequest: { idempotencyKey: 'forged' }
      }));
    });

    it.each([
      ['missing', null],
      ['disabled', { mode: 'disabled', exemptUserIds: ['unverified-1'] }],
      ['observe', { mode: 'observe', exemptUserIds: ['unverified-1'] }],
      ['enforce', { mode: 'enforce', exemptUserIds: ['unverified-1'] }]
    ])('requires verified guardian-email ownership with the policy %s for direct and collection-group reads', async (_state, policy) => {
      if (policy) {
        await testEnv.withSecurityRulesDisabled(async (context) => {
          await setDoc(doc(context.firestore(), 'securityPolicies', 'verifiedEmail'), policy);
        });
      }
      const registrationPath = ['teams', 'team-1', 'registrationForms', 'published-form', 'registrations', 'email-owned'];
      const unverifiedDb = testEnv.authenticatedContext('unverified-1', {
        email: 'victim@example.com',
        email_verified: false,
        email_verification_exempt: true
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
      const guardianApplications = (db, email = 'victim@example.com') => query(
        collectionGroup(db, 'registrations'),
        where('guardian.email', '==', email),
        orderBy(documentId(), 'desc'),
        limit(10)
      );
      const submitterApplications = query(
        collectionGroup(submitterDb, 'registrations'),
        where('submittedByUserId', '==', 'submitter-1'),
        orderBy(documentId(), 'desc'),
        limit(10)
      );

      await assertFails(getDoc(doc(unverifiedDb, ...registrationPath)));
      await assertSucceeds(getDoc(doc(verifiedDb, ...registrationPath)));
      await assertFails(getDoc(doc(wrongVerifiedDb, ...registrationPath)));
      await assertSucceeds(getDoc(doc(
        submitterDb,
        'teams', 'team-1', 'registrationForms', 'published-form', 'registrations', 'uid-owned'
      )));
      await assertFails(getDocs(guardianApplications(unverifiedDb)));
      await assertSucceeds(getDocs(guardianApplications(verifiedDb)));
      await assertFails(getDocs(guardianApplications(wrongVerifiedDb)));
      await assertSucceeds(getDocs(submitterApplications));
    });

    it('includes legacy registrations without submittedAt across document-id pages', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const db = context.firestore();
        await Promise.all(Array.from({ length: 11 }, (_, index) => setDoc(doc(
          db,
          'teams', 'team-1', 'registrationForms', 'published-form', 'registrations', `paged-${index}`
        ), {
          guardian: { email: 'paged@example.com' },
          ...(index === 5 ? { createdAt: new Date('2024-01-01T00:00:00.000Z') } : { submittedAt: new Date() }),
          status: 'pending'
        })));

        const baseConstraints = [
          where('guardian.email', '==', 'paged@example.com'),
          orderBy(documentId(), 'desc')
        ];
        const firstPage = await getDocs(query(
          collectionGroup(db, 'registrations'),
          ...baseConstraints,
          limit(10)
        ));
        const secondPage = await getDocs(query(
          collectionGroup(db, 'registrations'),
          ...baseConstraints,
          startAfter(firstPage.docs.at(-1)),
          limit(10)
        ));
        const registrationIds = [...firstPage.docs, ...secondPage.docs].map((registrationDoc) => registrationDoc.id);

        expect(registrationIds).toHaveLength(11);
        expect(registrationIds).toContain('paged-5');
      });
    });
  });
});
