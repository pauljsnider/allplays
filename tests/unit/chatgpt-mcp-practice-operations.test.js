import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { directPracticeFixture, practiceInput, practiceProposalId, practiceUpdateId, practiceSessionPath, acceptPractice } from '../helpers/direct-practice-fixture.js';
import { createDirectPracticeAttendanceCommands, createDirectPracticeAttendanceStore } from '../../services/chatgpt-mcp/src/directPracticeAttendance.js';
import { createDirectPracticeTimelineStore } from '../../services/chatgpt-mcp/src/directPracticeTimeline.js';
import { createDirectDiscovery } from '../../services/chatgpt-mcp/src/directDiscovery.js';
import { decodeFields, encodeValue } from '../../services/chatgpt-mcp/src/firestoreRest.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { createTestActionAuthority } from '../helpers/direct-test-authority.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
const accept = async () => acceptPractice();
const input = { proposalId: practiceUpdateId, teamId: 'team-1', eventId: 'practice-1', sessionId: practiceInput.sessionId, changes: [{ playerId: 'p1', status: 'present' }, { playerId: 'p2', status: 'absent' }] };
const blockInput = { ...practiceInput, proposalId: practiceUpdateId, mode: 'update', changes: { blockDurations: [{ order: 0, duration: 20 }], blockOrder: [1, 0] } };
async function fixture() {
    const f = directPracticeFixture(); await f.commands.prepare(practiceInput); await f.commands.confirm({ proposalId: practiceProposalId }, accept); f.store.transaction.mockClear();
    for (const id of ['p1', 'p2']) f.put(`teams/team-1/players/${id}`, { name: `Synthetic ${id}`, active: true });
    f.records.get(practiceSessionPath).data.aiContext = { retained: { private: 'Preserve' } };
    return { ...f, attendance: createDirectPracticeAttendanceCommands(f.dependencies) };
}
describe('practice attendance and plan editing batch', () => {
    it('adds and updates selected attendance with consistent totals and preserved notes/other AI context', async () => {
        const f = await fixture(); const prepared = await f.attendance.prepare(input); expect(prepared.preview.changes.map((row) => row.before)).toEqual(['not_marked', 'not_marked']);
        await f.attendance.confirm({ proposalId: practiceUpdateId }, accept); const first = f.records.get(practiceSessionPath).data;
        expect(first.attendance).toMatchObject({ rosterSize: 2, checkedInCount: 1, players: [{ playerId: 'p1', status: 'present', checkedInAt: expect.any(Date) }, { playerId: 'p2', status: 'absent', checkedInAt: null }] });
        expect(first.aiContext).toEqual({ retained: { private: 'Preserve' }, presentPlayerIds: ['p1'], attendanceSummary: { present: 1, late: 0, absent: 1 } });
        first.attendance.players[0].note = 'Preserve coach note'; f.put(practiceSessionPath, first); const old = structuredClone(first.attendance.players);
        const id = '00112233-4455-4677-8899-aabbccddeebb'; await f.attendance.prepare({ ...input, proposalId: id, changes: [{ playerId: 'p1', status: 'late' }] }); await f.attendance.confirm({ proposalId: id }, accept);
        const saved = f.records.get(practiceSessionPath).data; expect(saved.attendance.players).toEqual([{ ...old[0], status: 'late' }, old[1]]); expect(saved.aiContext.attendanceSummary).toEqual({ present: 0, late: 1, absent: 1 }); expect(saved.blocks).toEqual(first.blocks);
    });
    it('reorders and retimes existing blocks without dropping drill content, notes, attendance or other session data', async () => {
        const f = await fixture(); f.records.get(practiceSessionPath).data.blocks[0].notes = 'Keep this note'; const before = structuredClone(f.records.get(practiceSessionPath).data);
        const prepared = await f.commands.prepare(blockInput); expect(prepared.preview.blocksAfter).toEqual([{ order: 0, drillTitle: 'Water break', duration: 5 }, { order: 1, drillTitle: 'Passing', duration: 20 }]);
        expect(JSON.stringify(prepared)).not.toContain('Keep this note'); await f.commands.confirm({ proposalId: practiceUpdateId }, accept);
        const after = f.records.get(practiceSessionPath).data; expect(after.blocks).toEqual([{ ...before.blocks[1], order: 0 }, { ...before.blocks[0], order: 1, duration: 20 }]); expect(after.duration).toBe(25); expect(after.attendance).toEqual(before.attendance); expect(after.aiContext).toEqual(before.aiContext);
    });
    it.each([[], [{ playerId: 'p1', status: 'not_marked' }], [{ playerId: 'p1', status: 'present', note: 'No' }], [{ playerId: 'p1', status: 'present' }, { playerId: 'p1', status: 'late' }], Array.from({ length: 21 }, (_, i) => ({ playerId: `p${i}`, status: 'present' }))])('rejects invalid attendance inputs %#', async (changes) => {
        const f = await fixture(); await expect(f.attendance.prepare({ ...input, changes })).rejects.toThrow();
    });
    it.each([{ homePacketGenerated: true }, { homePacketContent: {} }, { status: 'completed' }, { eventId: 'other' }])('refuses unsupported session state for both workflows %#', async (change) => {
        const f = await fixture(); f.put(practiceSessionPath, { ...f.records.get(practiceSessionPath).data, ...change }); await expect(f.attendance.prepare(input)).rejects.toThrow(); await expect(f.commands.prepare(blockInput)).rejects.toThrow();
    });
    it.each(['unknown_attendance', 'unknown_row', 'inactive_player', 'duplicate_player', 'orphan_player', 'invalid_count', 'oversized_roster', 'duplicate_session'])('preserves and refuses %s', async (kind) => {
        const f = await fixture(); const data = f.records.get(practiceSessionPath).data;
        if (kind === 'unknown_attendance') data.attendance.custom = 'Preserve';
        if (kind === 'unknown_row' || kind === 'duplicate_player' || kind === 'orphan_player') {
            data.attendance.players = [{ playerId: 'p1', displayName: 'P1', status: 'absent', checkedInAt: null, note: null }]; data.attendance.rosterSize = 2;
            if (kind === 'unknown_row') data.attendance.players[0].extension = true;
            if (kind === 'duplicate_player') data.attendance.players.push({ ...data.attendance.players[0] });
            if (kind === 'orphan_player') data.attendance.players[0].playerId = 'gone';
        }
        if (kind === 'invalid_count') data.attendance.checkedInCount = 1;
        if (kind === 'inactive_player') f.put('teams/team-1/players/p2', { name: 'P2', active: false });
        if (kind === 'oversized_roster') for (let i = 0; i < 200; i++) f.put(`teams/team-1/players/extra${i}`, { name: 'Extra' });
        if (kind === 'duplicate_session') f.put('teams/team-1/practiceSessions/other', { eventId: 'practice-1' });
        f.put(practiceSessionPath, data); const before = structuredClone(data); await expect(f.attendance.prepare(input)).rejects.toThrow(); expect(f.records.get(practiceSessionPath).data).toEqual(before);
    });
    it.each([{ blockOrder: [0, 0] }, { blockOrder: [1] }, { blockOrder: [0, 2] }, { blockDurations: [{ order: 2, duration: 10 }] }, { blockDurations: [{ order: 0, duration: 0 }] }, { blockDurations: [{ order: 0, duration: 10, notes: 'No' }] }, { appendBlocks: [{ title: 'New', duration: 10 }], blockOrder: [1, 0] }])('rejects invalid block edits %#', async (changes) => {
        const f = await fixture(); await expect(f.commands.prepare({ ...blockInput, changes })).rejects.toThrow();
    });
    it.each([{ notesLog: [{ createdAt: new Date(), text: 'Preserve' }] }, { extension: { private: 'Preserve' } }, { order: 7 }])('refuses block rewrites that could discard legacy data %#', async (change) => {
        const f = await fixture(); const data = f.records.get(practiceSessionPath).data; Object.assign(data.blocks[0], change); f.put(practiceSessionPath, data); await expect(f.commands.prepare(blockInput)).rejects.toThrow(); expect(f.records.get(practiceSessionPath).data).toEqual(data);
    });
    it.each(['attendance', 'blocks'])('rejects stale data, revocation and expiry and requires authority for %s', async (kind) => {
        for (const change of ['session', 'event', 'permission', 'expiry', 'authority']) {
            const f = await fixture(); const command = kind === 'attendance' ? f.attendance : f.commands; await command.prepare(kind === 'attendance' ? input : blockInput);
            await expect(command.confirm({ proposalId: practiceUpdateId }, async () => {
                if (change === 'session') f.put(practiceSessionPath, { ...f.records.get(practiceSessionPath).data, title: 'Changed' });
                if (change === 'event') f.put('teams/team-1/games/practice-1', { ...f.records.get('teams/team-1/games/practice-1').data, source: 'Imported' });
                if (change === 'permission') f.context.teams.clear(); if (change === 'expiry') f.expire();
                return change === 'authority' ? { action: 'accept', content: { approve: true } } : accept();
            })).rejects.toThrow(); expect(f.records.get(practiceSessionPath).data.attendance.players).toEqual([]); expect(f.records.get(practiceSessionPath).data.duration).toBe(20);
        }
    });
    it('binds roster revisions after attendance approval and returns no partial write', async () => {
        const f = await fixture(); await f.attendance.prepare(input); await expect(f.attendance.confirm({ proposalId: practiceUpdateId }, async () => { f.put('teams/team-1/players/p2', { name: 'Changed', active: true }); return accept(); })).rejects.toThrow(); expect(f.records.get(practiceSessionPath).data.attendance.players).toEqual([]);
    });
    it.each(['attendance', 'blocks'])('does not apply cancelled/declined %s and reconciles a lost response without repeating writes', async (kind) => {
        const f = await fixture(); const command = kind === 'attendance' ? f.attendance : f.commands; await command.prepare(kind === 'attendance' ? input : blockInput);
        for (const action of ['cancel', 'decline']) expect(await command.confirm({ proposalId: practiceUpdateId }, async () => ({ action }))).toMatchObject({ applied: false }); expect(f.store.transaction).not.toHaveBeenCalled();
        const original = f.store.transaction.getMockImplementation(); f.store.transaction.mockImplementation(async (...args) => { await original(...args); throw new Error('Synthetic lost response'); });
        expect((await command.confirm({ proposalId: practiceUpdateId }, accept)).status).toBe('completed'); expect((await command.confirm({ proposalId: practiceUpdateId }, accept)).status).toBe('completed'); expect(f.store.transaction).toHaveBeenCalledTimes(1);
    });
    it('opt-in decoding preserves nested timestamp precision on re-encoding and default reads remain ordinary Dates', () => {
        const wire = '2026-01-01T00:00:00.123456789Z'; const fields = { rows: { arrayValue: { values: [{ mapValue: { fields: { at: { timestampValue: wire } } } }] } } };
        const decoded = decodeFields(fields, { preserveTimestampPrecision: true }); expect(decoded.rows[0].at).toBeInstanceOf(Date);
        expect(encodeValue(decoded).mapValue.fields).toEqual(fields); expect(decodeFields(fields).rows[0].at.toISOString()).toBe('2026-01-01T00:00:00.123Z');
        decoded.rows[0].at.setTime(Date.parse('2026-01-02T00:00:00.000Z')); expect(encodeValue(decoded.rows[0].at).timestampValue).toBe('2026-01-02T00:00:00.000Z');
    });
    it('denies arbitrary nested masks and notes/contact writes in attendance and other domain stores', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ transaction: 'synthetic' }))); const options = { projectId: 'demo-allplays-mcp-review', uid: 'owner', idToken: 'synthetic', fetchImpl };
        for (const store of [createDirectPracticeAttendanceStore(options), createDirectPracticeTimelineStore(options)]) {
            await expect(store.transaction(async (tx) => tx.patchFields(practiceSessionPath, { homePacketGenerated: true }, ['homePacketGenerated']))).rejects.toThrow();
            await expect(store.transaction(async (tx) => tx.patchFields('teams/team-1/players/p1', { medicalInfo: 'No' }, ['medicalInfo']))).rejects.toThrow();
        }
        expect(fetchImpl.mock.calls.every(([url]) => !url.endsWith(':commit'))).toBe(true);
    });
    it('actual packet assignment notification returns before delivery when the packet is absent/unchanged', async () => {
        const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
        const body = source.slice(source.indexOf('async function practicePacketAssignedNotification('), source.indexOf('\nconst ', source.indexOf('async function practicePacketAssignedNotification(')));
        // Extract the balanced function without executing any deployed module.
        const start = body.indexOf('\n  if (!afterData)'); const boundary = body.indexOf("\n  if (!NOTIFICATION_CATEGORIES.includes('practice'))");
        const guard = vm.runInNewContext(`(async (beforeData, afterData) => {${body.slice(start, boundary)} throw new Error('delivery reached'); })`, { hasPracticePacketContent: (value) => Boolean(value?.blocks?.length) });
        await expect(guard({ homePacketContent: null }, { homePacketContent: null, attendancePlayers: 2 })).resolves.toBe(null);
        const packet = { blocks: ['synthetic'] }; await expect(guard({ homePacketContent: packet }, { homePacketContent: packet, duration: 30 })).resolves.toBe(null);
        await expect(guard(null, { homePacketContent: packet })).rejects.toThrow('delivery reached');
    });
    it('outlines blocks without notes or descriptions and requires actual forms for both new entry points', async () => {
        const f = await fixture(); const discovery = createDirectDiscovery({ ...f.dependencies, getDb: async () => ({ doc: () => ({ get: async () => ({ exists: true, data: () => f.records.get(practiceSessionPath).data }) }) }) });
        const outline = await discovery.practiceBlocks({ teamId: 'team-1', sessionId: practiceInput.sessionId }); expect(outline.blocks).toHaveLength(2); expect(JSON.stringify(outline.blocks)).not.toContain('Pass in pairs');
        const server = createDirectFavoriteMcpSession({ ...f.dependencies, practiceAttendanceStore: f.store, authorizeAction: createTestActionAuthority() });
        const client = new Client({ name: 'isolated', version: '1' }, { capabilities: { elicitation: { form: {} } } }); let forms = 0;
        client.setRequestHandler(ElicitRequestSchema, async () => { forms++; return { action: 'accept', content: { approve: true } }; }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
        try {
            expect((await client.callTool({ name: 'prepare_practice_attendance', arguments: input })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_practice_attendance', arguments: { proposalId: practiceUpdateId, confirmed: true } })).isError).toBe(true);
            expect((await client.callTool({ name: 'confirm_practice_attendance', arguments: { proposalId: practiceUpdateId } })).structuredContent.status).toBe('completed');
            const id = '00112233-4455-4677-8899-aabbccddeebb'; const { mode, changes, ...args } = blockInput;
            expect((await client.callTool({ name: 'prepare_edit_practice_blocks', arguments: { ...args, proposalId: id, ...changes } })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_practice_timeline', arguments: { proposalId: id } })).structuredContent.status).toBe('completed'); expect(forms).toBe(2);
        } finally { await client.close(); await server.close(); }
    });
});
