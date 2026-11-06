import { describe, expect, it, vi } from 'vitest';
import { rosterFixture } from '../helpers/direct-roster-fixture.js';
import { createTestActionAuthority } from '../helpers/direct-test-authority.js';
import { createOneActionApproval } from '../../services/chatgpt-mcp/src/directActionApproval.js';
import { createDirectFamilyRsvpCommands, createDirectFamilyRsvpStore } from '../../services/chatgpt-mcp/src/directFamilyRsvp.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { isAvailabilityLocked } from '../../js/availability-preferences.js';
import { resolveMyRsvpByChildForGame } from '../../js/parent-dashboard-rsvp.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const input = { proposalId, teamId: 'team-1', eventId: 'event', playerIds: ['p1', 'p2'], response: 'going' };
const eventPath = 'teams/team-1/games/event';
const responsePath = (id) => `${eventPath}/rsvps/owner__${id}`;
const accept = async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} });
function fixture() {
    const f = rosterFixture(); f.context.teams.get('team-1').roles = new Set(['parent']);
    f.put('users/owner', { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1', 'team-1::p2'], email: 'never-copy@example.test' });
    f.put('teams/team-1', { name: 'Synthetic Team', availabilityPreferences: { cutoffMinutesBeforeStart: 1 } });
    f.put(eventPath, { type: 'game', date: new Date(f.dependencies.now() + 120000), notes: 'Private event note', rsvpSummary: { going: 0 } });
    for (const id of ['p1', 'p2']) f.put(`teams/team-1/players/${id}`, { name: `Synthetic ${id}`, active: true, medicalInfo: 'Never copy' });
    f.put(`${eventPath}/rsvpNotes/owner__p1`, { note: 'Existing private note', visibility: 'admins' });
    return { ...f, commands: createDirectFamilyRsvpCommands(f.dependencies) };
}
describe('linked-family RSVP batch', () => {
    it('creates an atomic selected-child batch and updates one child while preserving notes, summaries and other responders', async () => {
        const f = fixture(); f.put(`${eventPath}/rsvps/other__p1`, { response: 'maybe' });
        const prepared = await f.commands.prepare({ ...input, playerIds: ['p2', 'p1'] });
        expect(prepared.preview.children.map((row) => row.playerId)).toEqual(['p1', 'p2']); expect(JSON.stringify(prepared)).not.toMatch(/Never copy|Private event note|Existing private note/);
        await f.commands.confirm({ proposalId }, accept);
        for (const id of input.playerIds) expect(f.records.get(responsePath(id)).data).toEqual({ userId: 'owner', displayName: null, playerIds: [id], playerId: id, childId: id, response: 'going', respondedAt: expect.any(Date) });
        await f.commands.prepare({ ...input, proposalId: second, playerIds: ['p1'], response: 'not_going' }); await f.commands.confirm({ proposalId: second }, accept);
        expect(f.records.get(responsePath('p1')).data.response).toBe('not_going'); expect(f.records.get(responsePath('p2')).data.response).toBe('going');
        expect(resolveMyRsvpByChildForGame(input.playerIds.map((childId) => ({ teamId: input.teamId, id: input.eventId, childId })), input.teamId, input.eventId,
            input.playerIds.map((id) => ({ id: `owner__${id}`, ...f.records.get(responsePath(id)).data })), 'owner')).toEqual({ p1: 'not_going', p2: 'going' });
        expect(f.records.get(`${eventPath}/rsvpNotes/owner__p1`).data).toEqual({ note: 'Existing private note', visibility: 'admins' });
        expect(f.records.get(`${eventPath}/rsvps/other__p1`).data).toEqual({ response: 'maybe' }); expect(f.records.get(eventPath).data.rsvpSummary).toEqual({ going: 0 }); expect(f.records.has(`${eventPath}/rsvps/owner`)).toBe(false);
    });
    it.each([[], ['p1', 'p1'], ['../p1'], Array.from({ length: 11 }, (_, i) => `p${i}`), [1]])('rejects invalid child selection %#', async (playerIds) => {
        const f = fixture(); await expect(f.commands.prepare({ ...input, playerIds })).rejects.toMatchObject({ code: 'invalid_argument' });
    });
    it.each(['', 'yes', true, null])('rejects invalid response %#', async (response) => {
        const f = fixture(); await expect(f.commands.prepare({ ...input, response })).rejects.toMatchObject({ code: 'invalid_argument' });
    });
    it.each([{ parentTeamIds: [] }, { parentPlayerKeys: ['team-1::p1', 'other-team::p2'] }, { parentPlayerKeys: ['team-1::p1'] }, { parentPlayerKeys: [], parentOf: [{ teamId: 'team-1', playerId: 'p2' }] }])('requires exact canonical links for every child %#', async (change) => {
        const f = fixture(); f.put('users/owner', { ...f.records.get('users/owner').data, ...change }); await expect(f.commands.prepare(input)).rejects.toMatchObject({ code: 'permission_denied' }); expect(f.store.create).not.toHaveBeenCalled();
    });
    it('does not substitute manager access for linked-parent authority', async () => {
        const f = fixture(); f.context.teams.get('team-1').roles = new Set(['owner']); await expect(f.commands.prepare(input)).rejects.toThrow();
    });
    it.each([{ status: 'cancelled' }, { source: 'calendar' }, { seriesId: 'series' }, { liveStatus: 'live' }])('refuses unsupported events %#', async (change) => {
        const f = fixture(); f.put(eventPath, { ...f.records.get(eventPath).data, ...change }); await expect(f.commands.prepare(input)).rejects.toThrow();
    });
    it.each([{ active: false }, { name: '' }])('refuses an unsupported selected child without partial preparation %#', async (change) => {
        const f = fixture(); f.put('teams/team-1/players/p2', { ...f.records.get('teams/team-1/players/p2').data, ...change }); await expect(f.commands.prepare(input)).rejects.toThrow(); expect(f.store.create).not.toHaveBeenCalled();
    });
    it('refuses an existing base response and never deletes or changes its access-bearing state', async () => {
        const f = fixture(); const original = { userId: 'owner', response: 'going', playerIds: ['p1', 'p2'] }; f.put(`${eventPath}/rsvps/owner`, original);
        await expect(f.commands.prepare(input)).rejects.toMatchObject({ code: 'legacy_rsvp' }); expect(f.records.get(`${eventPath}/rsvps/owner`).data).toEqual(original);
    });
    it.each([{ note: 'Preserve' }, { userId: 'other' }, { childId: 'p2' }, { playerIds: ['p1', 'p2'] }, { respondedAt: null }])('refuses malformed or extended response %#', async (change) => {
        const f = fixture(); const original = { userId: 'owner', displayName: null, playerIds: ['p1'], playerId: 'p1', childId: 'p1', response: 'going', respondedAt: new Date(), ...change };
        f.put(responsePath('p1'), original); await expect(f.commands.prepare(input)).rejects.toThrow(); expect(f.records.get(responsePath('p1')).data).toEqual(original);
    });
    it.each(['link', 'team', 'event', 'child', 'response', 'legacy', 'expiry', 'permission'])('rejects %s changes while the approval form is open with zero partial writes', async (kind) => {
        const f = fixture(); await f.commands.prepare(input);
        await expect(f.commands.confirm({ proposalId }, async () => {
            if (kind === 'link') f.put('users/owner', { ...f.records.get('users/owner').data, parentPlayerKeys: ['team-1::p1'] });
            if (kind === 'team') f.put('teams/team-1', { name: 'Changed' });
            if (kind === 'event') f.put(eventPath, { ...f.records.get(eventPath).data, location: 'Changed' });
            if (kind === 'child') f.put('teams/team-1/players/p2', { name: 'Changed', active: true });
            if (kind === 'response') f.put(responsePath('p2'), { response: 'maybe' });
            if (kind === 'legacy') f.put(`${eventPath}/rsvps/owner`, { response: 'going' });
            if (kind === 'expiry') f.expire();
            if (kind === 'permission') f.context.teams.clear(); return accept();
        })).rejects.toThrow(); expect(f.records.has(responsePath('p1'))).toBe(false); expect(f.records.get(responsePath('p2'))?.data.response).not.toBe('going');
    });
    it('matches the shared app cutoff and rejects a deadline crossed after awaited dispatch preparation', async () => {
        const f = fixture(); const event = f.records.get(eventPath).data; const prefs = f.records.get('teams/team-1').data.availabilityPreferences;
        expect(isAvailabilityLocked(event.date, prefs, new Date(f.dependencies.now()))).toBe(false);
        await f.commands.prepare(input); const original = f.store.transaction.getMockImplementation();
        f.store.transaction.mockImplementation((callback, settings) => original(callback, { ...settings, beforeDispatch: async () => {
            const guard = await settings.beforeDispatch(); f.advance(60000); expect(isAvailabilityLocked(event.date, prefs, new Date(f.dependencies.now()))).toBe(true); return guard;
        } }));
        await expect(f.commands.confirm({ proposalId }, accept)).rejects.toMatchObject({ code: 'availability_locked' }); expect(f.records.has(responsePath('p1'))).toBe(false);
    });
    it('requires approval authority, rejects preview tampering and treats decline/cancel as no-op', async () => {
        const f = fixture(); await f.commands.prepare(input);
        for (const action of ['decline', 'cancel']) expect(await f.commands.confirm({ proposalId }, async () => ({ action }))).toMatchObject({ applied: false });
        await expect(f.commands.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true } }))).rejects.toThrow();
        f.records.get(`users/owner/privateAiPendingActions/direct_${proposalId}`).data.preview.children[0].after = 'not_going';
        await expect(f.commands.confirm({ proposalId }, accept)).rejects.toThrow(); expect(f.records.has(responsePath('p1'))).toBe(false);
    });
    it.each(['approval_expiry', 'disconnect'])('rejects %s after awaited dispatch preparation with the real approval authority', async (kind) => {
        const f = fixture(); f.put('teams/team-1', { availabilityPreferences: { cutoffMinutesBeforeStart: 0 } });
        const abort = new AbortController(); const actor = { uid: 'owner', clientId: 'synthetic-client', grantKey: 'synthetic-grant', expiresAt: f.dependencies.now() + 1000000 };
        const authority = createOneActionApproval({ getActor: async () => actor, now: f.dependencies.now });
        await f.commands.prepare(input); const original = f.store.transaction.getMockImplementation();
        f.store.transaction.mockImplementation((callback, settings) => original(callback, { ...settings, beforeDispatch: async () => {
            const guard = await settings.beforeDispatch(); if (kind === 'approval_expiry') f.advance(120001); else abort.abort(); return guard;
        } }));
        await expect(f.commands.confirm({ proposalId }, (preview) => authority(preview, async () => ({ action: 'accept', content: { approve: true } }), abort.signal))).rejects.toMatchObject({ code: 'confirmation_expired' });
        expect(f.records.has(responsePath('p1'))).toBe(false);
    });
    it('reconciles a lost response once and reauthorizes every selected child for status', async () => {
        const f = fixture(); await f.commands.prepare(input); const original = f.store.transaction.getMockImplementation();
        f.store.transaction.mockImplementation(async (...args) => { await original(...args); throw new Error('Synthetic lost response'); });
        expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed'); expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed'); expect(f.store.transaction).toHaveBeenCalledTimes(1);
        f.put('users/owner', { ...f.records.get('users/owner').data, parentPlayerKeys: ['team-1::p1'] }); await expect(f.commands.status({ proposalId })).rejects.toThrow();
    });
    it('discovers only linked child names and rejects ambiguity or malformed linkage', async () => {
        const f = fixture(); const result = await f.commands.discover({ teamId: 'team-1' }); expect(result.children.map((row) => row.playerId)).toEqual(['p1', 'p2']); expect(JSON.stringify(result)).not.toMatch(/Never copy|never-copy|Existing/);
        f.put('users/owner', { parentTeamIds: ['team-1'], parentPlayerKeys: 'bad' }); await expect(f.commands.discover({ teamId: 'team-1' })).rejects.toThrow();
    });
    it('scopes the REST adapter away from notes, base writes/deletes, other actors and event updates', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ transaction: 'synthetic' })));
        const store = createDirectFamilyRsvpStore({ projectId: 'demo-allplays-mcp-review', uid: 'owner', idToken: 'synthetic', fetchImpl });
        await expect(store.get(`${eventPath}/rsvpNotes/owner__p1`)).rejects.toThrow(); expect(fetchImpl).not.toHaveBeenCalled();
        for (const path of [`${eventPath}/rsvps/owner`, `${eventPath}/rsvps/other__p1`, eventPath]) await expect(store.transaction(async (tx) => tx.set(path, { response: 'going' }))).rejects.toThrow();
        await expect(store.transaction(async (tx) => tx.delete(responsePath('p1')))).rejects.toThrow();
        await expect(store.transaction(async (tx) => tx.patch(responsePath('p1'), { response: 'going', respondedAt: new Date(), note: 'No' }))).rejects.toThrow();
        expect(fetchImpl.mock.calls.every(([url]) => !url.endsWith(':commit'))).toBe(true);
    });
    it('both single and selected-child MCP entry points require actual form approval and reject notes/confirmed flags', async () => {
        const f = fixture(); const server = createDirectFavoriteMcpSession({ ...f.dependencies, familyRsvpStore: f.store, authorizeAction: createTestActionAuthority() });
        const client = new Client({ name: 'isolated', version: '1' }, { capabilities: { elicitation: { form: {} } } }); let forms = 0;
        client.setRequestHandler(ElicitRequestSchema, async () => { forms++; return { action: 'accept', content: { approve: true } }; });
        const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
        try {
            expect((await client.callTool({ name: 'prepare_linked_children_rsvps', arguments: { ...input, note: 'Hidden' } })).isError).toBe(true);
            expect((await client.callTool({ name: 'prepare_linked_children_rsvps', arguments: input })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_linked_children_rsvps', arguments: { proposalId, confirmed: true } })).isError).toBe(true);
            expect((await client.callTool({ name: 'confirm_linked_children_rsvps', arguments: { proposalId } })).structuredContent.status).toBe('completed');
            expect((await client.callTool({ name: 'prepare_linked_child_rsvp', arguments: { proposalId: second, teamId: input.teamId, eventId: input.eventId, playerId: 'p1', response: 'maybe' } })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_linked_children_rsvps', arguments: { proposalId: second } })).structuredContent.status).toBe('completed'); expect(forms).toBe(2);
        } finally { await client.close(); await server.close(); }
    });
});
