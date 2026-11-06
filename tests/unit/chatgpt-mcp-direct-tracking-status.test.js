import { describe, expect, it, vi } from 'vitest';
import { rosterFixture } from '../helpers/direct-roster-fixture.js';
import { createTestActionAuthority } from '../helpers/direct-test-authority.js';
import { buildTrackingStatusPayload, mergeTrackingStatusRows } from '../../js/tracking-status-admin.js';
import { createDirectTrackingStatusCommands, createDirectTrackingStatusStore } from '../../services/chatgpt-mcp/src/directTrackingStatus.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const secondId = '00112233-4455-4677-8899-aabbccddeeaa';
const input = { proposalId, teamId: 'team-1', itemId: 'item', playerId: 'existing', complete: true };
const itemPath = 'teams/team-1/trackingItems/item';
const playerPath = 'teams/team-1/players/existing';
const path = `${itemPath}/memberTracking/existing`;
const header = `users/owner/privateAiPendingActions/direct_${proposalId}`;
const accept = async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} });
const item = { teamId: 'team-1', name: 'Private requirement', description: '', visibility: 'private', status: 'active', active: true, archived: false,
    createdAt: new Date('2020-01-01'), createdBy: 'owner', updatedAt: new Date('2020-01-01'), updatedBy: 'owner' };
