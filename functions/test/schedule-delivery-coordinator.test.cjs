"use strict";
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { readFileSync } = require('node:fs');
const { FakeFirestore } = require('./helpers/notification-journal-fixture.cjs');
const { createFirestoreNotificationJournalStore, normalizeNotificationAttempt } = require('../notification-attempt-journal.cjs');
const { createScheduleDeliveryProviders, pinScheduleProviderRequest } = require('../schedule-delivery-providers.cjs');
const { createScheduleDeliveryCoordinator, scheduleDeliveryFingerprint: hash } = require('../schedule-delivery-coordinator.cjs');

function fixture(overrides = {}) {
    const firestore = new FakeFirestore();
    const store = createFirestoreNotificationJournalStore(firestore);
    const actor = { uid: 'owner', clientId: 'test-client', grantKey: hash('synthetic-grant'), expiresAt: 200000, reviewRequests: true };
    const event = { version: '1970-01-01T00:01:36.000123456Z', data: { type: 'practice', title: 'Synthetic practice', date: '2060-01-02T10:00:00Z' } };
    const approval = { ...actor, sessionId: 'synthetic-session', approvalId: 'synthetic-approval', proposalId: 'synthetic-proposal', teamId: 'team-1', eventId: 'event-1',
        intentDigest: hash('synthetic-intent'), eventDigest: hash(event.data), beforeVersion: null, mode: 'create', eventType: 'practice',
        approve: true, notifyTeam: true, consumed: true, issuedAt: 90000, expiresAt: 150000, consumedAt: 95000 };
    const commit = { ...approval, committed: true, committedAt: 96000, sourceVersion: event.version };
    let permitted = true; let recipientAllowed = true; let clock = 100000; let sends = 0;
    const calls = [];
    const targets = [{ recipientUid: 'member', channel: 'inbox', endpoint: 'member' }, { recipientUid: 'member', channel: 'push', endpoint: 'synthetic-device' }];
    const providers = createScheduleDeliveryProviders({ firestore, messaging: { send: async (parameters) => { sends++; calls.push(parameters); return 'projects/synthetic/messages/one'; } } });
    const dependencies = { store, now: () => clock, providers,
        authenticate: async (credential) => { if (credential !== 'synthetic-credential') throw new Error('secret raw auth failure'); return actor; },
        verifyApproval: async (handle) => { if (handle !== 'trusted-approval-handle') throw new Error('Not signed evidence'); return approval; },
        verifyCommit: async (handle) => { if (handle !== 'trusted-commit-handle') throw new Error('Not signed evidence'); return commit; },
        readEvent: async () => event,
        authorize: async () => ({ actorAllowed: permitted, recipientAllowed }),
        resolveRecipients: async () => targets, ...overrides };
    const create = (changes = {}) => createScheduleDeliveryCoordinator({ ...dependencies, ...changes });
    const coordinator = create();
    const bind = () => coordinator.bind('synthetic-credential', { approvalHandle: 'trusted-approval-handle', commitHandle: 'trusted-commit-handle' });
    return { firestore, store, actor, approval, commit, event, targets, providers, coordinator, create, bind, calls,
        sends: () => sends, revoke: () => { permitted = false; }, revokeRecipient: () => { recipientAllowed = false; }, advance: (ms) => { clock += ms; } };
}

