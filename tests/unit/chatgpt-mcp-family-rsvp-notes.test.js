import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { rosterFixture } from '../helpers/direct-roster-fixture.js';
import { createTestActionAuthority } from '../helpers/direct-test-authority.js';
import { createOneActionApproval } from '../../services/chatgpt-mcp/src/directActionApproval.js';
import { createDirectFamilyRsvpCommands, createDirectFamilyRsvpStore } from '../../services/chatgpt-mcp/src/directFamilyRsvp.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { buildAvailabilityNoteRows } from '../../js/availability-preferences.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const third = '00112233-4455-4677-8899-aabbccddeebb';
const eventPath = 'teams/team-1/games/event';
const responsePath = (id) => `${eventPath}/rsvps/owner__${id}`;
const notePath = (id) => `${eventPath}/rsvpNotes/owner__${id}`;
const input = { proposalId, teamId: 'team-1', eventId: 'event', playerIds: ['p1', 'p2'], response: 'going', note: 'Synthetic availability note' };
const accept = async () => ({ action: 'accept', content: { approve: true, staffRsvpNote: true }, consume: async () => {} });
function fixture() {
    const f = rosterFixture(); f.context.teams.get('team-1').roles = new Set(['parent']);
    f.put('users/owner', { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1', 'team-1::p2'] });
    f.put('teams/team-1', { name: 'Synthetic Team', availabilityPreferences: { noteVisibility: 'admins', cutoffMinutesBeforeStart: 1 } });
    f.put(eventPath, { type: 'game', date: new Date(f.dependencies.now() + 120000), rsvpSummary: { going: 0 } });
    for (const id of input.playerIds) f.put(`teams/team-1/players/${id}`, { name: `Synthetic ${id}`, active: true, medicalInfo: 'Never copy' });
    return { ...f, commands: createDirectFamilyRsvpCommands(f.dependencies, { staffNotes: true }) };
}
const noteRecord = (f, id, note = 'Existing private note') => ({ userId: 'owner', displayName: null, playerId: id, childId: id, playerIds: [id], response: 'maybe', note, visibility: 'admins', respondedAt: new Date(f.dependencies.now() - 1000), updatedAt: new Date(f.dependencies.now() - 1000), createdAt: new Date(0) });
describe('staff-only family RSVP note batch', () => {
    it('creates responses and notes together, then replaces one and explicitly clears the other', async () => {
        const f = fixture(); f.put(`${eventPath}/rsvpNotes/other__p1`, { note: 'Other author' });
        const prepared = await f.commands.prepare(input); expect(prepared.preview).toMatchObject({ note: input.note, audience: 'Author and current authorized team staff', requiredAcknowledgements: ['staffRsvpNote'] });
        expect(JSON.stringify(prepared)).not.toMatch(/Never copy|Other author/); expect(prepared.message).toMatch(/Prepared is not applied/);
        await f.commands.confirm({ proposalId }, accept);
        for (const id of input.playerIds) {
            expect(f.records.get(responsePath(id)).data.response).toBe('going'); expect(f.records.get(responsePath(id)).data.note).toBeUndefined();
            expect(f.records.get(notePath(id)).data).toMatchObject({ userId: 'owner', playerId: id, childId: id, playerIds: [id], response: 'going', note: input.note, visibility: 'admins' });
        }
        await f.commands.prepare({ ...input, proposalId: second, playerIds: ['p1'], response: 'maybe', note: 'Replacement\nSecond line' }); await f.commands.confirm({ proposalId: second }, accept);
        expect(f.records.get(notePath('p1')).data.note).toBe('Replacement\nSecond line'); expect(f.records.get(notePath('p2')).data.note).toBe(input.note);
        await f.commands.prepare({ ...input, proposalId: third, playerIds: ['p2'], note: '' }); await f.commands.confirm({ proposalId: third }, accept);
        expect(f.records.get(notePath('p2')).data.note).toBeNull(); expect(f.records.get(notePath('p2')).data.visibility).toBe('admins');
        expect(f.records.get(`${eventPath}/rsvpNotes/other__p1`).data.note).toBe('Other author'); expect(f.records.get(eventPath).data.rsvpSummary).toEqual({ going: 0 }); expect(f.records.has(`${eventPath}/rsvps/owner`)).toBe(false);
    });
    it('never copies an old note into the pending preview and preserves historical metadata', async () => {
        const f = fixture(); const old = noteRecord(f, 'p1'); f.put(notePath('p1'), old); const prepared = await f.commands.prepare(input);
        expect(JSON.stringify(prepared)).not.toContain(old.note); expect(JSON.stringify(f.records.get(`users/owner/privateAiPendingActions/direct_${proposalId}`).data)).not.toContain(old.note);
        await f.commands.confirm({ proposalId }, accept); expect(f.records.get(notePath('p1')).data.createdAt).toEqual(old.createdAt); expect(f.records.get(notePath('p1')).data.displayName).toBeNull();
    });
    it('requires the distinct note acknowledgement and cannot confirm through the response-only engine', async () => {
        const f = fixture(); await f.commands.prepare(input);
        for (const content of [{ approve: true }, { approve: true, staffRsvpNote: false }, { approve: true, staffRsvpNote: 'true' }]) expect(await f.commands.confirm({ proposalId }, async () => ({ action: 'accept', content, consume: async () => {} }))).toMatchObject({ applied: false });
        await expect(createDirectFamilyRsvpCommands(f.dependencies).confirm({ proposalId }, accept)).rejects.toThrow(); expect(f.records.has(responsePath('p1'))).toBe(false);
    });
    it.each([undefined, null, true, ' padded', 'trailing ', 'x'.repeat(2001), 'bad\u0000note'])('rejects unsupported note text %#', async (note) => {
        const f = fixture(); await expect(f.commands.prepare({ ...input, note })).rejects.toMatchObject({ code: 'invalid_argument' }); expect(f.store.create).not.toHaveBeenCalled();
    });
    it.each([{ noteVisibility: 'team' }, { noteVisibility: 'unknown' }, null, [], 'admins', new Date(), { availabilityPreferences: { noteVisibility: 'team' } }])('rejects audience configuration %# without changing it', async (availabilityPreferences) => {
        const f = fixture(); f.put('teams/team-1', { name: 'Synthetic Team', availabilityPreferences }); await expect(f.commands.prepare(input)).rejects.toThrow(); expect(f.records.get('teams/team-1').data.availabilityPreferences).toEqual(availabilityPreferences);
    });
    it('accepts the actual app default staff audience and displays notes only to staff in the shared consumer', async () => {
        const f = fixture(); f.put('teams/team-1', { name: 'Synthetic Team' }); await f.commands.prepare(input); await f.commands.confirm({ proposalId }, accept);
        const rows = input.playerIds.map((id) => ({ ...f.records.get(responsePath(id)).data, note: f.records.get(notePath(id)).data.note }));
        expect(buildAvailabilityNoteRows(rows, {}, false)).toEqual([]); expect(buildAvailabilityNoteRows(rows, {}, true).map((row) => row.note)).toEqual([input.note, input.note]);
    });
    it.each([{ userId: 'other' }, { playerId: 'p2' }, { childId: 'p2' }, { playerIds: ['p1', 'p2'] }, { visibility: 'team' }, { parentEmail: 'legacy@example.test' }, { updatedAt: null }, { note: 42 }])('rejects an unsafe existing note %# without partial response updates', async (change) => {
        const f = fixture(); f.put(notePath('p1'), { ...noteRecord(f, 'p1'), ...change }); await expect(f.commands.prepare(input)).rejects.toThrow(); expect(f.records.has(responsePath('p1'))).toBe(false); expect(f.records.has(responsePath('p2'))).toBe(false);
    });
    it.each(['note', 'legacy_note', 'audience', 'link', 'child', 'response', 'cutoff', 'role'])('rejects %s changes during confirmation without partial writes', async (kind) => {
        const f = fixture(); await f.commands.prepare(input);
        await expect(f.commands.confirm({ proposalId }, async () => {
            if (kind === 'note') f.put(notePath('p2'), noteRecord(f, 'p2'));
            if (kind === 'legacy_note') f.put(`${eventPath}/rsvpNotes/owner`, { note: 'Legacy family' });
            if (kind === 'audience') f.put('teams/team-1', { availabilityPreferences: { noteVisibility: 'team' } });
            if (kind === 'link') f.put('users/owner', { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1'] });
            if (kind === 'child') f.put('teams/team-1/players/p2', { name: 'Changed', active: false });
            if (kind === 'response') f.put(responsePath('p2'), { response: 'maybe' });
            if (kind === 'cutoff') f.advance(60000); if (kind === 'role') f.context.teams.clear(); return accept();
        })).rejects.toThrow(); expect(f.records.has(responsePath('p1'))).toBe(false); expect(f.records.has(notePath('p1'))).toBe(false);
    });
    it.each(['expiry', 'disconnect', 'cutoff'])('rejects %s after awaited dispatch preparation with actual authority', async (kind) => {
        const f = fixture(); const abort = new AbortController(); const authority = createOneActionApproval({ getActor: async () => ({ uid: 'owner', clientId: 'test', grantKey: 'test', expiresAt: f.dependencies.now() + 1000000 }), now: f.dependencies.now });
        await f.commands.prepare(input); const original = f.store.transaction.getMockImplementation();
        f.store.transaction.mockImplementation((callback, settings) => original(callback, { ...settings, beforeDispatch: async () => { const guard = await settings.beforeDispatch(); if (kind === 'disconnect') abort.abort(); else f.advance(kind === 'cutoff' ? 60000 : 120001); return guard; } }));
        await expect(f.commands.confirm({ proposalId }, (preview) => authority(preview, accept, abort.signal))).rejects.toThrow(); expect(f.records.has(responsePath('p1'))).toBe(false); expect(f.records.has(notePath('p1'))).toBe(false);
    });
    it('reconciles a lost response once and reauthorizes status for every child', async () => {
        const f = fixture(); await f.commands.prepare(input); const original = f.store.transaction.getMockImplementation();
        f.store.transaction.mockImplementation(async (...args) => { await original(...args); throw new Error('Synthetic lost response'); });
        expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed'); expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed'); expect(f.store.transaction).toHaveBeenCalledTimes(1);
        f.put('users/owner', { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1'] }); await expect(f.commands.status({ proposalId })).rejects.toThrow();
    });
    it('adapter restricts notes to this author and forbids audience changes and deletes', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ transaction: 'synthetic' })));
        const options = { projectId: 'demo-allplays-mcp-review', uid: 'owner', idToken: 'synthetic', fetchImpl };
        await expect(createDirectFamilyRsvpStore(options).get(notePath('p1'))).rejects.toThrow();
        const store = createDirectFamilyRsvpStore(options, { staffNotes: true }); await expect(store.get(`${eventPath}/rsvpNotes/other__p1`)).rejects.toThrow(); expect(fetchImpl).not.toHaveBeenCalled();
        for (const path of [`${eventPath}/rsvpNotes/other__p1`, `${eventPath}/rsvpNotes/owner`]) await expect(store.transaction(async (tx) => tx.set(path, { note: 'No' }))).rejects.toThrow();
        await expect(store.transaction(async (tx) => tx.delete(notePath('p1')))).rejects.toThrow();
        await expect(store.transaction(async (tx) => tx.set(notePath('p1'), { ...noteRecord(fixture(), 'p1'), visibility: 'team' }))).rejects.toThrow();
        await expect(store.transaction(async (tx) => tx.patch(notePath('p1'), { response: 'going', respondedAt: new Date(), updatedAt: new Date(), note: 'No', visibility: 'team' }))).rejects.toThrow();
        expect(fetchImpl.mock.calls.every(([url]) => !url.endsWith(':commit'))).toBe(true);
    });
    it('matches the actual app separate-note payload normalization for blank and multiline input', async () => {
        const source = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');
        const normalize = runInNewContext(`${source.slice(source.indexOf('function normalizeRsvpNoteText('), source.indexOf('function getRsvpNoteVisibility('))}; normalizeRsvpNoteText`);
        for (const note of ['', input.note, 'First line\nSecond line']) {
            const f = fixture(); await f.commands.prepare({ ...input, note }); await f.commands.confirm({ proposalId }, accept);
            expect(f.records.get(notePath('p1')).data.note).toBe(normalize(note) || null);
        }
    });
    it('MCP requires explicit note text and actual extra acknowledgement for both entry points', async () => {
        const f = fixture(); const server = createDirectFavoriteMcpSession({ ...f.dependencies, familyRsvpNoteStore: f.store, authorizeAction: createTestActionAuthority() });
        const client = new Client({ name: 'isolated', version: '1' }, { capabilities: { elicitation: { form: {} } } }); let approved = false;
        client.setRequestHandler(ElicitRequestSchema, async (request) => { expect(request.params.requestedSchema.required).toEqual(['approve', 'staffRsvpNote']); return { action: 'accept', content: { approve: true, staffRsvpNote: approved } }; });
        const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
        try {
            const { note, ...missing } = input;
            expect((await client.callTool({ name: 'prepare_linked_children_rsvps_with_staff_note', arguments: missing })).isError).toBe(true);
            expect((await client.callTool({ name: 'prepare_linked_children_rsvps_with_staff_note', arguments: { ...input, visibility: 'team' } })).isError).toBe(true);
            expect((await client.callTool({ name: 'prepare_linked_children_rsvps_with_staff_note', arguments: input })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_family_rsvp_staff_note', arguments: { proposalId, confirmed: true } })).isError).toBe(true);
            expect((await client.callTool({ name: 'confirm_family_rsvp_staff_note', arguments: { proposalId } })).structuredContent.applied).toBe(false);
            approved = true; expect((await client.callTool({ name: 'confirm_family_rsvp_staff_note', arguments: { proposalId } })).structuredContent.status).toBe('completed');
            const { playerIds, ...args } = input;
            expect((await client.callTool({ name: 'prepare_linked_child_rsvp_with_staff_note', arguments: { ...args, proposalId: second, playerId: 'p1', note: '' } })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_family_rsvp_staff_note', arguments: { proposalId: second } })).structuredContent.status).toBe('completed'); expect(f.records.get(notePath('p1')).data.note).toBeNull();
        } finally { await client.close(); await server.close(); }
    });
});
