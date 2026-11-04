import { describe, expect, it, vi } from 'vitest';
import { createDirectPracticeTimelineStore } from '../../services/chatgpt-mcp/src/directPracticeTimeline.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { createDirectDiscovery } from '../../services/chatgpt-mcp/src/directDiscovery.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import { directPracticeFixture, practiceInput as input, practiceProposalId as proposalId, practiceUpdateId as updateId, practiceSessionPath as path, acceptPractice as accepted } from '../helpers/direct-practice-fixture.js';

async function preparedFixture() { const f = directPracticeFixture(); await f.commands.prepare(input); await f.commands.confirm({ proposalId }, async () => accepted()); return f; }
describe('draft practice timeline commands', () => {
    it('creates an app-compatible draft only after approval, without changing schedule or packet delivery', async () => {
        const f = directPracticeFixture(); const originalEvent = structuredClone(f.records.get('teams/team-1/games/practice-1'));
        f.put('drillLibrary/drill-1', { ...f.records.get('drillLibrary/drill-1').data, type: '' });
        const prepared = await f.commands.prepare(input);
        expect(prepared.preview).toMatchObject({ after: { blockCount: 2, duration: 20, location: 'Synthetic Field' } });
        expect(prepared.preview.blocksToAdd[0]).toMatchObject({ drillTitle: 'Passing', description: 'Pass in pairs.', duration: 15 });
        expect(f.records.has(path)).toBe(false);
        const answer = accepted(); const approve = vi.fn(async () => answer);
        expect(await f.commands.confirm({ proposalId }, approve)).toMatchObject({ status: 'completed', sessionId: input.sessionId });
        expect(f.records.get(path).data).toMatchObject({ eventId: 'practice-1', eventType: 'practice', status: 'draft', homePacketGenerated: false, homePacketContent: null,
            createdBy: 'owner', attendance: { players: [], checkedInCount: 0 }, duration: 20 });
        expect(f.records.get(path).data.blocks[0]).toEqual({ order: 0, drillId: 'drill-1', drillTitle: 'Passing', type: 'Technical', duration: 15, description: 'Pass in pairs.', notes: '', notesLog: [] });
        expect(f.records.get('teams/team-1/games/practice-1')).toEqual(originalEvent);
        await f.commands.confirm({ proposalId }, approve); expect(approve).toHaveBeenCalledTimes(1); expect(answer.consume).toHaveBeenCalledTimes(1);
    });
    it('appends without replacing old blocks, notes, attendance, unknown extensions or dates', async () => {
        const f = await preparedFixture(); const existing = f.records.get(path).data;
        existing.blocks[0].notes = 'Synthetic coach note'; existing.blocks[0].notesLog = [{ type: 'text', text: 'Keep this', createdAt: '2026-01-01' }];
        existing.blocks[0].extension = { nested: true }; existing.attendance.players = [{ playerId: 'synthetic', status: 'present' }]; existing.extra = { retained: true }; f.put(path, existing);
        const before = structuredClone(f.records.get(path).data);
        const args = { ...input, proposalId: updateId, mode: 'update', changes: { title: 'Updated title', location: '', appendBlocks: [{ title: 'Cool down', duration: 10 }] } };
        const preview = await f.commands.prepare(args);
        expect(JSON.stringify(preview)).not.toContain('Synthetic coach note'); expect(JSON.stringify(preview)).not.toContain('Keep this');
        await f.commands.confirm({ proposalId: updateId }, async () => accepted());
        const after = f.records.get(path).data;
        expect(after.blocks.slice(0, 2)).toEqual(before.blocks); expect(after.blocks[2].order).toBe(2);
        expect(after).toMatchObject({ title: 'Updated title', location: null, duration: 30, attendance: before.attendance, extra: before.extra, date: before.date });
    });
    it.each([{ type: 'game' }, { isSeriesMaster: true }, { seriesId: 'series' }, { recurrence: {} }, { status: 'cancelled' }, { date: 'invalid' }])('rejects unsupported event state %j', async (patch) => {
        const f = directPracticeFixture(); f.put('teams/team-1/games/practice-1', { ...f.records.get('teams/team-1/games/practice-1').data, ...patch });
        await expect(f.commands.prepare(input)).rejects.toMatchObject({ code: 'unsupported_event' }); expect(f.store.create).not.toHaveBeenCalled();
    });
    it.each([{ homePacketGenerated: true }, { homePacketContent: { blocks: [] } }, { status: 'completed' }, { eventId: 'other' }])('blocks packet-assigned or non-draft updates %j', async (patch) => {
        const f = await preparedFixture(); f.put(path, { ...f.records.get(path).data, ...patch });
        await expect(f.commands.prepare({ ...input, proposalId: updateId, mode: 'update', changes: { title: 'Changed' } })).rejects.toMatchObject({ code: 'unsupported_timeline' });
    });
    it.each([{ blocks: [] }, { title: 'X', blocks: [{ title: 'X', duration: 0 }] }, { title: 'X', blocks: [{ title: 'X', duration: 10, notes: 'not allowed' }] }, { title: 'X', blocks: [{ title: 'X', duration: 10 }], homePacketGenerated: true }])('rejects unsupported input %j', async (changes) => {
        const f = directPracticeFixture(); await expect(f.commands.prepare({ ...input, changes })).rejects.toMatchObject({ code: 'invalid_argument' });
    });
    it.each(['drill', 'event', 'timeline', 'permission', 'expiry'])('invalidates approval after a %s change', async (change) => {
        const f = directPracticeFixture(); await f.commands.prepare(input);
        await expect(f.commands.confirm({ proposalId }, async () => {
            if (change === 'drill') f.put('drillLibrary/drill-1', { source: 'community', title: 'Changed drill' });
            if (change === 'event') f.put('teams/team-1/games/practice-1', { ...f.records.get('teams/team-1/games/practice-1').data, location: 'Changed field' });
            if (change === 'timeline') f.put('teams/team-1/practiceSessions/other', { eventId: 'practice-1' });
            if (change === 'permission') f.context.teams.clear();
            if (change === 'expiry') f.expire();
            return accepted();
        })).rejects.toThrow(); expect(f.records.has(path)).toBe(false);
    });
    it('rejects inaccessible drills, duplicate timelines and invalid legacy block ordering', async () => {
        const f = directPracticeFixture(); f.put('drillLibrary/drill-1', { title: 'Private other-team drill', source: 'custom', teamId: 'other' });
        await expect(f.commands.prepare(input)).rejects.toMatchObject({ code: 'permission_denied' });
        const g = await preparedFixture(); g.put('teams/team-1/practiceSessions/duplicate', { eventId: 'practice-1' });
        await expect(g.commands.prepare({ ...input, proposalId: updateId, mode: 'update', changes: { title: 'New' } })).rejects.toMatchObject({ code: 'unsupported_timeline' });
        const h = await preparedFixture(); const session = h.records.get(path).data; session.blocks[0].order = 7; h.put(path, session);
        await expect(h.commands.prepare({ ...input, proposalId: updateId, mode: 'update', changes: { appendBlocks: [{ title: 'X', duration: 5 }] } })).rejects.toMatchObject({ code: 'unsupported_timeline' });
    });
    it('handles decline and lost successful commits without duplicate creation', async () => {
        const f = directPracticeFixture(); await f.commands.prepare(input);
        expect(await f.commands.confirm({ proposalId }, async () => ({ action: 'decline' }))).toMatchObject({ applied: false }); expect(f.records.has(path)).toBe(false);
        const transaction = f.store.transaction.getMockImplementation(); f.store.transaction.mockImplementation(async (callback, settings) => { await transaction(callback, settings); throw new Error('lost'); });
        expect(await f.commands.confirm({ proposalId }, async () => accepted())).toMatchObject({ status: 'completed' }); expect(f.store.transaction).toHaveBeenCalledTimes(1);
    });
    it('runs discovery and create/append through SDK form approval', async () => {
        const f = directPracticeFixture(); const server = createDirectFavoriteMcpSession(f.dependencies);
        const client = new Client({ name: 'synthetic', version: '1' }, { capabilities: { elicitation: { form: {} } } });
        const approvals = []; client.setRequestHandler(ElicitRequestSchema, async (request) => { approvals.push(request.params); return accepted(); });
        const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
        try {
            expect((await client.callTool({ name: 'list_team_practices', arguments: { teamId: 'team-1' } })).structuredContent.items[0]).toMatchObject({ id: 'practice-1', supportsDirectTimeline: true });
            expect((await client.callTool({ name: 'list_practice_drill_options', arguments: { teamId: 'team-1', scope: 'community' } })).structuredContent.items[0].id).toBe('drill-1');
            expect((await client.callTool({ name: 'prepare_create_practice_timeline', arguments: { proposalId, teamId: 'team-1', eventId: 'practice-1', changes: input.changes } })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_practice_timeline', arguments: { proposalId } })).structuredContent.status).toBe('completed');
            expect((await client.callTool({ name: 'list_practice_timelines', arguments: { teamId: 'team-1', eventId: 'practice-1' } })).structuredContent.timelines[0].id).toBe(input.sessionId);
            expect((await client.callTool({ name: 'prepare_update_practice_timeline', arguments: { proposalId: updateId, teamId: 'team-1', eventId: 'practice-1', sessionId: input.sessionId, changes: { appendBlocks: [{ title: 'Cool down', duration: 5 }] } } })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_practice_timeline', arguments: { proposalId: updateId } })).structuredContent.status).toBe('completed'); expect(approvals).toHaveLength(2);
        } finally { await client.close(); await server.close(); }
    });
    it('restricts queries and array transforms to this domain, preserving existing stored values', async () => {
        const fetchImpl = vi.fn(async (url, options) => ({ ok: true, json: async () => url.endsWith(':beginTransaction') ? { transaction: 'synthetic' } : [] }));
        const store = createDirectPracticeTimelineStore({ projectId: 'demo-synthetic', uid: 'owner', idToken: 'synthetic', fetchImpl });
        await expect(store.get('teams/team-1/players/p')).rejects.toMatchObject({ code: 'permission_denied' });
        await expect(store.list('teams/team-1/practiceSessions')).rejects.toMatchObject({ code: 'permission_denied' });
        await store.list('teams/team-1/practiceSessions', { eventId: 'practice-1' });
        const query = JSON.parse(fetchImpl.mock.calls.at(-1)[1].body).structuredQuery;
        expect(query.where.fieldFilter).toMatchObject({ field: { fieldPath: 'eventId' }, value: { stringValue: 'practice-1' } }); expect(query.limit).toBe(2);
        await store.transaction(async (tx) => tx.append(path, 'blocks', [{ order: 1, drillTitle: 'New', duration: 5 }], { duration: 10, updatedAt: new Date() }));
        const commit = fetchImpl.mock.calls.find(([url]) => url.endsWith(':commit'));
        const write = JSON.parse(commit[1].body).writes[0]; expect(write.updateTransforms[0].fieldPath).toBe('blocks');
        expect(write.updateMask.fieldPaths).not.toContain('blocks'); expect(write.update.fields).not.toHaveProperty('blocks');
        await expect(store.transaction(async (tx) => tx.append(path, 'attendance', [], { updatedAt: new Date() }))).rejects.toMatchObject({ code: 'permission_denied' });
    });
    it('keeps discovery role-scoped and propagates missing client data', async () => {
        const f = directPracticeFixture(); const discovery = createDirectDiscovery(f.dependencies); f.context.teams.clear();
        await expect(discovery.practices({ teamId: 'team-1' })).rejects.toMatchObject({ code: 'permission_denied' });
        await expect(discovery.drills({ teamId: 'team-1', scope: 'community' })).rejects.toMatchObject({ code: 'permission_denied' });
    });
});
