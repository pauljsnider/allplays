import { describe, expect, it, vi } from 'vitest';
import { createDirectRosterCommands, createDirectRosterStore } from '../../services/chatgpt-mcp/src/directRoster.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';

const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const updateId = '00112233-4455-4677-8899-aabbccddeeaa';
const input = { proposalId, mode: 'create', teamId: 'team-1', playerId: `mcp_${proposalId}`, fields: { name: 'Synthetic New Player' } };
const path = `teams/team-1/players/${input.playerId}`;
const proposalPath = `users/owner/privateAiPendingActions/direct_${proposalId}`;
const accepted = () => ({ action: 'accept', content: { approve: true }, consume: vi.fn() });
function fixture() {
    const records = new Map(); let revision = 0; let clock = Date.now();
    const put = (key, data) => records.set(key, { exists: true, data: structuredClone(data), version: `v${++revision}` });
    put('teams/team-1', { name: 'Synthetic Team' });
    put('teams/team-1/players/existing', { name: 'Synthetic Existing', number: '00', position: 'Forward', active: false, legacyContact: 'excluded' });
    const context = { uid: 'owner', teams: new Map([['team-1', { team: { name: 'Synthetic Team' }, roles: new Set(['owner']) }]]) };
    const store = {
        get: vi.fn(async (key) => structuredClone(records.get(key) || { exists: false, version: null, data: null })),
        list: vi.fn(async (collection) => [...records].filter(([key]) => key.startsWith(`${collection}/`)).map(([key, value]) => ({ ...structuredClone(value), id: key.split('/').at(-1) }))),
        create: vi.fn(async (key, data) => { if (records.has(key)) throw new Error('exists'); put(key, data); }),
        transaction: vi.fn(async (callback, { beforeCommit } = {}) => {
            const writes = [];
            const result = await callback({ get: store.get, list: store.list,
                set: (key, data) => writes.push(() => put(key, data)),
                patch: (key, data) => writes.push(() => put(key, { ...records.get(key).data, ...data })) });
            if (writes.length) await beforeCommit?.(); writes.forEach((write) => write()); return result;
        })
    };
    const query = { select: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), get: async () => ({ docs: (await store.list('teams/team-1/players')).map((row) => ({ id: row.id, data: () => row.data })) }) };
    const dependencies = { uid: 'owner', store, rosterStore: store, getContext: async () => context, getDb: async () => ({ collection: () => query }), now: () => clock };
    return { records, put, context, store, dependencies, commands: createDirectRosterCommands(dependencies), expire: () => { clock += 300001; } };
}