describe('verified schedule approval to isolated delivery coordination', () => {
    it('binds independent approval and commit evidence to the exact observed event and delivers once', async () => {
        const f = fixture(); const reference = await f.bind();
        assert.equal((await f.coordinator.status('synthetic-credential', reference)).status, 'not_started');
        const result = await f.coordinator.deliver('synthetic-credential', reference);
        assert.equal(result.accepted, 2); assert.equal(f.sends(), 1);
        assert.deepEqual(await f.bind(), reference);
        assert.equal((await f.coordinator.deliver('synthetic-credential', reference)).accepted, 2); assert.equal(f.sends(), 1);
        assert.equal(result.deviceDelivery, 'unverified');
        assert.ok(!/member|synthetic-device|grant|session|receiptId/.test(JSON.stringify(result)));
        assert.equal(f.calls[0].data.appRoute, '/schedule/team-1/event-1');
        const privateRows = [...f.firestore.documents.values()];
        assert.ok(privateRows.some((row) => row.request?.provider?.parameters?.token === 'synthetic-device'));
    });
    it('does not accept a user-writable completion receipt or a model-selected confirmation boolean', async () => {
        const f = fixture();
        await assert.rejects(f.coordinator.bind('synthetic-credential', { approvalHandle: { approve: true }, commitHandle: { status: 'completed' } }), { code: 'binding_denied' });
        assert.equal(f.firestore.documents.size, 0); assert.equal(f.sends(), 0);
    });
    for (const field of ['approve', 'notifyTeam', 'consumed']) it(`requires verified ${field} evidence`, async () => {
        const f = fixture(); f.approval[field] = false;
        await assert.rejects(f.bind(), { code: 'binding_denied' }); assert.equal(f.firestore.documents.size, 0);
    });
    for (const field of ['uid', 'clientId', 'grantKey', 'sessionId', 'approvalId', 'proposalId', 'teamId', 'eventId', 'intentDigest', 'eventDigest', 'beforeVersion']) it(`rejects a commit bound to another ${field}`, async () => {
        const f = fixture(); f.commit[field] = 'different';
        await assert.rejects(f.bind(), { code: 'binding_denied' }); assert.equal(f.firestore.documents.size, 0);
    });
    it('rejects expired, unconsumed, future, unordered and overly long approval windows', async () => {
        for (const mutate of [
            (f) => { f.commit.committedAt = 150001; }, (f) => { f.approval.consumedAt = 96001; },
            (f) => { f.approval.issuedAt = 100000; }, (f) => { f.approval.expiresAt = 500000; },
            (f) => { f.commit.committedAt = 100001; }, (f) => { f.commit.committed = false; },
            (f) => { f.commit.sourceVersion = '1970-01-01T00:01:37Z'; }
        ]) { const f = fixture(); mutate(f); await assert.rejects(f.bind(), { code: 'binding_denied' }); }
    });
    it('requires the exact event revision and content before binding or first dispatch', async () => {
        for (const change of [(f) => { f.event.version = '2060-01-01T11:00:00Z'; }, (f) => { f.event.data.title = 'Changed'; }]) {
            const f = fixture(); change(f); await assert.rejects(f.bind(), { code: 'source_changed' }); assert.equal(f.sends(), 0);
        }
        const f = fixture(); const reference = await f.bind(); f.event.data.title = 'New edit';
        await assert.rejects(f.coordinator.deliver('synthetic-credential', reference), { code: 'source_changed' });
    });
    it('reconciles a lost binding response and refuses conflicting approval replay at the same event revision', async () => {
        const f = fixture(); f.firestore.failAfterTransactions.add(1); const reference = await f.bind();
        assert.deepEqual(await f.bind(), reference);
        f.approval.approvalId = f.commit.approvalId = 'different-approval';
        await assert.rejects(f.bind(), { code: 'receipt_conflict' });
    });
    it('does not deliver after an unverified or false binding persistence result', async () => {
        const f = fixture({ store: { get: async () => null, change: async () => false } });
        await assert.rejects(f.bind(), { code: 'receipt_conflict' }); assert.equal(f.sends(), 0);
    });
    it('rechecks identity, scope, grant expiry and manager authorization for status and delivery', async () => {
        for (const mutate of [(f) => { f.actor.uid = 'other'; }, (f) => { f.actor.clientId = 'other'; },
            (f) => { f.actor.grantKey = hash('other'); }, (f) => { f.actor.reviewRequests = false; },
            (f) => f.advance(100001), (f) => f.revoke()]) {
            const f = fixture(); const reference = await f.bind(); mutate(f);
            await assert.rejects(f.coordinator.status('synthetic-credential', reference), { code: 'binding_denied' });
            await assert.rejects(f.coordinator.deliver('synthetic-credential', reference), { code: 'binding_denied' }); assert.equal(f.sends(), 0);
        }
    });
    it('suppresses revoked recipients and freezes an empty audience rather than expanding on retry', async () => {
        const f = fixture(); const reference = await f.bind(); f.revokeRecipient();
        assert.equal((await f.coordinator.deliver('synthetic-credential', reference)).suppressed, 2); assert.equal(f.sends(), 0);
        const empty = fixture(); const ref = await empty.bind(); empty.targets.length = 0;
        assert.equal((await empty.coordinator.deliver('synthetic-credential', ref)).plannedTargetCount, 0);
        empty.targets.push({ recipientUid: 'new-member', channel: 'inbox', endpoint: 'new-member' });
        assert.equal((await empty.coordinator.deliver('synthetic-credential', ref)).plannedTargetCount, 0);
    });
    it('reuses frozen requests across serializer changes and endpoint rotation', async () => {
        const f = fixture(); const reference = await f.bind(); await f.coordinator.deliver('synthetic-credential', reference);
        f.targets[1].endpoint = 'rotated-private-device';
        const restart = f.create({ providers: { ...f.providers, pin: () => { throw new Error('New serializer must not run'); } } });
        assert.equal((await restart.deliver('synthetic-credential', reference)).accepted, 2); assert.equal(f.sends(), 1);
    });
    it('preserves an uncertain push across restart and reconciliation without resending', async () => {
        const f = fixture(); const reference = await f.bind(); let calls = 0;
        const providers = createScheduleDeliveryProviders({ firestore: f.firestore, messaging: { send: async () => { calls++; throw new Error('Synthetic timeout with private token'); } } });
        const worker = f.create({ providers });
        const result = await worker.deliver('synthetic-credential', reference); assert.equal(result.accepted, 1); assert.equal(result.uncertain, 1);
        const restart = f.create({ providers });
        assert.equal((await restart.status('synthetic-credential', reference, { reconcile: true })).uncertain, 1);
        assert.equal((await restart.deliver('synthetic-credential', reference)).uncertain, 1); assert.equal(calls, 1);
    });
    it('does not import either integration module into the deployed entrypoint', () => {
        const index = readFileSync(new URL('../index.js', `file://${__filename}`), 'utf8');
        assert.ok(!index.includes('schedule-delivery-coordinator')); assert.ok(!index.includes('schedule-delivery-providers'));
    });
});

