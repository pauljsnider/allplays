"use strict";
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { FakeFirestore } = require('./helpers/notification-journal-fixture.cjs');
const { createFirestoreNotificationJournalStore } = require('../notification-attempt-journal.cjs');
const { createScheduleRecoveryWorker } = require('../schedule-recovery-worker.cjs');
function fixture(overrides = {}) {
    const db = new FakeFirestore(); const store = createFirestoreNotificationJournalStore(db); let clock = 100000; const calls = [];
    const dependencies = { store, now: () => clock, leaseMs: 1000, authorizeRun: async () => true,
        pipeline: { recover: async (input) => { calls.push(input); return { results: [{ state: 'completed' }], nextCursor: input.cursor === null ? 'page-one' : null }; } }, ...overrides };
    return { db, calls, dependencies, row: () => [...db.documents.values()][0], create: () => createScheduleRecoveryWorker(dependencies), advance: (ms = 1001) => { clock += ms; } };
}
describe('unmounted bounded schedule recovery worker', () => {
    it('persists cursor across restart and wraps only after a complete scan cycle', async () => {
        const f = fixture(); assert.deepEqual(await f.create().run({ teamId: 'team' }), { state: 'processed', count: 1, cycleComplete: false });
        assert.equal(f.row().cursor, 'page-one'); assert.equal(f.row().lease, null);
        assert.deepEqual(await f.create().run({ teamId: 'team' }), { state: 'processed', count: 1, cycleComplete: true });
        assert.deepEqual(f.calls, [{ teamId: 'team', cursor: null }, { teamId: 'team', cursor: 'page-one' }]); assert.equal(f.row().cursor, null);
    });
    it('serializes concurrent page claims and never runs the busy invocation', async () => {
        let entered; const started = new Promise((resolve) => { entered = resolve; }); let finish; const wait = new Promise((resolve) => { finish = resolve; });
        const f = fixture({ pipeline: { recover: async () => { entered(); await wait; return { results: [], nextCursor: null }; } } });
        const pending = f.create().run({ teamId: 'team' }); await started;
        assert.deepEqual(await f.create().run({ teamId: 'team' }), { state: 'busy' }); finish(); await pending;
    });
    it('does no work after a lost claim acknowledgment and retries the retained page only after lease expiry', async () => {
        const f = fixture(); f.db.failAfterTransactions.add(1);
        await assert.rejects(f.create().run({ teamId: 'team' })); assert.equal(f.calls.length, 0); assert.equal(f.row().cursor, null);
        assert.deepEqual(await f.create().run({ teamId: 'team' }), { state: 'busy' });
        f.advance(); await f.create().run({ teamId: 'team' }); assert.equal(f.calls.length, 1); assert.equal(f.calls[0].cursor, null);
    });
    it('trusts durable cursor state after a lost completion response rather than replaying the earlier page', async () => {
        const f = fixture(); f.db.failAfterTransactions.add(2); await assert.rejects(f.create().run({ teamId: 'team' }));
        assert.equal(f.row().cursor, 'page-one'); await f.create().run({ teamId: 'team' }); assert.equal(f.calls[1].cursor, 'page-one');
    });
    it('retains the old cursor after partial recovery failure', async () => {
        const f = fixture(); let calls = 0; f.dependencies.pipeline.recover = async () => { calls++; throw new Error('Partial provider processing'); };
        await assert.rejects(f.create().run({ teamId: 'team' })); assert.equal(f.row().cursor, null); assert.equal(calls, 1);
        assert.deepEqual(await f.create().run({ teamId: 'team' }), { state: 'busy' });
        f.advance(); await assert.rejects(f.create().run({ teamId: 'team' })); assert.equal(calls, 2); assert.equal(f.row().cursor, null);
    });
    it('does not let an expired worker overwrite the replacement worker cursor', async () => {
        let finish; const wait = new Promise((resolve) => { finish = resolve; }); let entered; const started = new Promise((resolve) => { entered = resolve; }); let calls = 0;
        const f = fixture({ pipeline: { recover: async () => {
            if (++calls === 1) { entered(); await wait; return { results: [], nextCursor: 'stale' }; }
            return { results: [], nextCursor: 'replacement' };
        } } });
        const pending = f.create().run({ teamId: 'team' }); await started; f.advance(); await f.create().run({ teamId: 'team' }); finish();
        await assert.rejects(pending); assert.equal(f.row().cursor, 'replacement'); assert.equal(f.row().generation, 2);
    });
    for (const phase of [1, 2, 3]) it(`requires current worker authorization at boundary ${phase}`, async () => {
        let count = 0; const f = fixture({ authorizeRun: async () => ++count !== phase });
        await assert.rejects(f.create().run({ teamId: 'team' })); assert.equal(f.calls.length, phase === 3 ? 1 : 0);
        if (phase !== 1) assert.equal(f.row().cursor, null); else assert.equal(f.db.documents.size, 0);
    });
    it('checks lease expiry after delayed claim acknowledgment before entering the pipeline', async () => {
        const f = fixture(); const change = f.dependencies.store.change;
        f.dependencies.store.change = async (...args) => { const saved = await change(...args); f.advance(); return saved; };
        await assert.rejects(f.create().run({ teamId: 'team' })); assert.equal(f.calls.length, 0); assert.equal(f.row().cursor, null);
    });
    it('keeps failed jobs eligible for the next full cycle while advancing a successfully read page', async () => {
        const f = fixture({ pipeline: { recover: async () => ({ results: [{ state: 'retry_required' }], nextCursor: 'next-page' }) } });
        assert.deepEqual(await f.create().run({ teamId: 'team' }), { state: 'retry_required', count: 1, cycleComplete: false });
        assert.equal(f.row().lastOutcome, 'retry_required'); assert.equal(f.row().cursor, 'next-page');
    });
    for (const page of [{ results: [], nextCursor: '../bad' }, { results: Array(101).fill({ state: 'completed' }), nextCursor: null }, { results: [{}], nextCursor: null }]) it('rejects malformed or unbounded recovery output without checkpointing', async () => {
        const f = fixture({ pipeline: { recover: async () => page } }); await assert.rejects(f.create().run({ teamId: 'team' })); assert.equal(f.row().cursor, null);
    });
    it('rejects a scanner that fails to advance its non-null cursor', async () => {
        const f = fixture(); await f.create().run({ teamId: 'team' }); f.dependencies.pipeline.recover = async () => ({ results: [], nextCursor: 'page-one' });
        await assert.rejects(f.create().run({ teamId: 'team' })); assert.equal(f.row().cursor, 'page-one');
    });
    it('rejects malformed teams, missing authority and invalid lease bounds before work', async () => {
        const f = fixture(); for (const teamId of [null, 3, ['team'], '../team']) await assert.rejects(f.create().run({ teamId }));
        for (const leaseMs of [0, 999, 300001, Infinity]) assert.throws(() => createScheduleRecoveryWorker({ ...f.dependencies, leaseMs }));
        assert.throws(() => createScheduleRecoveryWorker({ ...f.dependencies, authorizeRun: undefined })); assert.equal(f.db.documents.size, 0);
    });
});
