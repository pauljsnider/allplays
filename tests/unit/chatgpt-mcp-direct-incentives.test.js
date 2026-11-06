import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { rosterFixture } from '../helpers/direct-roster-fixture.js';
import { createTestActionAuthority } from '../helpers/direct-test-authority.js';
import { createOneActionApproval } from '../../services/chatgpt-mcp/src/directActionApproval.js';
import { createDirectIncentiveCommands, createDirectIncentiveStore } from '../../services/chatgpt-mcp/src/directIncentives.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const terms = { statKey: 'pts', type: 'per_unit', amountCents: 25, threshold: null, thresholdOp: null, active: true };
const input = { proposalId, teamId: 'team-1', playerId: 'p1', mode: 'create', resultId: `mcp_${proposalId}`, terms };
const path = (id) => `users/owner/incentiveRules/${id}`;
const accept = async () => ({ action: 'accept', content: { approve: true, incentiveTerms: true }, consume: async () => {} });
const source = readFileSync(new URL('../../js/parent-incentives.js', import.meta.url), 'utf8');
const app = runInNewContext(`${source.slice(source.indexOf('function normalizeComparableDate'), source.indexOf('export function formatCents')).replaceAll('export function', 'function')}\n({ getApplicableRulesForGame, calculateEarnings })`, { Date });
function fixture() {
    const f = rosterFixture(); f.context.teams.get('team-1').roles = new Set(['parent']);
    f.put('users/owner', { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1'], email: 'Do not copy' });
    f.put('teams/team-1/players/p1', { name: 'Synthetic Player', active: true, medicalInfo: 'Do not copy' });
    f.put('teams/team-1/statTrackerConfigs/config', { columns: ['PTS', 'REB'], baseType: 'Basketball' });
    f.put(path('existing-rule'), { teamId: 'team-1', playerId: 'p1', playerName: 'Synthetic Player', ...terms,
        createdAt: new Date(f.dependencies.now() - 10000), updatedAt: new Date(f.dependencies.now() - 10000), effectiveFrom: new Date(f.dependencies.now() - 10000), effectiveTo: null });
    f.put('users/owner/incentivePaidGames/game__p1', { totalCents: 999, paid: true });
    const list = f.store.list.getMockImplementation(); f.store.list.mockImplementation(async (collection, args) => (await list(collection)).filter((row) => !args?.playerId || row.data.playerId === args.playerId));
    return { ...f, commands: createDirectIncentiveCommands(f.dependencies) };
}
const currentRules = (f) => [...f.records].filter(([key]) => key.startsWith('users/owner/incentiveRules/') && !key.includes('/_cap_')).map(([, row]) => row.data);
describe('private incentive command batch', () => {
    it('creates a rule additive to existing rules and requires a distinct acknowledgement', async () => {
        const f = fixture(); const prepared = await f.commands.prepare(input);
        expect(prepared.preview).toMatchObject({ currentRuleCount: 1, requiredAcknowledgements: ['incentiveTerms'], after: terms }); expect(JSON.stringify(prepared)).not.toMatch(/Do not copy/);
        for (const content of [{ approve: true }, { approve: true, incentiveTerms: false }, { approve: true, incentiveTerms: 'true' }]) {
            expect(await f.commands.confirm({ proposalId }, async () => ({ action: 'accept', content, consume: async () => {} }))).toMatchObject({ applied: false });
            expect(f.records.has(path(input.resultId))).toBe(false);
        }
        await f.commands.confirm({ proposalId }, accept); expect(f.records.get(path(input.resultId)).data).toMatchObject({ ...terms, effectiveFrom: new Date(f.dependencies.now()), effectiveTo: null });
        expect(app.calculateEarnings(app.getApplicableRulesForGame(currentRules(f), new Date(f.dependencies.now())), { pts: 4 }).totalCents).toBe(200);
        expect(f.records.get('users/owner/incentivePaidGames/game__p1').data).toEqual({ totalCents: 999, paid: true });
    });
    it('revises in one transaction with continuous nonoverlapping history and unchanged historical earnings', async () => {
        const f = fixture(); const old = structuredClone(f.records.get(path('existing-rule')).data); const instant = f.dependencies.now();
        await f.commands.prepare({ ...input, mode: 'revise', sourceId: 'existing-rule', terms: { ...terms, type: 'threshold', amountCents: 500, threshold: 4, thresholdOp: 'gte' } }); await f.commands.confirm({ proposalId }, accept);
        expect(f.store.transaction).toHaveBeenCalledTimes(1); expect(f.records.get(path('existing-rule')).data).toEqual({ ...old, effectiveTo: new Date(instant), updatedAt: new Date(instant) });
        const next = f.records.get(path(input.resultId)).data; expect(next).toMatchObject({ supersedesRuleId: 'existing-rule', effectiveFrom: new Date(instant), active: true });
        expect(app.calculateEarnings(app.getApplicableRulesForGame(currentRules(f), new Date(instant - 1)), { pts: 4 }).totalCents).toBe(100);
        expect(app.calculateEarnings(app.getApplicableRulesForGame(currentRules(f), new Date(instant)), { pts: 4 }).totalCents).toBe(500);
    });
    it('sets explicit active state without inversion, then retires without deleting history', async () => {
        const f = fixture(); await f.commands.prepare({ ...input, mode: 'set_active', sourceId: 'existing-rule', active: false }); await f.commands.confirm({ proposalId }, accept);
        expect(f.records.get(path('existing-rule')).data.active).toBe(true); expect(f.records.get(path(input.resultId)).data.active).toBe(false);
        expect(app.calculateEarnings(app.getApplicableRulesForGame(currentRules(f), new Date(f.dependencies.now())), { pts: 4 }).totalCents).toBe(0);
        f.advance(1000); await f.commands.prepare({ ...input, proposalId: second, mode: 'retire', sourceId: input.resultId }); await f.commands.confirm({ proposalId: second }, accept);
        expect(f.records.get(path(input.resultId)).data.effectiveTo).toEqual(new Date(f.dependencies.now())); expect(currentRules(f)).toHaveLength(2);
    });
    it('discloses retroactive cap semantics, supports zero and clear, and preserves paid records', async () => {
        const f = fixture(); const prepared = await f.commands.prepare({ ...input, mode: 'cap', resultId: '_cap_p1', maxPerGameCents: 0 });
        expect(prepared.preview.effect).toMatch(/past and future/); await f.commands.confirm({ proposalId }, accept);
        expect(f.records.get(path('_cap_p1')).data.maxPerGameCents).toBe(0);
        const historical = app.getApplicableRulesForGame(currentRules(f), new Date(f.dependencies.now() - 1));
        expect(app.calculateEarnings(historical, { pts: 4 }, 0).totalCents).toBe(0);
        await f.commands.prepare({ ...input, proposalId: second, mode: 'cap', resultId: '_cap_p1', maxPerGameCents: null }); await f.commands.confirm({ proposalId: second }, accept);
        expect(f.records.has(path('_cap_p1'))).toBe(false); expect(app.calculateEarnings(historical, { pts: 4 }).totalCents).toBe(100);
        expect(f.records.get('users/owner/incentivePaidGames/game__p1').data).toEqual({ totalCents: 999, paid: true });
    });
    it.each([{ amountCents: -1 }, { amountCents: 0 }, { amountCents: 1.1 }, { amountCents: 1000001 }, { statKey: '../x' }, { type: 'other' }, { active: 'true' }, { threshold: 3 }, { thresholdOp: 'gt' }, { type: 'threshold' }, { arbitrary: 'field' }])('rejects invalid complete terms %#', async (change) => {
        const f = fixture(); await expect(f.commands.prepare({ ...input, terms: { ...terms, ...change } })).rejects.toMatchObject({ code: 'invalid_argument' }); expect(f.store.create).not.toHaveBeenCalled();
    });
    it.each([-1, 0.5, 1000001, undefined, '0'])('rejects invalid cap %#', async (maxPerGameCents) => {
        const f = fixture(); await expect(f.commands.prepare({ ...input, mode: 'cap', resultId: '_cap_p1', maxPerGameCents })).rejects.toThrow();
    });
    it.each([{ parentTeamIds: [] }, { parentPlayerKeys: [] }, { parentPlayerKeys: ['other::p1'] }, { parentPlayerKeys: ['team-1::p1', 'other::p1'] }])('requires unambiguous exact parent links %#', async (change) => {
        const f = fixture(); f.put('users/owner', { ...f.records.get('users/owner').data, ...change }); await expect(f.commands.prepare(input)).rejects.toMatchObject({ code: 'permission_denied' });
    });
    it('does not substitute manager access for private parent authority', async () => {
        const f = fixture(); f.context.teams.get('team-1').roles = new Set(['owner']); await expect(f.commands.prepare(input)).rejects.toThrow();
    });
    it.each([{ effectiveTo: new Date(0) }, { effectiveFrom: new Date('2100-01-01') }, { type: 'penalty' }, { amountCents: -25 }, { teamId: 'other' }, { playerId: 'other' }, { extra: true }, { effectiveFrom: null }])('rejects historical, foreign or extended source %#', async (change) => {
        const f = fixture(); f.put(path('existing-rule'), { ...f.records.get(path('existing-rule')).data, ...change });
        await expect(f.commands.prepare({ ...input, mode: 'revise', sourceId: 'existing-rule' })).rejects.toThrow();
    });
    it('rejects unsupported stat keys, a no-op toggle and colliding new versions', async () => {
        const f = fixture(); await expect(f.commands.prepare({ ...input, terms: { ...terms, statKey: 'unknown' } })).rejects.toThrow();
        await expect(f.commands.prepare({ ...input, mode: 'set_active', sourceId: 'existing-rule', active: true })).rejects.toThrow();
        await expect(f.commands.prepare({ ...input, resultId: 'existing-rule' })).rejects.toThrow();
    });
    it.each([{ teamId: 'other' }, { playerId: 'other' }, { legacy: true }, { updatedAt: null }])('rejects legacy or cross-team cap %#', async (change) => {
        const f = fixture(); f.put(path('_cap_p1'), { teamId: 'team-1', playerId: 'p1', maxPerGameCents: 100, updatedAt: new Date(), ...change }); await expect(f.commands.prepare(input)).rejects.toThrow();
    });
    it.each(['link', 'rule', 'new_rule', 'cap', 'config', 'player', 'expiry', 'role'])('rejects %s changes during confirmation without business writes', async (kind) => {
        const f = fixture(); await f.commands.prepare(input);
        await expect(f.commands.confirm({ proposalId }, async () => {
            if (kind === 'link') f.put('users/owner', { parentTeamIds: [], parentPlayerKeys: [] });
            if (kind === 'rule') f.put(path('existing-rule'), { ...f.records.get(path('existing-rule')).data, amountCents: 50 });
            if (kind === 'new_rule') f.put(path('competing'), f.records.get(path('existing-rule')).data);
            if (kind === 'cap') f.put(path('_cap_p1'), { teamId: 'team-1', playerId: 'p1', maxPerGameCents: 100, updatedAt: new Date() });
            if (kind === 'config') f.put('teams/team-1/statTrackerConfigs/config', { columns: ['PTS'] });
            if (kind === 'player') f.put('teams/team-1/players/p1', { name: 'Changed', active: true });
            if (kind === 'expiry') f.expire(); if (kind === 'role') f.context.teams.clear(); return accept();
        })).rejects.toThrow(); expect(f.records.has(path(input.resultId))).toBe(false);
    });
    it('rejects missing authority and tampered previews; decline/cancel do not apply', async () => {
        const f = fixture(); await f.commands.prepare(input);
        for (const action of ['decline', 'cancel']) expect(await f.commands.confirm({ proposalId }, async () => ({ action }))).toMatchObject({ applied: false });
        await expect(f.commands.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true, incentiveTerms: true } }))).rejects.toThrow();
        f.records.get(`users/owner/privateAiPendingActions/direct_${proposalId}`).data.preview.after.amountCents = 900;
        await expect(f.commands.confirm({ proposalId }, accept)).rejects.toThrow(); expect(f.records.has(path(input.resultId))).toBe(false);
    });
    it.each(['expiry', 'disconnect'])('guards final dispatch against %s with actual approval authority', async (kind) => {
        const f = fixture(); const abort = new AbortController(); const authority = createOneActionApproval({ getActor: async () => ({ uid: 'owner', clientId: 'test', grantKey: 'test', expiresAt: f.dependencies.now() + 1000000 }), now: f.dependencies.now });
        await f.commands.prepare(input); const original = f.store.transaction.getMockImplementation();
        f.store.transaction.mockImplementation((callback, settings) => original(callback, { ...settings, beforeDispatch: async () => { const guard = await settings.beforeDispatch(); if (kind === 'expiry') f.advance(120001); else abort.abort(); return guard; } }));
        await expect(f.commands.confirm({ proposalId }, (preview) => authority(preview, accept, abort.signal))).rejects.toThrow(); expect(f.records.has(path(input.resultId))).toBe(false);
    });
    it('reconciles lost responses once and reauthorizes status', async () => {
        const f = fixture(); await f.commands.prepare(input); const original = f.store.transaction.getMockImplementation();
        f.store.transaction.mockImplementation(async (...args) => { await original(...args); throw new Error('Synthetic lost response'); });
        expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed'); expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed'); expect(f.store.transaction).toHaveBeenCalledTimes(1);
        f.put('users/owner', { parentTeamIds: [], parentPlayerKeys: [] }); await expect(f.commands.status({ proposalId })).rejects.toThrow();
    });
    it('bounds discovery and omits contacts, paid records and closed history', async () => {
        const f = fixture(); const discovered = await f.commands.discover(input); expect(discovered.statKeys).toEqual(['fouls', 'pts', 'reb']); expect(discovered.rules).toEqual([{ id: 'existing-rule', ...terms }]); expect(JSON.stringify(discovered)).not.toMatch(/Do not copy|paid|999/);
        for (let i = 0; i < 100; i++) f.put(path(`rule${i}`), f.records.get(path('existing-rule')).data); await expect(f.commands.discover(input)).rejects.toThrow();
    });
    it('adapter denies paid records, other parents, rule deletion and terms patches', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ transaction: 'synthetic' }))); const store = createDirectIncentiveStore({ projectId: 'demo-allplays-mcp-review', uid: 'owner', idToken: 'synthetic', fetchImpl });
        for (const target of ['users/other/incentiveRules/rule', 'users/owner/incentivePaidGames/game']) await expect(store.get(target)).rejects.toThrow(); expect(fetchImpl).not.toHaveBeenCalled();
        await expect(store.transaction(async (tx) => tx.delete(path('existing-rule')))).rejects.toThrow();
        await expect(store.transaction(async (tx) => tx.patch(path('existing-rule'), { amountCents: 100 }))).rejects.toThrow();
        await expect(store.transaction(async (tx) => tx.set('users/owner/incentivePaidGames/game', { paid: true }))).rejects.toThrow();
        expect(fetchImpl.mock.calls.every(([url]) => !url.endsWith(':commit'))).toBe(true);
    });
    it('uses commit-time transforms without re-encoding existing historical fields', async () => {
        let committed;
        const fetchImpl = async (url, options) => {
            if (url.endsWith(':commit')) committed = JSON.parse(options.body);
            return new Response(JSON.stringify(url.endsWith(':beginTransaction') ? { transaction: 'synthetic' } : {}));
        };
        const store = createDirectIncentiveStore({ projectId: 'demo-allplays-mcp-review', uid: 'owner', idToken: 'synthetic', fetchImpl });
        const stamp = new Date(0);
        await store.transaction(async (tx) => {
            tx.patch(path('existing-rule'), { updatedAt: stamp, effectiveTo: stamp });
            tx.set(path('new-rule'), { ...terms, createdAt: stamp, updatedAt: stamp, effectiveFrom: stamp, effectiveTo: null });
        });
        expect(committed.writes[0]).toMatchObject({ transform: { fieldTransforms: [
            { fieldPath: 'updatedAt', setToServerValue: 'REQUEST_TIME' }, { fieldPath: 'effectiveTo', setToServerValue: 'REQUEST_TIME' }
        ] }, currentDocument: { exists: true } }); expect(committed.writes[0].update).toBeUndefined();
        const created = committed.writes[1]; expect(created.updateTransforms.map((row) => row.fieldPath)).toEqual(['createdAt', 'updatedAt', 'effectiveFrom']);
        expect(created.update.fields.createdAt).toBeUndefined(); expect(created.update.fields.effectiveTo).toEqual({ nullValue: null });
    });
    it('enables a disabled rule with the explicit requested state and supports strict greater-than thresholds', async () => {
        const f = fixture(); f.put(path('existing-rule'), { ...f.records.get(path('existing-rule')).data, active: false, type: 'threshold', threshold: 4, thresholdOp: 'gt' });
        await f.commands.prepare({ ...input, mode: 'set_active', sourceId: 'existing-rule', active: true }); await f.commands.confirm({ proposalId }, accept);
        const applicable = app.getApplicableRulesForGame(currentRules(f), new Date(f.dependencies.now()));
        expect(app.calculateEarnings(applicable, { pts: 4 }).totalCents).toBe(0); expect(app.calculateEarnings(applicable, { pts: 5 }).totalCents).toBe(25);
        expect(f.records.get(path('existing-rule')).data.active).toBe(false); expect(f.records.get(path(input.resultId)).data.active).toBe(true);
    });
    it('MCP exposes five strict preparations and requires both real form fields', async () => {
        const f = fixture(); const server = createDirectFavoriteMcpSession({ ...f.dependencies, incentiveStore: f.store, authorizeAction: createTestActionAuthority() });
        const client = new Client({ name: 'isolated', version: '1' }, { capabilities: { elicitation: { form: {} } } }); let acknowledged = false;
        client.setRequestHandler(ElicitRequestSchema, async (request) => { expect(request.params.requestedSchema.required).toEqual(['approve', 'incentiveTerms']); return { action: 'accept', content: { approve: true, incentiveTerms: acknowledged } }; });
        const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
        try {
            const names = (await client.listTools()).tools.map((tool) => tool.name); expect(names.filter((name) => name.startsWith('prepare_') && name.includes('incentive'))).toHaveLength(5); expect(names.some((name) => name.includes('paid'))).toBe(false);
            const args = { proposalId, teamId: input.teamId, playerId: input.playerId, terms };
            expect((await client.callTool({ name: 'prepare_create_player_incentive_rule', arguments: { ...args, userId: 'other' } })).isError).toBe(true);
            expect((await client.callTool({ name: 'prepare_create_player_incentive_rule', arguments: args })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_player_incentive', arguments: { proposalId, confirmed: true } })).isError).toBe(true);
            expect((await client.callTool({ name: 'confirm_player_incentive', arguments: { proposalId } })).structuredContent.applied).toBe(false); expect(f.records.has(path(input.resultId))).toBe(false);
            acknowledged = true; expect((await client.callTool({ name: 'confirm_player_incentive', arguments: { proposalId } })).structuredContent.status).toBe('completed');
        } finally { await client.close(); await server.close(); }
    });
});
