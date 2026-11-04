import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer } from 'node:http';
import express from '../../services/chatgpt-mcp/node_modules/express/index.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import { createDirectSessionRouter } from '../../services/chatgpt-mcp/src/directSessionTransport.js';
import { createDirectSessionAuthenticator } from '../../services/chatgpt-mcp/src/directSessionAuth.js';
import { createOAuthBroker, s256Challenge } from '../../services/chatgpt-mcp/src/oauth.js';
import { createIdentityResolver } from '../../services/chatgpt-mcp/src/identity.js';
import { DomainError } from '../../services/chatgpt-mcp/src/core.js';
import { createOneActionApproval } from '../../services/chatgpt-mcp/src/directActionApproval.js';

const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const input = { proposalId, teamId: 'team-1', drillId: 'drill-1', favorite: true };
const favoritePath = 'teams/team-1/drillFavorites/drill-1';
const accepted = () => ({ action: 'accept', content: { approve: true } });
const stops = [];
afterEach(async () => { for (const stop of stops.splice(0)) await stop(); });

async function fixture(options = {}) {
    let clock = Date.now();
    const now = () => clock;
    const oauth = createOAuthBroker({ now });
    const revoked = new Set();
    const resolveIdentity = vi.fn(async (authorization, settings) => {
        expect(settings.forceRefresh).toBe(true);
        const uid = authorization.slice('Bearer firebase-'.length);
        if (revoked.has(uid)) throw new DomainError('unauthenticated', 'Synthetic revoked credential');
        return { uid, email: `${uid}@example.test`, idToken: `synthetic-${uid}`, via: 'refresh-token' };
    });
    const authenticate = createDirectSessionAuthenticator({ oauth, resolveIdentity, now });
    const token = async (uid = 'owner', client = 'one', consent = true) => {
        const redirectUri = `https://chatgpt.com/connector/oauth/${client}`;
        const clientId = oauth.registerClient({ redirect_uris: [redirectUri] }).client_id;
        const verifier = 'synthetic-verifier-with-at-least-forty-three-characters';
        const code = await oauth.approveAuthorization({ clientId, redirectUri, codeChallenge: s256Challenge(verifier), firebaseRefreshToken: `firebase-${uid}`, scope: 'allplays.read allplays.review', reviewApproved: consent });
        return (await oauth.exchange({ grant_type: 'authorization_code', code, code_verifier: verifier })).access_token;
    };
    const records = new Map();
    let revision = 0;
    const put = (path, data) => records.set(path, { exists: true, data: structuredClone(data), version: `v${++revision}` });
    put('teams/team-1', { name: 'Synthetic Team' }); put('drillLibrary/drill-1', { title: 'Synthetic Drill' });
    let businessWrites = 0;
    const service = createDirectSessionRouter({
        authenticate, now, sessionLifetimeMs: 10000, approvalLifetimeMs: 2000, ...options,
        createDependencies: (actor, current) => ({
            uid: actor.uid, now,
            getContext: async () => ({ uid: (await current()).uid, teams: new Map([['team-1', { roles: new Set(['owner']) }]]) }),
            store: {
                get: async (path) => { await current(); return structuredClone(records.get(path) || { exists: false, data: null, version: null }); },
                create: async (path, data) => { await current(); if (records.has(path)) throw new Error('exists'); put(path, data); },
                transaction: async (callback, { beforeCommit } = {}) => {
                    const writes = [];
                    const result = await callback({
                        get: async (path) => { await current(); return structuredClone(records.get(path) || { exists: false, data: null, version: null }); },
                        set: (path, data) => writes.push(() => { if (path === favoritePath) businessWrites++; put(path, data); }),
                        delete: (path) => writes.push(() => { if (path === favoritePath) businessWrites++; records.delete(path); })
                    });
                    await current(); if (writes.length) await beforeCommit?.(); writes.forEach((write) => write()); return result;
                }
            }
        })
    });
    const app = express(); app.use('/direct', service.router);
    const http = createServer(app);
    await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${http.address().port}/direct`;
    const clients = [];
    stops.push(async () => {
        await Promise.all(clients.map(({ client }) => client.close().catch(() => {})));
        await service.close(); http.closeAllConnections();
        await new Promise((resolve) => http.close(resolve));
    });
    const connect = async (bearer, answer = accepted, capture = []) => {
        const client = new Client({ name: 'synthetic-client', version: '1' }, { capabilities: { elicitation: { form: {} } } });
        client.onerror = () => {};
        client.setRequestHandler(ElicitRequestSchema, answer);
        const transport = new StreamableHTTPClientTransport(new URL(url), {
            requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
            reconnectionOptions: { maxRetries: 0, maxReconnectionDelay: 1, initialReconnectionDelay: 1, reconnectionDelayGrowFactor: 1 },
            fetch: (target, init) => {
                if (init?.body) { const message = JSON.parse(init.body); if (message.result?.action) capture.push(message); }
                return fetch(target, init);
            }
        });
        clients.push({ client, transport }); await client.connect(transport);
        return { client, transport };
    };
    const post = (bearer, sessionId, body) => fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, 'Mcp-Session-Id': sessionId, 'MCP-Protocol-Version': '2025-11-25', Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { token, authenticate, resolveIdentity, revoked, service, connect, post, url, records, writes: () => businessWrites, advance: (ms) => { clock += ms; } };
}

describe('authenticated direct-command HTTP sessions', () => {
    it('rejects raw credentials and read-only grants, and returns authenticated client/grant bindings', async () => {
        const f = await fixture();
        await expect(f.authenticate('Bearer synthetic.raw.jwt')).rejects.toMatchObject({ code: 'unauthenticated' });
        await expect(f.authenticate(`Bearer ${await f.token('owner', 'one', false)}`)).rejects.toMatchObject({ code: 'insufficient_scope' });
        expect(f.resolveIdentity).not.toHaveBeenCalled();
        const a = await f.authenticate(`Bearer ${await f.token()}`);
        const b = await f.authenticate(`Bearer ${await f.token('owner', 'two')}`);
        expect(a.uid).toBe(b.uid); expect(a.clientId).not.toBe(b.clientId); expect(a.grantKey).not.toBe(b.grantKey);
        expect(a).not.toHaveProperty('firebaseRefreshToken');
    });
    it('introspects only the exact current account/client/grant/session without credentials', async () => {
        const f = await fixture(); const bearer = await f.token();
        const actor = await f.authenticate(`Bearer ${bearer}`); const { transport } = await f.connect(bearer);
        const input = { uid: actor.uid, clientId: actor.clientId, grantKey: actor.grantKey, sessionId: transport.sessionId, expiresAt: Date.now() + 1000, purpose: 'schedule.execute' };
        const result = await f.service.introspectSession(input);
        expect(Object.keys(result).sort()).toEqual(['uid', 'clientId', 'grantKey', 'sessionId', 'expiresAt', 'connected', 'reviewRequests'].sort());
        expect(result).toMatchObject({ uid: actor.uid, sessionId: transport.sessionId, connected: true, reviewRequests: true });
        expect(result.expiresAt).toBeLessThan(actor.expiresAt);
        for (const change of [{ uid: 'other' }, { clientId: 'other' }, { grantKey: 'b'.repeat(64) }, { sessionId: 'other' }, { extra: true }, { purpose: 'arbitrary' }, { expiresAt: Date.now() + 20000 }]) {
            await expect(f.service.introspectSession({ ...input, ...change })).rejects.toThrow();
        }
        f.revoked.add('owner'); await expect(f.service.introspectSession(input)).rejects.toThrow();
        f.revoked.clear(); await f.service.close(); await expect(f.service.introspectSession(input)).rejects.toThrow();
    });
    it('rechecks the requested deadline after session reauthentication awaits', async () => {
        const f = await fixture(); const bearer = await f.token(); const actor = await f.authenticate(`Bearer ${bearer}`);
        const { transport } = await f.connect(bearer);
        const input = { uid: actor.uid, clientId: actor.clientId, grantKey: actor.grantKey, sessionId: transport.sessionId, expiresAt: Date.now() + 500, purpose: 'schedule.status' };
        f.resolveIdentity.mockImplementationOnce(async () => { f.advance(1000); return { uid: actor.uid, idToken: 'synthetic-owner', via: 'refresh-token' }; });
        await expect(f.service.introspectSession(input)).rejects.toThrow();
    });
    it('rejects simultaneous local-evidence and signed-backend execution modes', () => {
        expect(() => createDirectSessionRouter({ createExecutionEvidence: () => ({}), createScheduleBroker: () => ({}) })).toThrow();
    });
    it('runs prepare → user approval → execute over HTTP and ignores a replayed approval response', async () => {
        const f = await fixture(); const bearer = await f.token(); const captured = [];
        const { client, transport } = await f.connect(bearer, accepted, captured);
        expect((await client.callTool({ name: 'prepare_team_drill_favorite', arguments: input })).isError).not.toBe(true);
        expect(f.writes()).toBe(0);
        const applied = await client.callTool({ name: 'confirm_team_drill_favorite', arguments: { proposalId } });
        expect(applied.structuredContent?.status, JSON.stringify(applied.content)).toBe('completed');
        expect(f.writes()).toBe(1); expect(captured).toHaveLength(1);
        await f.post(bearer, transport.sessionId, captured[0]);
        expect(f.writes()).toBe(1);
        expect((await client.callTool({ name: 'confirm_team_drill_favorite', arguments: { proposalId } })).structuredContent.status).toBe('completed');
        expect(captured).toHaveLength(1);
    });
    it('rejects another account, client or access grant on the same session without disrupting its owner', async () => {
        const f = await fixture(); const bearer = await f.token();
        const { client, transport } = await f.connect(bearer);
        for (const other of [await f.token('other'), await f.token('owner', 'two'), await f.token('owner', 'one')]) {
            const result = await f.post(other, transport.sessionId, { jsonrpc: '2.0', id: 99, result: accepted() });
            expect(result.status).toBe(403);
        }
        expect((await client.listTools()).tools).toHaveLength(3); expect(f.writes()).toBe(0);
    });
    it('rejects a forged response to an actual pending approval from another connection', async () => {
        const f = await fixture(); const bearer = await f.token(); const other = await f.token('other');
        let transport;
        const connected = await f.connect(bearer, async (_request, extra) => {
            const forged = await f.post(other, transport.sessionId, { jsonrpc: '2.0', id: extra.requestId, result: accepted() });
            expect(forged.status).toBe(403); expect(f.writes()).toBe(0);
            return { action: 'decline' };
        });
        transport = connected.transport;
        await connected.client.callTool({ name: 'prepare_team_drill_favorite', arguments: input });
        const result = await connected.client.callTool({ name: 'confirm_team_drill_favorite', arguments: { proposalId } });
        expect(result.structuredContent.status).toBe('declined'); expect(f.writes()).toBe(0);
    });
    it('denies expired sessions and requires fresh initialization after a server restart', async () => {
        const f = await fixture(); const bearer = await f.token();
        const { client, transport } = await f.connect(bearer);
        f.advance(10001);
        expect((await f.post(bearer, transport.sessionId, { jsonrpc: '2.0', id: 88, method: 'tools/list' })).status).toBe(404);
        expect(f.service.sessionCount()).toBe(0);
        await client.close();
        const restarted = await f.connect(bearer);
        await f.service.close();
        expect((await f.post(bearer, restarted.transport.sessionId, { jsonrpc: '2.0', id: 89, method: 'tools/list' })).status).toBe(404);
    });
    it.each(['decline', 'cancel', 'expiry', 'revocation'])('does not execute after %s during approval', async (mode) => {
        const f = await fixture(); const bearer = await f.token();
        const answer = async () => {
            if (mode === 'expiry') f.advance(2001);
            if (mode === 'revocation') f.revoked.add('owner');
            return ['decline', 'cancel'].includes(mode) ? { action: mode } : accepted();
        };
        const { client } = await f.connect(bearer, answer);
        await client.callTool({ name: 'prepare_team_drill_favorite', arguments: input });
        // A revoked response is rejected at HTTP authentication before it can
        // reach elicitation. Abort the request instead of waiting for its timer.
        const abort = new AbortController();
        const result = client.callTool({ name: 'confirm_team_drill_favorite', arguments: { proposalId } }, undefined, { signal: abort.signal, timeout: 3000 });
        if (mode === 'revocation') setTimeout(() => abort.abort(), 100).unref();
        await result.catch(() => null);
        expect(f.writes()).toBe(0);
    });
    it('invalidates pending approval on disconnect and does not accept its late response', async () => {
        const f = await fixture(); const bearer = await f.token();
        let release; let announce;
        const pending = new Promise((resolve) => { release = resolve; });
        const asked = new Promise((resolve) => { announce = resolve; });
        const { client, transport } = await f.connect(bearer, async () => { announce(); await pending; return accepted(); });
        await client.callTool({ name: 'prepare_team_drill_favorite', arguments: input });
        const result = client.callTool({ name: 'confirm_team_drill_favorite', arguments: { proposalId } }).catch(() => null);
        await asked; const oldSession = transport.sessionId;
        await client.close();
        await expect.poll(() => f.service.sessionCount(), { timeout: 1000 }).toBe(0);
        release(); await result;
        // A follow-up request also completes any disconnect cleanup on the server.
        const response = await f.post(bearer, oldSession, { jsonrpc: '2.0', id: 123, result: accepted() });
        expect(response.status).toBe(404); expect(f.writes()).toBe(0);
    });
    it('rejects unapproved browser origins and bounds session count', async () => {
        const f = await fixture({ maxSessions: 1 }); const bearer = await f.token();
        await f.connect(bearer);
        const response = await fetch(f.url, { method: 'POST', headers: { Authorization: `Bearer ${bearer}`, Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}' });
        expect(response.status).toBe(403);
        await expect(f.connect(await f.token('other'))).rejects.toThrow();
        expect(f.service.sessionCount()).toBe(1);
    });
    it('bounds sessions per actor without blocking a different account below global capacity', async () => {
        const f = await fixture({ maxSessions: 4, maxSessionsPerActor: 1 });
        await f.connect(await f.token());
        await expect(f.connect(await f.token('owner', 'two'))).rejects.toThrow();
        await f.connect(await f.token('other'));
        expect(f.service.sessionCount()).toBe(2);
    });
});

it('forces a fresh Firebase credential exchange for sensitive authorization instead of accepting cached identity', async () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'owner', email: 'owner@example.test' })).toString('base64url');
    const fetchImpl = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ user_id: 'owner', id_token: `synthetic.${payload}.signature`, expires_in: 3600 }) }).mockResolvedValue({ ok: false });
    const resolve = createIdentityResolver({ apiKey: 'synthetic', fetchImpl });
    await resolve('Bearer synthetic-refresh');
    await resolve('Bearer synthetic-refresh'); expect(fetchImpl).toHaveBeenCalledTimes(1);
    await expect(resolve('Bearer synthetic-refresh', { forceRefresh: true })).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(resolve('Bearer synthetic-refresh')).rejects.toThrow(); expect(fetchImpl).toHaveBeenCalledTimes(3);
});

it('consumes approval once and rechecks expiry and payload at the commit boundary', async () => {
    let clock = 1000;
    const actor = { uid: 'owner', clientId: 'client', grantKey: 'grant', expiresAt: 10000 };
    const authorize = createOneActionApproval({ getActor: async () => actor, now: () => clock, lifetimeMs: 1000 });
    const preview = { teamId: 'team-1', favorite: true };
    const first = await authorize(preview, async () => accepted());
    await first.consume(); await expect(first.consume()).rejects.toMatchObject({ code: 'confirmation_replayed' });
    const expired = await authorize(preview, async () => accepted());
    clock = 2000;
    await expect(expired.consume()).rejects.toMatchObject({ code: 'confirmation_expired' });
    const changed = await authorize(preview, async () => accepted());
    preview.favorite = false;
    await expect(changed.consume()).rejects.toMatchObject({ code: 'confirmation_expired' });
});
