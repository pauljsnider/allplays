import { describe, expect, it, vi } from 'vitest';
import { rosterFixture } from '../helpers/direct-roster-fixture.js';
import { createTestActionAuthority } from '../helpers/direct-test-authority.js';
import { createDirectTrackingItemCommands, createDirectTrackingItemStore } from '../../services/chatgpt-mcp/src/directTrackingItem.js';
import { createDirectDiscovery } from '../../services/chatgpt-mcp/src/directDiscovery.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const input = { proposalId, mode: 'create', teamId: 'team-1', itemId: `mcp_${proposalId}`, changes: { name: 'Synthetic equipment checklist', description: 'Staff preparation' } };
const path = `teams/team-1/trackingItems/${input.itemId}`;
const existingPath = 'teams/team-1/trackingItems/existing';
const header = `users/owner/privateAiPendingActions/direct_${proposalId}`;
const accept = async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} });
const existing = { teamId: 'team-1', name: 'Existing item', description: 'Preserve this', visibility: 'private', status: 'active', active: true, archived: false,
    createdAt: new Date('2020-01-01T00:00:00Z'), createdBy: 'previous-owner', updatedAt: new Date('2020-01-01T00:00:00Z'), updatedBy: 'previous-owner' };
function fixture() {
    const f = rosterFixture(); f.put(existingPath, existing);
    return { ...f, commands: createDirectTrackingItemCommands(f.dependencies) };
}
describe('private tracking item create/update commands', () => {
    it('creates the real app/rules schema once after explicit approval', async () => {
        const f = fixture(); const prepared = await f.commands.prepare(input);
        expect(prepared.preview).toMatchObject({ before: null, after: input.changes, visibility: 'private', status: 'active' }); expect(f.records.has(path)).toBe(false);
        await f.commands.confirm({ proposalId }, accept);
        expect(f.records.get(path).data).toEqual({ teamId: 'team-1', ...input.changes, visibility: 'private', status: 'active', active: true, archived: false,
            createdBy: 'owner', updatedBy: 'owner', createdAt: expect.any(Date), updatedAt: expect.any(Date) });
        await f.commands.confirm({ proposalId }, () => { throw new Error('No repeat approval'); }); expect(f.store.transaction).toHaveBeenCalledTimes(1);
    });
    it('patches only selected text and preserves creation audit and completion data', async () => {
        const f = fixture(); const status = `${existingPath}/memberTracking/player`; f.put(status, { complete: true, completedBy: 'owner' });
        await f.commands.prepare({ ...input, mode: 'update', itemId: 'existing', changes: { description: '' } });
        await f.commands.confirm({ proposalId }, accept);
        expect(f.records.get(existingPath).data).toEqual({ ...existing, description: '', updatedBy: 'owner', updatedAt: expect.any(Date) });
        expect(f.records.get(status).data).toEqual({ complete: true, completedBy: 'owner' });
    });
    it.each([{ visibility: 'public' }, { status: 'archived' }, { active: false }, { dueDate: '2030-01-01' }, { title: 'Unsupported' }, {}, { name: '' }, { name: ' padded ' }, { description: null }, { name: 'x'.repeat(121) }, { description: 'x'.repeat(2001) }, { description: 'unsafe\ncontrol' }])('rejects unsupported or malformed fields %#', async (changes) => {
        const f = fixture(); await expect(f.commands.prepare({ ...input, changes })).rejects.toMatchObject({ code: 'invalid_argument' }); expect(f.store.create).not.toHaveBeenCalled();
    });
    it.each([{ visibility: 'public' }, { status: 'archived', active: false, archived: true }, { teamId: 'other' }, { legacy: true }, { createdBy: null }, { createdAt: null }])('refuses unsupported existing item %#', async (changed) => {
        const f = fixture(); f.put(existingPath, { ...existing, ...changed });
        await expect(f.commands.prepare({ ...input, mode: 'update', itemId: 'existing', changes: { name: 'Changed' } })).rejects.toMatchObject({ code: 'unsupported_tracking_item' });
    });
    it('checks duplicates across archived/public/legacy names and refuses an incomplete bounded list', async () => {
        const f = fixture();
        for (const data of [{ name: 'SYNTHETIC  equipment checklist', status: 'archived' }, { title: input.changes.name, visibility: 'public' }, { label: input.changes.name }]) {
            f.put('teams/team-1/trackingItems/duplicate', data); await expect(f.commands.prepare(input)).rejects.toMatchObject({ code: 'ambiguous_tracking_item' });
        }
        f.records.delete('teams/team-1/trackingItems/duplicate'); f.store.list.mockResolvedValue(Array.from({ length: 201 }, (_, index) => ({ id: `i${index}`, data: {}, version: `v${index}` })));
        await expect(f.commands.prepare(input)).rejects.toMatchObject({ code: 'unsupported_tracking_list' });
    });
    it.each(['decline', 'cancel'])('does not apply a %s response', async (action) => {
        const f = fixture(); await f.commands.prepare(input); expect(await f.commands.confirm({ proposalId }, async () => ({ action }))).toMatchObject({ applied: false }); expect(f.records.has(path)).toBe(false);
    });
    it.each(['team', 'item', 'duplicate', 'permission', 'expiry'])('fails closed after %s changes during confirmation', async (kind) => {
        const f = fixture(); await f.commands.prepare(input);
        await expect(f.commands.confirm({ proposalId }, async () => {
            if (kind === 'team') f.put('teams/team-1', { name: 'Changed team' });
            if (kind === 'item') f.put(path, { name: 'Competing item' });
            if (kind === 'duplicate') f.put('teams/team-1/trackingItems/concurrent', { name: input.changes.name });
            if (kind === 'permission') f.context.teams.clear();
            if (kind === 'expiry') f.expire();
            return accept();
        })).rejects.toThrow(); expect(f.records.get(path)?.data.name).not.toBe(input.changes.name);
    });
    it('requires a bound one-use authority and rejects altered preview content', async () => {
        const f = fixture(); await f.commands.prepare(input);
        await expect(f.commands.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true } }))).rejects.toThrow();
        const row = f.records.get(header).data; row.preview.after.name = 'Unapproved';
        await expect(f.commands.confirm({ proposalId }, accept)).rejects.toThrow(); expect(f.store.transaction).not.toHaveBeenCalled();
    });
    it('reconciles a lost committed response without a duplicate item and reauthorizes results', async () => {
        const f = fixture(); await f.commands.prepare(input); const transaction = f.store.transaction.getMockImplementation();
        f.store.transaction.mockImplementation(async (...args) => { await transaction(...args); throw new Error('Synthetic lost response'); });
        expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed');
        expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed'); expect(f.store.transaction).toHaveBeenCalledTimes(1);
        f.context.teams.clear(); await expect(f.commands.status({ proposalId })).rejects.toThrow();
    });
    it('restricts the REST adapter from completion records, other domains and visibility patches', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ transaction: 'synthetic' })));
        const store = createDirectTrackingItemStore({ projectId: 'demo-allplays-mcp-review', uid: 'owner', idToken: 'synthetic', fetchImpl });
        await expect(store.get(`${existingPath}/memberTracking/player`)).rejects.toThrow(); expect(fetchImpl).not.toHaveBeenCalled();
        for (const data of [{ visibility: 'public' }, { status: 'archived' }, { createdBy: 'other' }]) {
            await expect(store.transaction(async (tx) => tx.patch(existingPath, { ...data, updatedAt: new Date(), updatedBy: 'owner' }))).rejects.toThrow();
        }
        expect(fetchImpl.mock.calls.every(([url]) => !url.endsWith(':commit'))).toBe(true);
    });
    it('discovers only bounded names, IDs and state without descriptions or player completions', async () => {
        const f = fixture(); const query = { select: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), startAfterDocumentId: vi.fn().mockReturnThis(), get: async () => ({ docs: [
            { id: 'one', data: () => ({ ...existing, description: 'Do not return', memberTracking: 'Do not return' }) }, { id: 'two', data: () => existing }
        ] }) };
        const discovery = createDirectDiscovery({ ...f.dependencies, getDb: async () => ({ collection: () => query }) });
        const result = await discovery.trackingItems({ teamId: 'team-1', limit: 1 }); expect(result.hasMore).toBe(true); expect(result.nextCursor).toBe('one');
        expect(JSON.stringify(result)).not.toContain('Do not return'); expect(query.select).toHaveBeenCalledWith('name', 'title', 'label', 'visibility', 'status', 'active', 'archived');
        f.context.teams.clear(); await expect(discovery.trackingItems({ teamId: 'team-1' })).rejects.toThrow();
    });
    it('runs prepare and confirm through actual MCP form elicitation and rejects conversational flags', async () => {
        const f = fixture(); const server = createDirectFavoriteMcpSession({ ...f.dependencies, trackingItemStore: f.store, authorizeAction: createTestActionAuthority() });
        const client = new Client({ name: 'isolated', version: '1' }, { capabilities: { elicitation: { form: {} } } }); let forms = 0;
        client.setRequestHandler(ElicitRequestSchema, async () => { forms++; return { action: 'accept', content: { approve: true } }; });
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair(); await server.connect(serverTransport); await client.connect(clientTransport);
        try {
            expect((await client.callTool({ name: 'prepare_create_tracking_item', arguments: { proposalId, teamId: input.teamId, changes: input.changes } })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_tracking_item', arguments: { proposalId, confirmed: true } })).isError).toBe(true); expect(f.records.has(path)).toBe(false);
            expect((await client.callTool({ name: 'confirm_tracking_item', arguments: { proposalId } })).structuredContent.status).toBe('completed'); expect(forms).toBe(1);
        } finally { await client.close(); await server.close(); }
    });
});
