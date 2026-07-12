import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const emulatorProjectId = process.env.FIRESTORE_EMULATOR_PROJECT_ID
  || `allplays-opportunity-rules-${Date.now()}`;

async function expectPermissionDenied(operation) {
  const error = await assertFails(operation);
  expect(error.code).toBe('permission-denied');
}

describe('public opportunity Firestore boundaries', () => {
  it('keeps listings and reports server-only while allowing participant-only inquiry reads', () => {
    expect(rules).toContain('match /publicOpportunities/{listingId}');
    expect(rules).toContain('match /publicOpportunityReports/{reportId}');
    expect(rules).toContain('match /opportunityInquiries/{inquiryId}');
    expect(rules).toContain("request.auth.uid in resource.data.get('participantIds', [])");
    expect(rules).toContain('allow create, update, delete: if false;');
  });

  describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('rules engine coverage', () => {
    let testEnv;
    beforeAll(async () => {
      try {
        testEnv = await initializeTestEnvironment({ projectId: emulatorProjectId, firestore: { rules } });
      } catch (error) {
        throw new Error(`Unable to initialize opportunity rules test environment for ${emulatorProjectId}.`, { cause: error });
      }
    });
    beforeEach(async () => {
      try {
        await testEnv.clearFirestore();
      } catch (error) {
        throw new Error('Unable to clear opportunity rules test data.', { cause: error });
      }
    });
    afterAll(async () => {
      if (!testEnv) return;
      try {
        await testEnv.cleanup();
      } catch (error) {
        throw new Error('Unable to clean up opportunity rules test environment.', { cause: error });
      }
    });

    it('denies direct listing access and limits inquiry reads to participants', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'publicOpportunities', 'listing-1'), { title: 'Private source record' });
        await setDoc(doc(context.firestore(), 'opportunityInquiries', 'inquiry-1'), { participantIds: ['user-1', 'user-2'] });
        await setDoc(doc(context.firestore(), 'opportunityInquiries', 'inquiry-1', 'messages', 'message-1'), { body: 'Private' });
      });
      const anonymousDb = testEnv.unauthenticatedContext().firestore();
      const participantDb = testEnv.authenticatedContext('user-1').firestore();
      const otherParticipantDb = testEnv.authenticatedContext('user-2').firestore();
      const outsiderDb = testEnv.authenticatedContext('user-3').firestore();

      await expectPermissionDenied(getDoc(doc(anonymousDb, 'publicOpportunities', 'listing-1')));
      await expectPermissionDenied(getDoc(doc(participantDb, 'publicOpportunities', 'listing-1')));
      await expectPermissionDenied(setDoc(doc(participantDb, 'publicOpportunities', 'listing-2'), { title: 'Client write' }));
      await expectPermissionDenied(setDoc(doc(participantDb, 'opportunityInquiries', 'inquiry-2'), { participantIds: ['user-1'] }));
      await expectPermissionDenied(getDoc(doc(anonymousDb, 'opportunityInquiries', 'inquiry-1')));

      const inquirySnapshot = await assertSucceeds(getDoc(doc(participantDb, 'opportunityInquiries', 'inquiry-1')));
      expect(inquirySnapshot.data()).toEqual({ participantIds: ['user-1', 'user-2'] });
      const messageSnapshot = await assertSucceeds(getDoc(doc(otherParticipantDb, 'opportunityInquiries', 'inquiry-1', 'messages', 'message-1')));
      expect(messageSnapshot.data()).toEqual({ body: 'Private' });
      await expectPermissionDenied(getDoc(doc(outsiderDb, 'opportunityInquiries', 'inquiry-1')));
    });
  });
});
