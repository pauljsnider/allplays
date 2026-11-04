import { describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import { createOAuthBroker, requestedReviewScope, s256Challenge } from '../../services/chatgpt-mcp/src/oauth.js';
import { createFirestoreOAuthGrantStore, createMemoryOAuthGrantStore } from '../../services/chatgpt-mcp/src/oauthStore.js';
const redirectUri = 'https://chatgpt.com/connector_platform_oauth_redirect';
const verifier = 'synthetic-verifier-with-more-than-forty-three-characters';
async function issue(broker, extra = {}) {
    const clientId = broker.registerClient({ redirect_uris: [redirectUri] }).client_id;
    const code = await broker.approveAuthorization({ clientId, redirectUri, codeChallenge: s256Challenge(verifier), firebaseRefreshToken: 'synthetic-firebase-binding', ...extra });
    return broker.exchange({ grant_type: 'authorization_code', code, code_verifier: verifier });
}
function firestoreFixture() {
    const documents = new Map();
    let revision = 0;
    const fetchImpl = async (url, options = {}) => {
        const name = String(url).split('?')[0].replace('https://firestore.googleapis.com/v1/', '');
        if (name.endsWith(':commit')) {
            const { writes } = JSON.parse(options.body);
            if (writes.some((write) => write.delete
                ? documents.get(write.delete)?.updateTime !== write.currentDocument.updateTime
                : write.currentDocument?.exists === false && documents.has(write.update.name))) {
                return { ok: false, status: 409, json: async () => ({ error: { status: 'ABORTED' } }) };
            }
            for (const write of writes) {
                if (write.delete) documents.delete(write.delete);
                else documents.set(write.update.name, { ...write.update, updateTime: String(++revision) });
            }
            return { ok: true, json: async () => ({}) };
        }
        const record = documents.get(name);
        return { ok: Boolean(record), status: record ? 200 : 404, json: async () => structuredClone(record || {}) };
    };
    const options = { projectId: 'synthetic-oauth', encryptionKey: Buffer.alloc(32, 9).toString('base64'), accessTokenProvider: async () => 'synthetic-store-token', fetchImpl };
    return { documents, store: () => createFirestoreOAuthGrantStore(options) };
}
describe('explicit review-only OAuth capability', () => {
    it('requires both the requested scope and explicit consent; legacy/read grants stay read-only', async () => {
        for (const extra of [{}, { scope: 'allplays.review' }, { reviewApproved: true }]) {
            const broker = createOAuthBroker();
            const tokens = await issue(broker, extra);
            expect(tokens.scope).toBe('allplays.read');
            expect(await broker.resolveAccessToken(tokens.access_token)).not.toHaveProperty('reviewRequests');
            const rotated = await broker.exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token, scope: 'allplays.review' });
            expect(rotated.scope).toBe('allplays.read');
            expect(await broker.resolveAccessToken(rotated.access_token)).not.toHaveProperty('reviewRequests');
        }
        expect(() => requestedReviewScope('allplays.admin')).toThrow('Unsupported scope');
    });
    it('preserves explicit consent through memory-store cross-instance rotation', async () => {
        const state = {};
        const broker = createOAuthBroker({ grantStore: createMemoryOAuthGrantStore({ state }) });
        const tokens = await issue(broker, { scope: 'allplays.read allplays.review', reviewApproved: true });
        const restarted = createOAuthBroker({ grantStore: createMemoryOAuthGrantStore({ state }) });
        const rotated = await restarted.exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
        expect(rotated.scope).toBe('allplays.read allplays.review');
        expect(await restarted.resolveAccessToken(rotated.access_token)).toMatchObject({ reviewRequests: true });
        expect(await restarted.resolveAccessToken(rotated.access_token, { includeBinding: true })).toMatchObject({ clientId: expect.any(String), expiresAt: expect.any(Number), reviewRequests: true });
    });
    it('authenticates scope in durable code and grant envelopes, preserves it across restart and rejects tampering', async () => {
        const fixture = firestoreFixture();
        const broker = createOAuthBroker({ grantStore: fixture.store() });
        const clientId = broker.registerClient({ redirect_uris: [redirectUri] }).client_id;
        const code = await broker.approveAuthorization({ clientId, redirectUri, codeChallenge: s256Challenge(verifier), firebaseRefreshToken: 'synthetic-binding', scope: 'allplays.review', reviewApproved: true });
        const restarted = createOAuthBroker({ grantStore: fixture.store() });
        const tokens = await restarted.exchange({ grant_type: 'authorization_code', code, code_verifier: verifier });
        expect(await restarted.resolveAccessToken(tokens.access_token)).toMatchObject({ reviewRequests: true });
        expect(await restarted.resolveAccessToken(tokens.access_token, { includeBinding: true })).toMatchObject({ clientId, expiresAt: expect.any(Number), reviewRequests: true });
        const rotated = await restarted.exchange({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
        expect(rotated.scope).toBe('allplays.read allplays.review');
        const access = [...fixture.documents.values()].filter((record) => record.fields.type.stringValue === 'access');
        for (const record of access) delete record.fields.reviewRequests;
        await expect(restarted.resolveAccessToken(rotated.access_token)).rejects.toThrow();
        const legacyFixture = firestoreFixture();
        const legacy = createOAuthBroker({ grantStore: legacyFixture.store() });
        const readTokens = await issue(legacy);
        const readAccess = [...legacyFixture.documents.values()].find((record) => record.fields.type.stringValue === 'access');
        readAccess.fields.reviewRequests = { booleanValue: true };
        await expect(legacy.resolveAccessToken(readTokens.access_token)).rejects.toThrow();
    });
    it('denies unconsented direct bearers before any application request and advertises the consent checkbox only when requested', async () => {
        const previous = [process.env.FIREBASE_PROJECT_ID, process.env.FIREBASE_WEB_API_KEY];
        process.env.FIREBASE_PROJECT_ID = 'demo-allplays'; process.env.FIREBASE_WEB_API_KEY = 'synthetic';
        const { app } = await import('../../services/chatgpt-mcp/src/server.js');
        const server = createServer(app);
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        const origin = `http://127.0.0.1:${server.address().port}`;
        const realFetch = globalThis.fetch;
        const guard = vi.spyOn(globalThis, 'fetch').mockImplementation((url, ...args) => {
            if (!String(url).startsWith(origin)) throw new Error('Unexpected application request');
            return realFetch(url, ...args);
        });
        try {
            const jwt = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'synthetic', email: 'synthetic@example.test', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url')}.synthetic`;
            const response = await fetch(`${origin}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_team', arguments: { requestId: '00112233-4455-4677-8899-aabbccddeeff', arguments: { name: 'Synthetic', sport: 'Soccer' } } } }) });
            expect(await response.text()).toContain('insufficient_scope');
            expect(guard).toHaveBeenCalledTimes(1);
            const listed = await fetch(`${origin}/mcp`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) });
            const listText = await listed.text();
            expect(listText).toContain('get_team_roster');
            expect(listText).toContain('nextCursor');
            expect(listText).not.toContain('prepare_team_drill_favorite');
            expect(listText).not.toContain('confirm_team_drill_favorite');
            expect(guard).toHaveBeenCalledTimes(2);
            const client = await (await fetch(`${origin}/oauth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ redirect_uris: [redirectUri] }) })).json();
            const query = new URLSearchParams({ client_id: client.client_id, redirect_uri: redirectUri, response_type: 'code', code_challenge: s256Challenge(verifier), code_challenge_method: 'S256', scope: 'allplays.read allplays.review' });
            const html = await (await fetch(`${origin}/oauth/authorize?${query}`)).text();
            expect(html).toContain('name="review_agree"');
            expect(html).not.toContain('name="review_agree" type="checkbox" value="yes" checked');
            query.set('scope', 'allplays.read');
            expect(await (await fetch(`${origin}/oauth/authorize?${query}`)).text()).not.toContain('name="review_agree"');
        } finally {
            guard.mockRestore();
            await new Promise((resolve) => server.close(resolve));
            if (previous[0] === undefined) delete process.env.FIREBASE_PROJECT_ID; else process.env.FIREBASE_PROJECT_ID = previous[0];
            if (previous[1] === undefined) delete process.env.FIREBASE_WEB_API_KEY; else process.env.FIREBASE_WEB_API_KEY = previous[1];
        }
    });
});
