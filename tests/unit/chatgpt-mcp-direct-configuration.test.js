import { describe, expect, it, vi } from 'vitest';
import { createDirectStatConfigurationCommands, createDirectStatConfigurationStore, cloneableConfiguration } from '../../services/chatgpt-mcp/src/directStatConfiguration.js';
import { createDirectFavoriteCommands } from '../../services/chatgpt-mcp/src/directFavorite.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { createDirectDiscovery } from '../../services/chatgpt-mcp/src/directDiscovery.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';

const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const renameId = '00112233-4455-4677-8899-aabbccddeeaa';
const input = { proposalId, mode: 'clone', teamId: 'team-1', sourceConfigId: 'source', configId: `mcp_${proposalId}`, name: 'New configuration' };
const sourcePath = 'teams/team-1/statTrackerConfigs/source';
const targetPath = `teams/team-1/statTrackerConfigs/${input.configId}`;
const proposalPath = `users/owner/privateAiPendingActions/direct_${proposalId}`;
const accepted = () => ({ action: 'accept', content: { approve: true }, consume: vi.fn() });
const source = {
    name: 'Synthetic source', baseType: 'Basketball', columns: ['PTS', 'PRIVATE'], scoringColumn: 'PTS',
    statDefinitions: [{ id: 'pts', label: 'Points', scope: 'player', visibility: 'public', type: 'base', formula: null, topStat: true },
        { id: 'private', label: 'Private', scope: 'player', visibility: 'private', type: 'derived', formula: 'PTS/2', topStat: false }],
    createdAt: new Date(0)
};
function fixture() {
    const records = new Map(); let revision = 0; let clock = Date.now();
    const put = (path, data) => records.set(path, { exists: true, data: structuredClone(data), version: `v${++revision}` });
    put('teams/team-1', { name: 'Synthetic team' }); put(sourcePath, source);
    const context = { uid: 'owner', teams: new Map([['team-1', { team: { name: 'Synthetic team', privateContact: 'excluded' }, roles: new Set(['owner']) }]]) };
    const store = {
        get: vi.fn(async (path) => structuredClone(records.get(path) || { exists: false, data: null, version: null })),
        create: vi.fn(async (path, data) => { if (records.has(path)) throw new Error('exists'); put(path, data); }),
        transaction: vi.fn(async (callback, { beforeCommit } = {}) => {
            const writes = [];
            const result = await callback({ get: store.get,
                set: (path, data) => writes.push(() => put(path, data)),
                patch: (path, data) => writes.push(() => put(path, { ...records.get(path).data, ...data })) });
            if (writes.length) await beforeCommit?.(); writes.forEach((write) => write()); return result;
        })
    };
    const query = { select: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockReturnThis(), startAfterDocumentId: vi.fn().mockReturnThis(), get: vi.fn(async () => ({ docs: [{ id: 'source', data: () => source }] })) };
    const dependencies = { uid: 'owner', store, statConfigurationStore: store, getContext: async () => context, now: () => clock, getDb: async () => ({ collection: () => query }) };
    return { records, put, context, store, query, dependencies, commands: createDirectStatConfigurationCommands(dependencies), expire: () => { clock += 300001; } };
}

