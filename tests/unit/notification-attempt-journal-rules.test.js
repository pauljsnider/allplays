import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, runTransaction, updateDoc } from 'firebase/firestore';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
const require = createRequire(import.meta.url);
const { createNotificationAttemptJournal, createFirestoreNotificationJournalStore, normalizeNotificationAttempt } = require('../../functions/notification-attempt-journal.cjs');

const projectId = 'demo-allplays-mcp-review';
const request = { teamId: 'team-1', eventId: 'event-1', actorUid: 'owner', recipientUid: 'member', sourceVersion: '2060-01-01T10:00:00Z', channel: 'push', endpoint: 'synthetic-private-device', title: 'Synthetic update', body: 'Synthetic schedule changed.' };
const accepted = (metadata) => ({ ...metadata, final: true, outcome: 'accepted', receiptId: 'synthetic-provider-receipt' });
const journalPath = (value = request) => `teams/team-1/notificationSendLog/durable_${normalizeNotificationAttempt(value).effectId}`;

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('notification journal with real rules and server-only storage', () => {
    let env;
    beforeAll(async () => { env = await initializeTestEnvironment({ projectId, firestore: { rules: compactFirestoreRules(readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')) } }); }, 30000);
    afterAll(async () => env?.cleanup());
    const db = (uid = 'owner') => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
    const serverStore = (database) => createFirestoreNotificationJournalStore({
        doc: (path) => ({ path, get: async () => { const value = await getDoc(doc(database, path)); return { exists: value.exists(), data: () => value.data() }; } }),
        runTransaction: (callback) => runTransaction(database, (transaction) => callback({
            get: async (reference) => { const value = await transaction.get(doc(database, reference.path)); return { exists: value.exists(), data: () => value.data() }; },
            set: (reference, data) => transaction.set(doc(database, reference.path), data)
        }))
    });
    // Synthetic authorization resolver for this emulator fixture only. Production
    // needs verified trigger/callable identity plus authoritative source binding.
    const authorize = async () => {
        const team = (await getDoc(doc(db(), 'teams/team-1'))).data();
        return { actorAllowed: team?.ownerId === 'owner', sourceCurrent: true, recipientAllowed: team?.recipientEnabled !== false };
    };
    beforeEach(async () => {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(context.firestore(), 'teams/team-1'), { ownerId: 'owner', name: 'Synthetic Team', recipientEnabled: true });
        });
    });
    it('persists exact server-only requests while denying manager/member reads and forged receipts', async () => {
        await env.withSecurityRulesDisabled(async (context) => {
            const journal = createNotificationAttemptJournal({ store: serverStore(context.firestore()), authorize, send: async (_value, metadata) => accepted(metadata) });
            expect((await journal.deliver(request)).status).toBe('accepted');
            expect((await getDoc(doc(context.firestore(), journalPath()))).data().request.endpoint).toBe(request.endpoint);
        });
        for (const uid of ['owner', 'member', 'other']) {
            await assertFails(getDoc(doc(db(uid), journalPath())));
            await assertFails(setDoc(doc(db(uid), journalPath()), { status: 'accepted', request }));
        }
    });
    it('uses a durable transaction lease across independent workers and frozen channel plans', async () => {
        await env.withSecurityRulesDisabled(async (context) => {
            const store = serverStore(context.firestore()); let sends = 0; let release; let entered;
            const started = new Promise((resolve) => { entered = resolve; });
            const send = async (_value, metadata) => { sends++; entered(); await new Promise((resolve) => { release = resolve; }); return accepted(metadata); };
            const one = createNotificationAttemptJournal({ store, authorize, send });
            const two = createNotificationAttemptJournal({ store, authorize, send });
            const pending = one.deliverPlan([request]); await started;
            const concurrent = await two.deliverPlan([{ ...request, endpoint: 'rotated-device' }]);
            expect(concurrent.results[0].status).toBe('dispatching'); expect(sends).toBe(1);
            release(); expect((await pending).results[0].status).toBe('accepted');
            expect((await two.deliverPlan([request])).results[0].status).toBe('accepted'); expect(sends).toBe(1);
        });
    });
    it('reconciles persisted uncertainty after restart without resending, and denies status after actor revocation', async () => {
        await env.withSecurityRulesDisabled(async (context) => {
            const store = serverStore(context.firestore()); let metadata; let sends = 0;
            const journal = createNotificationAttemptJournal({ store, authorize, send: async (_value, value) => { sends++; metadata = value; throw new Error('Synthetic lost response'); } });
            expect((await journal.deliver(request)).status).toBe('uncertain');
            const restart = createNotificationAttemptJournal({ store, authorize, send: async () => { sends++; }, reconcile: async () => accepted(metadata) });
            expect((await restart.deliver(request)).status).toBe('uncertain');
            expect((await restart.reconcile(request)).status).toBe('accepted'); expect(sends).toBe(1);
            await updateDoc(doc(context.firestore(), 'teams/team-1'), { ownerId: 'replacement' });
            await expect(restart.status(request)).rejects.toThrow();
        });
    });
    it('suppresses a target revoked after reservation without invoking the provider', async () => {
        await env.withSecurityRulesDisabled(async (context) => {
            let sends = 0;
            const journal = createNotificationAttemptJournal({ store: serverStore(context.firestore()), authorize: async (_value, phase) => {
                if (phase === 'before_dispatch') await updateDoc(doc(context.firestore(), 'teams/team-1'), { recipientEnabled: false });
                return authorize();
            }, send: async () => { sends++; } });
            expect((await journal.deliver(request)).status).toBe('suppressed'); expect(sends).toBe(0);
        });
    });
});
