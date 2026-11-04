"use strict";
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { readFileSync } = require('node:fs');
const { createNotificationAttemptJournal, createFirestoreNotificationJournalStore, normalizeNotificationAttempt } = require('../notification-attempt-journal.cjs');

const { FakeFirestore } = require('./helpers/notification-journal-fixture.cjs');

const request = (overrides = {}) => ({ teamId: 'team-1', eventId: 'event-1', actorUid: 'owner', recipientUid: 'member', sourceVersion: '2060-01-01T10:00:00.123456789Z', channel: 'push', endpoint: 'synthetic-device-token', title: 'Synthetic schedule update', body: 'Synthetic event changed.', ...overrides });
const allow = { actorAllowed: true, sourceCurrent: true, recipientAllowed: true };
const proof = (metadata, outcome = 'accepted') => ({ effectId: metadata.effectId, requestHash: metadata.requestHash, attemptId: metadata.attemptId, final: true, outcome, receiptId: 'synthetic-provider-receipt' });
function fixture(options = {}) {
    const firestore = new FakeFirestore(); let clock = 100000; let calls = 0;
    const store = createFirestoreNotificationJournalStore(firestore);
    const delivered = [];
    const sender = createNotificationAttemptJournal({ store, now: () => clock, leaseMs: 1000, retryMs: 1000,
        authorize: async () => allow, send: async (value, metadata) => { calls++; delivered.push({ value, metadata }); return proof(metadata); }, ...options });
    const path = (value = request()) => `teams/${value.teamId}/notificationSendLog/durable_${normalizeNotificationAttempt(value).effectId}`;
    return { sender, firestore, store, delivered, calls: () => calls, advance: (ms) => { clock += ms; }, path };
}

