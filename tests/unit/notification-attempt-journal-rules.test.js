import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, runTransaction, updateDoc } from 'firebase/firestore';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
const require = createRequire(import.meta.url);
const { createNotificationAttemptJournal, createFirestoreNotificationJournalStore, normalizeNotificationAttempt } = require('../../functions/notification-attempt-journal.cjs');
const { createScheduleDeliveryCoordinator, scheduleDeliveryFingerprint: hash } = require('../../functions/schedule-delivery-coordinator.cjs');
const { createScheduleDeliveryProviders } = require('../../functions/schedule-delivery-providers.cjs');

const projectId = 'demo-allplays-mcp-review';
const request = { teamId: 'team-1', eventId: 'event-1', actorUid: 'owner', recipientUid: 'member', sourceVersion: '2060-01-01T10:00:00Z', channel: 'push', endpoint: 'synthetic-private-device', title: 'Synthetic update', body: 'Synthetic schedule changed.' };
const accepted = (metadata) => ({ ...metadata, final: true, outcome: 'accepted', receiptId: 'synthetic-provider-receipt' });
const journalPath = (value = request) => `teams/team-1/notificationSendLog/durable_${normalizeNotificationAttempt(value).effectId}`;

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('notification journal with real rules and server-only storage', () => {
    let env;
    beforeAll(async () => { env = await initializeTestEnvironment({ projectId, firestore: { rules: compactFirestoreRules(readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')) } }); }, 30000);
    afterAll(async () => env?.cleanup());
    const db = (uid = 'owner') => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
    const serverDatabase = (database) => ({
        doc: (path) => ({ path, get: async () => { const value = await getDoc(doc(database, path)); return { exists: value.exists(), data: () => value.data() }; } }),
        runTransaction: (callback) => runTransaction(database, (transaction) => callback({
            get: async (reference) => { const value = await transaction.get(doc(database, reference.path)); return { exists: value.exists(), data: () => value.data() }; },
            set: (reference, data) => transaction.set(doc(database, reference.path), data)
        }))
    });
    const serverStore = (database) => createFirestoreNotificationJournalStore(serverDatabase(database));
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

    // These trusted verification callbacks are isolated test authorities, not
    // proof that the deployed OAuth broker emits signed commit evidence.
    async function coordinatorFixture(database) {
        const host = process.env.FIRESTORE_EMULATOR_HOST;
        if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Local emulator required');
        await setDoc(doc(database, 'teams/team-1/games/event-1'), { type: 'practice', title: 'Synthetic practice' });
        const readEvent = async () => {
            const response = await fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents/teams/team-1/games/event-1`, { headers: { authorization: 'Bearer owner' } });
            if (!response.ok) throw new Error('Emulator event unavailable');
            const row = await response.json();
            return { version: row.updateTime, data: { type: row.fields.type.stringValue, title: row.fields.title.stringValue } };
        };
        const event = await readEvent();
        const committedAt = Date.parse(event.version);
        const actor = { uid: 'owner', clientId: 'synthetic-client', grantKey: hash('synthetic-grant'), reviewRequests: true, expiresAt: committedAt + 200000 };
        const approval = { ...actor, sessionId: 'synthetic-session', approvalId: 'synthetic-approval', proposalId: 'synthetic-proposal', teamId: 'team-1', eventId: 'event-1',
            intentDigest: hash('synthetic-intent'), eventDigest: hash(event.data), beforeVersion: null, mode: 'create', eventType: 'practice',
            approve: true, notifyTeam: true, consumed: true, issuedAt: committedAt - 1000, expiresAt: committedAt + 60000, consumedAt: committedAt - 1 };
        const store = serverStore(database); let sends = 0; let pushThrows = false;
        const providers = createScheduleDeliveryProviders({ firestore: serverDatabase(database), messaging: { send: async () => { sends++; if (pushThrows) throw new Error('Synthetic lost push response'); return 'projects/synthetic/messages/emulator'; } } });
        const dependencies = { store, providers, now: () => committedAt + 1, authenticate: async () => actor, verifyApproval: async () => approval,
            verifyCommit: async () => ({ ...approval, sourceVersion: event.version, committed: true, committedAt }), readEvent,
            authorize: async () => { const team = (await getDoc(doc(database, 'teams/team-1'))).data(); return { actorAllowed: team.ownerId === actor.uid, recipientAllowed: team.recipientEnabled !== false }; },
            resolveRecipients: async () => [{ recipientUid: 'member', channel: 'inbox', endpoint: 'member' }, { recipientUid: 'member', channel: 'push', endpoint: 'synthetic-device' }] };
        const coordinator = createScheduleDeliveryCoordinator(dependencies);
        const reference = await coordinator.bind('synthetic-credential', { approvalHandle: 'test-authority', commitHandle: 'test-authority' });
        return { coordinator, reference, store, restart: () => createScheduleDeliveryCoordinator(dependencies), sends: () => sends, losePush: () => { pushThrows = true; } };
    }
    it('binds the actual emulator updateTime, coordinates two workers, and keeps approval/provider records private', async () => {
        let privatePaths; let inboxPath;
        await env.withSecurityRulesDisabled(async (context) => {
            const database = context.firestore(); const f = await coordinatorFixture(database);
            await Promise.all([f.coordinator.deliver('synthetic-credential', f.reference), f.restart().deliver('synthetic-credential', f.reference)]);
            expect(f.sends()).toBe(1);
            expect((await f.coordinator.status('synthetic-credential', f.reference, { reconcile: true })).accepted).toBe(2);
            const bindingPath = `teams/team-1/notificationSendLog/durable_${f.reference.bindingId}`;
            const binding = (await getDoc(doc(database, bindingPath))).data();
            const planId = hash({ plan: true, teamId: 'team-1', eventId: 'event-1', sourceVersion: binding.sourceVersion });
            const plan = await f.store.get('team-1', planId);
            privatePaths = [bindingPath, `teams/team-1/notificationSendLog/durable_${planId}`, ...plan.requests.map((value) => journalPath(value))];
            inboxPath = plan.requests.find((value) => value.channel === 'inbox').provider.parameters.path;
            const inbox = (await getDoc(doc(database, inboxPath))).data();
            expect(inbox.createdAt.toDate()).toBeInstanceOf(Date);
            expect(JSON.stringify(inbox)).not.toMatch(/grantKey|synthetic-device|approvalId|requestHash/);
        });
        for (const uid of ['owner', 'member', 'other']) for (const path of privatePaths) {
            await assertFails(getDoc(doc(db(uid), path)));
            await assertFails(setDoc(doc(db(uid), path), { status: 'completed', approve: true, notifyTeam: true }));
        }
        expect((await getDoc(doc(db('member'), inboxPath))).exists()).toBe(true);
        await assertFails(getDoc(doc(db('other'), inboxPath)));
        await assertFails(setDoc(doc(db('member'), inboxPath), { title: 'Forged delivery' }));
    });
    it('reconciles a persisted mixed outcome after restart without replaying an uncertain push', async () => {
        await env.withSecurityRulesDisabled(async (context) => {
            const f = await coordinatorFixture(context.firestore()); f.losePush();
            const result = await f.coordinator.deliver('synthetic-credential', f.reference);
            expect(result.accepted).toBe(1); expect(result.uncertain).toBe(1);
            const restart = f.restart();
            expect((await restart.status('synthetic-credential', f.reference, { reconcile: true })).uncertain).toBe(1);
            expect((await restart.deliver('synthetic-credential', f.reference)).uncertain).toBe(1); expect(f.sends()).toBe(1);
            await updateDoc(doc(context.firestore(), 'teams/team-1'), { ownerId: 'replacement' });
            await expect(restart.status('synthetic-credential', f.reference)).rejects.toThrow();
        });
    });
    it('rejects an intervening real event revision before audience resolution or provider dispatch', async () => {
        await env.withSecurityRulesDisabled(async (context) => {
            const f = await coordinatorFixture(context.firestore());
            await updateDoc(doc(context.firestore(), 'teams/team-1/games/event-1'), { title: 'A later edit' });
            await expect(f.coordinator.deliver('synthetic-credential', f.reference)).rejects.toMatchObject({ code: 'source_changed' });
            expect(f.sends()).toBe(0);
        });
    });
});
