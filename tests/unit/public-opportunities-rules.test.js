import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

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
      testEnv = await initializeTestEnvironment({ projectId: `allplays-opportunity-rules-${Date.now()}`, firestore: { rules } });
    });
    beforeEach(async () => testEnv.clearFirestore());
    afterAll(async () => testEnv?.cleanup());

    it('denies direct listing access and limits inquiry reads to participants', async () => {
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'publicOpportunities', 'listing-1'), { title: 'Private source record' });
        await setDoc(doc(context.firestore(), 'opportunityInquiries', 'inquiry-1'), { participantIds: ['user-1', 'user-2'] });
        await setDoc(doc(context.firestore(), 'opportunityInquiries', 'inquiry-1', 'messages', 'message-1'), { body: 'Private' });
      });
      await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), 'publicOpportunities', 'listing-1')));
      await assertFails(getDoc(doc(testEnv.authenticatedContext('user-1').firestore(), 'publicOpportunities', 'listing-1')));
      await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('user-1').firestore(), 'opportunityInquiries', 'inquiry-1')));
      await assertSucceeds(getDoc(doc(testEnv.authenticatedContext('user-2').firestore(), 'opportunityInquiries', 'inquiry-1', 'messages', 'message-1')));
      await assertFails(getDoc(doc(testEnv.authenticatedContext('user-3').firestore(), 'opportunityInquiries', 'inquiry-1')));
    });
  });
});