describe('unmounted durable notification attempt journal', () => {
    it('persists exact private parameters before sending and returns only a bounded acceptance status', async () => {
        const f = fixture(); const result = await f.sender.deliver(request());
        assert.equal(result.status, 'accepted'); assert.equal(result.providerAcceptance, 'confirmed'); assert.equal(result.deviceDelivery, 'unverified');
        assert.deepEqual(f.firestore.read(f.path()).request, request());
        assert.ok(!JSON.stringify(result).includes('synthetic-device-token'));
        assert.equal(f.delivered[0].metadata.idempotencyKey, result.effectId);
        await f.sender.deliver(request()); assert.equal(f.calls(), 1);
    });
    it('binds one recipient/channel/revision to immutable content and rejects malformed input', async () => {
        const f = fixture(); await f.sender.deliver(request());
        await assert.rejects(f.sender.deliver(request({ body: 'Changed body at same revision' })), { code: 'receipt_conflict' });
        for (const changes of [{ teamId: '../other' }, { sourceVersion: '2060-02-30T10:00:00Z' }, { channel: 'email' }, { endpoint: '' }, { channel: 'inbox', endpoint: 'other' }, { extra: 'not-allowed' }]) {
            await assert.rejects(f.sender.deliver(request(changes)), { code: 'invalid_request' });
        }
        assert.equal(f.calls(), 1);
    });
    it('never calls the provider when reservation or dispatch-boundary persistence is unverified', async () => {
        for (const transaction of [1, 2, 3]) {
            const f = fixture(); f.firestore.failBeforeTransactions.add(transaction);
            await f.sender.deliver(request()).catch(() => {});
            assert.equal(f.calls(), 0);
        }
    });
    it('reconciles lost reservation, lease, dispatch-marker and successful result commits', async () => {
        for (const transaction of [1, 2, 3, 4]) {
            const f = fixture(); f.firestore.failAfterTransactions.add(transaction);
            assert.equal((await f.sender.deliver(request())).status, 'accepted');
            await f.sender.deliver(request()); assert.equal(f.calls(), 1);
        }
    });
    it('does not send after an unreadable committed dispatch boundary, even when no provider call actually happened', async () => {
        const f = fixture(); f.firestore.failAfterTransactions.add(3); f.firestore.failReads = 2;
        await assert.rejects(f.sender.deliver(request()), { code: 'journal_unavailable' });
        assert.equal(f.calls(), 0);
        f.advance(1001); assert.equal((await f.sender.deliver(request())).status, 'uncertain'); assert.equal(f.calls(), 0);
    });
    it('recovers an unreadable committed success after restart without resending', async () => {
        const f = fixture(); f.firestore.failAfterTransactions.add(4); f.firestore.failReads = 2;
        await assert.rejects(f.sender.deliver(request()), { code: 'journal_unavailable' });
        assert.equal(f.calls(), 1);
        assert.equal((await f.sender.deliver(request())).status, 'accepted'); assert.equal(f.calls(), 1);
    });
    it('stores only bounded provider evidence fields', async () => {
        const f = fixture({ send: async (_value, metadata) => ({ ...proof(metadata), unrelatedProviderSecret: 'must-not-copy' }) });
        await f.sender.deliver(request());
        assert.ok(!JSON.stringify(f.firestore.read(f.path()).evidence).includes('must-not-copy'));
    });
    it('leaves an ambiguous provider response uncertain across expiry and restarts, without resending', async () => {
        let sends = 0;
        const f = fixture({ send: async () => { sends++; throw new Error('Provider may have accepted before response loss'); } });
        assert.equal((await f.sender.deliver(request())).status, 'uncertain');
        f.advance(100000);
        const restarted = createNotificationAttemptJournal({ store: f.store, authorize: async () => allow, send: async () => { sends++; } });
        assert.equal((await restarted.deliver(request())).status, 'uncertain');
        assert.equal((await restarted.reconcile(request())).status, 'uncertain'); assert.equal(sends, 1);
    });
    it('never infers non-delivery from a missing receipt, nonfinal evidence or evidence for another attempt', async () => {
        for (const evidence of [null, { outcome: 'not-found', final: true }, { outcome: 'rejected', final: false }, { outcome: 'accepted', final: true, effectId: 'other', attemptId: 'other' }]) {
            let sends = 0;
            const f = fixture({ send: async () => { sends++; throw new Error('Unknown'); }, reconcile: async () => evidence });
            await f.sender.deliver(request()); assert.equal((await f.sender.reconcile(request())).status, 'uncertain');
            await f.sender.deliver(request()); assert.equal(sends, 1);
        }
    });
    it('resolves uncertainty from authoritative evidence for the exact attempt without sending', async () => {
        let metadata; let sends = 0;
        const f = fixture({ send: async (_value, value) => { sends++; metadata = value; throw new Error('Unknown'); }, reconcile: async () => proof(metadata) });
        await f.sender.deliver(request());
        assert.equal((await f.sender.reconcile(request())).status, 'accepted');
        await f.sender.deliver(request()); assert.equal(sends, 1);
    });
    it('allows a bounded delayed retry only after a definitive rejection, preserving the provider key and parameters', async () => {
        const calls = [];
        const f = fixture({ send: async (value, metadata) => { calls.push({ value, metadata }); return proof(metadata, 'rejected'); } });
        assert.equal((await f.sender.deliver(request())).status, 'retryable');
        assert.equal((await f.sender.deliver(request())).status, 'retryable'); assert.equal(calls.length, 1);
        f.advance(1001); await f.sender.deliver(request()); f.advance(1001);
        assert.equal((await f.sender.deliver(request())).status, 'failed');
        f.advance(100000); await f.sender.deliver(request()); assert.equal(calls.length, 3);
        assert.deepEqual(calls[0].value, calls[2].value); assert.equal(calls[0].metadata.idempotencyKey, calls[2].metadata.idempotencyKey);
        assert.notEqual(calls[0].metadata.attemptId, calls[2].metadata.attemptId);
    });
    it('requires final rejection evidence before retrying an uncertain attempt', async () => {
        let metadata; let sends = 0;
        const f = fixture({ send: async (_value, value) => { metadata = value; if (++sends === 1) throw new Error('Unknown'); return proof(value); }, reconcile: async () => proof(metadata, 'rejected') });
        await f.sender.deliver(request()); assert.equal((await f.sender.reconcile(request())).status, 'retryable');
        await f.sender.deliver(request()); assert.equal(sends, 1);
        f.advance(1001); assert.equal((await f.sender.deliver(request())).status, 'accepted'); assert.equal(sends, 2);
    });
    it('serializes concurrent senders and records a late final response after lease expiry', async () => {
        let release; let entered;
        const sending = new Promise((resolve) => { entered = resolve; });
        let sends = 0;
        const f = fixture({ send: async (_value, metadata) => { sends++; entered(); await new Promise((resolve) => { release = resolve; }); return proof(metadata); } });
        const first = f.sender.deliver(request()); await sending;
        assert.equal((await f.sender.deliver(request())).status, 'dispatching');
        f.advance(1001); assert.equal((await f.sender.status(request())).status, 'uncertain');
        assert.equal((await f.sender.deliver(request())).status, 'uncertain'); release();
        assert.equal((await first).status, 'accepted'); assert.equal(sends, 1);
    });
    it('rechecks actor, source and endpoint permission before provider dispatch', async () => {
        for (const field of ['actorAllowed', 'sourceCurrent', 'recipientAllowed']) {
            const f = fixture({ authorize: async (_value, phase) => ({ ...allow, ...(phase === 'before_dispatch' ? { [field]: false } : {}) }) });
            if (field === 'actorAllowed') await assert.rejects(f.sender.deliver(request()), { code: 'permission_denied' });
            else assert.equal((await f.sender.deliver(request())).status, 'suppressed');
            assert.equal(f.calls(), 0);
        }
        const denied = fixture({ authorize: async () => ({ ...allow, actorAllowed: false }) });
        await assert.rejects(denied.sender.status(request()), { code: 'permission_denied' });
    });
    it('retries a known pre-dispatch authorization service failure only after fresh authorization', async () => {
        let failed = false;
        const f = fixture({ authorize: async (_value, phase) => { if (phase === 'before_dispatch' && !failed) { failed = true; throw new Error('Transient authorization outage'); } return allow; } });
        await assert.rejects(f.sender.deliver(request()), { code: 'authorization_unavailable' });
        assert.equal((await f.sender.status(request())).status, 'retryable'); assert.equal(f.calls(), 0);
        f.advance(1001); assert.equal((await f.sender.deliver(request())).status, 'accepted'); assert.equal(f.calls(), 1);
    });
    it('keeps reconciliation outages uncertain and never exposes raw provider details', async () => {
        let sends = 0;
        const f = fixture({ send: async () => { sends++; throw new Error('Unknown'); }, reconcile: async () => { throw new Error('Synthetic private provider detail'); } });
        await f.sender.deliver(request());
        const result = await f.sender.reconcile(request()); assert.equal(result.status, 'uncertain');
        assert.ok(!JSON.stringify(result).includes('private provider')); await f.sender.deliver(request()); assert.equal(sends, 1);
    });
    it('rejects malformed provider success and corrupt receipts without claiming delivery', async () => {
        const f = fixture({ send: async () => ({ successCount: 1 }) });
        assert.equal((await f.sender.deliver(request())).status, 'uncertain');
        const record = f.firestore.documents.get(f.path()); record.status = 'accepted'; record.evidence = null;
        await assert.rejects(f.sender.status(request()), { code: 'receipt_conflict' });
    });
    it('freezes recipients and channel endpoints so retries cannot add people or rotated tokens', async () => {
        const f = fixture(); const original = request();
        const first = await f.sender.deliverPlan([original]);
        const repeat = await f.sender.deliverPlan([request({ endpoint: 'rotated-token' }), request({ recipientUid: 'new-member', endpoint: 'new-token' })]);
        assert.equal(first.planId, repeat.planId); assert.equal(repeat.results.length, 1); assert.equal(f.calls(), 1);
        await assert.rejects(f.sender.deliverPlan([request({ body: 'Changed content' })]), { code: 'receipt_conflict' });
    });
    it('freezes an empty verified audience so a later retry cannot notify newly eligible members', async () => {
        const f = fixture();
        const source = Object.fromEntries(['teamId', 'eventId', 'actorUid', 'sourceVersion', 'title', 'body'].map((key) => [key, request()[key]]));
        const original = await f.sender.deliverPlan([], source);
        assert.equal(original.plannedTargetCount, 0);
        const retry = await f.sender.deliverPlan([request()]);
        assert.equal(retry.planId, original.planId); assert.equal(retry.plannedTargetCount, 0); assert.equal(f.calls(), 0);
        await assert.rejects(f.sender.deliverPlan([]), { code: 'invalid_request' });
    });
    it('isolates inbox acceptance from uncertain push, preserves partial results and reconciles without a resend', async () => {
        let pushMetadata; const sent = [];
        const f = fixture({ send: async (value, metadata) => { sent.push(value.channel); if (value.channel === 'push') { pushMetadata = metadata; throw new Error('Unknown push'); } return proof(metadata); }, reconcile: async () => proof(pushMetadata) });
        const plan = [request(), request({ channel: 'inbox', endpoint: 'member' })];
        const first = await f.sender.deliverPlan(plan);
        assert.deepEqual(first.results.map((row) => row.status).sort(), ['accepted', 'uncertain']);
        assert.ok((await f.sender.reconcilePlan(plan)).results.every((row) => row.status === 'accepted'));
        await f.sender.deliverPlan(plan); assert.deepEqual(sent.sort(), ['inbox', 'push']);
    });
    it('reconciles a lost frozen-plan commit before any channel attempt', async () => {
        const f = fixture(); f.firestore.failAfterTransactions.add(1);
        assert.equal((await f.sender.deliverPlan([request()])).results[0].status, 'accepted'); assert.equal(f.calls(), 1);
    });
    it('remains unmounted and retains the server-only rules boundary', () => {
        const source = readFileSync(require.resolve('../index.js'), 'utf8');
        assert.ok(!source.includes('notification-attempt-journal'));
        const rules = readFileSync(require.resolve('../../firestore.rules'), 'utf8');
        assert.match(rules, /match \/notificationSendLog\/\{docId\}\s*\{\s*allow read, write: if false/);
    });
});
