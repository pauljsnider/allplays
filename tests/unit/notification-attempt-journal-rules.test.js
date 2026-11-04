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
const { createScheduleEvidenceAuthority } = require('../../functions/schedule-delivery-evidence.cjs');
const { createFirestoreStatusRateLimit } = require('../../functions/schedule-delivery-status.cjs');

const { createScheduleProofOrdering } = require('../../functions/schedule-proof-ordering.cjs');
const { createScheduleEffectEligibility } = require('../../functions/schedule-effect-eligibility.cjs');
const { createScheduleConsumerOwnership } = require('../../functions/schedule-consumer-ownership.cjs');

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
        const actor = { uid: 'owner', clientId: 'synthetic-client', sessionId: 'synthetic-session', grantKey: hash('synthetic-grant'), reviewRequests: true, expiresAt: committedAt + 200000 };
        const approval = { ...actor, sessionId: 'synthetic-session', approvalId: 'synthetic-approval', proposalId: 'synthetic-proposal', teamId: 'team-1', eventId: 'event-1',
            intentDigest: hash('synthetic-intent'), previewDigest: hash('synthetic-preview'), eventDigest: hash(event.data), beforeVersion: null, mode: 'create', eventType: 'practice',
            approve: true, notifyTeam: true, consumed: true, issuedAt: committedAt - 1000, expiresAt: committedAt + 60000, consumedAt: committedAt - 1 };
        const store = serverStore(database); let sends = 0; let pushThrows = false;
        let evidenceClock = committedAt - 1; let observation;
        const authority = createScheduleEvidenceAuthority({ store, now: () => evidenceClock, authenticate: async () => actor,
            resolveCommand: async () => approval, verifyForm: async () => ({ ...approval, disconnected: false }),
            verifyCommitObservation: async () => observation, authorize: async () => (await getDoc(doc(database, 'teams/team-1'))).data().ownerId === actor.uid });
        const evidenceRef = await authority.issue('synthetic-credential', { formHandle: 'test-authority', commandHandle: 'test-authority' });
        const dispatch = await authority.consume('synthetic-credential', evidenceRef); evidenceClock = committedAt + 1;
        observation = { ...approval, sourceVersion: event.version, committed: true, committedAt, dispatchId: dispatch.dispatchId };
        await authority.recordCommit('synthetic-credential', evidenceRef, dispatch.dispatchId, 'test-observer');
        const providers = createScheduleDeliveryProviders({ firestore: serverDatabase(database), messaging: { send: async () => { sends++; if (pushThrows) throw new Error('Synthetic lost push response'); return 'projects/synthetic/messages/emulator'; } } });
        const dependencies = { store, providers, now: () => committedAt + 1, authenticate: async () => actor, verifyApproval: authority.verifyApproval,
            verifyCommit: authority.verifyCommit, readEvent,
            authorize: async () => { const team = (await getDoc(doc(database, 'teams/team-1'))).data(); return { actorAllowed: team.ownerId === actor.uid, recipientAllowed: team.recipientEnabled !== false }; },
            resolveRecipients: async () => [{ recipientUid: 'member', channel: 'inbox', endpoint: 'member' }, { recipientUid: 'member', channel: 'push', endpoint: 'synthetic-device' }] };
        const coordinator = createScheduleDeliveryCoordinator(dependencies);
        const reference = await coordinator.bind('synthetic-credential', { approvalHandle: evidenceRef, commitHandle: evidenceRef });
        return { coordinator, reference, store, authority, evidenceRef, restart: () => createScheduleDeliveryCoordinator(dependencies), sends: () => sends, losePush: () => { pushThrows = true; } };
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
            privatePaths = [bindingPath, `teams/team-1/notificationSendLog/durable_${f.evidenceRef.evidenceId}`, `teams/team-1/notificationSendLog/durable_${planId}`, ...plan.requests.map((value) => journalPath(value))];
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
    it('retains consumed approval evidence after restart and denies repeat execution', async () => {
        await env.withSecurityRulesDisabled(async (context) => {
            const f = await coordinatorFixture(context.firestore());
            await expect(f.authority.consume('synthetic-credential', f.evidenceRef)).rejects.toMatchObject({ code: 'approval_replayed' });
            expect((await f.authority.verifyCommit(f.evidenceRef)).committed).toBe(true);
            await updateDoc(doc(context.firestore(), 'teams/team-1'), { ownerId: 'replacement' });
            await expect(f.authority.consume('synthetic-credential', f.evidenceRef)).rejects.toThrow();
        });
    });
    it('serializes proof/trigger recovery with real transactions and one journaled synthetic send', async () => {
        let fencePath; let inboxPath;
        await env.withSecurityRulesDisabled(async (context) => {
            const store = serverStore(context.firestore()); let clock = 100000;
            const fields = { type: { stringValue: 'game' }, status: { stringValue: 'scheduled' }, date: { timestampValue: '2060-01-01T10:00:00Z' } };
            const event = { teamId: 'team-1', eventId: 'event-1', sourceVersion: '1970-01-01T00:01:40.001000000Z', category: 'schedule', beforeVersion: null, eventDigest: hash(fields) };
            const intent = { teamId: event.teamId, eventId: event.eventId, uid: 'owner', beforeVersion: null, eventDigest: event.eventDigest, intentDigest: hash('synthetic-intent'), approvalId: hash('synthetic-proof'), approve: true, notifyTeam: true, consumed: true, expiresAt: 150000 };
            const reference = { teamId: event.teamId, evidenceId: intent.approvalId };
            const verifyCommit = async () => ({ ...intent, sourceVersion: event.sourceVersion, committed: true, mode: 'create', eventType: 'game' });
            const create = () => createScheduleProofOrdering({ store, now: () => clock, verifyApprovedIntent: async () => intent, verifyCommit, verifyTrigger: async () => event });
            const armed = await create().arm('synthetic-private-intent'); const effect = await create().captureTrigger('synthetic-platform-trigger');
            fencePath = `teams/team-1/notificationSendLog/durable_${armed.fenceId}`;
            inboxPath = `teams/team-1/notificationSendLog/durable_${hash({ kind: 'schedule-trigger-inbox-v1', ...effect })}`;
            const decide = createScheduleConsumerOwnership({ store, readVerifiedDeploymentGate: async () => ({ mode: 'journal', legacyHead: 'a'.repeat(40), journalHead: 'b'.repeat(40), legacyCompatible: true, bothConsumersGated: true, compatibleProducersVerified: true }),
                verifyEffectEligibility: createScheduleEffectEligibility({ resolveEffect: create().resolveEffect, verifyCommit, readEvent: async () => ({ version: event.sourceVersion, data: fields }) }) });
            await expect(decide({ ...effect, consumer: 'legacy' })).rejects.toMatchObject({ code: 'proof_pending' });
            clock = 150001;
            await Promise.allSettled([create().publish(reference), create().closeForLegacy(effect)]);
            const resolution = await create().resolveEffect(effect); expect(['legacy', 'proof']).toContain(resolution.state);
            const owner = resolution.state === 'proof' ? 'journal' : 'legacy'; let sends = 0;
            const deliver = async (consumer) => {
                if (!(await decide({ ...effect, consumer })).mayConsume) return;
                const journal = createNotificationAttemptJournal({ store, now: () => clock,
                    authorize: async () => ({ actorAllowed: (await decide({ ...effect, consumer })).mayConsume, sourceCurrent: true, recipientAllowed: true }),
                    send: async (_request, metadata) => { sends++; return accepted(metadata); } });
                await journal.deliver({ ...request, sourceVersion: event.sourceVersion });
            };
            await Promise.all([deliver('legacy'), deliver('journal'), deliver(owner)]);
            await deliver(owner); expect(sends).toBe(1);
            expect((await decide({ ...effect, consumer: owner })).owner).toBe(owner);
        });
        for (const path of [fencePath, inboxPath]) for (const uid of ['owner', 'member']) {
            await assertFails(getDoc(doc(db(uid), path)));
            await assertFails(setDoc(doc(db(uid), path), { state: 'proof', eligible: true }));
        }
    });
    it('keeps durable status counters server-private and shared across instances', async () => {
        const key = hash('synthetic-principal');
        await env.withSecurityRulesDisabled(async (context) => {
            const first = createFirestoreStatusRateLimit({ firestore: serverDatabase(context.firestore()), now: () => 100000 });
            const second = createFirestoreStatusRateLimit({ firestore: serverDatabase(context.firestore()), now: () => 100000 });
            const input = { key, limit: 30, windowMs: 60000 };
            for (let i = 0; i < 30; i++) expect(await first(input)).toBe(true);
            expect(await second(input)).toBe(false);
        });
        for (const uid of ['owner', 'member', 'other']) {
            await assertFails(getDoc(doc(db(uid), `mcpStatusRateLimits/${key}`)));
            await assertFails(setDoc(doc(db(uid), `mcpStatusRateLimits/${key}`), { count: 0, window: 1 }));
        }
    });
});
