import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { createMockUserToken } from '@firebase/util';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { createDirectScheduleCommands, createDirectScheduleStore } from '../../services/chatgpt-mcp/src/directSchedule.js';
import { createDirectRsvpCommands, createDirectRsvpStore } from '../../services/chatgpt-mcp/src/directRsvp.js';
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
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const input = { proposalId, mode: 'create', teamId: 'team-1', eventId: `mcp_${proposalId}`, eventType: 'game', changes: { startDate: '2060-12-01T17:00Z', opponent: 'Other Visitors' } };
const newPath = `teams/team-1/games/${input.eventId}`;
const oldPath = 'teams/team-1/players/existing';
const header = `users/owner/privateAiPendingActions/direct_${proposalId}`;
const payload = `teams/team-1/privateAiPendingActions/direct_owner_${proposalId}`;
const rsvpInput = { proposalId, teamId: 'team-1', eventId: 'event-1', playerId: 'existing', response: 'going' };
const rsvpPath = 'teams/team-1/games/event-1/rsvps/owner__existing';
const accept = async () => ({ action: 'accept', content: { approve: true, notifyTeam: true } });

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('direct schedule and RSVP under real Firestore rules', () => {
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
    const commands = (fetchImpl = localFetch, now = Date.now) => createDirectScheduleCommands({ uid: 'owner', now, getContext,
        store: createDirectScheduleStore({ projectId, uid: 'owner', idToken: token(), fetchImpl }) });
    const rsvpCommands = (fetchImpl = localFetch, now = Date.now) => createDirectRsvpCommands({ uid: 'owner', now, getContext,
        store: createDirectRsvpStore({ projectId, uid: 'owner', idToken: token(), fetchImpl }) });
    beforeEach(async () => {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async (context) => {
            const admin = context.firestore();
            await setDoc(doc(admin, 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(admin, 'teams/team-1'), { ownerId: 'owner', adminEmails: [], name: 'Synthetic Team' });
            await setDoc(doc(admin, oldPath), { name: 'Synthetic Existing', position: 'Forward', active: true, privateLegacyField: 'Preserved' });
            await setDoc(doc(admin, 'teams/team-1/games/event-1'), { type: 'game', opponent: 'Synthetic Visitors', date: new Date('2060-12-01T17:00:00Z'), end: new Date('2060-12-01T18:00:00Z'), location: 'Synthetic Field', notes: 'Private notes' });
        });
    });
    it('requires distinct notification approval, creates once, and updates only selected fields under real rules', async () => {
        const command = commands(); await command.prepare(input);
        expect((await command.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true } }))).applied).toBe(false);
        expect((await getDoc(doc(db(), newPath))).exists()).toBe(false);
        await assertFails(getDoc(doc(db('other'), payload)));
        const created = await command.confirm({ proposalId }, accept);
        expect(created).toMatchObject({ status: 'completed', notificationDelivery: 'unverified' });
        const reference = doc(db(), newPath); const before = (await getDoc(reference)).data();
        expect(before).toMatchObject({ type: 'game', status: 'scheduled', createdBy: 'owner', opponentTeamId: null });
        expect(before.source).toBeUndefined();
        await updateDoc(reference, { notes: 'Private retained note', scheduleNotifications: { enabled: false, sent: true }, customReference: doc(db(), 'teams/team-1') });
        await command.prepare({ ...input, proposalId: second, mode: 'update', changes: { location: 'Updated Field' } });
        await command.confirm({ proposalId: second }, accept);
        const after = (await getDoc(reference)).data();
        expect(after).toMatchObject({ location: 'Updated Field', notes: 'Private retained note', scheduleNotifications: { enabled: false, sent: true } });
        expect(after.customReference.path).toBe('teams/team-1');
        expect((await getDoc(doc(db(), header))).data()).toMatchObject({ receiptOnly: true, eventId: input.eventId });
        expect(JSON.stringify((await getDoc(doc(db(), header))).data())).not.toContain(input.changes.opponent);
    });
    it('creates a practice and preserves reminder history when moving it', async () => {
        const command = commands();
        await command.prepare({ ...input, eventType: 'practice', changes: { title: 'Synthetic Practice', startDate: '2060-12-01T17:00Z', endDate: '2060-12-01T18:00Z' } });
        await command.confirm({ proposalId }, accept);
        await updateDoc(doc(db(), newPath), { scheduleNotifications: { enabled: false, sentAt: new Date('2060-01-01T00:00Z') } });
        await command.prepare({ ...input, eventType: 'practice', proposalId: second, mode: 'update', changes: { startDate: '2060-12-01T18:00Z' } });
        await command.confirm({ proposalId: second }, accept);
        const saved = (await getDoc(doc(db(), newPath))).data();
        expect(saved.date.toDate().toISOString()).toBe('2060-12-01T18:00:00.000Z');
        expect(saved.end.toDate().toISOString()).toBe('2060-12-01T19:00:00.000Z');
        expect(saved.scheduleNotifications.enabled).toBe(false);
        expect(saved.scheduleNotifications.sentAt.toDate().toISOString()).toBe('2060-01-01T00:00:00.000Z');
    });
    it.each(['schedule', 'rsvp'])('fails closed after manager revocation for %s', async (domain) => {
        const command = domain === 'schedule' ? commands() : rsvpCommands();
        await command.prepare(domain === 'schedule' ? input : rsvpInput);
        await expect(command.confirm({ proposalId }, async () => {
            await env.withSecurityRulesDisabled(async (context) => updateDoc(doc(context.firestore(), 'teams/team-1'), { ownerId: 'replacement' }));
            return accept();
        })).rejects.toThrow();
        await env.withSecurityRulesDisabled(async (context) => expect((await getDoc(doc(context.firestore(), domain === 'schedule' ? newPath : rsvpPath))).exists()).toBe(false));
    });
    it('keeps an event absent when commit-time rules reject the actor', async () => {
        const command = commands(async (url, options) => {
            if (url.endsWith(':commit') && JSON.parse(options.body).transaction) options = { ...options, headers: { ...options.headers, Authorization: `Bearer ${token('other')}` } };
            return localFetch(url, options);
        });
        await command.prepare(input); await expect(command.confirm({ proposalId }, accept)).rejects.toThrow();
        expect((await getDoc(doc(db(), newPath))).exists()).toBe(false);
        expect((await getDoc(doc(db(), header))).data().status).toBe('prepared');
    });
    it.each(['schedule', 'rsvp'])('reconciles lost %s commit responses without repeating effects after expiry', async (domain) => {
        let clock = Date.now(); let commits = 0;
        const factory = domain === 'schedule' ? commands : rsvpCommands;
        const command = factory(async (url, options) => {
            const response = await localFetch(url, options);
            if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; if (response.ok) throw new Error('Lost response'); }
            return response;
        }, () => clock);
        await command.prepare(domain === 'schedule' ? input : rsvpInput);
        expect((await command.confirm({ proposalId }, accept)).status).toBe('completed'); clock += 300001;
        expect((await command.confirm({ proposalId }, async () => { throw new Error('No second approval'); })).status).toBe('completed');
        expect(commits).toBe(1);
    });
    it('rejects duplicate schedule creation races', async () => {
        const command = commands(); await command.prepare(input); await command.prepare({ ...input, proposalId: second, eventId: `mcp_${second}` });
        let arrived = 0; let release; const both = new Promise((resolve) => { release = resolve; });
        const approve = async () => ({ ...await accept(), consume: async () => { if (++arrived === 2) release(); await both; } });
        await Promise.allSettled([proposalId, second].map((id) => command.confirm({ proposalId: id }, approve)));
        const rows = await Promise.all([proposalId, second].map((id) => getDoc(doc(db(), `teams/team-1/games/mcp_${id}`))));
        expect(rows.filter((row) => row.exists()).length).toBeLessThanOrEqual(1);
    }, 20000);
    it('saves and updates only the current manager override, preserving private notes and all other responses', async () => {
        const note = 'teams/team-1/games/event-1/rsvpNotes/owner__existing';
        await env.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), note), { note: 'Private retained', visibility: 'admins' });
            await setDoc(doc(context.firestore(), 'teams/team-1/games/event-1/rsvps/other__existing'), { userId: 'other', playerId: 'existing', response: 'maybe' });
        });
        const command = rsvpCommands(); await command.prepare(rsvpInput); await command.confirm({ proposalId }, accept);
        await command.prepare({ ...rsvpInput, proposalId: second, response: 'not_going' }); await command.confirm({ proposalId: second }, accept);
        expect((await getDoc(doc(db(), rsvpPath))).data()).toMatchObject({ userId: 'owner', playerId: 'existing', response: 'not_going' });
        expect((await getDoc(doc(db(), note))).data().note).toBe('Private retained');
        expect((await getDoc(doc(db(), 'teams/team-1/games/event-1/rsvps/other__existing'))).data().response).toBe('maybe');
        expect((await getDoc(doc(db(), 'teams/team-1/games/event-1/rsvps/owner'))).exists()).toBe(false);
        expect((await getDoc(doc(db(), 'teams/team-1/games/event-1'))).data().rsvpSummary).toBeUndefined();
        expect((await getDoc(doc(db(), header))).data().response).toBeUndefined();
    });
    it('blocks base/family reconciliation and a cutoff reached immediately before the commit', async () => {
        let clock = Date.now(); const command = rsvpCommands(localFetch, () => clock);
        await env.withSecurityRulesDisabled(async (context) => {
            await updateDoc(doc(context.firestore(), 'teams/team-1'), { availabilityPreferences: { cutoffMinutesBeforeStart: 1 } });
            await updateDoc(doc(context.firestore(), 'teams/team-1/games/event-1'), { date: new Date(clock + 61000) });
        });
        await command.prepare(rsvpInput);
        await expect(command.confirm({ proposalId }, async () => ({ ...await accept(), consume: async () => { clock += 1001; } }))).rejects.toMatchObject({ code: 'availability_locked' });
        expect((await getDoc(doc(db(), rsvpPath))).exists()).toBe(false);
        await env.withSecurityRulesDisabled(async (context) => setDoc(doc(context.firestore(), 'teams/team-1/games/event-1/rsvps/owner'), { userId: 'owner', response: 'going' }));
        await expect(command.prepare({ ...rsvpInput, proposalId: second })).rejects.toMatchObject({ code: 'legacy_rsvp' });
    });
    it('runs distinct schedule acknowledgment and RSVP approval through the authenticated HTTP session', async () => {
        const oauth = createOAuthBroker(); const redirectUri = 'https://chatgpt.com/connector/oauth/synthetic-schedule';
        const clientId = oauth.registerClient({ redirect_uris: [redirectUri] }).client_id;
        const verifier = 'synthetic-verifier-with-more-than-forty-three-characters';
        const code = await oauth.approveAuthorization({ clientId, redirectUri, codeChallenge: s256Challenge(verifier), firebaseRefreshToken: 'owner', scope: 'allplays.review', reviewApproved: true });
        const bearer = (await oauth.exchange({ grant_type: 'authorization_code', code, code_verifier: verifier })).access_token;
        const authenticate = createDirectSessionAuthenticator({ oauth, resolveIdentity: async () => ({ uid: 'owner', via: 'refresh-token', idToken: token() }) });
        const service = createDirectSessionRouter({ authenticate, createDependencies: (actor, current) => {
            const options = { projectId, uid: actor.uid, getIdToken: async () => (await current()).idToken, fetchImpl: localFetch };
            return { uid: actor.uid, store: createDirectFavoriteStore(options), scheduleStore: createDirectScheduleStore(options), rsvpStore: createDirectRsvpStore(options),
                getDb: async () => createUserDb({ projectId, idToken: (await current()).idToken, fetchImpl: localFetch }), getContext: async () => { await current(); return getContext(); } };
        } });
        const app = express(); app.use('/direct', service.router); const http = createServer(app);
        await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
        const client = new Client({ name: 'synthetic-schedule-client', version: '1' }, { capabilities: { elicitation: { form: {} } } });
        let acknowledge = false; const forms = []; client.onerror = () => {};
        client.setRequestHandler(ElicitRequestSchema, async (request) => { forms.push(request.params); return { action: 'accept', content: { approve: true, notifyTeam: acknowledge } }; });
        const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${http.address().port}/direct`), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } });
        try {
            await client.connect(transport);
            await client.callTool({ name: 'prepare_create_schedule_event', arguments: { proposalId, teamId: input.teamId, eventType: input.eventType, changes: input.changes } });
            expect((await client.callTool({ name: 'confirm_schedule_event', arguments: { proposalId } })).structuredContent?.applied).toBe(false);
            expect((await getDoc(doc(db(), newPath))).exists()).toBe(false); acknowledge = true;
            const result = await client.callTool({ name: 'confirm_schedule_event', arguments: { proposalId } });
            expect(result.structuredContent?.status, JSON.stringify(result.content)).toBe('completed');
            expect(result.structuredContent.notificationDelivery).toBe('unverified');
            expect(forms[0].requestedSchema.required).toEqual(['approve', 'notifyTeam']);
            await client.callTool({ name: 'prepare_staff_rsvp_override', arguments: { ...rsvpInput, proposalId: second } });
            const rsvp = await client.callTool({ name: 'confirm_staff_rsvp_override', arguments: { proposalId: second } });
            expect(rsvp.structuredContent?.status, JSON.stringify(rsvp.content)).toBe('completed');
            expect(forms.at(-1).requestedSchema.required).toEqual(['approve']);
        } finally { await client.close(); await service.close(); http.closeAllConnections(); await new Promise((resolve) => http.close(resolve)); }
    }, 15000);
});
