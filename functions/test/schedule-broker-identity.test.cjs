"use strict";
const assert = require('node:assert/strict');
const { describe, it } = require('node:test');
const { generateKeyPairSync, sign } = require('node:crypto');
const { OAuth2Client } = require('google-auth-library');
const { Readable } = require('node:stream');
const { createFirebaseScheduleUserVerifier, createGoogleScheduleWorkloadVerifier } = require('../schedule-broker-identity.cjs');
const { createScheduleBrokerHttpHandler } = require('../schedule-broker-http.cjs');
const { createScheduleBrokerChannel, signBrokerCommand } = require('../schedule-broker-channel.cjs');
const { createFirestoreNotificationJournalStore } = require('../notification-attempt-journal.cjs');
const { FakeFirestore } = require('./helpers/notification-journal-fixture.cjs');
const projectId = 'demo-allplays-mcp-review';
const audience = 'https://schedule.example.test';
const denial = { code: 'broker_identity_denied', message: 'The verified broker identity is unavailable.' };
function userFixture() {
    let clock = 100000; const calls = [];
    const claims = { uid: 'owner', sub: 'owner', aud: projectId, iss: `https://securetoken.google.com/${projectId}`, email_verified: true,
        email: 'owner@example.test', exp: 200, iat: 90, auth_time: 80 };
    const account = { uid: 'owner', email: 'owner@example.test', disabled: false, emailVerified: true, tokensValidAfterTime: new Date(70000).toISOString() };
    const auth = { verifyIdToken: async (...args) => { calls.push(args); return claims; }, getUser: async (uid) => { assert.equal(uid, 'owner'); return account; } };
    const verify = () => createFirebaseScheduleUserVerifier({ auth, projectId, now: () => clock });
    return { claims, account, auth, calls, verify, expire: () => { clock = 200000; } };
}
describe('unmounted Firebase user identity adapter', () => {
    it('requires SDK signature/revocation verification and current account state without returning credentials', async () => {
        const f = userFixture(); const result = await f.verify()('synthetic-token', { checkRevoked: false });
        assert.deepEqual(f.calls, [['synthetic-token', true]]);
        assert.deepEqual(result, { uid: 'owner', disabled: false, emailVerified: true, expiresAt: 200000 });
        assert.ok(!JSON.stringify(result).includes('owner@example.test')); assert.ok(!JSON.stringify(result).includes('synthetic-token'));
    });
    for (const [name, mutate] of [
        ['wrong project', (f) => { f.claims.aud = 'another-project'; }],
        ['wrong issuer', (f) => { f.claims.iss = 'https://untrusted.example.test'; }],
        ['wrong subject', (f) => { f.claims.sub = 'other'; }],
        ['coerced uid', (f) => { f.claims.uid = 123; }],
        ['unverified token', (f) => { f.claims.email_verified = false; }],
        ['unverified account', (f) => { f.account.emailVerified = false; }],
        ['disabled account', (f) => { f.account.disabled = true; }],
        ['changed email', (f) => { f.account.email = 'changed@example.test'; }],
        ['wrong account', (f) => { f.account.uid = 'other'; }],
        ['new revocation', (f) => { f.account.tokensValidAfterTime = new Date(81000).toISOString(); }],
        ['invalid revocation time', (f) => { f.account.tokensValidAfterTime = null; }],
        ['expired token', (f) => { f.claims.exp = 100; }],
        ['future issue time', (f) => { f.claims.iat = 101; }],
        ['future authentication', (f) => { f.claims.auth_time = 91; }],
        ['coerced expiry', (f) => { f.claims.exp = '200'; }]
    ]) it(`rejects ${name}`, async () => { const f = userFixture(); mutate(f); await assert.rejects(f.verify()('synthetic-token'), denial); });
    it('accepts an absent revocation timestamp only after the SDK revocation check', async () => {
        const f = userFixture(); delete f.account.tokensValidAfterTime; assert.equal((await f.verify()('synthetic-token')).uid, 'owner'); assert.equal(f.calls[0][1], true);
    });
    it('rechecks time after account lookup and redacts SDK failures', async () => {
        const f = userFixture(); f.auth.getUser = async () => { f.expire(); return f.account; };
        await assert.rejects(f.verify()('synthetic-token'), denial);
        f.auth.verifyIdToken = async () => { throw new Error('private-token-and-account-details'); };
        await assert.rejects(f.verify()('synthetic-token'), denial);
    });
    it('rejects malformed tokens before reaching the SDK', async () => {
        const f = userFixture(); for (const token of ['', {}, 'x'.repeat(8193)]) await assert.rejects(f.verify()(token), denial);
        assert.deepEqual(f.calls, []);
    });
});

