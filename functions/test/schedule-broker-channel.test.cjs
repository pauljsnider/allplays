"use strict";
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { generateKeyPairSync } = require('node:crypto');
const { signBrokerCommand, createScheduleBrokerChannel } = require('../schedule-broker-channel.cjs');
const { FakeFirestore } = require('./helpers/notification-journal-fixture.cjs');
const { createFirestoreNotificationJournalStore } = require('../notification-attempt-journal.cjs');
const { scheduleDeliveryFingerprint: hash } = require('../schedule-delivery-coordinator.cjs');
function fixture(overrides = {}) {
    const keys = generateKeyPairSync('ed25519'); // ephemeral fixture only; never persisted
    const firestore = new FakeFirestore(); const store = createFirestoreNotificationJournalStore(firestore);
    let clock = 100000; let calls = 0; let permitted = true;
    const actor = { uid: 'owner', clientId: 'chatgpt.synthetic', grantKey: hash('grant'), sessionId: 'session' };
    const input = { keyId: 'test-key', privateKey: keys.privateKey, audience: 'isolated-command-backend', actor,
        command: { proposalId: 'proposal', teamId: 'team', eventId: 'event', mode: 'create', eventType: 'game', changes: { opponent: 'Visitors' } },
        approval: { preview: { opponent: 'Visitors' }, approve: true, notifyTeam: true }, idToken: 'synthetic-user-token', issuedAt: 90000, expiresAt: 150000 };
    const dependencies = { audience: input.audience, publicKeys: new Map([['test-key', keys.publicKey]]), store, now: () => clock,
        verifyUserToken: async (token, options) => { assert.equal(options.checkRevoked, true); assert.equal(token, input.idToken); return { uid: actor.uid, disabled: false, emailVerified: true, expiresAt: 200000 }; },
        verifyLiveSession: async () => permitted ? { ...actor, reviewRequests: true, connected: true, expiresAt: 200000 } : null, authorizeActor: async () => permitted,
        executeCommand: async ({ idToken, assertCurrent }) => { calls++; assert.equal(idToken, input.idToken); await assertCurrent(); return { commitVerified: true, secret: 'must-not-escape' }; }, ...overrides };
    return { input, dependencies, firestore, create: () => createScheduleBrokerChannel(dependencies), envelope: (changes = {}) => signBrokerCommand({ ...input, ...changes }), calls: () => calls,
        advance: (value = 160000) => { clock = value; }, revoke: () => { permitted = false; } };
}
describe('unmounted authenticated broker command channel', () => {
    for (const check of [1, 2]) for (const kind of ['expiry', 'removed-key', 'replaced-key']) it(`rejects ${kind} during authorization check ${check} before invoking the executor`, async () => {
        let authorizations = 0; let executions = 0;
        const f = fixture({ authorizeActor: async () => {
            await Promise.resolve();
            if (++authorizations === check) {
                if (kind === 'expiry') f.advance(150001);
                if (kind === 'removed-key') f.dependencies.publicKeys.delete('test-key');
                if (kind === 'replaced-key') f.dependencies.publicKeys.set('test-key', generateKeyPairSync('ed25519').publicKey);
            }
            return true;
        }, executeCommand: async () => { executions++; return { commitVerified: true }; } });
        const key = f.dependencies.publicKeys.get('test-key');
        await assert.rejects(f.create().handle(f.envelope()), { code: 'broker_request_denied' });
        assert.equal(executions, 0); assert.equal(f.firestore.documents.size, check === 1 ? 0 : 1);
        if (check === 2) {
            assert.equal([...f.firestore.documents.values()][0].state, 'reserved');
            f.advance(100000); f.dependencies.publicKeys.set('test-key', key);
            assert.equal((await f.create().handle(f.envelope())).status, 'unverified'); assert.equal(executions, 0);
        }
    });
    for (const kind of ['expiry', 'removed-key']) it(`carries a synchronous ${kind} guard to the actual REST fetch boundary`, async () => {
        const { createDirectCommandStore } = await import('../../services/chatgpt-mcp/src/directCommandStore.js');
        let businessCommits = 0; let entered = 0;
        const f = fixture({ executeCommand: async ({ assertCurrent, assertDispatchReady }) => {
            entered++; assert.equal(typeof assertDispatchReady, 'function');
            const store = createDirectCommandStore({ projectId: 'demo-allplays-mcp-review', uid: 'owner', idToken: 'synthetic-user-token', fetchImpl: async (url) => {
                if (url.endsWith(':commit')) businessCommits++;
                return new Response(JSON.stringify(url.endsWith(':beginTransaction') ? { transaction: 'synthetic' } : {}), { status: 200 });
            } }, { write: () => true });
            await store.transaction(async (tx) => { tx.set('teams/team/games/event', {}); }, { beforeDispatch: async () => {
                assert.equal(await assertCurrent(), assertDispatchReady);
                queueMicrotask(() => { if (kind === 'expiry') f.advance(150001); else f.dependencies.publicKeys.clear(); });
                return assertDispatchReady;
            } });
            return { commitVerified: true };
        } });
        await assert.rejects(f.create().handle(f.envelope()));
        assert.equal(entered, 1); assert.equal(businessCommits, 0);
        assert.equal([...f.firestore.documents.values()][0].state, 'unverified');
    });
    it('executes a signed, current command once across parallel calls, restart and new nonce', async () => {
        const f = fixture(); const channel = f.create();
        const result = await Promise.all([channel.handle(f.envelope()), channel.handle(f.envelope())]);
        assert.equal(f.calls(), 1); assert.ok(result.some((row) => row.status === 'committed'));
        assert.equal((await f.create().handle(f.envelope())).status, 'committed'); assert.equal(f.calls(), 1);
        assert.equal((await f.create().handle(f.envelope({ purpose: 'schedule.status' }))).status, 'committed');
        const persisted = JSON.stringify([...f.firestore.documents.values()]);
        for (const secret of ['synthetic-user-token', 'Visitors', 'must-not-escape', 'privateKey', 'tokenHash']) assert.ok(!persisted.includes(secret));
        assert.deepEqual(Object.keys(result[0]).sort(), ['operationId', 'status']);
    });
    for (const kind of ['signature', 'payload', 'token', 'key', 'extra-envelope', 'audience', 'purpose', 'future', 'expired', 'lifetime', 'notify', 'actor', 'extra-command']) it(`rejects ${kind} before storing or executing`, async () => {
        const f = fixture(); let envelope;
        if (kind === 'audience') envelope = f.envelope({ audience: 'other' });
        if (kind === 'purpose') envelope = f.envelope({ purpose: 'send-email' });
        if (kind === 'future') envelope = f.envelope({ issuedAt: 100001 });
        if (kind === 'expired') envelope = f.envelope({ expiresAt: 99999 });
        if (kind === 'lifetime') envelope = f.envelope({ issuedAt: 1 });
        if (kind === 'notify') envelope = f.envelope({ approval: { ...f.input.approval, notifyTeam: false } });
        if (kind === 'actor') envelope = f.envelope({ actor: { ...f.input.actor, grantKey: 'unverified' } });
        if (kind === 'extra-command') envelope = f.envelope({ command: { ...f.input.command, writePlan: {} } });
        envelope ||= f.envelope();
        if (kind === 'signature') envelope.signature = 'A'.repeat(86);
        if (kind === 'payload') { const payload = JSON.parse(Buffer.from(envelope.payload, 'base64url')); payload.command.changes.opponent = 'Unapproved'; envelope.payload = Buffer.from(JSON.stringify(payload)).toString('base64url'); }
        if (kind === 'token') envelope.idToken = 'different-token';
        if (kind === 'key') envelope.keyId = 'unknown';
        if (kind === 'extra-envelope') envelope.confirmed = true;
        await assert.rejects(f.create().handle(envelope)); assert.equal(f.calls(), 0); assert.equal(f.firestore.documents.size, 0);
    });
    for (const user of [{ uid: 'other' }, { disabled: true }, { emailVerified: false }, { expiresAt: 140000 }]) it(`rejects invalid current user ${JSON.stringify(user)}`, async () => {
        const f = fixture({ verifyUserToken: async () => ({ uid: 'owner', disabled: false, emailVerified: true, expiresAt: 200000, ...user }) });
        await assert.rejects(f.create().handle(f.envelope())); assert.equal(f.firestore.documents.size, 0);
    });
    for (const changes of [{ reviewRequests: false }, { connected: false }, { grantKey: hash('other') }, { expiresAt: 140000 }]) it(`requires explicit current scoped session evidence ${JSON.stringify(changes)}`, async () => {
        const f = fixture({ verifyLiveSession: async () => ({ ...f.input.actor, reviewRequests: true, connected: true, expiresAt: 200000, ...changes }) });
        await assert.rejects(f.create().handle(f.envelope())); assert.equal(f.calls(), 0); assert.equal(f.firestore.documents.size, 0);
    });
    it('checks revocation again after the durable reservation and never resumes it', async () => {
        let checks = 0; const f = fixture({ verifyLiveSession: async () => ++checks === 1 ? { ...f.input.actor, reviewRequests: true, connected: true, expiresAt: 200000 } : null });
        await assert.rejects(f.create().handle(f.envelope())); assert.equal(f.calls(), 0);
        f.dependencies.verifyLiveSession = async () => ({ ...f.input.actor, reviewRequests: true, connected: true, expiresAt: 200000 });
        assert.equal((await f.create().handle(f.envelope())).status, 'unverified'); assert.equal(f.calls(), 0);
    });
    it('refuses false reservation/completion persistence results without assuming success', async () => {
        const f = fixture(); f.dependencies.store.change = async () => false;
        await assert.rejects(f.create().handle(f.envelope()), { code: 'broker_outcome_unknown' }); assert.equal(f.calls(), 0);
        const g = fixture(); const change = g.dependencies.store.change; let writes = 0;
        g.dependencies.store.change = (...args) => ++writes === 2 ? false : change(...args);
        await assert.rejects(g.create().handle(g.envelope()), { code: 'broker_outcome_unknown' }); assert.equal(g.calls(), 1);
        assert.equal((await g.create().handle(g.envelope({ purpose: 'schedule.status' }))).status, 'unverified');
        await g.create().handle(g.envelope()); assert.equal(g.calls(), 1);
    });
    it('does not execute after a lost reservation response', async () => {
        const f = fixture(); f.firestore.failAfterTransactions.add(1);
        await assert.rejects(f.create().handle(f.envelope()), { code: 'broker_outcome_unknown' });
        assert.equal((await f.create().handle(f.envelope({ purpose: 'schedule.status' }))).status, 'unverified');
        await f.create().handle(f.envelope()); assert.equal(f.calls(), 0);
    });
    it('recovers only durable status after a lost completion response without re-execution', async () => {
        const f = fixture(); f.firestore.failAfterTransactions.add(2);
        await assert.rejects(f.create().handle(f.envelope()), { code: 'broker_outcome_unknown' });
        assert.equal((await f.create().handle(f.envelope({ purpose: 'schedule.status' }))).status, 'committed');
        await f.create().handle(f.envelope()); assert.equal(f.calls(), 1);
    });
    it('leaves unknown credentialed writes unverified and suppresses automatic retries', async () => {
        let attempts = 0; const f = fixture({ executeCommand: async () => { attempts++; throw new Error('secret-id-token-in-provider-error'); } });
        assert.equal((await f.create().handle(f.envelope())).status, 'unverified');
        assert.equal((await f.create().handle(f.envelope())).status, 'unverified'); assert.equal(attempts, 1);
        assert.ok(!JSON.stringify([...f.firestore.documents.values()]).includes('secret'));
    });
    it('denies a different command or session under the same proposal', async () => {
        const f = fixture(); await f.create().handle(f.envelope());
        await assert.rejects(f.create().handle(f.envelope({ command: { ...f.input.command, changes: { opponent: 'Other' } } })), { code: 'broker_command_conflict' });
        f.dependencies.verifyLiveSession = async () => ({ ...f.input.actor, sessionId: 'other', reviewRequests: true, connected: true, expiresAt: 200000 });
        await assert.rejects(f.create().handle(f.envelope({ actor: { ...f.input.actor, sessionId: 'other' } })), { code: 'broker_command_conflict' });
        assert.equal(f.calls(), 1);
    });
    it('never treats status of an unstarted command as execution authorization', async () => {
        const f = fixture(); assert.equal((await f.create().handle(f.envelope({ purpose: 'schedule.status' }))).status, 'not_started');
        assert.equal(f.firestore.documents.size, 0); assert.equal(f.calls(), 0);
    });
    it('refuses status after expiry or revocation and rejects newly removed signing keys', async () => {
        const f = fixture(); const envelope = f.envelope(); await f.create().handle(envelope); f.revoke();
        await assert.rejects(f.create().handle(f.envelope({ purpose: 'schedule.status' })));
        f.advance(); await assert.rejects(f.create().handle(envelope));
        const g = fixture(); const channel = g.create(); const signed = g.envelope(); g.dependencies.publicKeys.clear();
        await assert.rejects(channel.handle(signed)); assert.equal(g.calls(), 0);
    });
});