describe('single-player direct roster commands', () => {
    it('creates a name-only active player exactly once after approval, without contact or invitation fields', async () => {
        const f = fixture(); const proposal = await f.commands.prepare(input);
        expect(proposal.preview).toMatchObject({ before: null, changes: input.fields, active: true });
        expect(f.records.has(path)).toBe(false);
        const answer = accepted(); const approve = vi.fn(async () => answer);
        expect(await f.commands.confirm({ proposalId }, approve)).toMatchObject({ status: 'completed', playerId: input.playerId });
        expect(f.records.get(path).data).toEqual({ name: input.fields.name, active: true, createdAt: expect.any(Date) });
        expect(answer.consume).toHaveBeenCalledTimes(1);
        await f.commands.confirm({ proposalId }, approve); expect(approve).toHaveBeenCalledTimes(1);
    });
    it('updates only provided fields and preserves inactivity, number formatting and legacy private fields', async () => {
        const f = fixture();
        const before = structuredClone(f.records.get('teams/team-1/players/existing').data);
        const result = await f.commands.prepare({ ...input, mode: 'update', playerId: 'existing', fields: { position: '' } });
        expect(JSON.stringify(result)).not.toContain('legacyContact');
        expect(result.preview).toMatchObject({ before: { number: '00' }, active: false, changes: { position: '' } });
        await f.commands.confirm({ proposalId }, async () => accepted());
        expect(f.records.get('teams/team-1/players/existing').data).toEqual({ ...before, position: '', updatedAt: expect.any(Date) });
    });
    it.each([{ active: false }, { familyContacts: [] }, { parentEmail: 'test@example.test' }, { photoUrl: 'https://example.test/a' }, {}, { name: '' }, { name: ' Synthetic ' }, { number: 7 }])('rejects unsupported or ambiguous fields %j', async (fields) => {
        const f = fixture(); await expect(f.commands.prepare({ ...input, fields })).rejects.toMatchObject({ code: 'invalid_argument' });
        expect(f.store.create).not.toHaveBeenCalled();
    });
    it('blocks matching inactive names, refuses oversized rosters and never substitutes a name for an ID', async () => {
        const f = fixture();
        await expect(f.commands.prepare({ ...input, fields: { name: 'synthetic  EXISTING' } })).rejects.toMatchObject({ code: 'ambiguous_player' });
        await expect(f.commands.prepare({ ...input, mode: 'update', playerId: 'not-existing' })).rejects.toMatchObject({ code: 'not_found' });
        f.store.list.mockResolvedValue(Array.from({ length: 201 }, (_, index) => ({ id: `p${index}`, data: {}, version: `v${index}` })));
        await expect(f.commands.prepare(input)).rejects.toMatchObject({ code: 'unsupported_roster' });
    });
    it.each(['decline', 'cancel'])('does not write on %s', async (action) => {
        const f = fixture(); await f.commands.prepare(input);
        expect(await f.commands.confirm({ proposalId }, async () => ({ action }))).toMatchObject({ applied: false });
        expect(f.records.has(path)).toBe(false);
    });
    it.each(['new-row', 'target', 'permission', 'expiry'])('rechecks %s during confirmation', async (change) => {
        const f = fixture(); await f.commands.prepare(input);
        await expect(f.commands.confirm({ proposalId }, async () => {
            if (change === 'new-row') f.put('teams/team-1/players/concurrent', { name: 'Another synthetic player' });
            if (change === 'target') f.put(path, { name: 'Competing creation' });
            if (change === 'permission') f.context.teams.clear();
            if (change === 'expiry') f.expire();
            return accepted();
        })).rejects.toThrow();
        expect(f.records.get(path)?.data.name).not.toBe(input.fields.name);
    });
    it('accepts opaque completion receipts after expiry, reauthorizes reads, and rejects cross-domain receipts', async () => {
        const f = fixture(); await f.commands.prepare(input);
        const record = f.records.get(proposalPath).data;
        f.put(proposalPath, { userId: 'owner', toolName: record.toolName, digest: record.digest, teamId: 'team-1', playerId: input.playerId, mode: 'create', status: 'completed', receiptOnly: true });
        f.expire(); const approve = vi.fn();
        expect(await f.commands.confirm({ proposalId }, approve)).toEqual({ proposalId, status: 'completed', mode: 'create', teamId: 'team-1', playerId: input.playerId });
        expect(approve).not.toHaveBeenCalled();
        f.put(proposalPath, { ...f.records.get(proposalPath).data, toolName: 'mcp_direct_favorite' });
        await expect(f.commands.status({ proposalId })).rejects.toMatchObject({ code: 'not_found' });
        f.context.teams.clear(); await expect(f.commands.status({ proposalId })).rejects.toThrow();
    });
    it('discovers and executes create/update through SDK confirmation, refusing confirmed flags and contacts', async () => {
        const f = fixture(); const server = createDirectFavoriteMcpSession(f.dependencies);
        const client = new Client({ name: 'synthetic', version: '1' }, { capabilities: { elicitation: { form: {} } } });
        const approvals = []; client.setRequestHandler(ElicitRequestSchema, async (request) => { approvals.push(request.params.message); return accepted(); });
        const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
        try {
            const page = await client.callTool({ name: 'get_team_roster', arguments: { teamId: 'team-1' } });
            expect(page.structuredContent.players[0]).toMatchObject({ id: 'existing', active: false, number: '00' });
            expect(JSON.stringify(page)).not.toContain('legacyContact');
            const args = { proposalId, teamId: 'team-1', fields: input.fields };
            expect((await client.callTool({ name: 'prepare_create_roster_player', arguments: { ...args, confirmed: true } })).isError).toBe(true);
            expect((await client.callTool({ name: 'prepare_create_roster_player', arguments: { ...args, fields: { ...input.fields, familyContacts: [] } } })).isError).toBe(true);
            expect((await client.callTool({ name: 'prepare_create_roster_player', arguments: args })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_roster_player', arguments: { proposalId } })).structuredContent.status).toBe('completed');
            expect((await client.callTool({ name: 'prepare_update_roster_player', arguments: { proposalId: updateId, teamId: 'team-1', playerId: input.playerId, fields: { number: '07' } } })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_roster_player', arguments: { proposalId: updateId } })).structuredContent.status).toBe('completed');
            expect(f.records.get(path).data.number).toBe('07'); expect(approvals).toHaveLength(2);
        } finally { await client.close(); await server.close(); }
    });
    it('keeps names only in the team companion and denies private-path/query injection', async () => {
        const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
        const store = createDirectRosterStore({ projectId: 'demo-synthetic', uid: 'owner', idToken: 'synthetic', fetchImpl });
        await store.create(proposalPath, { userId: 'owner', toolName: 'mcp_direct_roster_player', teamId: 'team-1', playerId: input.playerId, mode: 'create', digest: 'a'.repeat(64), status: 'prepared', fields: input.fields, preview: { after: input.fields }, expiresAt: new Date(Date.now() + 300000).toISOString() });
        const writes = JSON.parse(fetchImpl.mock.calls[0][1].body).writes;
        expect(writes).toHaveLength(2); expect(JSON.stringify(writes[0])).not.toContain(input.fields.name);
        expect(JSON.stringify(writes[1])).toContain(input.fields.name); expect(writes[1].update.fields.status.stringValue).toBe('pending');
        await expect(store.get('teams/team-1/players/p/private/profile')).rejects.toMatchObject({ code: 'permission_denied' });
        await expect(store.list('teams/team-1/accessCodes')).rejects.toMatchObject({ code: 'permission_denied' });
    });
});
