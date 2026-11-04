"use strict";
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { FakeFirestore } = require('./helpers/notification-journal-fixture.cjs');
const { createFirestoreNotificationJournalStore } = require('../notification-attempt-journal.cjs');
const { createScheduleEvidenceAuthority } = require('../schedule-delivery-evidence.cjs');
const { createScheduleDeliveryStatusHandler, createFirestoreStatusRateLimit } = require('../schedule-delivery-status.cjs');
const { createScheduleDeliveryAudience, createFirestoreScheduleRecipientLoader } = require('../schedule-delivery-audience.cjs');
const { createScheduleDeliveryCoordinator, scheduleDeliveryFingerprint: hash } = require('../schedule-delivery-coordinator.cjs');
const { createScheduleDeliveryProviders } = require('../schedule-delivery-providers.cjs');

function evidenceFixture(overrides = {}) {
    const firestore = new FakeFirestore(); const store = createFirestoreNotificationJournalStore(firestore);
    let clock = 100000; let permitted = true; let disconnected = false;
    const actor = { uid: 'owner', clientId: 'synthetic-client', grantKey: hash('synthetic-grant'), sessionId: 'synthetic-session', reviewRequests: true, expiresAt: 200000 };
    const event = { version: '1970-01-01T00:01:40.001Z', data: { type: 'practice', title: 'Synthetic practice' } };
    const command = { proposalId: 'synthetic-proposal', teamId: 'team-1', eventId: 'event-1', mode: 'create', eventType: 'practice', intentDigest: hash('synthetic-intent'),
        previewDigest: hash('synthetic-preview'), eventDigest: hash(event.data), beforeVersion: null };
    const form = { ...actor, ...command, approve: true, notifyTeam: true, disconnected: false, issuedAt: 90000, expiresAt: 150000 };
    let observed;
    const dependencies = { store, now: () => clock, authenticate: async (credential) => { if (credential !== 'synthetic-credential' || disconnected) throw new Error('private auth error'); return actor; },
        resolveCommand: async (handle) => { if (handle !== 'validated-command') throw new Error('Untrusted command'); return command; },
        verifyForm: async (handle) => { if (handle !== 'broker-form-proof') throw new Error('Untrusted form'); return form; },
        verifyCommitObservation: async (handle) => { if (handle !== 'writer-observation') throw new Error('Untrusted commit'); return observed; },
        authorize: async () => permitted, ...overrides };
    const create = () => createScheduleEvidenceAuthority(dependencies); const authority = create();
    const issue = () => authority.issue('synthetic-credential', { formHandle: 'broker-form-proof', commandHandle: 'validated-command' });
    const consume = (reference) => authority.consume('synthetic-credential', reference);
    const record = (reference, dispatchId) => authority.recordCommit('synthetic-credential', reference, dispatchId, 'writer-observation');
    const observe = (dispatchId) => { clock = 100001; observed = { ...actor, ...command, dispatchId, committed: true, committedAt: clock, sourceVersion: event.version }; return observed; };
    return { firestore, store, actor, event, command, form, dependencies, authority, create, issue, consume, record, observe,
        now: () => clock, advance: (ms) => { clock += ms; }, revoke: () => { permitted = false; }, disconnect: () => { disconnected = true; } };
}

