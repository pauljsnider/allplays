import { describe, expect, it, vi } from 'vitest';
import { rosterFixture } from '../helpers/direct-roster-fixture.js';
import { createDirectRosterBatchCommands } from '../../services/chatgpt-mcp/src/directRosterBatch.js';
import { DomainError } from '../../services/chatgpt-mcp/src/core.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';

const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const input = { proposalId, teamId: 'team-1', operations: [
    { mode: 'create', fields: { name: 'Synthetic New', number: '07' } },
    { mode: 'update', playerId: 'existing', fields: { position: '' } }
] };
const newPath = `teams/team-1/players/mcp_${proposalId}_0`;
const oldPath = 'teams/team-1/players/existing';
const accept = async () => ({ action: 'accept', content: { approve: true } });
const fixture = () => { const f = rosterFixture(); return { ...f, commands: createDirectRosterBatchCommands(f.dependencies) }; };

describe('atomic basic roster batches', () => {
    it('shows every row, applies a mixed batch once and preserves unselected private/status fields', async () => {
        const f = fixture(); const before = structuredClone(f.records.get(oldPath).data);
        const prepared = await f.commands.prepare(input);
        expect(prepared.preview.operations).toHaveLength(2); expect(JSON.stringify(prepared)).not.toContain('legacyContact');
        expect(f.records.has(newPath)).toBe(false);
        const approve = vi.fn(accept);
        expect(await f.commands.confirm({ proposalId }, approve)).toMatchObject({ status: 'completed', createdCount: 1, updatedCount: 1 });
        expect(f.records.get(newPath).data).toEqual({ name: 'Synthetic New', number: '07', active: true, createdAt: expect.any(Date) });
        expect(f.records.get(oldPath).data).toEqual({ ...before, position: '', updatedAt: expect.any(Date) });
        await f.commands.confirm({ proposalId }, approve); expect(approve).toHaveBeenCalledTimes(1);
        expect((await f.commands.prepare(input)).status).toBe('completed');
    });
    it.each([
        [], Array(21).fill(input.operations[0]),
        [input.operations[1], input.operations[1]],
        [{ mode: 'create', playerId: 'chosen', fields: { name: 'Synthetic' } }],
        [{ mode: 'create', fields: { number: '01' } }],
        [{ mode: 'update', playerId: 'existing', fields: { active: true } }],
        [{ mode: 'update', playerId: 'existing', fields: { familyContacts: [] } }],
        [{ mode: 'delete', playerId: 'existing', fields: { name: 'Synthetic' } }]
    ])('rejects unsupported batches before staging %#', async (operations) => {
        const f = fixture(); await expect(async () => f.commands.prepare({ ...input, operations })).rejects.toMatchObject({ code: 'invalid_argument' });
        expect(f.store.create).not.toHaveBeenCalled();
    });
    it('rejects duplicate resulting names within a batch and against inactive players', async () => {
        const f = fixture();
        for (const operations of [[input.operations[0], input.operations[0]], [{ mode: 'create', fields: { name: 'synthetic  EXISTING' } }]]) {
            await expect(f.commands.prepare({ ...input, operations })).rejects.toMatchObject({ code: 'ambiguous_player' });
        }
        expect(f.store.create).not.toHaveBeenCalled();
    });
    it('allows atomic name swaps while unrelated preexisting duplicates do not block exact-ID number edits', async () => {
        const f = fixture(); f.put('teams/team-1/players/second', { name: 'Second' });
        const operations = [{ mode: 'update', playerId: 'existing', fields: { name: 'Second' } }, { mode: 'update', playerId: 'second', fields: { name: 'Synthetic Existing' } }];
        await f.commands.prepare({ ...input, operations }); await f.commands.confirm({ proposalId }, accept);
        expect(f.records.get(oldPath).data.name).toBe('Second');
        const other = fixture(); other.put('teams/team-1/players/duplicate', { name: 'Synthetic Existing' });
        await expect(other.commands.prepare({ ...input, operations: [input.operations[1]] })).resolves.toMatchObject({ status: 'prepared' });
    });
    it('rejects missing exact IDs and batches exceeding the final roster bound', async () => {
        const f = fixture(); await expect(f.commands.prepare({ ...input, operations: [{ ...input.operations[1], playerId: 'missing' }] })).rejects.toMatchObject({ code: 'not_found' });
        for (let i = 0; i < 199; i++) f.put(`teams/team-1/players/p${i}`, { name: `Synthetic ${i}` });
        await expect(f.commands.prepare(input)).rejects.toMatchObject({ code: 'unsupported_roster' });
    });
    it.each(['decline', 'cancel', 'implicit'])('does not execute on %s confirmation', async (action) => {
        const f = fixture(); await f.commands.prepare(input);
        await f.commands.confirm({ proposalId }, async () => action === 'implicit' ? { action: 'accept', content: {} } : { action });
        expect(f.records.has(newPath)).toBe(false); expect(f.records.get(oldPath).data.position).toBe('Forward');
    });
    it.each(['roster', 'permission', 'identity', 'expiry', 'approval'])('does not partially apply after %s changes during confirmation', async (change) => {
        const f = fixture(); await f.commands.prepare(input);
        await expect(f.commands.confirm({ proposalId }, async () => {
            if (change === 'roster') f.put('teams/team-1/players/concurrent', { name: 'Other' });
            if (change === 'permission') f.context.teams.clear();
            if (change === 'identity') f.context.uid = 'other';
            if (change === 'expiry') f.expire();
            return { ...await accept(), consume: async () => { if (change === 'approval') throw new DomainError('confirmation_expired', 'Expired'); } };
        })).rejects.toThrow();
        expect(f.records.has(newPath)).toBe(false); expect(f.records.get(oldPath).data.position).toBe('Forward');
    });
    it('rejects reordered or changed reuse of a proposal UUID', async () => {
        const f = fixture(); await f.commands.prepare(input);
        await expect(f.commands.prepare({ ...input, operations: [...input.operations].reverse() })).rejects.toMatchObject({ code: 'conflict' });
    });
    it('reconciles a lost commit response and refuses replacement on unverified failure', async () => {
        const f = fixture(); await f.commands.prepare(input);
        const transaction = f.store.transaction.getMockImplementation();
        f.store.transaction.mockImplementation(async (...args) => { await transaction(...args); throw new Error('Lost response'); });
        expect(await f.commands.confirm({ proposalId }, accept)).toMatchObject({ status: 'completed' });
        const unknown = fixture(); await unknown.commands.prepare(input);
        unknown.store.transaction.mockRejectedValue(new Error('Unknown transport failure'));
        await expect(unknown.commands.confirm({ proposalId }, accept)).rejects.toMatchObject({ code: 'outcome_unknown' });
        expect(unknown.records.has(newPath)).toBe(false); expect(unknown.records.get(oldPath).data.position).toBe('Forward');
    });
    it('exposes one batch approval through the SDK and rejects model-supplied confirmation', async () => {
        const f = fixture(); const server = createDirectFavoriteMcpSession({ ...f.dependencies, rosterBatchStore: f.store });
        const client = new Client({ name: 'synthetic', version: '1' }, { capabilities: { elicitation: { form: {} } } });
        const approvals = []; client.setRequestHandler(ElicitRequestSchema, async (request) => { approvals.push(request.params.message); return accept(); });
        const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
        try {
            expect((await client.callTool({ name: 'prepare_roster_batch', arguments: input })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_roster_batch', arguments: { proposalId, confirmed: true } })).isError).toBe(true);
            expect((await client.callTool({ name: 'confirm_roster_batch', arguments: { proposalId } })).structuredContent.status).toBe('completed');
            expect(approvals).toHaveLength(1); expect(approvals[0]).toContain('Synthetic New'); expect(approvals[0]).toContain('Synthetic Existing');
        } finally { await client.close(); await server.close(); }
    });
});
