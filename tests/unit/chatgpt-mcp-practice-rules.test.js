import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { createMockUserToken } from '@firebase/util';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { createDirectPracticeTimelineCommands, createDirectPracticeTimelineStore } from '../../services/chatgpt-mcp/src/directPracticeTimeline.js';
import { createDirectFavoriteStore } from '../../services/chatgpt-mcp/src/directFavoriteStore.js';
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
const first = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const input = { proposalId: first, mode: 'create', teamId: 'team-1', eventId: 'practice-1', sessionId: `mcp_${first}`,
    changes: { title: 'Synthetic Private Coaching Plan', blocks: [{ drillId: 'drill-1', duration: 15 }] } };
const sessionPath = `teams/team-1/practiceSessions/${input.sessionId}`;
const accept = async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} });

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('direct practice timeline with real Firestore rules', () => {
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
    const commands = (fetchImpl = localFetch, now = Date.now) => createDirectPracticeTimelineCommands({ uid: 'owner', now, getContext,
        store: createDirectPracticeTimelineStore({ projectId, uid: 'owner', idToken: token(), fetchImpl }) });
    beforeEach(async () => {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async (context) => {
            const admin = context.firestore();
            await setDoc(doc(admin, 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(admin, 'teams/team-1'), { ownerId: 'owner', adminEmails: [], name: 'Synthetic Team' });
            await setDoc(doc(admin, 'teams/team-1/games/practice-1'), { type: 'practice', title: 'Synthetic Practice', date: new Date('2026-12-01T17:00:00Z'), location: 'Synthetic Field' });
            await setDoc(doc(admin, 'drillLibrary/drill-1'), { source: 'community', title: 'Passing', description: 'Pass in pairs.', type: 'Technical', setup: { duration: 10 } });
        });
    });
    it('stores proposal content only behind team rules, then appends without rewriting old notes or Firestore references', async () => {
        const command = commands(); await command.prepare(input);
        const header = `users/owner/privateAiPendingActions/direct_${first}`;
        const payload = `teams/team-1/privateAiPendingActions/direct_owner_${first}`;
        expect(JSON.stringify((await getDoc(doc(db(), header))).data())).not.toContain(input.changes.title);
        expect((await getDoc(doc(db(), payload))).data().changes.title).toBe(input.changes.title);
        await assertFails(getDoc(doc(db('other'), payload)));
        await command.confirm({ proposalId: first }, accept);
        const session = doc(db(), sessionPath);
        const before = (await getDoc(session)).data();
        expect(before).toMatchObject({ status: 'draft', duration: 15, homePacketGenerated: false, homePacketContent: null });
        const oldBlocks = before.blocks; oldBlocks[0].notes = 'Synthetic coach note';
        oldBlocks[0].notesLog = [{ type: 'text', text: 'Keep this note', createdAt: '2026-01-01' }];
        oldBlocks[0].legacyReference = doc(db(), 'drillLibrary/drill-1');
        oldBlocks[0].legacyTimestamp = new Date('2026-01-01T10:00:00Z');
        await updateDoc(session, { blocks: oldBlocks, attendance: { players: [{ playerId: 'synthetic', status: 'present' }], checkedInCount: 1 }, customExtension: { retained: true } });
        const update = { ...input, proposalId: second, mode: 'update', changes: { title: 'Updated plan', location: '', appendBlocks: [{ title: 'Cool down', duration: 5 }] } };
        await command.prepare(update); await command.confirm({ proposalId: second }, accept);
        const after = (await getDoc(session)).data();
        expect(after).toMatchObject({ title: 'Updated plan', location: null, duration: 20, attendance: { checkedInCount: 1 }, customExtension: { retained: true }, homePacketContent: null });
        expect(after.blocks[0].legacyReference.path).toBe('drillLibrary/drill-1');
        expect(after.blocks[0].legacyTimestamp.toDate().toISOString()).toBe('2026-01-01T10:00:00.000Z');
        expect(after.blocks[0].notesLog).toEqual(oldBlocks[0].notesLog); expect(after.blocks[1].order).toBe(1);
        expect((await getDoc(doc(db(), 'teams/team-1/games/practice-1'))).data().location).toBe('Synthetic Field');
        expect((await getDoc(doc(db(), header))).data()).toMatchObject({ receiptOnly: true, status: 'completed' });
        await env.withSecurityRulesDisabled(async (context) => expect((await getDoc(doc(context.firestore(), payload))).exists()).toBe(false));
    });
    it.each(['event', 'drill', 'manager', 'packet'])('rejects a changed %s during approval under real rules', async (change) => {
        const command = commands(); await command.prepare(input); await command.confirm({ proposalId: first }, accept);
        await command.prepare({ ...input, proposalId: second, mode: 'update', changes: { appendBlocks: [{ drillId: 'drill-1', duration: 10 }] } });
        await expect(command.confirm({ proposalId: second }, async () => {
            await env.withSecurityRulesDisabled(async (context) => {
                const admin = context.firestore();
                if (change === 'event') await updateDoc(doc(admin, 'teams/team-1/games/practice-1'), { location: 'Changed field' });
                if (change === 'drill') await updateDoc(doc(admin, 'drillLibrary/drill-1'), { description: 'Changed description' });
                if (change === 'manager') await updateDoc(doc(admin, 'teams/team-1'), { ownerId: 'replacement' });
                if (change === 'packet') await updateDoc(doc(admin, sessionPath), { homePacketGenerated: true, homePacketContent: { blocks: [{ title: 'Synthetic packet' }] } });
            });
            return accept();
        })).rejects.toThrow();
        await env.withSecurityRulesDisabled(async (context) => expect((await getDoc(doc(context.firestore(), sessionPath))).data().blocks).toHaveLength(1));
    });
    it('reconciles lost successful creation responses through the opaque receipt even after expiry', async () => {
        let clock = Date.now(); let lose = false; let commits = 0;
        const command = commands(async (url, options) => {
            const response = await localFetch(url, options);
            if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; if (lose && response.ok) { lose = false; throw new Error('Synthetic lost response'); } }
            return response;
        }, () => clock);
        await command.prepare(input); lose = true;
        expect(await command.confirm({ proposalId: first }, accept)).toMatchObject({ status: 'completed' });
        clock += 300001;
        expect(await command.confirm({ proposalId: first }, async () => { throw new Error('Must not recreate'); })).toMatchObject({ status: 'completed' });
        expect(commits).toBe(1);
    });
    it('does not create two timelines for the same event when approved transactions race', async () => {
        const command = commands(); await command.prepare(input);
        await command.prepare({ ...input, proposalId: second, sessionId: `mcp_${second}` });
        let arrived = 0; let release;
        const both = new Promise((resolve) => { release = resolve; });
        const approve = async () => ({ action: 'accept', content: { approve: true }, consume: async () => { if (++arrived === 2) release(); await both; } });
        await Promise.allSettled([command.confirm({ proposalId: first }, approve), command.confirm({ proposalId: second }, approve)]);
        const sessions = await Promise.all([first, second].map((id) => getDoc(doc(db(), `teams/team-1/practiceSessions/mcp_${id}`))));
        expect(sessions.filter((session) => session.exists()).length).toBeLessThanOrEqual(1);
    }, 20000);
    it('runs discovery → prepare → approve → create and append through broker-bound HTTP', async () => {
        const oauth = createOAuthBroker(); const redirectUri = 'https://chatgpt.com/connector/oauth/synthetic-practice';
        const clientId = oauth.registerClient({ redirect_uris: [redirectUri] }).client_id;
        const verifier = 'synthetic-verifier-with-more-than-forty-three-characters';
        const code = await oauth.approveAuthorization({ clientId, redirectUri, codeChallenge: s256Challenge(verifier), firebaseRefreshToken: 'owner', scope: 'allplays.review', reviewApproved: true });
        const bearer = (await oauth.exchange({ grant_type: 'authorization_code', code, code_verifier: verifier })).access_token;
        const authenticate = createDirectSessionAuthenticator({ oauth, resolveIdentity: async () => ({ uid: 'owner', via: 'refresh-token', idToken: token() }) });
        const service = createDirectSessionRouter({ authenticate, createDependencies: (actor, current) => ({ uid: actor.uid,
            store: createDirectFavoriteStore({ projectId, uid: actor.uid, getIdToken: async () => (await current()).idToken, fetchImpl: localFetch }),
            practiceTimelineStore: createDirectPracticeTimelineStore({ projectId, uid: actor.uid, getIdToken: async () => (await current()).idToken, fetchImpl: localFetch }),
            getDb: async () => createUserDb({ projectId, idToken: (await current()).idToken, fetchImpl: localFetch }),
            getContext: async () => { await current(); return getContext(); } }) });
        const app = express(); app.use('/direct', service.router); const http = createServer(app);
        await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
        const client = new Client({ name: 'synthetic-practice-client', version: '1' }, { capabilities: { elicitation: { form: {} } } });
        client.onerror = () => {}; client.setRequestHandler(ElicitRequestSchema, accept);
        const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${http.address().port}/direct`), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } });
        try {
            await client.connect(transport);
            expect((await client.callTool({ name: 'list_team_practices', arguments: { teamId: 'team-1' } })).structuredContent?.items[0]).toMatchObject({ id: 'practice-1', supportsDirectTimeline: true });
            expect((await client.callTool({ name: 'list_practice_drill_options', arguments: { teamId: 'team-1', scope: 'community' } })).structuredContent?.items[0].id).toBe('drill-1');
            expect((await client.callTool({ name: 'prepare_create_practice_timeline', arguments: { proposalId: first, teamId: 'team-1', eventId: 'practice-1', changes: input.changes } })).isError).not.toBe(true);
            const create = await client.callTool({ name: 'confirm_practice_timeline', arguments: { proposalId: first } });
            expect(create.structuredContent?.status, JSON.stringify(create.content)).toBe('completed');
            expect((await client.callTool({ name: 'list_practice_timelines', arguments: { teamId: 'team-1', eventId: 'practice-1' } })).structuredContent?.timelines[0].id).toBe(input.sessionId);
            expect((await client.callTool({ name: 'prepare_update_practice_timeline', arguments: { proposalId: second, teamId: 'team-1', eventId: 'practice-1', sessionId: input.sessionId, changes: { appendBlocks: [{ title: 'Cool down', duration: 5 }] } } })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_practice_timeline', arguments: { proposalId: second } })).structuredContent?.status).toBe('completed');
            expect((await getDoc(doc(db(), sessionPath))).data().blocks).toHaveLength(2);
        } finally { await client.close(); await service.close(); http.closeAllConnections(); await new Promise((resolve) => http.close(resolve)); }
    }, 15000);
});
