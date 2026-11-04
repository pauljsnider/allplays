"use strict";
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { createScheduleRecoveryPipeline } = require('../schedule-recovery-pipeline.cjs');
const { createFirestoreNotificationJournalStore } = require('../notification-attempt-journal.cjs');
const { scheduleDeliveryFingerprint: hash } = require('../schedule-delivery-coordinator.cjs');
const { FakeFirestore } = require('./helpers/notification-journal-fixture.cjs');
function fixture() {
    const db = new FakeFirestore(); const store = createFirestoreNotificationJournalStore(db); let clock = 100000;
    let ready = 'ready'; let legacyFails = false; let authorized = true; let providerFails = false; let sends = 0;
    const fields = { type: { stringValue: 'game' }, status: { stringValue: 'scheduled' }, date: { timestampValue: '2060-01-01T12:00:00Z' } };
    const intent = { teamId: 'team', eventId: 'event', uid: 'owner', beforeVersion: null, eventDigest: hash(fields), intentDigest: hash('intent'), approvalId: hash('approval'),
        approve: true, notifyTeam: true, consumed: true, expiresAt: 150000 };
    const reference = { teamId: 'team', evidenceId: intent.approvalId };
    const event = { teamId: 'team', eventId: 'event', sourceVersion: '1970-01-01T00:01:40.001000000Z', beforeVersion: null,
        fields, actorUid: 'owner', title: 'Schedule changed', body: 'Review the schedule in the app.' };
    const targets = [{ recipientUid: 'member', channel: 'push', endpoint: 'synthetic-device' }];
    const dependencies = { store, now: () => clock,
        authority: { verifyConsumedApproval: async (ref) => { assert.deepEqual(ref, reference); return intent; }, verifyCommit: async (ref) => { assert.deepEqual(ref, reference); return { ...intent, mode: 'create', eventType: 'game', committed: true, sourceVersion: event.sourceVersion }; } },
        verifyPlatformTrigger: async (handle) => { if (handle !== 'platform-trigger') throw new Error('Untrusted trigger'); return event; },
        assessAudience: async () => { if (ready === 'unavailable') throw new Error('Temporary read error'); return ready === 'ready' ? { state: 'ready', targets } : { state: 'legacy_required' }; },
        prepareLegacyPlan: async () => { if (legacyFails) throw new Error('Temporary legacy read error'); return targets; },
        authorizeDelivery: async () => ({ actorAllowed: authorized, recipientAllowed: authorized, sourceCurrent: true }),
        providers: { pin: (request) => ({ ...request, provider: { adapter: 'synthetic-v1', parameters: { fixture: true } } }), send: async (_request, metadata) => { sends++; if (providerFails) throw new Error('Synthetic unknown outcome'); return { ...metadata, final: true, outcome: 'accepted', receiptId: 'synthetic-receipt' }; } },
        readVerifiedDeploymentGate: async () => ({ mode: 'journal', legacyHead: 'a'.repeat(40), journalHead: 'b'.repeat(40), legacyCompatible: true, bothConsumersGated: true, compatibleProducersVerified: true }),
        scanWork: async () => ({ rows: [...db.documents.values()].map((row) => structuredClone(row)), nextCursor: null }) };
    const create = () => createScheduleRecoveryPipeline(dependencies); const pipeline = create();
    const start = async () => { const handle = await pipeline.producer.arm(reference); await pipeline.producer.beginWrite(handle); return handle; };
    const owners = () => [...db.documents.values()].filter((row) => row.kind === 'schedule-consumer-owner');
    const jobs = () => [...db.documents.values()].filter((row) => row.kind === 'schedule-recovery-job');
    return { db, dependencies, intent, reference, event, targets, pipeline, create, start, owners, jobs, sends: () => sends,
        readiness: (value) => { ready = value; }, failLegacy: () => { legacyFails = true; }, revoke: () => { authorized = false; }, loseProvider: () => { providerFails = true; }, expire: () => { clock = 150001; } };
}
describe('isolated producer/trigger/recovery composition', () => {
    it('persists the full payload before acknowledgment and delivers once after proof across restart and concurrent recovery', async () => {
        const f = fixture(); const handle = await f.start(); const effect = await f.pipeline.capture('platform-trigger');
        assert.deepEqual(f.jobs()[0].payload.fields, f.event.fields); assert.equal((await f.create().process(effect)).state, 'waiting'); assert.equal(f.owners().length, 0);
        await f.pipeline.producer.publish(f.reference, handle);
        await Promise.all([f.create().process(effect), f.create().recover({ teamId: 'team' })]);
        assert.equal(f.sends(), 1); assert.equal(f.jobs()[0].state, 'completed'); assert.equal(f.owners()[0].owner, 'journal');
    });
    it('uses legacy before arming when readiness is known incompatible', async () => {
        const f = fixture(); f.readiness('legacy_required'); const handle = await f.start();
        assert.equal(f.db.documents.size, 0); const effect = await f.pipeline.capture('platform-trigger');
        await f.pipeline.producer.publish(f.reference, handle); assert.equal((await f.create().process(effect)).owner, 'legacy'); assert.equal(f.sends(), 1);
    });
    it('chooses legacy if readiness changes before owner selection', async () => {
        const f = fixture(); const handle = await f.start(); const effect = await f.pipeline.capture('platform-trigger');
        await f.pipeline.producer.publish(f.reference, handle); f.readiness('legacy_required');
        assert.equal((await f.create().process(effect)).owner, 'legacy'); assert.equal(f.sends(), 1);
    });
    for (const kind of ['canonical', 'legacy']) it(`does not select ownership when ${kind} audience preparation fails`, async () => {
        const f = fixture(); const handle = await f.start(); const effect = await f.pipeline.capture('platform-trigger'); await f.pipeline.producer.publish(f.reference, handle);
        if (kind === 'canonical') f.readiness('unavailable'); else f.failLegacy();
        await assert.rejects(f.create().process(effect)); assert.equal(f.owners().length, 0); assert.equal(f.sends(), 0); assert.equal(f.jobs().length, 1);
    });
    it('recovers a payload persisted before trigger-index acknowledgment was lost', async () => {
        const f = fixture(); await f.start(); f.db.failAfterTransactions.add(f.db.transactionCount + 1);
        await assert.rejects(f.pipeline.capture('platform-trigger')); assert.equal(f.jobs().length, 1);
        f.expire(); await f.create().recover({ teamId: 'team' }); assert.equal(f.sends(), 1); assert.equal(f.owners()[0].owner, 'legacy');
    });
    it('retains a frozen plan after an uncertain plan-persistence response and does not rediscover audiences', async () => {
        const f = fixture(); const handle = await f.start(); const effect = await f.pipeline.capture('platform-trigger'); await f.pipeline.producer.publish(f.reference, handle);
        // process first repeats captureTrigger transaction, then freezes plans.
        f.db.failAfterTransactions.add(f.db.transactionCount + 2); await assert.rejects(f.create().process(effect));
        assert.ok(f.jobs()[0].plans); f.readiness('unavailable'); await f.create().process(effect); assert.equal(f.sends(), 1);
    });
    it('cancels expired unstarted arms during recovery and allows a fresh bound intent', async () => {
        const f = fixture(); const stale = await f.pipeline.producer.arm(f.reference); f.expire();
        const recovery = await f.create().recover({ teamId: 'team' }); assert.deepEqual(recovery.results, [{ state: 'cancelled_unstarted' }]);
        await assert.rejects(f.pipeline.producer.beginWrite(stale));
        f.intent.expiresAt = 200000; f.intent.approvalId = hash('new'); f.intent.intentDigest = hash('new intent'); f.reference.evidenceId = f.intent.approvalId;
        const next = await f.pipeline.producer.arm(f.reference); await f.pipeline.producer.beginWrite(next);
        assert.equal([...f.db.documents.values()].filter((row) => row.state === 'cancelled').length, 1);
    });
    it('does not recycle an ambiguous dispatched write with no trigger', async () => {
        const f = fixture(); const handle = await f.start(); f.expire(); await f.create().recover({ teamId: 'team' });
        await assert.rejects(f.pipeline.producer.cancelUnstarted(handle)); assert.equal(f.sends(), 0);
    });
    it('keeps uncertainty durable without a second send across recovery', async () => {
        const f = fixture(); const handle = await f.start(); const effect = await f.pipeline.capture('platform-trigger'); await f.pipeline.producer.publish(f.reference, handle); f.loseProvider();
        assert.equal((await f.create().process(effect)).state, 'uncertain'); await f.create().recover({ teamId: 'team' }); assert.equal(f.sends(), 1); assert.equal(f.jobs()[0].state, 'uncertain');
    });
    it('reconciles a verified provider acceptance across worker restart without a second send', async () => {
        const { createScheduleRecoveryWorker } = require('../schedule-recovery-worker.cjs');
        const f = fixture(); const handle = await f.start(); const effect = await f.pipeline.capture('platform-trigger'); await f.pipeline.producer.publish(f.reference, handle); f.loseProvider();
        assert.equal((await f.create().process(effect)).state, 'uncertain'); let reconciliations = 0;
        f.dependencies.providers.reconcile = async (_request, metadata) => { reconciliations++; return { ...metadata, final: true, outcome: 'accepted', receiptId: 'synthetic-reconciled' }; };
        const createWorker = () => createScheduleRecoveryWorker({ store: f.dependencies.store, pipeline: f.create(), now: f.dependencies.now, authorizeRun: async () => true });
        await Promise.all([createWorker().run({ teamId: 'team' }), createWorker().run({ teamId: 'team' })]);
        assert.equal(f.jobs()[0].state, 'completed'); assert.equal(f.sends(), 1); assert.equal(reconciliations, 1);
        await createWorker().run({ teamId: 'team' }); assert.equal(f.sends(), 1);
    });
    it('does not duplicate an in-flight provider attempt when a worker lease expires and another worker scans the same page', async () => {
        const { createScheduleRecoveryWorker } = require('../schedule-recovery-worker.cjs');
        const f = fixture(); const handle = await f.start(); await f.pipeline.capture('platform-trigger'); await f.pipeline.producer.publish(f.reference, handle);
        let started; const entered = new Promise((resolve) => { started = resolve; }); let finish; const wait = new Promise((resolve) => { finish = resolve; }); let sends = 0;
        f.dependencies.providers.send = async (_request, metadata) => { sends++; started(); await wait; return { ...metadata, final: true, outcome: 'accepted', receiptId: 'synthetic-late-receipt' }; };
        const createWorker = () => createScheduleRecoveryWorker({ store: f.dependencies.store, pipeline: f.create(), now: f.dependencies.now, leaseMs: 1000, authorizeRun: async () => true });
        const first = createWorker().run({ teamId: 'team' }); await entered; f.expire();
        await createWorker().run({ teamId: 'team' }); assert.equal(sends, 1); finish(); await assert.rejects(first);
        assert.equal(f.jobs()[0].state, 'completed'); await createWorker().run({ teamId: 'team' }); assert.equal(sends, 1);
    });
    for (const response of [null, { final: true, outcome: 'accepted' }]) it('retains uncertainty when reconciliation lacks exact attempt evidence', async () => {
        const f = fixture(); const handle = await f.start(); const effect = await f.pipeline.capture('platform-trigger'); await f.pipeline.producer.publish(f.reference, handle); f.loseProvider();
        await f.create().process(effect); f.dependencies.providers.reconcile = async () => response;
        await f.create().recover({ teamId: 'team' }); assert.equal(f.jobs()[0].state, 'uncertain'); assert.equal(f.sends(), 1);
    });
    it('rechecks current authorization instead of using the frozen audience as permission', async () => {
        const f = fixture(); const handle = await f.start(); const effect = await f.pipeline.capture('platform-trigger'); await f.pipeline.producer.publish(f.reference, handle); f.revoke();
        await assert.rejects(f.create().process(effect)); assert.equal(f.sends(), 0); assert.notEqual(f.jobs()[0].state, 'completed');
    });
    it('rejects untrusted trigger handles and oversize payloads without acknowledgment', async () => {
        const f = fixture(); await assert.rejects(f.pipeline.capture({ status: 'completed' })); assert.equal(f.jobs().length, 0);
        f.event.fields.notes = { stringValue: 'x'.repeat(262144) }; await assert.rejects(f.pipeline.capture('platform-trigger')); assert.equal(f.jobs().length, 0);
    });
    it('rejects coerced actor and recovery team identifiers before persistence or scanning', async () => {
        const f = fixture(); f.event.actorUid = 123;
        await assert.rejects(f.pipeline.capture('platform-trigger')); assert.equal(f.jobs().length, 0);
        for (const teamId of [123, ['team'], null, ' team ']) await assert.rejects(f.pipeline.recover({ teamId }));
    });
});
