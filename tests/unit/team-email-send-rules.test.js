import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertFails, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
const projectId = process.env.FIRESTORE_EMULATOR_PROJECT_ID || `allplays-team-email-rules-${Date.now()}`;

describe('team email send Firestore boundary', () => {
  it('keeps the client-writable relay collection server-only', () => {
    const block = rules.slice(rules.indexOf('match /emailSends/{sendId}'), rules.indexOf('// Chat messages subcollection'));
    expect(block).toContain('allow create, update, delete: if false;');
    expect(block).not.toContain('allow create: if');
  });

  describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('rules engine coverage', () => {
    let testEnv;

    beforeAll(async () => {
      testEnv = await initializeTestEnvironment({ projectId, firestore: { rules } });
    }, 30000);
    beforeEach(async () => {
      await testEnv.clearFirestore();
      await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), 'teams', 'team-1'), {
          ownerId: 'owner-1',
          adminEmails: ['coach@example.com']
        });
        await setDoc(doc(context.firestore(), 'users', 'platform-admin'), { isAdmin: true });
        await setDoc(doc(context.firestore(), 'users', 'parent-1'), { parentTeamIds: ['team-1'] });
      });
    }, 30000);
    afterAll(async () => {
      await testEnv?.cleanup();
    }, 30000);

    it('denies owner, team admin, platform admin, and parent creates', async () => {
      const actors = [
        { context: testEnv.authenticatedContext('owner-1'), uid: 'owner-1' },
        { context: testEnv.authenticatedContext('coach-1', { email: 'coach@example.com' }), uid: 'coach-1' },
        { context: testEnv.authenticatedContext('platform-admin'), uid: 'platform-admin' },
        { context: testEnv.authenticatedContext('parent-1'), uid: 'parent-1' }
      ];
      for (const [index, actor] of actors.entries()) {
        await assertFails(setDoc(doc(actor.context.firestore(), 'teams', 'team-1', 'emailSends', `send-${index}`), {
          teamId: 'team-1',
          createdBy: actor.uid,
          recipients: ['external@example.com'],
          subject: 'Relay',
          body: 'Blocked'
        }));
      }
    });
  });
});