describe('durable actor-bound schedule approval evidence', () => {
    it('persists one approval and one consumed commit, then feeds the coordinator without a client receipt', async () => {
        const f = evidenceFixture(); const ref = await f.issue(); const dispatch = await f.consume(ref); f.observe(dispatch.dispatchId);
        await f.record(ref, dispatch.dispatchId);
        const restarted = f.create(); const approval = await restarted.verifyApproval(ref); const commit = await restarted.verifyCommit(ref);
        assert.equal(approval.consumed, true); assert.equal(commit.committed, true); assert.equal(approval.approvalId, ref.evidenceId);
        const coordinator = createScheduleDeliveryCoordinator({ store: f.store, now: f.now, authenticate: f.dependencies.authenticate,
            verifyApproval: restarted.verifyApproval, verifyCommit: restarted.verifyCommit, readEvent: async () => f.event,
            authorize: async () => ({ actorAllowed: true, recipientAllowed: true }), resolveRecipients: async () => [],
            providers: createScheduleDeliveryProviders({ firestore: f.firestore }) });
        const binding = await coordinator.bind('synthetic-credential', { approvalHandle: ref, commitHandle: ref });
        assert.equal((await coordinator.deliver('synthetic-credential', binding)).plannedTargetCount, 0);
        assert.deepEqual(Object.keys(ref).sort(), ['evidenceId', 'teamId']); assert.ok(!JSON.stringify(ref).includes('dispatch'));
    });
    it('rejects model-selected approvals, unvalidated commands and fake completion receipts', async () => {
        const f = evidenceFixture();
        await assert.rejects(f.authority.issue('synthetic-credential', { formHandle: { approve: true, notifyTeam: true }, commandHandle: 'validated-command' }), { code: 'evidence_denied' });
        await assert.rejects(f.authority.issue('synthetic-credential', { formHandle: 'broker-form-proof', commandHandle: f.command }), { code: 'evidence_denied' });
        const ref = await f.issue(); const dispatch = await f.consume(ref);
        await assert.rejects(f.authority.recordCommit('synthetic-credential', ref, dispatch.dispatchId, { status: 'completed' }), { code: 'evidence_denied' });
        await assert.rejects(f.authority.verifyCommit(ref), { code: 'commit_unverified' });
    });
    for (const key of ['uid', 'clientId', 'grantKey', 'sessionId', 'proposalId', 'intentDigest', 'eventDigest', 'previewDigest']) it(`rejects form evidence for another ${key}`, async () => {
        const f = evidenceFixture(); f.form[key] = 'other'; await assert.rejects(f.issue(), { code: 'evidence_denied' }); assert.equal(f.firestore.documents.size, 0);
    });
    it('requires both acknowledgments, a connected session and a bounded live approval', async () => {
        for (const change of [(f) => { f.form.approve = false; }, (f) => { f.form.notifyTeam = false; }, (f) => { f.form.disconnected = true; },
            (f) => { f.form.expiresAt = 100000; }, (f) => { f.form.issuedAt = 100001; }, (f) => { f.form.expiresAt = 999999; }]) {
            const f = evidenceFixture(); change(f); await assert.rejects(f.issue(), { code: 'evidence_denied' });
        }
    });
    it('serializes concurrent consumption and never issues a second dispatch capability', async () => {
        const f = evidenceFixture(); const ref = await f.issue();
        const results = await Promise.allSettled([f.consume(ref), f.create().consume('synthetic-credential', ref)]);
        assert.equal(results.filter((row) => row.status === 'fulfilled').length, 1);
        assert.equal(results.find((row) => row.status === 'rejected').reason.code, 'approval_replayed');
        await assert.rejects(f.consume(ref), { code: 'approval_replayed' });
    });
    it('recovers lost issue, consume and commit responses without replacing the evidence', async () => {
        const f = evidenceFixture(); f.firestore.failAfterTransactions.add(1); const ref = await f.issue();
        f.firestore.failAfterTransactions.add(2); const dispatch = await f.consume(ref); f.observe(dispatch.dispatchId);
        f.firestore.failAfterTransactions.add(3); await f.record(ref, dispatch.dispatchId);
        await f.record(ref, dispatch.dispatchId); assert.equal((await f.create().verifyCommit(ref)).sourceVersion, f.event.version);
        assert.equal(f.firestore.documents.size, 1);
    });
    it('does not turn a failed or false reservation into approval', async () => {
        const f = evidenceFixture({ store: { get: async () => null, change: async () => false } });
        await assert.rejects(f.issue(), { code: 'evidence_conflict' });
        const failed = evidenceFixture(); failed.firestore.failBeforeTransactions.add(1);
        await assert.rejects(failed.issue()); assert.equal(failed.firestore.documents.size, 0);
    });
    it('denies consumption after scope, identity, expiry, permission or connection changes', async () => {
        for (const change of [(f) => { f.actor.reviewRequests = false; }, (f) => { f.actor.sessionId = 'new-session'; },
            (f) => f.advance(50001), (f) => f.revoke(), (f) => f.disconnect()]) {
            const f = evidenceFixture(); const ref = await f.issue(); change(f); await assert.rejects(f.consume(ref));
            await assert.rejects(f.authority.verifyApproval(ref), { code: 'commit_unverified' });
        }
    });
    it('withholds the dispatch capability when the session expires or disconnects during persistence', async () => {
        for (const change of [(f) => f.advance(50001), (f) => f.disconnect()]) {
            const f = evidenceFixture(); const ref = await f.issue(); const original = f.store.change;
            f.store.change = async (...args) => { const value = await original(...args); change(f); return value; };
            await assert.rejects(f.consume(ref));
            const row = await f.store.get(ref.teamId, ref.evidenceId); assert.equal(row.state, 'consumed');
            await assert.rejects(f.authority.verifyCommit(ref), { code: 'commit_unverified' });
        }
    });
    it('rejects mismatched dispatch, actor, digest, source time and conflicting commit replay', async () => {
        for (const key of ['uid', 'clientId', 'grantKey', 'sessionId', 'intentDigest', 'eventDigest', 'dispatchId', 'sourceVersion']) {
            const f = evidenceFixture(); const ref = await f.issue(); const dispatch = await f.consume(ref); f.observe(dispatch.dispatchId)[key] = 'other';
            await assert.rejects(f.record(ref, dispatch.dispatchId), { code: 'evidence_denied' });
        }
        const f = evidenceFixture(); const ref = await f.issue(); const dispatch = await f.consume(ref); f.observe(dispatch.dispatchId); await f.record(ref, dispatch.dispatchId);
        const changed = f.observe(dispatch.dispatchId); changed.sourceVersion = '1970-01-01T00:01:40Z'; changed.committedAt = 100000;
        await assert.rejects(f.record(ref, dispatch.dispatchId), { code: 'evidence_conflict' });
    });
    it('composes durable evidence, canonical audience, partial delivery and authenticated status without resending', async () => {
        const f = evidenceFixture(); const ref = await f.issue(); const dispatch = await f.consume(ref); f.observe(dispatch.dispatchId); await f.record(ref, dispatch.dispatchId);
        const audience = createScheduleDeliveryAudience({ listCanonicalMembers: async () => ({ complete: true, uids: ['owner', 'member'] }), authorizeActor: async () => true,
            loadRecipient: async ({ uid }) => ({ uid, complete: true, authEnabled: true, roles: ['parent'], preferences: null, devices: [{ ownerUid: uid, token: 'synthetic-device' }] }) });
        let pushes = 0;
        const authenticate = async (credential) => { assert.equal(credential, 'Bearer synthetic-token'); return f.actor; };
        const coordinator = createScheduleDeliveryCoordinator({ store: f.store, now: f.now, authenticate, verifyApproval: f.authority.verifyApproval, verifyCommit: f.authority.verifyCommit,
            readEvent: async () => f.event, resolveRecipients: audience.resolve, authorize: audience.authorize,
            providers: createScheduleDeliveryProviders({ firestore: f.firestore, messaging: { send: async () => { pushes++; throw new Error('Synthetic unknown push outcome'); } } }) });
        const binding = await coordinator.bind('Bearer synthetic-token', { approvalHandle: ref, commitHandle: ref });
        assert.equal((await coordinator.deliver('Bearer synthetic-token', binding)).uncertain, 1);
        let appUsed = false;
        const handler = createScheduleDeliveryStatusHandler({ authenticate, now: f.now, allowedAppIds: ['synthetic-app'], coordinator,
            takeRateLimit: createFirestoreStatusRateLimit({ firestore: f.firestore, now: f.now }),
            verifyAppCheck: async () => { const alreadyConsumed = appUsed; appUsed = true; return { appId: 'synthetic-app', alreadyConsumed }; } });
        const request = { method: 'POST', headers: { host: 'localhost', authorization: 'Bearer synthetic-token', 'x-firebase-appcheck': 'synthetic-appcheck', 'content-type': 'application/json' }, body: { ...binding, reconcile: true } };
        const response = () => ({ setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
        const first = response(); await handler(request, first); assert.equal(first.code, 200); assert.equal(first.body.accepted, 1); assert.equal(first.body.uncertain, 1);
        const replay = response(); await handler(request, replay); assert.equal(replay.code, 403);
        await coordinator.deliver('Bearer synthetic-token', binding); assert.equal(pushes, 1);
    });
});

function routeFixture(overrides = {}) {
    let calls = 0; let appOptions;
    const result = { bindingId: hash('binding'), status: 'recorded', plannedTargetCount: 2, accepted: 1, uncertain: 1, suppressed: 0, pending: 0, failed: 0, deviceDelivery: 'unverified', privateToken: 'must-not-return' };
    const handler = createScheduleDeliveryStatusHandler({ now: () => 100000, allowedAppIds: ['synthetic-app'],
        authenticate: async () => ({ uid: 'owner', clientId: 'client', grantKey: hash('grant'), reviewRequests: true, expiresAt: 200000 }),
        verifyAppCheck: async (_token, options) => { appOptions = options; return { appId: 'synthetic-app', alreadyConsumed: false }; },
        takeRateLimit: async () => true, coordinator: { status: async () => { calls++; return result; } }, ...overrides });
    const request = { method: 'POST', headers: { host: 'localhost:9999', authorization: 'Bearer synthetic-token', 'x-firebase-appcheck': 'synthetic-app-token', 'content-type': 'application/json' }, body: { teamId: 'team-1', bindingId: hash('binding'), reconcile: true } };
    const run = async () => { const response = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, status(value) { this.code = value; return this; }, json(value) { this.body = value; return this; } }; await handler(request, response); return response; };
    return { run, request, result, calls: () => calls, appOptions: () => appOptions };
}

describe('unmounted authenticated delivery status route', () => {
    it('projects bounded partial delivery and consumes App Check for reconciliation', async () => {
        const f = routeFixture(); const response = await f.run(); assert.equal(response.code, 200);
        assert.equal(response.body.accepted, 1); assert.equal(response.body.uncertain, 1); assert.ok(!JSON.stringify(response.body).includes('must-not-return'));
        assert.equal(response.headers['Cache-Control'], 'no-store'); assert.deepEqual(f.appOptions(), { consume: true });
    });
    it('does not request App Check consumption for plain status reads', async () => {
        const f = routeFixture(); f.request.body.reconcile = false; assert.equal((await f.run()).code, 200); assert.deepEqual(f.appOptions(), { consume: false });
    });
    it('rejects host/origin spoofing, cookies, malformed payloads, extra actions and wrong methods before status', async () => {
        for (const change of [(f) => { f.request.headers.host = 'evil.test'; }, (f) => { f.request.headers.host = 'evil@localhost'; }, (f) => { f.request.headers.origin = 'https://evil.test'; },
            (f) => { delete f.request.headers.authorization; f.request.headers.cookie = 'session=fake'; }, (f) => { f.request.body.send = true; },
            (f) => { f.request.body.teamId = '../other'; }, (f) => { f.request.body.reconcile = 'yes'; }, (f) => { f.request.method = 'GET'; },
            (f) => { f.request.headers['content-type'] = 'text/plain'; }, (f) => { f.request.body.bindingId = 'x'.repeat(9000); }]) {
            const f = routeFixture(); change(f); assert.notEqual((await f.run()).code, 200); assert.equal(f.calls(), 0);
        }
    });
    it('denies invalid, absent and replayed App Check, failed scope, expired credentials and rate exhaustion', async () => {
        for (const overrides of [{ verifyAppCheck: async () => ({ appId: 'other' }) }, { verifyAppCheck: async () => ({ appId: 'synthetic-app' }) }, { verifyAppCheck: async () => ({ appId: 'synthetic-app', alreadyConsumed: true }) },
            { authenticate: async () => ({ uid: 'owner', reviewRequests: false }) }, { authenticate: async () => { throw new Error('private-token'); } },
            { takeRateLimit: async () => false }]) {
            const f = routeFixture(overrides); const response = await f.run(); assert.notEqual(response.code, 200); assert.equal(f.calls(), 0); assert.ok(!JSON.stringify(response.body).includes('private-token'));
        }
        const f = routeFixture(); delete f.request.headers['x-firebase-appcheck']; assert.equal((await f.run()).code, 403);
    });
    it('rejects incoherent or overlarge status instead of leaking a backend response', async () => {
        for (const change of [(f) => { f.result.accepted = 99; }, (f) => { f.result.bindingId = hash('other'); }, (f) => { f.result.uncertain = -1; }]) {
            const f = routeFixture(); change(f); assert.equal((await f.run()).code, 503);
        }
    });
    it('shares a durable bounded counter across workers and denies uncertain persistence', async () => {
        const firestore = new FakeFirestore(); let clock = 100000;
        const one = createFirestoreStatusRateLimit({ firestore, now: () => clock });
        const two = createFirestoreStatusRateLimit({ firestore, now: () => clock });
        const input = { key: hash('principal'), limit: 30, windowMs: 60000 };
        const results = await Promise.all(Array.from({ length: 40 }, (_, index) => (index % 2 ? one : two)(input)));
        assert.equal(results.filter(Boolean).length, 30);
        clock += 60000; assert.equal(await two(input), true);
        firestore.failAfterTransactions.add(firestore.transactionCount + 1); assert.equal(await one(input), false);
        assert.equal(firestore.read(`mcpStatusRateLimits/${input.key}`).count, 2);
    });
    it('does not reset rate limiting when an access token rotates within the same client', async () => {
        const keys = [];
        for (const grant of ['first', 'second']) {
            const f = routeFixture({ authenticate: async () => ({ uid: 'owner', clientId: 'client', grantKey: hash(grant), reviewRequests: true, expiresAt: 200000 }),
                takeRateLimit: async ({ key }) => { keys.push(key); return true; } });
            assert.equal((await f.run()).code, 200);
        }
        assert.equal(keys[0], keys[1]);
    });
});

describe('complete canonical schedule audience interfaces', () => {
    const recipient = (uid, overrides = {}) => ({ uid, complete: true, authEnabled: true, roles: ['parent'], preferences: null, devices: [{ ownerUid: uid, token: `synthetic-${uid}` }], ...overrides });
    function fixture() {
        const members = { complete: true, uids: ['owner', 'member', 'tokenless', 'opted-out', 'disabled', 'removed'] };
        const records = { owner: recipient('owner', { roles: ['staff'] }), member: recipient('member'), tokenless: recipient('tokenless', { devices: [] }),
            'opted-out': recipient('opted-out', { preferences: { schedule: false } }), disabled: recipient('disabled', { authEnabled: false }), removed: recipient('removed', { roles: [] }) };
        let allowed = true;
        const audience = createScheduleDeliveryAudience({ listCanonicalMembers: async () => members, loadRecipient: async ({ uid }) => records[uid], authorizeActor: async () => allowed });
        return { members, records, audience, resolve: () => audience.resolve({ teamId: 'team-1', actorUid: 'owner' }), revoke: () => { allowed = false; } };
    }
    it('uses current roles, disabled state and schedule preferences, excludes the actor and keeps tokenless inbox recipients', async () => {
        const f = fixture(); const result = await f.resolve(); assert.equal(result.length, 3);
        assert.deepEqual(result.map((row) => [row.recipientUid, row.channel]), [['member', 'inbox'], ['member', 'push'], ['tokenless', 'inbox']]);
    });
    it('fails closed on incomplete membership or recipient pages and conflicting endpoint ownership', async () => {
        for (const change of [(f) => { f.members.complete = false; }, (f) => { f.records.member.complete = false; },
            (f) => { f.records.member.devices[0].ownerUid = 'other'; }, (f) => { f.records.tokenless.devices = [{ ownerUid: 'tokenless', token: 'synthetic-member' }]; },
            (f) => { f.records.member.devices = Array.from({ length: 21 }, () => ({ ownerUid: 'member', token: 'synthetic-device' })); }]) {
            const f = fixture(); change(f); await assert.rejects(f.resolve(), { code: 'audience_unavailable' });
        }
    });
    it('rechecks access, preferences and exact endpoints before each dispatch', async () => {
        const f = fixture(); const request = { teamId: 'team-1', actorUid: 'owner', recipientUid: 'member', channel: 'push', endpoint: 'synthetic-member' };
        const input = { actor: { uid: 'owner' }, binding: { teamId: 'team-1' }, request };
        assert.equal((await f.audience.authorize(input)).recipientAllowed, true);
        f.records.member.devices[0].token = 'rotated'; assert.equal((await f.audience.authorize(input)).recipientAllowed, false);
        f.records.member.preferences = { schedule: false }; request.channel = 'inbox'; request.endpoint = 'member'; assert.equal((await f.audience.authorize(input)).recipientAllowed, false);
        f.revoke(); assert.equal((await f.audience.authorize(input)).actorAllowed, false);
    });
    it('does not silently truncate an audience exceeding the delivery bound', async () => {
        const f = fixture(); f.members.uids = Array.from({ length: 51 }, (_, i) => `member-${i}`);
        f.members.uids.forEach((uid) => { f.records[uid] = recipient(uid); });
        await assert.rejects(f.resolve(), { code: 'audience_unavailable' });
    });
    it('loads current Auth and canonical records with bounded device reads; ignores claimed device uid fields', async () => {
        const firestore = new FakeFirestore(); firestore.documents.set('teams/team-1', { ownerId: 'owner' }); firestore.documents.set('users/member', { parentTeamIds: ['team-1'] });
        let collectionPath; let limit;
        firestore.collection = (path) => { collectionPath = path; return { limit: (value) => { limit = value; return { get: async () => ({ docs: [{ data: () => ({ token: 'synthetic-device', uid: 'forged-other' }) }] }) }; } }; };
        let rolesInput;
        const loader = createFirestoreScheduleRecipientLoader({ firestore, auth: { getUser: async (uid) => ({ uid, disabled: false, email: 'synthetic@example.test' }) }, resolveCanonicalRoles: (input) => { rolesInput = input; return ['parent']; } });
        const value = await loader({ teamId: 'team-1', uid: 'member' }); assert.equal(value.devices[0].ownerUid, 'member'); assert.equal(limit, 21);
        assert.equal(collectionPath, 'users/member/notificationDevices'); assert.equal(rolesInput.email, 'synthetic@example.test');
        const missing = createFirestoreScheduleRecipientLoader({ firestore, auth: { getUser: async () => { throw { code: 'auth/user-not-found' }; } }, resolveCanonicalRoles: () => [] });
        assert.equal((await missing({ teamId: 'team-1', uid: 'missing' })).authEnabled, false);
    });
});
