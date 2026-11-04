"use strict";
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { createScheduleProofOrdering } = require('../schedule-proof-ordering.cjs');
const { createScheduleEffectEligibility } = require('../schedule-effect-eligibility.cjs');
const { createScheduleConsumerOwnership } = require('../schedule-consumer-ownership.cjs');
const { createFirestoreNotificationJournalStore, createNotificationAttemptJournal } = require('../notification-attempt-journal.cjs');
const { scheduleDeliveryFingerprint: hash } = require('../schedule-delivery-coordinator.cjs');
const { FakeFirestore } = require('./helpers/notification-journal-fixture.cjs');
function fixture() {
    const db = new FakeFirestore(); const store = createFirestoreNotificationJournalStore(db); let clock = 100000;
    const data = { type: { stringValue: 'game' }, status: { stringValue: 'scheduled' }, date: { timestampValue: '2060-01-01T12:00:00.000000000Z' } };
    const event = { teamId: 'team', eventId: 'event', beforeVersion: null, sourceVersion: '1970-01-01T00:01:40.001000000Z', category: 'schedule', eventDigest: hash(data) };
    const intent = { teamId: 'team', eventId: 'event', uid: 'owner', beforeVersion: null, eventDigest: event.eventDigest, intentDigest: hash('intent'), approvalId: hash('approval'), approve: true, notifyTeam: true, consumed: true, expiresAt: 150000 };
    const reference = { teamId: 'team', evidenceId: intent.approvalId };
    const commit = { ...intent, sourceVersion: event.sourceVersion, committed: true, mode: 'create', eventType: 'game' };
    const dependencies = { store, now: () => clock, verifyApprovedIntent: async (handle) => { if (handle !== 'private-intent') throw new Error('untrusted'); return intent; },
        verifyTrigger: async (handle) => { if (handle !== 'platform-trigger') throw new Error('untrusted'); return event; },
        verifyCommit: async (ref) => { assert.deepEqual(ref, reference); return commit; } };
    const create = () => createScheduleProofOrdering(dependencies);
    const start = async () => { const reference = await create().arm('private-intent'); await create().beginWrite(reference); return reference; };
    const decide = () => createScheduleConsumerOwnership({ store, readVerifiedDeploymentGate: async () => ({ mode: 'journal', legacyHead: 'a'.repeat(40), journalHead: 'b'.repeat(40), legacyCompatible: true, bothConsumersGated: true, compatibleProducersVerified: true }),
        verifyEffectEligibility: createScheduleEffectEligibility({ resolveEffect: create().resolveEffect, verifyCommit: dependencies.verifyCommit, readEvent: async () => ({ version: event.sourceVersion, data }) }) });
    // Exercise the actual durable journal with a counted synthetic provider.
    // The active legacy trigger has NOT been migrated to this journal.
    const deliveries = []; let loseResponse = false;
    const deliver = async (consumer) => {
        const result = await decide()({ ...event, consumer });
        if (!result.mayConsume) return result;
        const journal = createNotificationAttemptJournal({ store, now: () => clock,
            authorize: async () => ({ actorAllowed: (await decide()({ ...event, consumer })).mayConsume, sourceCurrent: true, recipientAllowed: true }),
            send: async (_request, metadata) => {
                deliveries.push(consumer); if (loseResponse) throw new Error('Synthetic accepted send with lost response');
                return { effectId: metadata.effectId, requestHash: metadata.requestHash, attemptId: metadata.attemptId, final: true, outcome: 'accepted', receiptId: 'synthetic-receipt' };
            } });
        return journal.deliver({ teamId: event.teamId, eventId: event.eventId, sourceVersion: event.sourceVersion, actorUid: 'owner', recipientUid: 'member',
            channel: 'push', endpoint: 'synthetic-device', title: 'Schedule changed', body: 'Review the schedule in the app.' });
    };
    return { db, store, data, event, intent, reference, commit, dependencies, create, start, decide, deliver, deliveries, expire: () => { clock = 150001; }, loseProviderResponse: () => { loseResponse = true; } };

}
describe('private proof/trigger ordering without ownership transfer', () => {
    it('waits when trigger arrives before proof, then routes one journal effect after proof persists', async () => {
        const f = fixture(); await f.start(); await f.create().captureTrigger('platform-trigger');
        await assert.rejects(f.deliver('legacy'), { code: 'proof_pending' }); await assert.rejects(f.deliver('journal'), { code: 'proof_pending' });
        assert.equal(f.deliveries.length, 0); assert.equal([...f.db.documents.values()].filter((row) => row.kind === 'schedule-consumer-owner').length, 0);
        await f.create().publish(f.reference); await Promise.all([f.deliver('legacy'), f.deliver('journal'), f.deliver('journal')]);
        assert.deepEqual([...f.deliveries.values()], ['journal']);
    });
    it('routes identically when proof arrives before the trigger and after restart', async () => {
        const f = fixture(); await f.start(); await f.create().publish(f.reference);
        await f.create().captureTrigger('platform-trigger'); await Promise.all([f.deliver('legacy'), f.deliver('journal')]);
        assert.deepEqual([...f.deliveries.values()], ['journal']);
    });
    it('recovers a producer crash through a durable legacy close and rejects late proof', async () => {
        const f = fixture(); await f.start(); await f.create().captureTrigger('platform-trigger');
        await assert.rejects(f.create().closeForLegacy(f.event), { code: 'proof_still_pending' }); f.expire();
        assert.deepEqual(await f.create().closeForLegacy(f.event), { state: 'legacy' });
        await assert.rejects(f.create().publish(f.reference), { code: 'proof_path_closed' });
        await Promise.all([f.deliver('legacy'), f.deliver('journal'), f.deliver('legacy')]); assert.deepEqual([...f.deliveries.values()], ['legacy']);
    });
    for (const first of ['publish', 'close']) it(`serializes concurrent proof/recovery requests started ${first} first`, async () => {
        const f = fixture(); await f.start(); await f.create().captureTrigger('platform-trigger'); f.expire();
        const publish = () => f.create().publish(f.reference); const close = () => f.create().closeForLegacy(f.event);
        const results = await Promise.allSettled(first === 'publish' ? [publish(), close()] : [close(), publish()]);
        assert.equal(results[0].status, 'fulfilled');
        await Promise.all([f.deliver('legacy'), f.deliver('journal')]);
        const resolution = await f.create().resolveEffect(f.event);
        assert.deepEqual([...f.deliveries.values()], [resolution.state === 'proof' ? 'journal' : 'legacy']);
    });
    it('does not classify expiry itself as legacy or lose the pending inbox on restart', async () => {
        const f = fixture(); await f.start(); await f.create().captureTrigger('platform-trigger'); f.expire();
        assert.deepEqual(await f.create().resolveEffect(f.event), { state: 'pending' });
        await assert.rejects(f.deliver('legacy'), { code: 'proof_pending' });
        assert.equal([...f.db.documents.values()].filter((row) => row.kind === 'schedule-trigger-inbox').length, 1);
    });
    it('allows ordinary legacy triggers without a producer fence', async () => {
        const f = fixture(); await f.create().captureTrigger('platform-trigger'); await f.deliver('legacy');
        assert.deepEqual([...f.deliveries.values()], ['legacy']);
    });
    it('does not hold a later legacy recreation behind proof for an old exact commit', async () => {
        const f = fixture(); await f.start(); await f.create().captureTrigger('platform-trigger'); await f.create().publish(f.reference);
        await f.deliver('journal'); f.event.sourceVersion = '1970-01-01T00:02:00.000000000Z';
        await f.create().captureTrigger('platform-trigger'); await f.deliver('legacy');
        assert.deepEqual(f.deliveries, ['journal', 'legacy']);
    });
    it('does not hold a different legacy write behind another approved intent', async () => {
        const f = fixture(); await f.start(); f.event.eventDigest = hash('other write');
        await f.create().captureTrigger('platform-trigger'); await f.deliver('legacy'); assert.deepEqual([...f.deliveries.values()], ['legacy']);
    });
    for (const operation of ['arm', 'capture', 'publish', 'close']) it(`recovers a lost ${operation} persistence response without rerouting`, async () => {
        const f = fixture();
        if (operation === 'arm') {
            f.db.failAfterTransactions.add(1); await assert.rejects(f.create().arm('private-intent'));
            await f.start(); assert.equal([...f.db.documents.values()].filter((row) => row.kind === 'schedule-proof-fence').length, 1);
            assert.equal(f.deliveries.length, 0); return;
        }
        await f.start();
        if (operation !== 'capture') await f.create().captureTrigger('platform-trigger');
        if (operation === 'close') f.expire();
        f.db.failAfterTransactions.add(f.db.transactionCount + 1);
        const action = () => operation === 'capture' ? f.create().captureTrigger('platform-trigger') : operation === 'publish' ? f.create().publish(f.reference) : f.create().closeForLegacy(f.event);
        await assert.rejects(action()); await action();
        if (operation === 'capture') await f.create().publish(f.reference);
        await Promise.all([f.deliver('legacy'), f.deliver('journal')]); assert.deepEqual([...f.deliveries.values()], [operation === 'close' ? 'legacy' : 'journal']);
    });
    it('does not accept client receipts or event flags as trigger/intent proof', async () => {
        const f = fixture(); await assert.rejects(f.create().arm({ approved: true })); await assert.rejects(f.create().captureTrigger({ status: 'completed' }));
        assert.equal(f.db.documents.size, 0);
    });
    it('retains only bounded intent fields and rejects mismatched commit proof', async () => {
        const f = fixture(); f.intent.idToken = 'must-not-persist'; await f.start();
        assert.ok(!JSON.stringify([...f.db.documents.values()]).includes('must-not-persist'));
        f.commit.eventDigest = hash('different'); await assert.rejects(f.create().publish(f.reference));
        await f.create().captureTrigger('platform-trigger'); assert.deepEqual(await f.create().resolveEffect(f.event), { state: 'pending' });
    });
    it('does not switch consumers or resend after an uncertain provider response', async () => {
        const f = fixture(); await f.start(); await f.create().captureTrigger('platform-trigger'); await f.create().publish(f.reference);
        f.loseProviderResponse(); assert.equal((await f.deliver('journal')).status, 'uncertain'); f.expire();
        assert.equal((await f.create().closeForLegacy(f.event)).state, 'proof');
        await f.deliver('legacy'); assert.equal((await f.deliver('journal')).status, 'uncertain');
        assert.deepEqual(f.deliveries, ['journal']);
    });
    it('does not acknowledge an arm that expires while its reservation persists', async () => {
        const f = fixture(); const change = f.store.change;
        f.dependencies.store = { ...f.store, change: async (...args) => { const result = await change(...args); f.expire(); return result; } };
        await assert.rejects(f.create().arm('private-intent')); assert.equal(f.deliveries.length, 0);
    });
    it('cancels an unstarted reservation, preserves its tombstone and rejects stale dispatch after replacement', async () => {
        const f = fixture(); const old = await f.create().arm('private-intent'); await f.create().cancelUnstarted(old);
        await assert.rejects(f.create().beginWrite(old));
        f.intent.approvalId = hash('new approval'); f.intent.intentDigest = hash('new intent');
        const next = await f.create().arm('private-intent'); await assert.rejects(f.create().beginWrite(old));
        await f.create().beginWrite(next);
        assert.equal([...f.db.documents.values()].filter((row) => row.state === 'cancelled').length, 1);
    });
    it('never cancels a dispatched or ambiguous reservation and never dispatches it twice', async () => {
        const f = fixture(); const reference = await f.start();
        await assert.rejects(f.create().cancelUnstarted(reference), { code: 'write_outcome_unknown' });
        await assert.rejects(f.create().beginWrite(reference), { code: 'write_not_authorized' });
    });
    it('refuses proof publication for a producer that never crossed dispatch', async () => {
        const f = fixture(); await f.create().arm('private-intent'); await assert.rejects(f.create().publish(f.reference), { code: 'proof_path_closed' });
    });
    it('rejects false persistence acknowledgments before treating the producer or trigger as durable', async () => {
        const f = fixture(); f.dependencies.store = { ...f.store, change: async () => false };
        await assert.rejects(f.create().arm('private-intent')); await assert.rejects(f.create().captureTrigger('platform-trigger'));
    });
});
