import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { createMockUserToken } from '@firebase/util';
import { createUserDb } from '../../services/chatgpt-mcp/src/firestoreRest.js';
import { getManagedTeamRoster } from '../../services/chatgpt-mcp/src/rosterDiscovery.js';
import { createDirectFavoriteCommands } from '../../services/chatgpt-mcp/src/directFavorite.js';
import { createDirectFavoriteStore } from '../../services/chatgpt-mcp/src/directFavoriteStore.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import { createServer } from 'node:http';
import express from '../../services/chatgpt-mcp/node_modules/express/index.js';
import { StreamableHTTPClientTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import { createDirectSessionRouter } from '../../services/chatgpt-mcp/src/directSessionTransport.js';
import { createDirectSessionAuthenticator } from '../../services/chatgpt-mcp/src/directSessionAuth.js';
import { createOAuthBroker, s256Challenge } from '../../services/chatgpt-mcp/src/oauth.js';
const id = 'mcp_00112233-4455-4677-8899-aabbccddeeff';
const userPath = `users/owner/privateAiPendingActions/${id}`;
const teamPath = `teams/team-1/privateAiPendingActions/${id}`;
const envelope = { userId: 'owner', toolName: 'mcp_review_request', requestTool: 'apply_roster_import', status: 'mcp_request', reviewStatus: 'requested', payloadScope: 'team', teamId: 'team-1', args: {}, expiresAt: new Date(Date.now() + 1800000).toISOString() };
const payload = { ...envelope, status: 'pending', args: { teamId: 'team-1', operations: [{ name: 'Synthetic Child' }] }, expiresAtAt: new Date(Date.now() + 1800000) };
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('MCP review envelopes under real Firestore rules', () => {
    let env;
    beforeAll(async () => {
        env = await initializeTestEnvironment({ projectId: 'demo-allplays-mcp-review', firestore: { rules: compactFirestoreRules(readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')) } });
    }, 30000);
    afterAll(async () => { await env?.cleanup(); });
    beforeEach(async () => {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(context.firestore(), 'teams/team-1'), { ownerId: 'owner', name: 'Synthetic', adminEmails: [] });
        });
    });
    const userDb = (uid, verified = true) => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: verified }).firestore();
    const localFetch = (url, options) => {
        const host = process.env.FIRESTORE_EMULATOR_HOST;
        if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !url.startsWith('https://firestore.googleapis.com/v1/')) throw new Error('Only a local emulator request is allowed.');
        return fetch(url.replace('https://firestore.googleapis.com', `http://${host}`), options);
    };
    async function favoriteDependencies(uid = 'owner', verified = true) {
        await env.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'drillLibrary/drill-1'), { source: 'community', title: 'Synthetic Passing' });
        });
        return {
            uid,
            store: createDirectFavoriteStore({ projectId: 'demo-allplays-mcp-review', uid, idToken: createMockUserToken({ sub: uid, email: `${uid}@example.test`, email_verified: verified }, 'demo-allplays-mcp-review'), fetchImpl: localFetch }),
            getContext: async () => {
                const team = (await getDoc(doc(userDb(uid, verified), 'teams/team-1'))).data();
                return { uid, teams: new Map([['team-1', { roles: new Set(team?.ownerId === uid ? ['owner'] : []) }]]) };
            }
        };
    }
    it('accepts an atomic manager request while other accounts and unverified users cannot write it', async () => {
        const db = userDb('owner');
        const batch = writeBatch(db);
        batch.set(doc(db, userPath), envelope); batch.set(doc(db, teamPath), payload);
        await assertSucceeds(batch.commit());
        expect((await getDoc(doc(db, userPath))).data().args).toEqual({});
        await assertFails(getDoc(doc(userDb('other'), userPath)));
        await assertFails(getDoc(doc(userDb('other'), teamPath)));
        await assertFails(setDoc(doc(userDb('owner', false), userPath), envelope));
        await assertFails(setDoc(doc(userDb('other'), teamPath), { ...payload, userId: 'other' }));
    });
    it('revoked managers retain only empty user metadata and lose the roster payload', async () => {
        const db = userDb('owner');
        await setDoc(doc(db, userPath), envelope); await setDoc(doc(db, teamPath), payload);
        await env.withSecurityRulesDisabled(async (context) => updateDoc(doc(context.firestore(), 'teams/team-1'), { ownerId: 'replacement' }));
        expect((await getDoc(doc(db, userPath))).data().args).toEqual({});
        await assertFails(getDoc(doc(db, teamPath)));
        await assertFails(updateDoc(doc(db, teamPath), { args: {} }));
    });
    it('makes expired team request payloads unreadable', async () => {
        const db = userDb('owner');
        await setDoc(doc(db, teamPath), { ...payload, expiresAtAt: new Date(0) });
        await assertFails(getDoc(doc(db, teamPath)));
    });
    it('runs projected roster pagination through real REST rules and rejects a revoked manager', async () => {
        const host = process.env.FIRESTORE_EMULATOR_HOST;
        if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Only a local emulator is allowed.');
        await env.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'teams/team-1/players/a'), { name: 'Synthetic A', active: false });
            await setDoc(doc(context.firestore(), 'teams/team-1/players/b'), { name: 'Synthetic B', active: true });
        });
        const db = createUserDb({
            projectId: 'demo-allplays-mcp-review',
            idToken: createMockUserToken({ sub: 'owner', email: 'owner@example.test', email_verified: true }, 'demo-allplays-mcp-review'),
            fetchImpl: (url, options) => {
                if (!url.startsWith('https://firestore.googleapis.com/v1/')) throw new Error('Unexpected test request');
                return fetch(url.replace('https://firestore.googleapis.com', `http://${host}`), options);
            }
        });
        const context = { teams: new Map([['team-1', { roles: new Set(['owner']) }]]) };
        const first = await getManagedTeamRoster(db, context, { teamId: 'team-1', limit: 1 });
        expect(first).toMatchObject({ players: [{ id: 'a', active: false }], hasMore: true, nextCursor: 'a' });
        expect(await getManagedTeamRoster(db, context, { teamId: 'team-1', limit: 1, cursor: first.nextCursor })).toMatchObject({ players: [{ id: 'b', active: true }], hasMore: false });
        await env.withSecurityRulesDisabled(async (context) => updateDoc(doc(context.firestore(), 'teams/team-1'), { ownerId: 'replacement' }));
        await expect(getManagedTeamRoster(db, context, { teamId: 'team-1' })).rejects.toMatchObject({ code: 'permission_denied' });
    });
    it('executes one explicitly approved MCP favorite through real REST transactions and rules', async () => {
        const dependencies = await favoriteDependencies();
        const server = createDirectFavoriteMcpSession(dependencies);
        const client = new Client({ name: 'synthetic-client', version: '1' }, { capabilities: { elicitation: { form: {} } } });
        let approvals = 0;
        client.setRequestHandler(ElicitRequestSchema, async () => { approvals += 1; return { action: 'accept', content: { approve: true } }; });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport); await client.connect(clientTransport);
        const proposalId = id.slice(4);
        try {
            const prepared = await client.callTool({ name: 'prepare_team_drill_favorite', arguments: { proposalId, teamId: 'team-1', drillId: 'drill-1', favorite: true } });
            expect(prepared.isError, JSON.stringify(prepared.content)).not.toBe(true);
            expect((await getDoc(doc(userDb('owner'), 'teams/team-1/drillFavorites/drill-1'))).exists()).toBe(false);
            const completed = await client.callTool({ name: 'confirm_team_drill_favorite', arguments: { proposalId } });
            expect(completed.isError, JSON.stringify(completed.content)).not.toBe(true);
            expect(completed.structuredContent.status).toBe('completed');
            expect((await getDoc(doc(userDb('owner'), 'teams/team-1/drillFavorites/drill-1'))).data().addedBy).toBe('owner');
            expect((await getDoc(doc(userDb('owner'), `users/owner/privateAiPendingActions/direct_${proposalId}`))).data().status).toBe('completed');
            const restarted = createDirectFavoriteCommands(dependencies);
            expect(await restarted.confirm({ proposalId }, () => { throw new Error('Do not replay approval'); })).toMatchObject({ status: 'completed' });
            expect(approvals).toBe(1);
        } finally { await client.close(); await server.close(); }
    }, 15000);
    it('rejects a manager revoked during approval and unverified preparation', async () => {
        const proposalId = id.slice(4);
        const commands = createDirectFavoriteCommands(await favoriteDependencies());
        await commands.prepare({ proposalId, teamId: 'team-1', drillId: 'drill-1', favorite: true });
        await expect(commands.confirm({ proposalId }, async () => {
            await env.withSecurityRulesDisabled(async (context) => updateDoc(doc(context.firestore(), 'teams/team-1'), { ownerId: 'replacement' }));
            return { action: 'accept', content: { approve: true } };
        })).rejects.toThrow();
        await env.withSecurityRulesDisabled(async (context) => {
            expect((await getDoc(doc(context.firestore(), 'teams/team-1/drillFavorites/drill-1'))).exists()).toBe(false);
            await updateDoc(doc(context.firestore(), 'teams/team-1'), { ownerId: 'owner' });
        });
        const unverified = createDirectFavoriteCommands(await favoriteDependencies('owner', false));
        await expect(unverified.prepare({ proposalId: '00112233-4455-4677-8899-aabbccddeeaa', teamId: 'team-1', drillId: 'drill-1', favorite: false })).rejects.toThrow();
    });
    it('connects broker-bound HTTP approvals to real Firestore transactions using isolated emulator accounts', async () => {
        const dependencies = await favoriteDependencies();
        const oauth = createOAuthBroker();
        const issue = async (uid) => {
            const redirectUri = 'https://chatgpt.com/connector/oauth/synthetic-emulator';
            const clientId = oauth.registerClient({ redirect_uris: [redirectUri] }).client_id;
            const verifier = 'synthetic-verifier-with-more-than-forty-three-characters';
            const code = await oauth.approveAuthorization({ clientId, redirectUri, codeChallenge: s256Challenge(verifier), firebaseRefreshToken: uid, scope: 'allplays.review', reviewApproved: true });
            return (await oauth.exchange({ grant_type: 'authorization_code', code, code_verifier: verifier })).access_token;
        };
        const authenticate = createDirectSessionAuthenticator({ oauth, resolveIdentity: async (authorization) => {
            const uid = authorization.slice(7);
            return { uid, email: `${uid}@example.test`, via: 'refresh-token', idToken: createMockUserToken({ sub: uid, email: `${uid}@example.test`, email_verified: true }, 'demo-allplays-mcp-review') };
        } });
        const service = createDirectSessionRouter({ authenticate, createDependencies: (actor, current) => ({
            ...dependencies, uid: actor.uid,
            store: createDirectFavoriteStore({ projectId: 'demo-allplays-mcp-review', uid: actor.uid, getIdToken: async () => (await current()).idToken, fetchImpl: localFetch }),
            getContext: async () => { await current(); return dependencies.getContext(); }
        }) });
        const app = express(); app.use('/direct', service.router);
        const http = createServer(app); await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
        const url = `http://127.0.0.1:${http.address().port}/direct`;
        const bearer = await issue('owner');
        const client = new Client({ name: 'isolated-emulator-client', version: '1' }, { capabilities: { elicitation: { form: {} } } });
        client.onerror = () => {};
        client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'accept', content: { approve: true } }));
        const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } });
        try {
            await client.connect(transport);
            const outsider = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${await issue('other')}`, 'Mcp-Session-Id': transport.sessionId, 'Content-Type': 'application/json' }, body: '{}' });
            expect(outsider.status).toBe(403);
            const proposalId = id.slice(4);
            expect((await client.callTool({ name: 'prepare_team_drill_favorite', arguments: { proposalId, teamId: 'team-1', drillId: 'drill-1', favorite: true } })).isError).not.toBe(true);
            const result = await client.callTool({ name: 'confirm_team_drill_favorite', arguments: { proposalId } });
            expect(result.structuredContent?.status, JSON.stringify(result.content)).toBe('completed');
            expect((await getDoc(doc(userDb('owner'), 'teams/team-1/drillFavorites/drill-1'))).data().addedBy).toBe('owner');
        } finally {
            await client.close(); await service.close(); http.closeAllConnections();
            await new Promise((resolve) => http.close(resolve));
        }
    }, 15000);
    it('reconciles a lost successful REST commit and fails closed on concurrent transaction conflicts', async () => {
        const dependencies = await favoriteDependencies();
        const proposalId = id.slice(4);
        let loseResponse = false;
        const store = createDirectFavoriteStore({
            projectId: 'demo-allplays-mcp-review', uid: 'owner',
            idToken: createMockUserToken({ sub: 'owner', email: 'owner@example.test', email_verified: true }, 'demo-allplays-mcp-review'),
            fetchImpl: async (url, options) => {
                const response = await localFetch(url, options);
                if (loseResponse && url.endsWith(':commit') && JSON.parse(options.body).transaction && response.ok) {
                    loseResponse = false;
                    await response.json();
                    throw new Error('Synthetic lost commit response');
                }
                return response;
            }
        });
        const commands = createDirectFavoriteCommands({ ...dependencies, store });
        await commands.prepare({ proposalId, teamId: 'team-1', drillId: 'drill-1', favorite: true });
        loseResponse = true;
        expect(await commands.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true } }))).toMatchObject({ status: 'completed' });
        const removeId = '00112233-4455-4677-8899-aabbccddeeaa';
        await commands.prepare({ proposalId: removeId, teamId: 'team-1', drillId: 'drill-1', favorite: false });
        let approvals = 0;
        let release;
        const ready = new Promise((resolve) => { release = resolve; });
        const approve = async () => { if (++approvals === 2) release(); await ready; return { action: 'accept', content: { approve: true } }; };
        const results = await Promise.allSettled([
            commands.confirm({ proposalId: removeId }, approve),
            createDirectFavoriteCommands({ ...dependencies, store }).confirm({ proposalId: removeId }, approve)
        ]);
        for (const result of results) {
            if (result.status === 'fulfilled') expect(result.value.status).toBe('completed');
            else expect(result.reason.code).toBe('conflict');
        }
        // Firestore may abort both contenders. A known conflict is not silently
        // retried: verify the unchanged state, then obtain a NEW explicit approval.
        if (!results.some((result) => result.status === 'fulfilled')) {
            expect((await getDoc(doc(userDb('owner'), 'teams/team-1/drillFavorites/drill-1'))).exists()).toBe(true);
            expect(await commands.status({ proposalId: removeId })).toMatchObject({ status: 'prepared' });
            expect(await commands.confirm({ proposalId: removeId }, async () => ({ action: 'accept', content: { approve: true } }))).toMatchObject({ status: 'completed' });
        }
        expect((await getDoc(doc(userDb('owner'), 'teams/team-1/drillFavorites/drill-1'))).exists()).toBe(false);
        expect(await commands.status({ proposalId: removeId })).toMatchObject({ status: 'completed' });
    }, 25000);
});