const { createServer } = require('node:http');
const { Readable } = require('node:stream');
const { createScheduleBrokerHttpHandler } = require('../schedule-broker-http.cjs');
function httpHandler(f, extra = {}) {
    return createScheduleBrokerHttpHandler({ channel: f.create(), audience: 'isolated-command-backend', allowedPrincipals: ['synthetic-broker'], allowedHosts: ['127.0.0.1'], now: () => 100000,
        verifyWorkloadIdentity: async (token, options) => { assert.equal(token, 'synthetic-workload-token'); return { principal: 'synthetic-broker', audience: options.audience, expiresAt: 200000 }; },
        takeRateLimit: async () => true, ...extra });
}
async function invoke(handler, envelope, overrides = {}) {
    const req = Readable.from([Buffer.from(JSON.stringify(envelope))]);
    Object.assign(req, { method: 'POST', url: '/internal/v1/schedule-command', headers: { host: '127.0.0.1', 'content-type': 'application/json', authorization: 'Bearer synthetic-workload-token' }, ...overrides });
    const res = { statusCode: 0, setHeader() {}, end(body) { this.body = JSON.parse(body); } };
    await handler(req, res); return res;
}
describe('private HTTP ingress contract', () => {
    it('terminates a stalled body read without invoking the channel', { timeout: 1000 }, async () => {
        const f = fixture(); let channelCalls = 0;
        const handler = httpHandler(f, { bodyReadTimeoutMs: 5, channel: { handle: async () => { channelCalls++; } } });
        const req = new Readable({ read() {} });
        Object.assign(req, { method: 'POST', url: '/internal/v1/schedule-command', headers: { host: '127.0.0.1', 'content-type': 'application/json', authorization: 'Bearer synthetic-workload-token' } });
        const res = { setHeader() {}, end(value) { this.body = JSON.parse(value); } };
        await handler(req, res);
        assert.equal(res.statusCode, 408); assert.equal(req.destroyed, true); assert.equal(channelCalls, 0);
        assert.deepEqual(res.body, { error: 'Command outcome unavailable.' });
    });
    for (const elapsed of [9999, 10000]) it(`enforces the body deadline at elapsed ${elapsed}ms`, async () => {
        const f = fixture(); let clock = 100000; let channelCalls = 0;
        const handler = httpHandler(f, { now: () => clock, channel: { handle: async () => { channelCalls++; return { operationId: 'a'.repeat(64), status: 'committed' }; } } });
        const req = Readable.from((async function* () { yield Buffer.from('{'); clock += elapsed; yield Buffer.from('}'); })());
        Object.assign(req, { method: 'POST', url: '/internal/v1/schedule-command', headers: { host: '127.0.0.1', 'content-type': 'application/json', authorization: 'Bearer synthetic-workload-token' } });
        const res = { setHeader() {}, end(value) { this.body = JSON.parse(value); } };
        await handler(req, res); assert.equal(res.statusCode, elapsed < 10000 ? 200 : 408); assert.equal(channelCalls, elapsed < 10000 ? 1 : 0);
    });
    it('rejects unbounded or invalid body timeout configuration', () => {
        const f = fixture();
        for (const bodyReadTimeoutMs of [0, -1, 30001, Infinity, 1.5, '1000']) assert.throws(() => httpHandler(f, { bodyReadTimeoutMs }));
    });
    for (const phase of ['rate-limit', 'body']) for (const change of ['expiry', 'allowlist']) it(`rechecks workload ${change} after awaiting ${phase}`, async () => {
        const f = fixture(); let clock = 100000; let channelCalls = 0; const principals = ['synthetic-broker'];
        const invalidate = () => { if (change === 'expiry') clock = 100002; else principals.length = 0; };
        const handler = httpHandler(f, { now: () => clock, allowedPrincipals: principals,
            verifyWorkloadIdentity: async () => ({ principal: 'synthetic-broker', audience: 'isolated-command-backend', expiresAt: 100001 }),
            takeRateLimit: async () => { if (phase === 'rate-limit') { await Promise.resolve(); invalidate(); } return true; },
            channel: { handle: async () => { channelCalls++; return { operationId: 'a'.repeat(64), status: 'committed' }; } } });
        const body = JSON.stringify(f.envelope());
        const req = Readable.from((async function* () {
            yield Buffer.from(body.slice(0, 10)); await Promise.resolve();
            if (phase === 'body') invalidate(); yield Buffer.from(body.slice(10));
        })());
        Object.assign(req, { method: 'POST', url: '/internal/v1/schedule-command', headers: { host: '127.0.0.1', 'content-type': 'application/json', authorization: 'Bearer synthetic-workload-token' } });
        const res = { setHeader() {}, end(value) { this.body = JSON.parse(value); } };
        await handler(req, res); assert.equal(res.statusCode, 403); assert.equal(channelCalls, 0);
        assert.deepEqual(res.body, { error: 'Command outcome unavailable.' });
    });
    for (const kind of ['host', 'origin', 'content-type', 'method', 'path', 'workload', 'rate', 'size']) it(`rejects invalid ${kind} before command execution`, async () => {
        const f = fixture(); const envelope = f.envelope(); let overrides = {}; let dependencies = {};
        const headers = { host: '127.0.0.1', 'content-type': 'application/json', authorization: 'Bearer synthetic-workload-token' };
        if (kind === 'host') headers.host = 'untrusted.example';
        if (kind === 'origin') headers.origin = 'https://untrusted.example';
        if (kind === 'content-type') headers['content-type'] = 'text/plain';
        if (kind === 'method') overrides.method = 'GET';
        if (kind === 'path') overrides.url = '/public';
        if (kind === 'workload') dependencies.verifyWorkloadIdentity = async () => ({ principal: 'other', audience: 'isolated-command-backend', expiresAt: 200000 });
        if (kind === 'rate') dependencies.takeRateLimit = async () => false;
        if (kind === 'size') envelope.payload = 'A'.repeat(50000);
        const res = await invoke(httpHandler(f, dependencies), envelope, { ...overrides, headers });
        assert.notEqual(res.statusCode, 200); assert.equal(f.calls(), 0); assert.equal(f.firestore.documents.size, 0);
        assert.deepEqual(res.body, { error: 'Command outcome unavailable.' });
    });
    it('crosses a real loopback HTTP boundary with signed bytes, then rejects tampering and replays safely', async () => {
        const f = fixture(); let handler; const server = createServer((req, res) => handler(req, res));
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const host = `127.0.0.1:${server.address().port}`; handler = httpHandler(f, { allowedHosts: [host] });
        const send = (body) => fetch(`http://${host}/internal/v1/schedule-command`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-workload-token' }, body: JSON.stringify(body), redirect: 'error' });
        try {
            const envelope = f.envelope(); const response = await send(envelope); assert.equal(response.status, 200); assert.equal((await response.json()).status, 'committed');
            const replay = await send(envelope); assert.equal((await replay.json()).status, 'committed'); assert.equal(f.calls(), 1);
            envelope.idToken = 'substituted-token'; const rejected = await send(envelope); assert.equal(rejected.status, 403); assert.equal(f.calls(), 1);
        } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    });
    it('persists status after the client disconnects without authorizing a second execution', async () => {
        let start; let finish; let complete; let calls = 0;
        const started = new Promise((resolve) => { start = resolve; }); const finishing = new Promise((resolve) => { finish = resolve; });
        const completed = new Promise((resolve) => { complete = resolve; });
        const f = fixture({ executeCommand: async () => { calls++; start(); await finishing; return { commitVerified: true }; } });
        let handler; const server = createServer(async (req, res) => { await handler(req, res); complete(); });
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const host = `127.0.0.1:${server.address().port}`; handler = httpHandler(f, { allowedHosts: [host] });
        const controller = new AbortController();
        try {
            const request = fetch(`http://${host}/internal/v1/schedule-command`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-workload-token' }, body: JSON.stringify(f.envelope()), signal: controller.signal }).catch(() => null);
            await started; controller.abort(); await request; finish(); await completed;
            assert.equal((await f.create().handle(f.envelope({ purpose: 'schedule.status' }))).status, 'committed');
            await f.create().handle(f.envelope()); assert.equal(calls, 1);
        } finally { finish(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    });
});

const { signBrokerStatusQuery } = require('../schedule-broker-channel.cjs');
describe('read-only replacement-session recovery', () => {
    const query = (f, changes = {}) => signBrokerStatusQuery({ ...f.input, actor: { ...f.input.actor, sessionId: 'replacement-session' },
        teamId: f.input.command.teamId, proposalId: f.input.command.proposalId, ...changes });
    const live = (f) => { f.dependencies.verifyLiveSession = async (input) => ({ ...input, connected: true, reviewRequests: true, expiresAt: 200000 }); };
    it('reads committed status from a new session on the original grant without mutating or executing', async () => {
        const f = fixture(); await f.create().handle(f.envelope()); live(f);
        const rows = structuredClone([...f.firestore.documents]); const transactions = f.firestore.transactionCount;
        const result = await f.create().handle(query(f)); assert.equal(result.status, 'committed'); assert.equal(f.calls(), 1);
        assert.deepEqual([...f.firestore.documents], rows); assert.equal(f.firestore.transactionCount, transactions);
        assert.deepEqual(Object.keys(result).sort(), ['operationId', 'status']);
    });
    it('returns not_started for a missing attempt without creating an execution reservation', async () => {
        const f = fixture(); live(f); assert.equal((await f.create().handle(query(f))).status, 'not_started');
        assert.equal(f.calls(), 0); assert.equal(f.firestore.documents.size, 0);
    });
    for (const state of ['reserved', 'unverified']) it(`preserves ${state} uncertainty after restart without replay`, async () => {
        const f = fixture(); await f.create().handle(f.envelope()); live(f);
        const [path, row] = [...f.firestore.documents][0]; f.firestore.documents.set(path, { ...row, state });
        assert.equal((await f.create().handle(query(f))).status, 'unverified'); assert.equal(f.calls(), 1);
        assert.equal(f.firestore.documents.get(path).state, state);
    });
    for (const field of ['clientId', 'grantKey']) it(`rejects a different ${field} even when the account can currently manage the team`, async () => {
        const f = fixture(); await f.create().handle(f.envelope()); live(f);
        const actor = { ...f.input.actor, sessionId: 'new', [field]: field === 'grantKey' ? 'b'.repeat(64) : 'another-client' };
        await assert.rejects(f.create().handle(query(f, { actor })), { code: 'broker_command_conflict' }); assert.equal(f.calls(), 1);
    });
    it('does not retrofit recovery authority onto a historical row missing grant lineage', async () => {
        const f = fixture(); await f.create().handle(f.envelope()); live(f);
        const [path, row] = [...f.firestore.documents][0]; delete row.recoveryActorHash; f.firestore.documents.set(path, row);
        await assert.rejects(f.create().handle(query(f)), { code: 'broker_command_conflict' }); assert.equal(f.calls(), 1);
    });
    it('cannot promote a read-only recovery envelope into an execute or original-session status command', async () => {
        const f = fixture(); live(f);
        for (const purpose of ['schedule.execute', 'schedule.status']) {
            const envelope = query(f); const value = JSON.parse(Buffer.from(envelope.payload, 'base64url').toString()); value.purpose = purpose;
            envelope.payload = Buffer.from(JSON.stringify(value)).toString('base64url');
            const { sign } = require('node:crypto'); envelope.signature = sign(null, Buffer.from(`${envelope.keyId}.${envelope.payload}`), f.input.privateKey).toString('base64url');
            await assert.rejects(f.create().handle(envelope));
        }
        assert.equal(f.calls(), 0); assert.equal(f.firestore.documents.size, 0);
    });
    it('refuses executable approval fields on the recovery-only purpose', async () => {
        const f = fixture(); live(f); await assert.rejects(f.create().handle(f.envelope({ purpose: 'schedule.recover' })));
        assert.equal(f.calls(), 0); assert.equal(f.firestore.documents.size, 0);
    });
    for (const phase of ['session', 'permission', 'read']) it(`rechecks current permission and expiry around recovery ${phase} awaits`, async () => {
        const f = fixture(); await f.create().handle(f.envelope()); live(f);
        if (phase === 'session') f.dependencies.verifyLiveSession = async (input) => { f.advance(150001); return { ...input, connected: true, reviewRequests: true, expiresAt: 200000 }; };
        if (phase === 'permission') f.dependencies.authorizeActor = async () => { f.advance(150001); return true; };
        if (phase === 'read') {
            const get = f.dependencies.store.get; f.dependencies.store.get = async (...args) => { const result = await get(...args); f.advance(150001); return result; };
        }
        await assert.rejects(f.create().handle(query(f))); assert.equal(f.calls(), 1);
    });
    it('never resumes execution when a new session presents another explicit execute envelope for the same attempt', async () => {
        const f = fixture(); await f.create().handle(f.envelope()); live(f);
        await assert.rejects(f.create().handle(f.envelope({ actor: { ...f.input.actor, sessionId: 'replacement-session' } })), { code: 'broker_command_conflict' });
        assert.equal(f.calls(), 1);
    });
});