// Real Google JWT verification with ephemeral local RSA certificates. The
// certificate fetch is replaced; no Google request or live credential is used.
const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' });
function workloadFixture() {
    const seconds = Math.floor(Date.now() / 1000); let clock = seconds * 1000; let certificateReads = 0;
    const claims = { iss: 'https://accounts.google.com', aud: audience, sub: '123456789', email: 'broker@synthetic.iam.gserviceaccount.com', email_verified: true, iat: seconds - 10, exp: seconds + 300 };
    const client = new OAuth2Client();
    client.getFederatedSignonCertsAsync = async () => { certificateReads++; return { certs: { synthetic: publicKey }, format: 'PEM' }; };
    const token = () => {
        const data = [Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'synthetic' })).toString('base64url'), Buffer.from(JSON.stringify(claims)).toString('base64url')].join('.');
        return `${data}.${sign('RSA-SHA256', Buffer.from(data), keys.privateKey).toString('base64url')}`;
    };
    const verify = createGoogleScheduleWorkloadVerifier({ oauthClient: client, audience, now: () => clock });
    return { claims, client, verify, token, reads: () => certificateReads, expire: () => { clock = (seconds + 300) * 1000; } };
}
describe('unmounted Google workload identity adapter', () => {
    it('uses the actual Google SDK signature verifier with a fixed audience', async () => {
        const f = workloadFixture();
        assert.deepEqual(await f.verify(f.token(), { audience }), { principal: f.claims.email, subject: f.claims.sub, audience, expiresAt: f.claims.exp * 1000 });
        assert.equal(f.reads(), 1);
    });
    for (const [name, mutate] of [
        ['issuer', (f) => { f.claims.iss = 'https://untrusted.example.test'; }],
        ['audience', (f) => { f.claims.aud = 'https://different.example.test'; }],
        ['verified email', (f) => { f.claims.email_verified = false; }],
        ['human identity', (f) => { f.claims.email = 'human@example.test'; }],
        ['subject', (f) => { f.claims.sub = ''; }],
        ['expired identity', (f) => { f.claims.exp = f.claims.iat; }],
        ['future issue time', (f) => { f.claims.iat = f.claims.exp - 1; }]
    ]) it(`rejects a correctly signed token with invalid ${name}`, async () => {
        const f = workloadFixture(); mutate(f); await assert.rejects(f.verify(f.token(), { audience }), denial);
    });
    it('rejects signature substitution and audience changes before accepting an identity', async () => {
        const f = workloadFixture(); const signed = f.token(); const parts = signed.split('.'); parts[1] = Buffer.from(JSON.stringify({ ...f.claims, sub: '987654321' })).toString('base64url');
        await assert.rejects(f.verify(parts.join('.'), { audience }), denial);
        await assert.rejects(f.verify(signed, { audience: 'https://different.example.test' }), denial); assert.equal(f.reads(), 1);
    });
    it('rechecks expiry after SDK verification returns', async () => {
        const f = workloadFixture(); const verify = f.client.verifyIdToken.bind(f.client);
        f.client.verifyIdToken = async (...args) => { const result = await verify(...args); f.expire(); return result; };
        await assert.rejects(f.verify(f.token(), { audience }), denial);
    });
    it('requires HTTPS without audience credentials, query or fragments', () => {
        for (const target of ['http://schedule.example.test', 'https://secret@schedule.example.test', 'https://schedule.example.test?x=1', 'https://schedule.example.test#x']) {
            assert.throws(() => createGoogleScheduleWorkloadVerifier({ oauthClient: new OAuth2Client(), audience: target }));
        }
    });
});

describe('SDK identity adapters composed with private ingress and signed command channel', () => {
    for (const mode of ['valid', 'unlisted-workload', 'revoked-user']) it(`keeps both identities mandatory: ${mode}`, async () => {
        const workload = workloadFixture(); const user = userFixture(); const now = Date.now(); const seconds = Math.floor(now / 1000);
        Object.assign(user.claims, { exp: seconds + 300, iat: seconds - 10, auth_time: seconds - 20 });
        user.account.tokensValidAfterTime = new Date(0).toISOString();
        if (mode === 'revoked-user') user.auth.verifyIdToken = async () => { throw new Error('private revocation details'); };
        const signing = generateKeyPairSync('ed25519'); const db = new FakeFirestore(); let executions = 0;
        const actor = { uid: 'owner', clientId: 'synthetic-client', grantKey: 'a'.repeat(64), sessionId: 'synthetic-session' };
        const command = { proposalId: 'synthetic-proposal', teamId: 'team', eventId: 'event', mode: 'create', eventType: 'game', changes: {} };
        const envelope = signBrokerCommand({ keyId: 'synthetic', privateKey: signing.privateKey, audience, actor, command,
            approval: { preview: {}, approve: true, notifyTeam: true }, idToken: 'synthetic-user-token', issuedAt: now, expiresAt: now + 60000 });
        const channel = createScheduleBrokerChannel({ audience, publicKeys: new Map([['synthetic', signing.publicKey]]), store: createFirestoreNotificationJournalStore(db),
            verifyUserToken: createFirebaseScheduleUserVerifier({ auth: user.auth, projectId }),
            verifyLiveSession: async () => ({ ...actor, expiresAt: now + 60000, reviewRequests: true, connected: true }), authorizeActor: async () => true,
            executeCommand: async ({ idToken }) => { assert.equal(idToken, 'synthetic-user-token'); executions++; return { commitVerified: true }; } });
        const handler = createScheduleBrokerHttpHandler({ channel, audience, verifyWorkloadIdentity: workload.verify, takeRateLimit: async () => true,
            allowedHosts: ['schedule.example.test'], allowedPrincipals: mode === 'unlisted-workload' ? ['different@synthetic.iam.gserviceaccount.com'] : [workload.claims.email] });
        const req = Readable.from([Buffer.from(JSON.stringify(envelope))]);
        Object.assign(req, { method: 'POST', url: '/internal/v1/schedule-command', headers: { host: 'schedule.example.test', 'content-type': 'application/json', authorization: `Bearer ${workload.token()}` } });
        const response = { setHeader() {}, end(value) { this.body = JSON.parse(value); } };
        await handler(req, response);
        assert.equal(response.statusCode, mode === 'valid' ? 200 : 403); assert.equal(executions, mode === 'valid' ? 1 : 0);
        if (mode !== 'valid') { assert.deepEqual(response.body, { error: 'Command outcome unavailable.' }); assert.equal(db.documents.size, 0); }
        if (mode === 'unlisted-workload') assert.deepEqual(user.calls, []);
        if (mode === 'valid') assert.ok([...db.documents.values()].every((row) => !JSON.stringify(row).includes('synthetic-user-token')));
    });
});