function fixture() {
    const f = rosterFixture(); f.put(itemPath, item); f.put(playerPath, { name: 'Synthetic Player', number: '07', active: true, contact: 'excluded' });
    return { ...f, commands: createDirectTrackingStatusCommands(f.dependencies) };
}
describe('private player tracking completion', () => {
    it('matches the actual shared app payload and read model for complete and incomplete', async () => {
        const f = fixture(); const player = { id: input.playerId, ...f.records.get(playerPath).data };
        for (const [id, complete] of [[proposalId, true], [secondId, false]]) {
            const prepared = await f.commands.prepare({ ...input, proposalId: id, complete });
            expect(prepared.preview).toMatchObject({ playerName: player.name, itemName: item.name, complete });
            expect(JSON.stringify(prepared)).not.toContain('excluded');
            await f.commands.confirm({ proposalId: id }, accept);
            const data = f.records.get(path).data;
            expect(data).toEqual({ ...buildTrackingStatusPayload({ teamId: input.teamId, itemId: input.itemId, player, complete, actorId: 'owner', actorEmail: null }), updatedAt: expect.any(Date) });
            expect(mergeTrackingStatusRows([player], [{ id: input.playerId, ...data }])[0].complete).toBe(complete);
        }
        expect(f.records.get(itemPath).data).toEqual(item); const { id, ...originalPlayer } = player; expect(f.records.get(playerPath).data).toEqual(originalPlayer);
    });
    it.each(['decline', 'cancel'])('does not save after %s', async (action) => {
        const f = fixture(); await f.commands.prepare(input); await f.commands.confirm({ proposalId }, async () => ({ action })); expect(f.records.has(path)).toBe(false);
    });
    it.each([undefined, 'true', 1, null])('requires an explicit boolean %#', async (complete) => {
        const f = fixture(); await expect(f.commands.prepare({ ...input, complete })).rejects.toMatchObject({ code: 'invalid_argument' });
    });
    it.each([{ visibility: 'public' }, { active: false, archived: true, status: 'archived' }, { teamId: 'other' }, { dueDate: '2030-01-01' }])('refuses unsupported item %#', async (changes) => {
        const f = fixture(); f.put(itemPath, { ...item, ...changes }); await expect(f.commands.prepare(input)).rejects.toThrow(); expect(f.store.create).not.toHaveBeenCalled();
    });
    it.each([{ active: false }, { name: '' }, { name: ' padded ' }, { number: 7 }])('refuses unsupported player %#', async (changes) => {
        const f = fixture(); f.put(playerPath, { ...f.records.get(playerPath).data, ...changes }); await expect(f.commands.prepare(input)).rejects.toMatchObject({ code: 'unsupported_player' });
    });
    it.each([{ complete: true }, { status: 'incomplete' }, { note: 'Preserve private note' }, { teamId: 'other' }, { playerId: 'other' }, { updatedAt: null }])('preserves and refuses legacy or conflicting completion %#', async (changes) => {
        const f = fixture(); const original = { ...buildTrackingStatusPayload({ teamId: input.teamId, itemId: input.itemId, player: { id: input.playerId, name: 'Previous', number: '' }, complete: true, actorId: 'owner' }), updatedAt: new Date(), ...changes };
        if (Object.keys(changes).length === 1 && changes.complete === true) delete original.status;
        f.put(path, original); await expect(f.commands.prepare(input)).rejects.toMatchObject({ code: 'unsupported_tracking_status' }); expect(f.records.get(path).data).toEqual(original);
    });
    it.each(['team', 'item', 'player', 'status', 'permission', 'expiry'])('rejects %s changes during confirmation', async (kind) => {
        const f = fixture(); await f.commands.prepare(input);
        await expect(f.commands.confirm({ proposalId }, async () => {
            if (kind === 'team') f.put('teams/team-1', { name: 'Changed' });
            if (kind === 'item') f.put(itemPath, { ...item, visibility: 'public' });
            if (kind === 'player') f.put(playerPath, { name: 'Changed', number: '09', active: true });
            if (kind === 'status') f.put(path, { complete: false });
            if (kind === 'permission') f.context.teams.clear();
            if (kind === 'expiry') f.expire();
            return accept();
        })).rejects.toThrow(); expect(f.records.get(path)?.data.complete).not.toBe(true);
    });
    it('requires one-use authority and binds exactly the approved intent', async () => {
        const f = fixture(); await f.commands.prepare(input);
        await expect(f.commands.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true } }))).rejects.toThrow();
        f.records.get(header).data.preview.complete = false;
        await expect(f.commands.confirm({ proposalId }, accept)).rejects.toThrow(); expect(f.records.has(path)).toBe(false);
    });
    it('reconciles a lost response without repeating the write and reauthorizes status', async () => {
        const f = fixture(); await f.commands.prepare(input); const original = f.store.transaction.getMockImplementation();
        f.store.transaction.mockImplementation(async (...args) => { await original(...args); throw new Error('Synthetic lost response'); });
        expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed');
        expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed'); expect(f.store.transaction).toHaveBeenCalledTimes(1);
        f.context.teams.clear(); await expect(f.commands.status({ proposalId })).rejects.toThrow();
    });
    it('restricts adapter paths and rejects visibility, contacts and forged audit patches', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ transaction: 'synthetic' })));
        const store = createDirectTrackingStatusStore({ projectId: 'demo-allplays-mcp-review', uid: 'owner', idToken: 'synthetic', fetchImpl });
        await expect(store.get('users/other')).rejects.toThrow(); expect(fetchImpl).not.toHaveBeenCalled();
        for (const [target, data] of [[itemPath, { visibility: 'public' }], [playerPath, { name: 'Changed' }], [path, { complete: true, status: 'complete', updatedBy: 'other', updatedAt: new Date() }], [path, { complete: true, status: 'complete', updatedBy: 'owner', updatedByEmail: null, updatedAt: new Date(), note: 'Hidden' }]]) {
            await expect(store.transaction(async (tx) => tx.patch(target, data))).rejects.toThrow();
        }
        expect(fetchImpl.mock.calls.every(([url]) => !url.endsWith(':commit'))).toBe(true);
    });
    it('uses actual MCP form elicitation and rejects a conversational confirmed flag', async () => {
        const f = fixture(); const server = createDirectFavoriteMcpSession({ ...f.dependencies, trackingStatusStore: f.store, authorizeAction: createTestActionAuthority() });
        const client = new Client({ name: 'isolated', version: '1' }, { capabilities: { elicitation: { form: {} } } }); let forms = 0;
        client.setRequestHandler(ElicitRequestSchema, async () => { forms++; return { action: 'accept', content: { approve: true } }; });
        const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
        try {
            expect((await client.callTool({ name: 'prepare_player_tracking_status', arguments: input })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_player_tracking_status', arguments: { proposalId, confirmed: true } })).isError).toBe(true); expect(f.records.has(path)).toBe(false);
            expect((await client.callTool({ name: 'confirm_player_tracking_status', arguments: { proposalId } })).structuredContent.status).toBe('completed'); expect(forms).toBe(1);
        } finally { await client.close(); await server.close(); }
    });
});