describe('bounded configuration create and update', () => {
    it('clones once after exact approval, preserving schema, without modifying the source or assigning games', async () => {
        const f = fixture(); const prepared = await f.commands.prepare(input);
        expect(prepared.preview.configuration).toEqual({ ...cloneableConfiguration(source), name: input.name });
        expect(f.records.has(targetPath)).toBe(false);
        const answer = accepted(); const approve = vi.fn(async () => answer);
        expect(await f.commands.confirm({ proposalId }, approve)).toMatchObject({ status: 'completed', configId: input.configId });
        expect(answer.consume).toHaveBeenCalledTimes(1);
        expect(f.records.get(targetPath).data).toMatchObject({ name: input.name, statDefinitions: source.statDefinitions, scoringColumn: 'PTS' });
        expect(f.records.get(sourcePath).data).toEqual(source);
        expect([...f.records.keys()].some((path) => path.includes('/games/'))).toBe(false);
        expect(await f.commands.confirm({ proposalId }, approve)).toMatchObject({ status: 'completed' });
        expect(approve).toHaveBeenCalledTimes(1); expect(f.store.transaction).toHaveBeenCalledTimes(1);
    });
    it('renames using a patch that preserves unknown extensions, private definitions and timestamps', async () => {
        const f = fixture(); f.put(sourcePath, { ...source, futureSetting: { opaque: true } });
        await f.commands.prepare({ proposalId, mode: 'rename', teamId: 'team-1', configId: 'source', name: 'Renamed' });
        await f.commands.confirm({ proposalId }, async () => accepted());
        expect(f.records.get(sourcePath).data).toEqual({ ...source, futureSetting: { opaque: true }, name: 'Renamed', updatedAt: expect.any(Date) });
    });
    it.each(['decline', 'cancel', 'false'])('does not create for %s approval', async (action) => {
        const f = fixture(); await f.commands.prepare(input);
        expect(await f.commands.confirm({ proposalId }, async () => ({ action: action === 'false' ? 'accept' : action, content: { approve: false } }))).toMatchObject({ applied: false });
        expect(f.records.has(targetPath)).toBe(false); expect(f.store.transaction).not.toHaveBeenCalled();
    });
    it.each(['source', 'target', 'team', 'permission', 'actor', 'expiry', 'proposal'])('blocks %s changes during approval', async (change) => {
        const f = fixture(); await f.commands.prepare(input);
        await expect(f.commands.confirm({ proposalId }, async () => {
            if (change === 'source') f.put(sourcePath, { ...source, columns: ['CHANGED'] });
            if (change === 'target') f.put(targetPath, { name: 'Competing creation' });
            if (change === 'team') f.put('teams/team-1', { name: 'Changed' });
            if (change === 'permission') f.context.teams.clear();
            if (change === 'actor') f.context.uid = 'other';
            if (change === 'expiry') f.expire();
            if (change === 'proposal') f.put(proposalPath, { ...f.records.get(proposalPath).data, name: 'Changed' });
            return accepted();
        })).rejects.toThrow();
        expect(f.records.get(targetPath)?.data.name).not.toBe(input.name);
    });
    it('reconciles lost commits and keeps unknown outcomes on the same proposal ID', async () => {
        const f = fixture(); await f.commands.prepare(input);
        const transaction = f.store.transaction.getMockImplementation();
        f.store.transaction.mockImplementation(async (callback, options) => { await transaction(callback, options); throw new Error('lost'); });
        expect(await f.commands.confirm({ proposalId }, async () => accepted())).toMatchObject({ status: 'completed' });
        const g = fixture(); await g.commands.prepare(input);
        g.store.transaction.mockImplementation(async () => { throw new Error('unknown'); });
        await expect(g.commands.confirm({ proposalId }, async () => accepted())).rejects.toMatchObject({ code: 'outcome_unknown' });
        expect(g.records.has(targetPath)).toBe(false);
    });
    it('rejects cross-domain proposal reuse, edited previews and name/target collisions', async () => {
        const f = fixture(); await f.commands.prepare(input);
        await expect(createDirectFavoriteCommands(f.dependencies).status({ proposalId })).rejects.toMatchObject({ code: 'not_found' });
        await expect(f.commands.prepare({ ...input, name: 'Other' })).rejects.toMatchObject({ code: 'conflict' });
        f.put(proposalPath, { ...f.records.get(proposalPath).data, preview: { name: 'Fake' } });
        const approve = vi.fn(); await expect(f.commands.confirm({ proposalId }, approve)).rejects.toMatchObject({ code: 'conflict' });
        expect(approve).not.toHaveBeenCalled();
    });
    it.each([{ unknown: true }, { columns: null }, { statDefinitions: [{ id: 'x', unknown: true }] }, { statDefinitions: [{ formula: 'x'.repeat(1001) }] }])('rejects unsupported clone payloads without dropping fields: %j', async (patch) => {
        const f = fixture(); f.put(sourcePath, { ...source, ...patch });
        await expect(f.commands.prepare(input)).rejects.toMatchObject({ code: 'unsupported_configuration' });
        expect(f.records.has(proposalPath)).toBe(false);
    });
    it('limits the store to its domain, denies deletes, and emits an update mask for rename', async () => {
        const fetchImpl = vi.fn(async (url) => ({ ok: true, json: async () => url.endsWith(':beginTransaction') ? { transaction: 'synthetic' } : {} }));
        const store = createDirectStatConfigurationStore({ projectId: 'demo-synthetic', uid: 'owner', idToken: 'synthetic', fetchImpl });
        await expect(store.get('teams/team-1/players/player-1')).rejects.toMatchObject({ code: 'permission_denied' });
        await expect(store.create(sourcePath, {})).rejects.toMatchObject({ code: 'permission_denied' });
        await expect(store.transaction(async (tx) => tx.delete(sourcePath))).rejects.toMatchObject({ code: 'permission_denied' });
        await expect(store.transaction(async (tx) => tx.patch(sourcePath, { name: 'x', scoringColumn: 'x' }))).rejects.toMatchObject({ code: 'permission_denied' });
        await store.transaction(async (tx) => tx.patch(sourcePath, { name: 'Renamed', updatedAt: new Date(0) }));
        const write = JSON.parse(fetchImpl.mock.calls.filter(([url]) => url.endsWith(':commit')).at(-1)[1].body).writes[0];
        expect(write.updateMask.fieldPaths).toEqual(['name', 'updatedAt']); expect(write.currentDocument).toEqual({ exists: true });
    });
    it('offers discovery → prepare → explicit approve → clone and rename through the actual SDK', async () => {
        const f = fixture(); const server = createDirectFavoriteMcpSession(f.dependencies);
        const client = new Client({ name: 'synthetic', version: '1' }, { capabilities: { elicitation: { form: {} } } });
        const approvals = []; client.setRequestHandler(ElicitRequestSchema, async (request) => { approvals.push(request.params); return accepted(); });
        const [a, b] = InMemoryTransport.createLinkedPair(); await server.connect(a); await client.connect(b);
        try {
            expect((await client.listTools()).tools).toHaveLength(9);
            expect((await client.callTool({ name: 'list_managed_teams', arguments: {} })).structuredContent.teams).toEqual([{ id: 'team-1', name: 'Synthetic team' }]);
            expect((await client.callTool({ name: 'list_team_stat_configurations', arguments: { teamId: 'team-1' } })).structuredContent.configurations[0].id).toBe('source');
            expect((await client.callTool({ name: 'prepare_clone_stat_configuration', arguments: { proposalId, teamId: 'team-1', sourceConfigId: 'source', name: input.name, confirmed: true } })).isError).toBe(true);
            const prepared = await client.callTool({ name: 'prepare_clone_stat_configuration', arguments: { proposalId, teamId: 'team-1', sourceConfigId: 'source', name: input.name } });
            expect(prepared.structuredContent.configId).toBe(`mcp_${proposalId}`);
            expect((await client.callTool({ name: 'confirm_stat_configuration', arguments: { proposalId } })).structuredContent.status).toBe('completed');
            expect((await client.callTool({ name: 'prepare_rename_stat_configuration', arguments: { proposalId: renameId, teamId: 'team-1', configId: input.configId, name: 'Renamed clone' } })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_stat_configuration', arguments: { proposalId: renameId } })).structuredContent.status).toBe('completed');
            expect(approvals).toHaveLength(2); expect(approvals[0].requestedSchema.properties.approve.default).toBe(false);
            expect(f.records.get(targetPath).data.name).toBe('Renamed clone');
        } finally { await client.close(); await server.close(); }
    });
});

describe('configuration discovery', () => {
    it('projects safe summaries, pages duplicate names, and rechecks manager permissions', async () => {
        const f = fixture(); const discovery = createDirectDiscovery(f.dependencies);
        f.query.get.mockResolvedValue({ docs: ['a', 'b', 'c'].map((id) => ({ id, data: () => ({ name: 'Duplicate', baseType: 'Custom', privateContact: 'excluded' }) })) });
        const page = await discovery.configurations({ teamId: 'team-1', cursor: 'previous', limit: 2 });
        expect(page.configurations).toEqual([{ id: 'a', name: 'Duplicate', baseType: 'Custom' }, { id: 'b', name: 'Duplicate', baseType: 'Custom' }]);
        expect(page.nextCursor).toBe('b'); expect(page.hasMore).toBe(true);
        expect(f.query.select).toHaveBeenCalledWith('name', 'baseType'); expect(f.query.startAfterDocumentId).toHaveBeenCalledWith('previous');
        f.context.teams.clear(); await expect(discovery.configurations({ teamId: 'team-1' })).rejects.toMatchObject({ code: 'permission_denied' });
    });
    it('does not turn unavailable reads into empty results and rejects invalid cursors', async () => {
        const f = fixture(); const discovery = createDirectDiscovery(f.dependencies);
        f.query.get.mockRejectedValue(new Error('offline'));
        await expect(discovery.configurations({ teamId: 'team-1' })).rejects.toThrow('offline');
        await expect(discovery.configurations({ teamId: 'team-1', cursor: '../other' })).rejects.toMatchObject({ code: 'invalid_argument' });
    });
});