describe('pinned provider parameters and evidence', () => {
    const raw = { teamId: 'team-1', eventId: 'event-1', actorUid: 'owner', recipientUid: 'member', sourceVersion: '2060-01-01T10:00:00Z', channel: 'inbox', endpoint: 'member', title: 'Schedule updated', body: 'Open the app.' };
    const metadata = { effectId: hash('effect'), requestHash: hash('request'), attemptId: '00112233-4455-4677-8899-aabbccddeeff' };
    it('reconciles a committed inbox write after a lost response and preserves read state', async () => {
        const firestore = new FakeFirestore(); const provider = createScheduleDeliveryProviders({ firestore }); const request = provider.pin(raw);
        firestore.failAfterTransactions.add(1);
        await assert.rejects(provider.send(request, metadata));
        assert.equal((await provider.reconcile(request, metadata)).outcome, 'accepted');
        const row = firestore.read(request.provider.parameters.path); row.readAt = new Date();
        firestore.documents.set(request.provider.parameters.path, row);
        await provider.send(request, metadata);
        assert.deepEqual(firestore.read(request.provider.parameters.path).readAt, row.readAt);
        assert.equal(firestore.documents.size, 1);
    });
    it('does not treat missing or mismatching inbox records as confirmed delivery', async () => {
        const firestore = new FakeFirestore(); const provider = createScheduleDeliveryProviders({ firestore }); const request = provider.pin(raw);
        assert.equal(await provider.reconcile(request, metadata), null);
        firestore.documents.set(request.provider.parameters.path, { ...request.provider.parameters.data, body: 'different' });
        await assert.rejects(provider.reconcile(request, metadata), { code: 'provider_contract' });
        await assert.rejects(provider.send(request, metadata), { code: 'provider_contract' });
    });
    it('does not mistake a false persistence result for inbox delivery', async () => {
        const firestore = new FakeFirestore(); const provider = createScheduleDeliveryProviders({ firestore }); const request = provider.pin(raw);
        firestore.runTransaction = async () => false;
        await assert.rejects(provider.send(request, metadata), { code: 'provider_contract' });
        assert.equal(await provider.reconcile(request, metadata), null);
        firestore.documents.set(request.provider.parameters.path, request.provider.parameters.data);
        assert.equal((await provider.send(request, metadata)).outcome, 'accepted');
    });
    it('rejects changed targets, routing, unknown adapters, non-JSON and oversized requests', async () => {
        const provider = createScheduleDeliveryProviders({ firestore: new FakeFirestore() });
        for (const change of [(r) => { r.provider.parameters.path = 'users/other/notificationInbox/forged'; },
            (r) => { r.provider.parameters.data.appRoute = '/other'; }, (r) => { r.provider.adapter = 'unknown-v2'; }]) {
            const request = provider.pin(raw); change(request); await assert.rejects(provider.send(request, metadata), { code: 'provider_contract' });
        }
        for (const parameters of [{ bad: undefined }, { bad: new Date() }, { bad: Infinity }, { bad: 'x'.repeat(17000) }]) {
            assert.throws(() => normalizeNotificationAttempt({ ...raw, provider: { adapter: 'test-v1', parameters } }), { code: 'invalid_request' });
        }
    });
    it('pins full push options and rejects malformed provider acceptance', async () => {
        const request = pinScheduleProviderRequest({ ...raw, channel: 'push', endpoint: 'synthetic-token' });
        let parameters;
        const provider = createScheduleDeliveryProviders({ messaging: { send: async (input) => { parameters = input; return { unexpected: true }; } } });
        await assert.rejects(provider.send(request, metadata), { code: 'provider_contract' });
        assert.deepEqual(parameters, request.provider.parameters);
        assert.equal(await provider.reconcile(request, metadata), null);
    });
});
