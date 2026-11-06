"use strict";
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { createScheduleEffectEligibility } = require('../schedule-effect-eligibility.cjs');
const { createScheduleConsumerOwnership } = require('../schedule-consumer-ownership.cjs');
const { scheduleDeliveryFingerprint: hash } = require('../schedule-delivery-coordinator.cjs');
const { createFirestoreNotificationJournalStore } = require('../notification-attempt-journal.cjs');
const { FakeFirestore } = require('./helpers/notification-journal-fixture.cjs');
function fixture() {
    const effect = { teamId: 'team', eventId: 'event', sourceVersion: '2060-01-01T12:00:00.123456789Z', category: 'schedule' };
    const reference = { teamId: 'team', evidenceId: hash('private-evidence') };
    const fields = { type: { stringValue: 'game' }, status: { stringValue: 'scheduled' }, date: { timestampValue: '2060-12-01T12:00:00.000000000Z' }, opponent: { stringValue: 'Visitors' } };
    const event = { version: effect.sourceVersion, data: fields };
    const commit = { ...effect, approvalId: reference.evidenceId, mode: 'create', eventType: 'game', committed: true, consumed: true, approve: true, notifyTeam: true, eventDigest: hash(fields) };
    const readers = { resolveEffect: async () => ({ state: 'proof', reference }), verifyCommit: async (ref) => { assert.deepEqual(ref, reference); return commit; }, readEvent: async () => event };
    const db = new FakeFirestore(); const store = createFirestoreNotificationJournalStore(db);
    const decide = () => createScheduleConsumerOwnership({ store, readVerifiedDeploymentGate: async () => ({ mode: 'journal', legacyHead: 'a'.repeat(40), journalHead: 'b'.repeat(40), legacyCompatible: true, bothConsumersGated: true, compatibleProducersVerified: true }), verifyEffectEligibility: createScheduleEffectEligibility(readers) });
    return { effect, reference, fields, event, commit, readers, db, decide, rehash: () => { commit.eventDigest = hash(fields); } };
}
describe('server-verified per-effect journal eligibility', () => {
    for (const mode of ['create', 'update']) for (const eventType of ['game', 'practice']) it(`selects journal only for the verified ${mode} ${eventType} effect`, async () => {
        const f = fixture(); f.commit.mode = mode; f.commit.eventType = eventType; f.fields.type.stringValue = eventType; f.rehash();
        assert.deepEqual(await f.decide()({ ...f.effect, consumer: 'journal' }), { owner: 'journal', mayConsume: true });
        assert.equal([...f.db.documents.values()][0].eligibilityEvidenceId, f.reference.evidenceId);
    });
    it('keeps an ordinary legacy write with no private proof in legacy, even with client eligibility flags', async () => {
        const f = fixture(); f.readers.resolveEffect = async () => ({ state: 'legacy' });
        assert.deepEqual(await f.decide()({ ...f.effect, consumer: 'legacy', eligible: true, evidenceId: f.reference.evidenceId, receipt: { status: 'completed' } }), { owner: 'legacy', mayConsume: true });
        f.readers.resolveEffect = async () => ({ state: 'proof', reference: f.reference });
        assert.equal((await f.decide()({ ...f.effect, consumer: 'journal' })).mayConsume, false); // late proof cannot change owner
    });
    for (const field of ['importBatch', 'source', 'sourceMetadata', 'recurrence', 'seriesId', 'sharedScheduleId', 'trackingEngine', 'liveStatus', 'cancelled', 'customUnknown']) it(`keeps ${field} events legacy even with a verified commit`, async () => {
        const f = fixture(); f.fields[field] = { stringValue: 'unsupported' }; f.rehash();
        assert.equal((await f.decide()({ ...f.effect, consumer: 'journal' })).mayConsume, false);
        assert.equal((await f.decide()({ ...f.effect, consumer: 'legacy' })).mayConsume, true);
    });
    for (const [field, value] of [['type', 'tournament'], ['status', 'live'], ['competitionType', 'tournament'], ['opponentTeamId', 'linked-team']]) it(`retains legacy for unsupported ${field}`, async () => {
        const f = fixture(); f.fields[field] = { stringValue: value }; f.rehash();
        assert.equal((await f.decide()({ ...f.effect, consumer: 'legacy' })).mayConsume, true);
    });
    for (const field of ['teamId', 'eventId', 'sourceVersion', 'approvalId', 'eventDigest', 'committed', 'consumed', 'approve', 'notifyTeam']) it(`refuses mismatched private commit ${field} without assigning ownership`, async () => {
        const f = fixture(); f.commit[field] = ['committed', 'consumed', 'approve', 'notifyTeam'].includes(field) ? false : field === 'sourceVersion' ? '2060-01-01T12:00:00.123456790Z' : 'other';
        await assert.rejects(f.decide()({ ...f.effect, consumer: 'journal' })); assert.equal(f.db.documents.size, 0);
    });
    for (const reader of ['resolveEffect', 'verifyCommit', 'readEvent']) it(`does not guess legacy or journal after ${reader} fails`, async () => {
        const f = fixture(); f.readers[reader] = async () => { throw new Error('uncertain server read'); };
        await assert.rejects(f.decide()({ ...f.effect, consumer: 'journal' })); assert.equal(f.db.documents.size, 0);
    });
    it('refuses a different event read even when a proof was found for this version', async () => {
        const f = fixture(); f.event.data.opponent.stringValue = 'Changed'; await assert.rejects(f.decide()({ ...f.effect, consumer: 'journal' }));
        assert.equal(f.db.documents.size, 0);
    });
    for (const resolution of [null, undefined, { state: 'pending' }]) it(`never treats ${JSON.stringify(resolution)} as a legacy decision`, async () => {
        const f = fixture(); f.readers.resolveEffect = async () => resolution;
        await assert.rejects(f.decide()({ ...f.effect, consumer: 'legacy' })); assert.equal(f.db.documents.size, 0);
    });
    it('requires explicit effect verification and an exact positive binding', async () => {
        const f = fixture(); const store = createFirestoreNotificationJournalStore(f.db);
        assert.throws(() => createScheduleConsumerOwnership({ store, readVerifiedDeploymentGate: async () => ({}) }));
        assert.throws(() => createScheduleEffectEligibility({ ...f.readers, verifyCommit: undefined }));
    });
});
