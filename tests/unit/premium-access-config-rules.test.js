import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp, updateDoc } from 'firebase/firestore';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

describe('global premium access Firestore rules', () => {
  it('keeps the flag public, exact, admin-controlled, and free of billing state', () => {
    expect(rules).toContain("data.keys().hasOnly(['openToAll', 'updatedAt'])");
    expect(rules).toContain("data.keys().hasAll(['openToAll'])");
    expect(rules).toContain('data.openToAll is bool');
    expect(rules).toMatch(/match \/platformConfig\/\{configId\}[\s\S]*?allow get: if configId == 'premium';/);
    expect(rules).toMatch(/match \/platformConfig\/\{configId\}[\s\S]*?allow list: if false;/);
    expect(rules).toMatch(/match \/platformConfig\/\{configId\}[\s\S]*?isGlobalAdmin\(\)/);
    expect(rules).toMatch(/match \/platformConfig\/\{configId\}[\s\S]*?allow delete: if false;/);
  });

  describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('emulator authorization coverage', () => {
    let testEnv;

    beforeAll(async () => {
      testEnv = await initializeTestEnvironment({
        projectId: `allplays-premium-config-${Date.now()}`,
        firestore: { rules }
      });
    }, 30000);

    beforeEach(async () => {
      await testEnv.clearFirestore();
      await testEnv.withSecurityRulesDisabled(async (context) => {
        const firestore = context.firestore();
        await setDoc(doc(firestore, 'users/admin-1'), { isAdmin: true });
        await setDoc(doc(firestore, 'platformConfig/premium'), { openToAll: true });
      });
    });

    afterAll(async () => testEnv?.cleanup());

    it('allows anyone to get the exact premium flag but denies collection listing', async () => {
      const publicDb = testEnv.unauthenticatedContext().firestore();
      await assertSucceeds(getDoc(doc(publicDb, 'platformConfig/premium')));
      await assertFails(getDocs(collection(publicDb, 'platformConfig')));
      await assertFails(getDoc(doc(publicDb, 'platformConfig/other')));
    });

    it('allows only a global admin to write the exact boolean schema', async () => {
      const userDb = testEnv.authenticatedContext('user-1').firestore();
      const adminDb = testEnv.authenticatedContext('admin-1').firestore();
      const premiumRef = doc(adminDb, 'platformConfig/premium');

      await assertFails(updateDoc(doc(userDb, 'platformConfig/premium'), { openToAll: false }));
      await assertSucceeds(updateDoc(premiumRef, { openToAll: false, updatedAt: Timestamp.now() }));
      await assertFails(setDoc(premiumRef, { openToAll: 'false' }));
      await assertFails(setDoc(premiumRef, { openToAll: false, stripeCustomerId: 'private' }));
      await assertFails(setDoc(doc(adminDb, 'platformConfig/other'), { openToAll: false }));
      await assertFails(deleteDoc(premiumRef));
    });
  });
});
