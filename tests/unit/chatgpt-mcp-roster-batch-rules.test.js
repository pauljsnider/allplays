import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { createMockUserToken } from '@firebase/util';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { createDirectRosterBatchCommands, createDirectRosterBatchStore } from '../../services/chatgpt-mcp/src/directRosterBatch.js';
import { createDirectFavoriteStore } from '../../services/chatgpt-mcp/src/directFavoriteStore.js';
import { createScheduleReviewCommands } from '../../services/chatgpt-mcp/src/scheduleReview.js';
import { createDirectDiscovery } from '../../services/chatgpt-mcp/src/directDiscovery.js';
import { createUserDb } from '../../services/chatgpt-mcp/src/firestoreRest.js';
import { createDirectSessionRouter } from '../../services/chatgpt-mcp/src/directSessionTransport.js';
import { createDirectSessionAuthenticator } from '../../services/chatgpt-mcp/src/directSessionAuth.js';
import { createOAuthBroker, s256Challenge } from '../../services/chatgpt-mcp/src/oauth.js';
import { createServer } from 'node:http';
import express from '../../services/chatgpt-mcp/node_modules/express/index.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';

const projectId = 'demo-allplays-mcp-review';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const input = { proposalId, teamId: 'team-1', operations: [
    { mode: 'create', fields: { name: 'Synthetic New', number: '07' } },
    { mode: 'update', playerId: 'existing', fields: { position: '' } }
] };
const newPath = `teams/team-1/players/mcp_${proposalId}_0`;
const oldPath = 'teams/team-1/players/existing';
const header = `users/owner/privateAiPendingActions/direct_${proposalId}`;
const payload = `teams/team-1/privateAiPendingActions/direct_owner_${proposalId}`;
const accept = async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} });

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('roster batches and schedule review under real Firestore rules', () => {
    let env;
    beforeAll(async () => { env = await initializeTestEnvironment({ projectId, firestore: { rules: compactFirestoreRules(readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')) } }); }, 30000);
    afterAll(async () => env?.cleanup());
    const db = (uid = 'owner') => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
    const token = (uid = 'owner') => createMockUserToken({ sub: uid, email: `${uid}@example.test`, email_verified: true }, projectId);
    const localFetch = (url, options) => {
        const host = process.env.FIRESTORE_EMULATOR_HOST;
        if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !url.startsWith('https://firestore.googleapis.com/v1/')) throw new Error('Only isolated emulator requests are allowed.');
        return fetch(url.replace('https://firestore.googleapis.com', `http://${host}`), options);
    };
    const getContext = async () => {
        const team = (await getDoc(doc(db(), 'teams/team-1'))).data();
        return { uid: 'owner', teams: new Map([['team-1', { team, roles: new Set(team?.ownerId === 'owner' ? ['owner'] : []) }]]) };
    };
    const rest = () => createUserDb({ projectId, idToken: token(), fetchImpl: localFetch });
    const commands = (fetchImpl = localFetch, now = Date.now) => createDirectRosterBatchCommands({ uid: 'owner', now, getContext,
        store: createDirectRosterBatchStore({ projectId, uid: 'owner', idToken: token(), fetchImpl }) });
    beforeEach(async () => {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async (context) => {
            const admin = context.firestore();
            await setDoc(doc(admin, 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(admin, 'teams/team-1'), { ownerId: 'owner', adminEmails: [], name: 'Synthetic Team' });
            await setDoc(doc(admin, oldPath), { name: 'Synthetic Existing', position: 'Forward', active: false, privateLegacyField: 'Preserved' });
            await setDoc(doc(admin, 'teams/team-1/games/event-1'), { type: 'game', opponent: 'Synthetic Visitors', date: new Date('2026-12-01T17:00:00Z'), end: new Date('2026-12-01T18:00:00Z'), location: 'Synthetic Field', notes: 'Private notes' });
        });
    });
    it('commits the maximum mixed batch atomically, preserves private fields, and retains only opaque IDs in receipts', async () => {
        const command = commands();
        const operations = [...Array.from({ length: 19 }, (_, i) => ({ mode: 'create', fields: { name: `Synthetic New ${i}` } })), input.operations[1]];
        const prepared = await command.prepare({ ...input, operations });
        expect(prepared.playerIds).toHaveLength(20);
        expect(JSON.stringify((await getDoc(doc(db(), header))).data())).not.toContain('Synthetic New');
        await assertFails(getDoc(doc(db('other'), payload)));
        await command.confirm({ proposalId }, accept);
        for (const id of prepared.playerIds) expect((await getDoc(doc(db(), `teams/team-1/players/${id}`))).exists()).toBe(true);
        expect((await getDoc(doc(db(), oldPath))).data()).toMatchObject({ active: false, privateLegacyField: 'Preserved', position: '' });
        const receipt = (await getDoc(doc(db(), header))).data();
        expect(receipt).toMatchObject({ receiptOnly: true, createdCount: 19, updatedCount: 1 });
        expect(receipt.operations).toBeUndefined(); expect(receipt.preview).toBeUndefined();
        await env.withSecurityRulesDisabled(async (context) => expect((await getDoc(doc(context.firestore(), payload))).exists()).toBe(false));
        expect((await command.confirm({ proposalId }, async () => { throw new Error('Do not repeat'); })).status).toBe('completed');
    });
    it.each(['decline', 'cancel'])('leaves all rows unchanged when the batch is %s', async (action) => {
        const command = commands(); await command.prepare(input);
        await command.confirm({ proposalId }, async () => ({ action }));
        expect((await getDoc(doc(db(), newPath))).exists()).toBe(false);
        expect((await getDoc(doc(db(), oldPath))).data().position).toBe('Forward');
    });
    it('does not partially apply a commit rejected by rules after identity changes at the commit boundary', async () => {
        const command = commands(async (url, options) => {
            const body = options.body && JSON.parse(options.body);
            if (url.endsWith(':commit') && body.transaction) options = { ...options, headers: { ...options.headers, Authorization: `Bearer ${token('other')}` } };
            return localFetch(url, options);
        });
        await command.prepare(input); await expect(command.confirm({ proposalId }, accept)).rejects.toThrow();
        expect((await getDoc(doc(db(), newPath))).exists()).toBe(false);
        expect((await getDoc(doc(db(), oldPath))).data().position).toBe('Forward');
        expect((await getDoc(doc(db(), header))).data().status).toBe('prepared');
    });
    it.each(['roster', 'permission', 'companion'])('rejects %s changes during approval without applying any rows', async (change) => {
        const command = commands(); await command.prepare(input);
        await expect(command.confirm({ proposalId }, async () => {
            await env.withSecurityRulesDisabled(async (context) => {
                const admin = context.firestore();
                if (change === 'roster') await setDoc(doc(admin, 'teams/team-1/players/concurrent'), { name: 'Concurrent Player' });
                if (change === 'permission') await updateDoc(doc(admin, 'teams/team-1'), { ownerId: 'replacement' });
                if (change === 'companion') await updateDoc(doc(admin, payload), { playerIds: ['tampered'] });
            });
            return accept();
        })).rejects.toThrow();
        await env.withSecurityRulesDisabled(async (context) => {
            expect((await getDoc(doc(context.firestore(), newPath))).exists()).toBe(false);
            expect((await getDoc(doc(context.firestore(), oldPath))).data().position).toBe('Forward');
        });
    });
    it('reconciles a lost successful batch response without repeating the commit after expiry', async () => {
        let clock = Date.now(); let commits = 0;
        const command = commands(async (url, options) => {
            const response = await localFetch(url, options);
            if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; if (response.ok) throw new Error('Synthetic lost response'); }
            return response;
        }, () => clock);
        await command.prepare(input); expect((await command.confirm({ proposalId }, accept)).status).toBe('completed');
        clock += 300001; expect((await command.status({ proposalId })).status).toBe('completed');
        await command.confirm({ proposalId }, async () => { throw new Error('No second approval'); }); expect(commits).toBe(1);
    });
    it('does not create duplicate names when separate approved batches race', async () => {
        const command = commands(); await command.prepare(input); await command.prepare({ ...input, proposalId: second });
        let arrived = 0; let release; const both = new Promise((resolve) => { release = resolve; });
        const approve = async () => ({ ...await accept(), consume: async () => { if (++arrived === 2) release(); await both; } });
        await Promise.allSettled([proposalId, second].map((id) => command.confirm({ proposalId: id }, approve)));
        const rows = await Promise.all([proposalId, second].map((id) => getDoc(doc(db(), `teams/team-1/players/mcp_${id}_0`))));
        expect(rows.filter((row) => row.exists()).length).toBeLessThanOrEqual(1);
    }, 20000);
    it('stages an ordinary schedule update under real team rules, leaves the event untouched and denies access after revocation', async () => {
        const dependencies = { uid: 'owner', getContext, getDb: async () => rest() };
        const command = createScheduleReviewCommands(dependencies);
        const discovery = await createDirectDiscovery(dependencies).schedule({ teamId: 'team-1' });
        expect(discovery.items[0]).toMatchObject({ id: 'event-1', supportsOrdinaryAppReview: true });
        expect(JSON.stringify(discovery)).not.toContain('Private notes');
        const before = (await getDoc(doc(db(), 'teams/team-1/games/event-1'))).data();
        const result = await command.prepare({ requestId: proposalId, mode: 'update', teamId: 'team-1', eventId: 'event-1', eventType: 'game', changes: { location: 'New Synthetic Field' } });
        expect(result).toMatchObject({ status: 'requested', mayNotifyTeam: true, requiresAppConfirmation: true });
        expect((await getDoc(doc(db(), 'teams/team-1/games/event-1'))).data()).toEqual(before);
        await assertFails(getDoc(doc(db('other'), `teams/team-1/privateAiPendingActions/mcp_${proposalId}`)));
        await env.withSecurityRulesDisabled(async (context) => updateDoc(doc(context.firestore(), 'teams/team-1'), { ownerId: 'replacement' }));
        await expect(command.status({ requestId: proposalId })).rejects.toThrow();
    });
    it('runs a batch through broker-bound HTTP, one explicit approval, and durable outcome lookup', async () => {
        const oauth = createOAuthBroker(); const redirectUri = 'https://chatgpt.com/connector/oauth/synthetic-batch';
        const clientId = oauth.registerClient({ redirect_uris: [redirectUri] }).client_id;
        const verifier = 'synthetic-verifier-with-more-than-forty-three-characters';
        const code = await oauth.approveAuthorization({ clientId, redirectUri, codeChallenge: s256Challenge(verifier), firebaseRefreshToken: 'owner', scope: 'allplays.review', reviewApproved: true });
        const bearer = (await oauth.exchange({ grant_type: 'authorization_code', code, code_verifier: verifier })).access_token;
        const authenticate = createDirectSessionAuthenticator({ oauth, resolveIdentity: async () => ({ uid: 'owner', via: 'refresh-token', idToken: token() }) });
        const service = createDirectSessionRouter({ authenticate, createDependencies: (actor, current) => ({ uid: actor.uid,
            store: createDirectFavoriteStore({ projectId, uid: actor.uid, getIdToken: async () => (await current()).idToken, fetchImpl: localFetch }),
            rosterBatchStore: createDirectRosterBatchStore({ projectId, uid: actor.uid, getIdToken: async () => (await current()).idToken, fetchImpl: localFetch }),
            getDb: async () => createUserDb({ projectId, idToken: (await current()).idToken, fetchImpl: localFetch }),
            getContext: async () => { await current(); return getContext(); } }) });
        const app = express(); app.use('/direct', service.router); const http = createServer(app);
        await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
        const client = new Client({ name: 'synthetic-batch-client', version: '1' }, { capabilities: { elicitation: { form: {} } } });
        let approvals = 0; client.onerror = () => {}; client.setRequestHandler(ElicitRequestSchema, async () => { approvals++; return accept(); });
        const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${http.address().port}/direct`), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } });
        try {
            await client.connect(transport);
            expect((await client.callTool({ name: 'prepare_roster_batch', arguments: input })).isError).not.toBe(true);
            const result = await client.callTool({ name: 'confirm_roster_batch', arguments: { proposalId } });
            expect(result.structuredContent?.status, JSON.stringify(result.content)).toBe('completed');
            expect((await client.callTool({ name: 'get_roster_batch_action', arguments: { proposalId } })).structuredContent?.createdCount).toBe(1);
            await client.callTool({ name: 'confirm_roster_batch', arguments: { proposalId } }); expect(approvals).toBe(1);
        } finally { await client.close(); await service.close(); http.closeAllConnections(); await new Promise((resolve) => http.close(resolve)); }
    }, 15000);
});
