"use strict";
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { FakeFirestore } = require('./helpers/notification-journal-fixture.cjs');
const { createFirestoreNotificationJournalStore } = require('../notification-attempt-journal.cjs');
const { createScheduleConsumerOwnership } = require('../schedule-consumer-ownership.cjs');
function fixture() {
    const db = new FakeFirestore(); const gate = { mode: 'legacy-only', legacyHead: 'a'.repeat(40), legacyCompatible: true, journalHead: 'b'.repeat(40), bothConsumersGated: true, compatibleProducersVerified: true };
    const input = { teamId: 'team', eventId: 'event', sourceVersion: '2060-01-01T12:00:00.123456789Z' };
    const decide = createScheduleConsumerOwnership({ store: createFirestoreNotificationJournalStore(db), readVerifiedDeploymentGate: async () => gate });
    return { db, gate, input, decide };
}
describe('isolated single-consumer rollout ownership', () => {
    it('allows only the legacy consumer in shadow mode despite a client marker', async () => {
        const f = fixture(); f.gate.mode = 'shadow';
        assert.deepEqual(await f.decide({ ...f.input, consumer: 'journal', notificationOwner: 'journal' }), { owner: 'legacy', mayConsume: false });
        assert.equal((await f.decide({ ...f.input, consumer: 'legacy' })).mayConsume, true);
    });
    it('chooses exactly one owner when both consumers race', async () => {
        const f = fixture(); f.gate.mode = 'journal';
        const result = await Promise.all(['legacy', 'journal'].map((consumer) => f.decide({ ...f.input, consumer })));
        assert.equal(result.filter((row) => row.mayConsume).length, 1); assert.equal(result[1].owner, 'journal');
    });
    it('uses one ownership key for equivalent version spellings without losing nanoseconds', async () => {
        const f = fixture(); await f.decide({ ...f.input, sourceVersion: '2060-01-01T12:00:00Z', consumer: 'legacy' });
        f.gate.mode = 'journal';
        assert.equal((await f.decide({ ...f.input, sourceVersion: '2060-01-01T12:00:00.000000000Z', consumer: 'journal' })).mayConsume, false);
        assert.equal(f.db.documents.size, 1);
    });
    it('does not move old effects on cutover or rollback; only new commit versions change owners', async () => {
        const f = fixture(); await f.decide({ ...f.input, consumer: 'legacy' }); f.gate.mode = 'journal';
        assert.equal((await f.decide({ ...f.input, consumer: 'journal' })).mayConsume, false);
        const next = { ...f.input, sourceVersion: '2060-01-01T12:00:00.123456790Z' };
        assert.equal((await f.decide({ ...next, consumer: 'journal' })).mayConsume, true); f.gate.mode = 'legacy-only';
        assert.equal((await f.decide({ ...next, consumer: 'legacy' })).mayConsume, false);
    });
    for (const key of ['legacyCompatible', 'bothConsumersGated', 'compatibleProducersVerified', 'legacyHead', 'journalHead']) it(`blocks journal activation without ${key}`, async () => {
        const f = fixture(); f.gate.mode = 'journal'; delete f.gate[key]; await assert.rejects(f.decide({ ...f.input, consumer: 'journal' })); assert.equal(f.db.documents.size, 0);
    });
    it('does not fail over after an uncertain ownership reservation response', async () => {
        const f = fixture(); f.db.failAfterTransactions.add(1); await assert.rejects(f.decide({ ...f.input, consumer: 'legacy' }));
        f.gate.mode = 'journal'; assert.equal((await f.decide({ ...f.input, consumer: 'journal' })).mayConsume, false);
    });
});
