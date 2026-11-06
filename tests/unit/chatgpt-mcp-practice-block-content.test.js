import { describe, expect, it, vi } from 'vitest';
import { directPracticeFixture, practiceInput, practiceProposalId, practiceUpdateId, practiceSessionPath, acceptPractice } from '../helpers/direct-practice-fixture.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { createOneActionApproval } from '../../services/chatgpt-mcp/src/directActionApproval.js';
import { createTestActionAuthority } from '../helpers/direct-test-authority.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
vi.mock('../../apps/app/src/lib/adapters/legacyPracticeTimeline', () => ({ appendLivePracticeNote: vi.fn(), getDrills: vi.fn(), getPracticeSessionByEvent: vi.fn(), getTeam: vi.fn(), getTeamDrills: vi.fn(), hasFullTeamAccess: vi.fn(), updatePracticeSession: vi.fn(), upsertPracticeSessionForEvent: vi.fn() }));
import { normalizePracticeTimelineBlock, getPracticeTimelineTotalMinutes } from '../../apps/app/src/lib/practiceTimelineService';
const accept = async () => ({ action: 'accept', content: { approve: true, practiceBlockContent: true }, consume: async () => {} });
const input = { ...practiceInput, proposalId: practiceUpdateId, mode: 'update', changes: { blockReplacements: [{ order: 3, block: { title: 'New finish', duration: 12, description: 'Synthetic plan' } }], removeBlocks: [0] } };
async function fixture() {
    const f = directPracticeFixture(); await f.commands.prepare(practiceInput); await f.commands.confirm({ proposalId: practiceProposalId }, async () => acceptPractice()); f.store.transaction.mockClear();
    const session = f.records.get(practiceSessionPath).data;
    f.put(practiceSessionPath, { ...session, blocks: [...session.blocks,
        { order: 2, drillId: null, drillTitle: 'Keep content', type: 'Technical', duration: 10, description: 'Keep description', notes: 'Keep coaching note', notesLog: [] },
        { order: 3, drillId: null, drillTitle: 'Old finish', type: 'Technical', duration: 10, description: 'Old planned content', notes: '', notesLog: [] }], duration: 40,
        aiContext: { private: 'Do not expose' }, unknown: { preserve: [1, 2] } });
    return f;
}
describe('draft practice block replacement and removal', () => {
    it('uses original indices, shows exact discarded content and produces canonical app blocks with preserved unrelated state', async () => {
        const f = await fixture(); const old = structuredClone(f.records.get(practiceSessionPath).data); const event = structuredClone(f.records.get('teams/team-1/games/practice-1').data);
        const prepared = await f.commands.prepare(input);
        expect(prepared.preview.replacements[0]).toMatchObject({ originalOrder: 3, before: { drillTitle: 'Old finish', description: 'Old planned content', order: 3 }, after: { drillTitle: 'New finish', order: 2, duration: 12 } });
        expect(prepared.preview.removals[0]).toMatchObject({ order: 0, drillTitle: 'Passing' }); expect(prepared.preview.requiredAcknowledgements).toEqual(['practiceBlockContent']);
        expect(JSON.stringify(prepared)).not.toMatch(/Keep coaching note|Do not expose/); await f.commands.confirm({ proposalId: practiceUpdateId }, accept);
        const actual = f.records.get(practiceSessionPath).data; expect(actual.blocks.slice(0, 2)).toEqual([{ ...old.blocks[1], order: 0 }, { ...old.blocks[2], order: 1 }]);
        expect(actual.blocks[2]).toEqual({ order: 2, drillId: null, drillTitle: 'New finish', type: 'Technical', duration: 12, description: 'Synthetic plan', notes: '', notesLog: [] });
        expect(actual.duration).toBe(27); expect(actual.blocks.map(normalizePracticeTimelineBlock)).toEqual(actual.blocks); expect(getPracticeTimelineTotalMinutes(actual.blocks)).toBe(actual.duration);
        expect(actual.attendance).toEqual(old.attendance); expect(actual.aiContext).toEqual(old.aiContext); expect(actual.unknown).toEqual(old.unknown); expect(f.records.get('teams/team-1/games/practice-1').data).toEqual(event);
    });
    it('replaces with a freshly resolved available drill and supports removal alone', async () => {
        const f = await fixture(); const args = { ...input, changes: { blockReplacements: [{ order: 1, block: { drillId: 'drill-1', duration: 20 } }] } };
        const prepared = await f.commands.prepare(args); expect(prepared.preview.replacements[0].after).toMatchObject({ drillId: 'drill-1', drillTitle: 'Passing', description: 'Pass in pairs.', duration: 20 });
        await f.commands.confirm({ proposalId: practiceUpdateId }, accept); expect(f.records.get(practiceSessionPath).data.blocks[1].drillId).toBe('drill-1');
        const next = '00112233-4455-4677-8899-aabbccddeebb'; await f.commands.prepare({ ...input, proposalId: next, changes: { removeBlocks: [0, 3] } }); await f.commands.confirm({ proposalId: next }, accept);
        expect(f.records.get(practiceSessionPath).data.blocks.map((block) => block.drillTitle)).toEqual(['Passing', 'Keep content']); expect(f.records.get(practiceSessionPath).data.duration).toBe(30);
    });
    it('requires the extra content acknowledgement; decline, cancel and missing authority cannot change the plan', async () => {
        const f = await fixture(); const old = structuredClone(f.records.get(practiceSessionPath).data); await f.commands.prepare(input);
        for (const response of [{ action: 'decline' }, { action: 'cancel' }, { action: 'accept', content: { approve: true } }, { action: 'accept', content: { approve: true, practiceBlockContent: 'true' } }]) expect(await f.commands.confirm({ proposalId: practiceUpdateId }, async () => response)).toMatchObject({ applied: false });
        await expect(f.commands.confirm({ proposalId: practiceUpdateId }, async () => ({ action: 'accept', content: { approve: true, practiceBlockContent: true } }))).rejects.toThrow(); expect(f.records.get(practiceSessionPath).data).toEqual(old);
    });
    it.each([{ removeBlocks: [] }, { removeBlocks: [0, 0] }, { removeBlocks: [-1] }, { removeBlocks: [1.5] }, { removeBlocks: [100] }, { removeBlocks: [0, 1, 2, 3] }, { removeBlocks: [7] },
        { blockReplacements: [] }, { blockReplacements: [{ order: 1, block: { title: 'X', duration: 0 } }] }, { blockReplacements: [{ order: 1, block: { drillId: 5, duration: 5 } }] },
        { blockReplacements: [{ order: 1, block: { title: 'X', drillId: 'drill-1', duration: 5 } }] }, { blockReplacements: [{ order: 1, block: { title: 'X', duration: 5, notes: 'hidden' } }] },
        { blockReplacements: [{ order: 1, block: { title: 'X', duration: 5 } }, { order: 1, block: { title: 'Y', duration: 5 } }] },
        { blockReplacements: [{ order: 0, block: { title: 'X', duration: 5 } }], removeBlocks: [0] },
        { removeBlocks: [0], blockOrder: [0, 1, 2, 3] }, { removeBlocks: [0], appendBlocks: [{ title: 'X', duration: 5 }] }, { removeBlocks: [0], blockDurations: [{ order: 1, duration: 20 }] }
    ])('rejects invalid or ambiguous edits %#', async (changes) => {
        const f = await fixture(); await expect(f.commands.prepare({ ...input, changes })).rejects.toThrow(); expect(f.store.transaction).not.toHaveBeenCalled();
    });
    it.each(['replace_note', 'remove_note', 'historical_log', 'extended_block', 'duration_mismatch', 'packet', 'active', 'imported', 'recurring'])('refuses %s without discarding recorded content', async (kind) => {
        const f = await fixture(); const session = structuredClone(f.records.get(practiceSessionPath).data); let changes = input.changes;
        if (kind === 'replace_note') changes = { blockReplacements: [{ order: 2, block: { title: 'X', duration: 5 } }] };
        if (kind === 'remove_note') changes = { removeBlocks: [2] };
        if (kind === 'historical_log') session.blocks[1].notesLog = [{ type: 'text', text: 'Keep history', createdAt: new Date() }];
        if (kind === 'extended_block') session.blocks[1].opaque = { at: new Date() };
        if (kind === 'duration_mismatch') session.duration = 42;
        if (kind === 'packet') session.homePacketContent = { blocks: [] }; if (kind === 'active') session.status = 'in_progress'; f.put(practiceSessionPath, session);
        if (kind === 'imported') f.put('teams/team-1/games/practice-1', { ...f.records.get('teams/team-1/games/practice-1').data, source: 'calendar' });
        if (kind === 'recurring') f.put('teams/team-1/games/practice-1', { ...f.records.get('teams/team-1/games/practice-1').data, seriesId: 'series' });
        await expect(f.commands.prepare({ ...input, changes })).rejects.toThrow(); expect(f.records.get(practiceSessionPath).data).toEqual(session);
    });
    it.each(['session', 'event', 'team', 'drill', 'duplicate_session', 'role', 'expiry'])('invalidates %s changes after review without editing the timeline', async (kind) => {
        const f = await fixture(); const changes = { blockReplacements: [{ order: 1, block: { drillId: 'drill-1', duration: 20 } }] }; await f.commands.prepare({ ...input, changes });
        await expect(f.commands.confirm({ proposalId: practiceUpdateId }, async () => {
            if (kind === 'session') f.put(practiceSessionPath, { ...f.records.get(practiceSessionPath).data, title: 'Changed' });
            if (kind === 'event') f.put('teams/team-1/games/practice-1', { ...f.records.get('teams/team-1/games/practice-1').data, title: 'Changed' });
            if (kind === 'team') f.put('teams/team-1', { name: 'Changed' });
            if (kind === 'drill') f.put('drillLibrary/drill-1', { source: 'community', title: 'Changed' });
            if (kind === 'duplicate_session') f.put('teams/team-1/practiceSessions/duplicate', { eventId: 'practice-1' });
            if (kind === 'role') f.context.teams.clear(); if (kind === 'expiry') f.expire(); return accept();
        })).rejects.toThrow(); expect(f.records.get(practiceSessionPath).data.blocks[1].drillTitle).toBe('Water break');
    });
    it('refuses private foreign drills and oversized final durations', async () => {
        const f = await fixture(); f.put('drillLibrary/foreign', { teamId: 'other', title: 'Private' });
        await expect(f.commands.prepare({ ...input, changes: { blockReplacements: [{ order: 1, block: { drillId: 'foreign', duration: 5 } }] } })).rejects.toThrow();
        const session = f.records.get(practiceSessionPath).data; const blocks = Array.from({ length: 6 }, (_, order) => ({ ...session.blocks[0], order, duration: 100 })); f.put(practiceSessionPath, { ...session, blocks, duration: 600 });
        await expect(f.commands.prepare({ ...input, changes: { blockReplacements: [{ order: 0, block: { title: 'Too long', duration: 120 } }] } })).rejects.toThrow();
    });
    it('allows the thirty-block bound but rejects more before preparing', async () => {
        const f = await fixture(); const session = f.records.get(practiceSessionPath).data;
        f.put(practiceSessionPath, { ...session, blocks: Array.from({ length: 40 }, (_, order) => ({ ...session.blocks[0], order, duration: 5 })), duration: 200 });
        await expect(f.commands.prepare({ ...input, changes: { removeBlocks: Array.from({ length: 31 }, (_, i) => i) } })).rejects.toThrow();
        await f.commands.prepare({ ...input, changes: { removeBlocks: Array.from({ length: 30 }, (_, i) => i) } }); await f.commands.confirm({ proposalId: practiceUpdateId }, accept);
        expect(f.records.get(practiceSessionPath).data.blocks).toHaveLength(10); expect(f.records.get(practiceSessionPath).data.duration).toBe(50);
    });
    it('rejects preview substitution and final-dispatch disconnect with the real authority', async () => {
        const f = await fixture(); await f.commands.prepare(input); const proposal = f.records.get(`users/owner/privateAiPendingActions/direct_${practiceUpdateId}`).data;
        proposal.preview.removals[0].drillTitle = 'Wrong'; await expect(f.commands.confirm({ proposalId: practiceUpdateId }, accept)).rejects.toThrow(); proposal.preview.removals[0].drillTitle = 'Passing';
        const abort = new AbortController(); const authority = createOneActionApproval({ getActor: async () => ({ uid: 'owner', clientId: 'test', grantKey: 'test', expiresAt: Date.now() + 1000000 }) });
        const original = f.store.transaction.getMockImplementation(); f.store.transaction.mockImplementation((callback, settings) => original(callback, { ...settings, beforeDispatch: async () => { const guard = await settings.beforeDispatch(); abort.abort(); return guard; } }));
        await expect(f.commands.confirm({ proposalId: practiceUpdateId }, (preview) => authority(preview, accept, abort.signal))).rejects.toThrow(); expect(f.records.get(practiceSessionPath).data.blocks).toHaveLength(4);
    });
    it('reconciles a lost response once without applying old indices a second time', async () => {
        const f = await fixture(); await f.commands.prepare(input); const original = f.store.transaction.getMockImplementation(); f.store.transaction.mockImplementation(async (...args) => { await original(...args); throw new Error('Synthetic lost response'); });
        expect((await f.commands.confirm({ proposalId: practiceUpdateId }, accept)).status).toBe('completed'); expect((await f.commands.confirm({ proposalId: practiceUpdateId }, accept)).status).toBe('completed'); expect(f.store.transaction).toHaveBeenCalledTimes(1); expect(f.records.get(practiceSessionPath).data.blocks).toHaveLength(3);
    });
    it('MCP rejects hidden notes/confirmation flags and elicits the separate content acknowledgement', async () => {
        const f = await fixture(); const server = createDirectFavoriteMcpSession({ ...f.dependencies, authorizeAction: createTestActionAuthority() }); const client = new Client({ name: 'isolated', version: '1' }, { capabilities: { elicitation: { form: {} } } }); let approved = false;
        client.setRequestHandler(ElicitRequestSchema, async (request) => { expect(request.params.requestedSchema.required).toEqual(['approve', 'practiceBlockContent']); return { action: 'accept', content: { approve: true, practiceBlockContent: approved } }; });
        const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
        try {
            const args = { proposalId: practiceUpdateId, teamId: input.teamId, eventId: input.eventId, sessionId: input.sessionId, ...input.changes };
            expect((await client.callTool({ name: 'prepare_replace_or_remove_practice_blocks', arguments: { ...args, notes: 'hidden' } })).isError).toBe(true);
            expect((await client.callTool({ name: 'prepare_replace_or_remove_practice_blocks', arguments: args })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_practice_timeline', arguments: { proposalId: practiceUpdateId, confirmed: true } })).isError).toBe(true);
            expect((await client.callTool({ name: 'confirm_practice_timeline', arguments: { proposalId: practiceUpdateId } })).structuredContent.applied).toBe(false);
            approved = true; expect((await client.callTool({ name: 'confirm_practice_timeline', arguments: { proposalId: practiceUpdateId } })).structuredContent.status).toBe('completed');
        } finally { await client.close(); await server.close(); }
    });
});
