import { describe, expect, it, vi } from 'vitest';
import { rosterFixture } from '../helpers/direct-roster-fixture.js';
import { createTestActionAuthority } from '../helpers/direct-test-authority.js';
import { createOneActionApproval } from '../../services/chatgpt-mcp/src/directActionApproval.js';
import { TEAM_SETUP_PRESET_IDS, teamSetupPreset } from '../../services/chatgpt-mcp/src/directTeamSetup.js';
import { createDirectStatPresentationCommands, createDirectStatPresentationStore } from '../../services/chatgpt-mcp/src/directStatPresentation.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { getStatConfigPresetById, serializeAdvancedStatDefinitions } from '../../js/stat-config-presets.js';
import { normalizeStatTrackerConfig, parseAdvancedStatDefinitions, buildPlayerLeaderboardSnapshot, evaluateDerivedFormula, selectAnalyticsConfig } from '../../js/stat-leaderboards.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff'; const second = '00112233-4455-4677-8899-aabbccddeeaa';
const path = 'teams/team-1/statTrackerConfigs/existing'; const newPath = `teams/team-1/statTrackerConfigs/mcp_${proposalId}`;
const update = { proposalId, mode: 'update', teamId: 'team-1', configId: 'existing', changes: [{ statId: 'pts', precision: 2, format: 'percentage', rankingOrder: 'asc' }] };
const create = { ...update, mode: 'create', configId: `mcp_${proposalId}`, presetId: 'basketball', name: 'Customized Basketball' };
const accept = async () => ({ action: 'accept', content: { approve: true, publicConfiguration: true, statPresentation: true }, consume: async () => {} });
function fixture() {
    const f = rosterFixture(); f.put(path, { ...teamSetupPreset('basketball'), createdAt: new Date(0) }); f.put('teams/team-1/games/game', { configId: 'existing', homeScore: 10, playerStats: { p1: { pts: 10 } } });
    return { ...f, commands: createDirectStatPresentationCommands(f.dependencies) };
}
describe('bounded stat presentation create/update', () => {
    it.each(TEAM_SETUP_PRESET_IDS)('creates a customized %s preset matching actual normalization and advanced serialization', async (presetId) => {
        const f = fixture(); const preset = getStatConfigPresetById(presetId); const statId = preset.statDefinitions[0].id; const changes = [{ statId, precision: 3, rankingOrder: 'asc' }];
        const prepared = await f.commands.prepare({ ...create, presetId, changes }); expect(prepared.preview.requiredAcknowledgements).toEqual(['publicConfiguration', 'statPresentation']); expect(prepared.preview.effect).toMatch(/publicly readable.*private team/);
        await f.commands.confirm({ proposalId }, accept); const saved = f.records.get(newPath).data; expect(saved.statDefinitions).toEqual(preset.statDefinitions.map((d) => d.id === statId ? { ...d, precision: 3, rankingOrder: 'asc' } : d)); expect(saved.columns).toEqual(preset.columns);
        expect(normalizeStatTrackerConfig(saved).statDefinitions).toEqual(saved.statDefinitions);
        const parsed = normalizeStatTrackerConfig({ ...saved, statDefinitions: parseAdvancedStatDefinitions(serializeAdvancedStatDefinitions(saved)) }); expect(parsed.statDefinitions).toEqual(saved.statDefinitions);
    });
    it('updates only presentation, preserving formulas, identities, visibility, history and game references', async () => {
        const f = fixture(); const original = structuredClone(f.records.get(path).data); const game = structuredClone(f.records.get('teams/team-1/games/game').data);
        await f.commands.prepare(update); await f.commands.confirm({ proposalId }, accept); const saved = f.records.get(path).data;
        const expected = original.statDefinitions.map((definition) => definition.id === 'pts' ? { ...definition, precision: 2, format: 'percentage', rankingOrder: 'asc' } : definition);
        expect(saved).toEqual({ ...original, statDefinitions: expected, updatedAt: new Date(f.dependencies.now()) }); expect(f.records.get('teams/team-1/games/game').data).toEqual(game);
        const derived = saved.statDefinitions.find((row) => row.id === 'asttoratio'); expect(evaluateDerivedFormula(derived.formula, { ast: 7, to: 2 })).toBe(evaluateDerivedFormula(original.statDefinitions.find((row) => row.id === 'asttoratio').formula, { ast: 7, to: 2 }));
    });
    it('shows actual changed historical rounding/order while percentage adds only a suffix', async () => {
        const f = fixture(); const args = { players: [{ id: 'p1' }, { id: 'p2' }], seasonStatsByPlayerId: { p1: { pts: 0.125 }, p2: { pts: 2.555 } } };
        const before = buildPlayerLeaderboardSnapshot({ ...args, config: f.records.get(path).data }).topStats.find((stat) => stat.id === 'pts'); expect(before.leader.playerId).toBe('p2');
        const prepared = await f.commands.prepare(update); expect(prepared.preview.effect).toMatch(/does not multiply/); await f.commands.confirm({ proposalId }, accept);
        const after = buildPlayerLeaderboardSnapshot({ ...args, config: f.records.get(path).data }).topStats.find((stat) => stat.id === 'pts'); expect(after.leader.playerId).toBe('p1'); expect(after.leader.value).toBe(0.125); expect(after.leader.formattedValue).toBe('0.13%');
    });
    it('discloses that new presets can become the automatic analytics selection', async () => {
        const f = fixture(); const old = { name: 'Other', baseType: 'Custom', columns: ['X'] }; f.records.delete(path);
        const prepared = await f.commands.prepare(create); expect(prepared.preview.effect).toMatch(/automatically selected/); await f.commands.confirm({ proposalId }, accept);
        expect(selectAnalyticsConfig([old, f.records.get(newPath).data], 'Basketball').name).toBe(create.name);
    });
    it.each([[], [{ statId: 'pts' }], [{ statId: 'pts', precision: -1 }], [{ statId: 'pts', precision: 7 }], [{ statId: 'pts', precision: 1.5 }], [{ statId: 'pts', format: 'percent' }], [{ statId: 'pts', rankingOrder: 'ascending' }], [{ statId: 'pts', label: 'New' }], [{ statId: 'pts', visibility: 'public' }], [{ statId: 'pts', formula: '2*PTS' }], [{ statId: 'pts', precision: 1 }, { statId: 'pts', precision: 2 }], Array.from({ length: 21 }, (_, i) => ({ statId: `s${i}`, precision: 1 }))])('rejects unsupported edits %#', async (changes) => { const f = fixture(); await expect(f.commands.prepare({ ...update, changes })).rejects.toThrow(); expect(f.store.create).not.toHaveBeenCalled(); });
    it.each(['visibility', 'formula', 'id', 'label', 'columns', 'extended', 'diamond', 'precision'])('refuses a source with modified %s without lossy normalization', async (kind) => {
        const f = fixture(); const data = f.records.get(path).data;
        if (kind === 'visibility') data.statDefinitions[0].visibility = 'private'; if (kind === 'formula') data.statDefinitions[0].formula = '2*PTS'; if (kind === 'id') data.statDefinitions[0].id = 'other'; if (kind === 'label') data.statDefinitions[0].label = 'Other'; if (kind === 'columns') delete data.columns; if (kind === 'extended') data.extension = { keep: true }; if (kind === 'diamond') data.baseType = 'Baseball'; if (kind === 'precision') data.statDefinitions[0].precision = 10;
        f.put(path, data); await expect(f.commands.prepare(update)).rejects.toMatchObject({ code: 'unsupported_configuration' }); expect(f.store.create).not.toHaveBeenCalled();
    });
    it('rejects absent stats, duplicate names and oversized duplicate scans', async () => {
        const f = fixture(); await expect(f.commands.prepare({ ...update, changes: [{ statId: 'unknown', precision: 1 }] })).rejects.toThrow(); await expect(f.commands.prepare({ ...create, name: 'basketball   standard' })).rejects.toThrow();
        f.store.list.mockResolvedValue(Array.from({ length: 101 }, (_, i) => ({ id: `c${i}`, version: 'v', data: { name: String(i) } }))); await expect(f.commands.prepare(create)).rejects.toThrow();
    });
    it.each(['source', 'team', 'permission', 'expiry'])('rejects changed %s during approval', async (kind) => {
        const f = fixture(); const original = structuredClone(f.records.get(path).data); await f.commands.prepare(update);
        await expect(f.commands.confirm({ proposalId }, async () => { if (kind === 'source') f.put(path, { ...original, name: 'Changed' }); if (kind === 'team') f.put('teams/team-1', { archived: true }); if (kind === 'permission') f.context.teams.clear(); if (kind === 'expiry') f.expire(); return accept(); })).rejects.toThrow(); expect(f.records.get(path).data.statDefinitions).toEqual(original.statDefinitions);
    });
    it('requires both distinct acknowledgements and rejects cross-domain/no-op confirmation', async () => {
        const f = fixture(); await f.commands.prepare(update); for (const content of [{ approve: true }, { approve: true, publicConfiguration: true }, { approve: true, statPresentation: true }]) expect(await f.commands.confirm({ proposalId }, async () => ({ action: 'accept', content, consume: async () => {} }))).toMatchObject({ applied: false });
        await expect(f.commands.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true, publicConfiguration: true, statPresentation: true } }))).rejects.toThrow();
        await f.commands.confirm({ proposalId }, accept); await expect(f.commands.prepare({ ...update, proposalId: second })).rejects.toThrow();
    });
    it.each(['expiry', 'disconnect'])('guards final dispatch for %s after awaited preparation', async (kind) => {
        const f = fixture(); const abort = new AbortController(); const authority = createOneActionApproval({ getActor: async () => ({ uid: 'owner', clientId: 'test', grantKey: 'test', expiresAt: f.dependencies.now() + 1000000 }), now: f.dependencies.now }); await f.commands.prepare(create);
        const original = f.store.transaction.getMockImplementation(); f.store.transaction.mockImplementation((callback, settings) => original(callback, { ...settings, beforeDispatch: async () => { const guard = await settings.beforeDispatch(); if (kind === 'disconnect') abort.abort(); else f.advance(120001); return guard; } }));
        await expect(f.commands.confirm({ proposalId }, (preview) => authority(preview, accept, abort.signal))).rejects.toThrow(); expect(f.records.has(newPath)).toBe(false);
    });
    it('reconciles a lost response once and reauthorizes receipts and discovery', async () => {
        const f = fixture(); expect((await f.commands.discover({ teamId: 'team-1', configId: 'existing' })).stats[0]).toMatchObject({ id: 'pts', precision: 0 }); expect((await f.commands.discover({ teamId: 'team-1', presetId: 'soccer' })).stats.length).toBeGreaterThan(0); await expect(f.commands.discover({ teamId: 'team-1', configId: 'existing', presetId: 'soccer' })).rejects.toThrow();
        await f.commands.prepare(create); const original = f.store.transaction.getMockImplementation(); f.store.transaction.mockImplementation(async (...args) => { await original(...args); throw new Error('Synthetic lost response'); }); expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed'); expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed'); expect(f.store.transaction).toHaveBeenCalledTimes(1);
        f.context.teams.clear(); await expect(f.commands.status({ proposalId })).rejects.toThrow(); await expect(f.commands.discover({ teamId: 'team-1', configId: 'existing' })).rejects.toThrow();
    });
    it('adapter refuses replacement, visibility edits, scoring fields and unrelated paths', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ transaction: 'synthetic' }))); const store = createDirectStatPresentationStore({ projectId: 'demo-allplays-mcp-review', uid: 'owner', idToken: 'synthetic', fetchImpl });
        await expect(store.get('teams/team-1/games/game')).rejects.toThrow(); expect(fetchImpl).not.toHaveBeenCalled(); await expect(store.transaction(async (tx) => tx.set(path, { ...teamSetupPreset('basketball'), createdAt: new Date() }))).rejects.toThrow();
        const definitions = teamSetupPreset('basketball').statDefinitions; definitions[0].visibility = 'private';
        for (const data of [{ statDefinitions: definitions, updatedAt: new Date() }, { scoringColumn: 'Other', updatedAt: new Date() }]) await expect(store.transaction(async (tx) => tx.patch(path, data))).rejects.toThrow(); await expect(store.transaction(async (tx) => tx.delete(path))).rejects.toThrow(); expect(fetchImpl.mock.calls.some(([url]) => url.endsWith(':commit'))).toBe(false);
    });
    it('MCP binds strict create/update schemas and three required form booleans', async () => {
        const f = fixture(); const server = createDirectFavoriteMcpSession({ ...f.dependencies, statPresentationStore: f.store, authorizeAction: createTestActionAuthority() }); const client = new Client({ name: 'isolated', version: '1' }, { capabilities: { elicitation: { form: {} } } }); let approved = false;
        client.setRequestHandler(ElicitRequestSchema, async (request) => { expect(request.params.requestedSchema.required).toEqual(['approve', 'publicConfiguration', 'statPresentation']); return { action: 'accept', content: { approve: true, publicConfiguration: true, statPresentation: approved } }; }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
        try {
            const { mode, ...args } = update; expect((await client.callTool({ name: 'prepare_stat_presentation_update', arguments: { ...args, changes: [{ statId: 'pts', visibility: 'public' }] } })).isError).toBe(true); expect((await client.callTool({ name: 'prepare_stat_presentation_update', arguments: args })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_stat_presentation', arguments: { proposalId, confirmed: true } })).isError).toBe(true); expect((await client.callTool({ name: 'confirm_stat_presentation', arguments: { proposalId } })).structuredContent.applied).toBe(false); approved = true; expect((await client.callTool({ name: 'confirm_stat_presentation', arguments: { proposalId } })).structuredContent.status).toBe('completed');
            expect((await client.callTool({ name: 'prepare_customized_stat_preset', arguments: { proposalId: second, teamId: create.teamId, presetId: create.presetId, name: create.name, changes: create.changes } })).isError).not.toBe(true); expect((await client.callTool({ name: 'confirm_stat_presentation', arguments: { proposalId: second } })).structuredContent.status).toBe('completed');
        } finally { await client.close(); await server.close(); }
    });
});
