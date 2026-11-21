import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { collection, doc, setDoc, deleteDoc, getDoc, getDocs, query, orderBy,
    limit, startAfter, onSnapshot } from 'firebase/firestore';

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('overlay SDK limited-window semantics', () => {
    let env;
    beforeAll(async () => {
        env = await initializeTestEnvironment({ projectId: 'demo-allplays', firestore: {
            rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')
        } });
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async context => {
            const db = context.firestore();
            await setDoc(doc(db, 'teams/overlay-fixture'), { ownerId: 'fixture-owner', active: true });
            await setDoc(doc(db, 'teams/overlay-fixture/games/fixture'), {
                type: 'game', visibility: 'public', shareable: true, liveStatus: 'live', status: 'scheduled'
            });
            for (let n = 1; n <= 20; n++) await setDoc(doc(db, `teams/overlay-fixture/games/fixture/liveEvents/e${n}`), { createdAt: n });
        });
    }, 30000);
    afterAll(async () => { await env?.cleanup(); });

    it('proves limit eviction is not deletion, paginates within20, and observes real deletion', async () => {
        const db = env.unauthenticatedContext().firestore();
        const path = 'teams/overlay-fixture/games/fixture/liveEvents';
        const ref = collection(db, path);
        let latest;
        let failure;
        const unsubscribe = onSnapshot(query(ref, orderBy('createdAt', 'desc'), limit(20)),
            snapshot => { latest = snapshot; }, error => { failure = error; });
        try {
            await expect.poll(() => failure || latest?.size).toBe(20);
            await env.withSecurityRulesDisabled(context => setDoc(doc(context.firestore(), `${path}/e21`), { createdAt: 21 }));
            await expect.poll(() => latest?.docs[0]?.id).toBe('e21');
            expect(latest.docs.some(row => row.id === 'e1')).toBe(false);
            expect(latest.docChanges().some(change => change.type === 'removed' && change.doc.id === 'e1')).toBe(true);
            expect((await getDoc(doc(db, `${path}/e1`))).exists()).toBe(true);
            const first = await getDocs(query(ref, orderBy('createdAt'), limit(20)));
            const second = await getDocs(query(ref, orderBy('createdAt'), startAfter(first.docs.at(-1)), limit(20)));
            expect(first.size + second.size).toBe(21);
            await assertFails(getDocs(query(ref, limit(21))));
            await env.withSecurityRulesDisabled(context => deleteDoc(doc(context.firestore(), `${path}/e1`)));
            expect((await getDoc(doc(db, `${path}/e1`))).exists()).toBe(false);
            expect((await getDocs(query(ref, orderBy('createdAt'), limit(20)))).size).toBe(20);
            expect(failure).toBeUndefined();
        } finally { unsubscribe(); }
    }, 30000);
});
