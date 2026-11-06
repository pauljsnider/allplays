"use strict";
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { createPrivateBrokerJsonClient } = require('../private-broker-http.cjs');
const { createScheduleSessionHttpHandler, createScheduleSessionIntrospector } = require('../schedule-session-http.cjs');
const { createScheduleBrokerCommandClient } = require('../schedule-broker-http.cjs');
const audience = 'isolated-session-service';
const binding = { uid: 'owner', clientId: 'client', grantKey: 'a'.repeat(64), sessionId: 'session', expiresAt: 150000, purpose: 'schedule.execute' };
const live = { ...Object.fromEntries(['uid', 'clientId', 'grantKey', 'sessionId'].map((key) => [key, binding[key]])), connected: true, reviewRequests: true, expiresAt: 200000 };
const url = 'https://isolated-broker.test/internal/v1/schedule-session';
const response = (body) => new Response(JSON.stringify(body), { status: 200 });
async function fixture(t, overrides = {}) {
    let clock = 100000; const now = () => clock; let calls = 0;
    let handler; const server = createServer((req, res) => handler(req, res));
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); });
    const host = `127.0.0.1:${server.address().port}`;
    handler = createScheduleSessionHttpHandler({ now, audience, allowedHosts: [host], allowedPrincipals: ['isolated-backend'], takeRateLimit: async () => true,
        verifyWorkloadIdentity: async (value, requested) => { assert.equal(requested.audience, audience); if (value !== 'synthetic-workload') throw new Error('denied'); return { principal: 'isolated-backend', audience, expiresAt: 300000 }; },
        introspectSession: async (input) => { calls++; assert.deepEqual(input, binding); return live; }, ...overrides });
    const fetchImpl = (target, options) => { assert.equal(target, url); assert.equal(options.redirect, 'error'); return fetch(target.replace('https://isolated-broker.test', `http://${host}`), options); };
    const introspect = createScheduleSessionIntrospector({ url, audience, now, fetchImpl, getWorkloadToken: async (request) => { assert.equal(request.audience, audience); return 'synthetic-workload'; } });
    const raw = (body, token = 'synthetic-workload') => fetch(`http://${host}/internal/v1/schedule-session`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { introspect, raw, calls: () => calls, advance: (ms) => { clock += ms; } };
}
test('private session round trip returns only the exact binding and live status', async (t) => {
    const f = await fixture(t); assert.deepEqual(await f.introspect(binding), live); assert.equal(f.calls(), 1);
    assert.equal((await f.raw(binding, 'invalid')).status, 403); assert.equal(f.calls(), 1);
});
for (const change of [{ uid: 'other' }, { clientId: 'other' }, { grantKey: 'b'.repeat(64) }, { sessionId: 'other' }, { connected: false }, { reviewRequests: false }, { expiresAt: 149999 }, { idToken: 'never-return-credentials' }]) {
    test(`rejects mismatched or excessive session output: ${Object.keys(change)[0]}`, async (t) => {
        const f = await fixture(t, { introspectSession: async () => ({ ...live, ...change }) });
        await assert.rejects(f.introspect(binding), /unavailable/);
    });
}
for (const change of [{ extra: 'denied' }, { uid: '../other' }, { grantKey: 'not-a-hash' }, { purpose: 'schedule.arbitrary' }, { expiresAt: 100000 }, { expiresAt: 220001 }]) {
    test(`rejects malformed session input before resolver: ${Object.keys(change)[0]}`, async (t) => {
        const f = await fixture(t); assert.equal((await f.raw({ ...binding, ...change })).status, 403); assert.equal(f.calls(), 0);
        await assert.rejects(async () => f.introspect({ ...binding, ...change }));
    });
}
test('rechecks session deadline after asynchronous introspection', async (t) => {
    let clock = 100000;
    const f = await fixture(t, { now: () => clock, introspectSession: async () => { clock = 150001; return live; } });
    assert.equal((await f.raw(binding)).status, 403);
});
test('rejects oversized private session payloads', async (t) => {
    const f = await fixture(t); assert.equal((await f.raw({ ...binding, padding: 'a'.repeat(3000) })).status, 413); assert.equal(f.calls(), 0);
});
const client = (overrides = {}) => createPrivateBrokerJsonClient({ url, audience, now: () => 100000, getWorkloadToken: async () => 'synthetic-workload', validateResult: (result) => result, fetchImpl: async () => response(live), ...overrides });
for (const target of ['http://example.test/internal/v1/schedule-session', `${url}?query=yes`, `${url}#fragment`, 'https://user:pass@example.test/internal/v1/schedule-session', 'https://example.test/public']) {
    test(`rejects unfixed private endpoint ${target.split(':')[0]}`, () => assert.throws(() => client({ url: target })));
}
test('bounds response bytes and rejects redirects or response failures', async () => {
    for (const fetchImpl of [async () => response({ padding: 'a'.repeat(5000) }), async () => new Response('', { status: 302 }), async () => { throw new Error('redirect denied'); }, async () => new Response('invalid JSON')]) {
        await assert.rejects(client({ fetchImpl })(binding), /unavailable/);
    }
});
test('times out a delayed workload token and never starts a late fetch', async () => {
    let release; let calls = 0;
    const pending = new Promise((resolve) => { release = resolve; });
    await assert.rejects(client({ deadlineMs: 10, getWorkloadToken: () => pending, fetchImpl: async () => { calls++; return response(live); } })(binding), /unavailable/);
    release('synthetic-workload'); await new Promise((resolve) => setImmediate(resolve)); assert.equal(calls, 0);
});
test('aborts a stalled response body without retaining the request forever', async () => {
    let aborted = false;
    const call = client({ deadlineMs: 10, fetchImpl: async (_url, init) => {
        init.signal.addEventListener('abort', () => { aborted = true; });
        return new Response(new ReadableStream({ start() {} }));
    } });
    await assert.rejects(call(binding), /unavailable/); assert.equal(aborted, true);
});
test('rechecks application deadline after token and response awaits', async () => {
    let clock = 100000; let calls = 0;
    await assert.rejects(client({ now: () => clock, getWorkloadToken: async () => { clock += 5001; return 'synthetic'; }, fetchImpl: async () => { calls++; return response(live); } })(binding));
    assert.equal(calls, 0); clock = 100000;
    await assert.rejects(client({ now: () => clock, fetchImpl: async () => { clock += 5001; return response(live); } })(binding));
});
test('command client accepts only opaque status and correct endpoint', async () => {
    const config = { url: 'https://isolated-backend.test/internal/v1/schedule-command', audience, getWorkloadToken: async () => 'synthetic-workload' };
    const valid = { operationId: 'a'.repeat(64), status: 'committed' };
    assert.deepEqual(await createScheduleBrokerCommandClient({ ...config, fetchImpl: async () => response(valid) })({}), valid);
    for (const value of [{ ...valid, idToken: 'never-return' }, { ...valid, status: 'sent' }, { ...valid, operationId: 'not-an-id' }]) {
        await assert.rejects(createScheduleBrokerCommandClient({ ...config, fetchImpl: async () => response(value) })({}));
    }
    assert.throws(() => createScheduleBrokerCommandClient({ ...config, url }));
    assert.throws(() => createScheduleSessionIntrospector(config));
});
