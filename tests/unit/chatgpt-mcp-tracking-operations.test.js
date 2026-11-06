import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { rosterFixture } from '../helpers/direct-roster-fixture.js';
import { createTestActionAuthority } from '../helpers/direct-test-authority.js';
import { createOneActionApproval } from '../../services/chatgpt-mcp/src/directActionApproval.js';
import { buildTrackingStatusPayload } from '../../js/tracking-status-admin.js';
import { createDirectTrackingBatchCommands, createDirectTrackingLifecycleCommands, createDirectTrackingLifecycleStore } from '../../services/chatgpt-mcp/src/directTrackingOperations.js';
import { createDirectTrackingStatusCommands } from '../../services/chatgpt-mcp/src/directTrackingStatus.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const third = '00112233-4455-4677-8899-aabbccddeebb';
const itemPath = 'teams/team-1/trackingItems/item';
const statusPath = (id) => `${itemPath}/memberTracking/${id}`;
const batch = { proposalId, teamId: 'team-1', itemId: 'item', changes: [{ playerId: 'p2', complete: false }, { playerId: 'p1', complete: true }] };
const lifecycle = { proposalId, teamId: 'team-1', itemId: 'item', active: false };
const accept = async () => ({ action: 'accept', content: { approve: true, trackingLifecycle: true }, consume: async () => {} });
const item = { teamId: 'team-1', name: 'Synthetic requirement', description: 'Staff-only', visibility: 'private', status: 'active', active: true, archived: false, createdAt: new Date(0), createdBy: 'owner' };
function fixture() {
    const f = rosterFixture(); f.put(itemPath, item);
    for (const id of ['p1', 'p2']) f.put(`teams/team-1/players/${id}`, { name: `Synthetic ${id}`, number: '07', active: true, contact: 'Never copy' });
    return { ...f, batch: createDirectTrackingBatchCommands(f.dependencies), lifecycle: createDirectTrackingLifecycleCommands(f.dependencies) };
}
const status = (f, id, complete) => ({ ...buildTrackingStatusPayload({ teamId: 'team-1', itemId: 'item', player: { id, ...f.records.get(`teams/team-1/players/${id}`).data }, complete, actorId: 'owner', actorEmail: null }), updatedAt: new Date(0) });
describe('atomic tracking batches and private lifecycle', () => {
    it('creates and updates mixed completions atomically with the actual app payload', async () => {
        const f = fixture(); f.put(statusPath('p2'), status(f, 'p2', true)); f.put(statusPath('other'), { note: 'Preserve unselected legacy state' });
        const prepared = await f.batch.prepare(batch); expect(prepared.preview.changes.map((row) => [row.playerId, row.before, row.complete])).toEqual([['p1', null, true], ['p2', true, false]]); expect(JSON.stringify(prepared)).not.toContain('Never copy');
        await f.batch.confirm({ proposalId }, accept);
        for (const { playerId, complete } of batch.changes) expect(f.records.get(statusPath(playerId)).data).toEqual({ ...status(f, playerId, complete), updatedAt: new Date(f.dependencies.now()) });
        expect(f.records.get(statusPath('other')).data).toEqual({ note: 'Preserve unselected legacy state' }); expect(f.records.get(itemPath).data).toEqual(item);
    });
    it('archives and reactivates without deleting completion history or changing creation audit', async () => {
        const f = fixture(); const original = status(f, 'p1', true); f.put(statusPath('p1'), original); f.put(statusPath('other'), { note: 'Keep legacy' });
        const prepared = await f.lifecycle.prepare(lifecycle); expect(prepared.preview.requiredAcknowledgements).toEqual(['trackingLifecycle']); expect(prepared.preview.effect).toMatch(/not a reset/);
        await f.lifecycle.confirm({ proposalId }, accept); expect(f.records.get(itemPath).data).toEqual({ ...item, status: 'archived', active: false, archived: true, updatedAt: new Date(f.dependencies.now()), updatedBy: 'owner' });
        await expect(f.batch.prepare({ ...batch, proposalId: second })).rejects.toThrow(); await expect(createDirectTrackingStatusCommands(f.dependencies).prepare({ ...lifecycle, proposalId: second, playerId: 'p1', complete: true })).rejects.toThrow();
        await f.lifecycle.prepare({ ...lifecycle, proposalId: second, active: true }); await f.lifecycle.confirm({ proposalId: second }, accept);
        expect(f.records.get(itemPath).data.status).toBe('active'); expect(f.records.get(statusPath('p1')).data).toEqual(original); expect(f.records.get(statusPath('other')).data).toEqual({ note: 'Keep legacy' });
        await f.batch.prepare({ ...batch, proposalId: third }); await f.batch.confirm({ proposalId: third }, accept);
    });
    it('matches actual legacy and app lifecycle normalization', async () => {
        const legacy = readFileSync(new URL('../../js/tracking-items-admin.js', import.meta.url), 'utf8');
        const normalizeLegacy = runInNewContext(`${legacy.slice(legacy.indexOf('export function normalizeTrackingItemDraft('), legacy.indexOf('export function filterTrackingItemsForAdminList(')).replace('export ', '')}; normalizeTrackingItemDraft`, { normalizeString: (v) => String(v || '').trim(), VISIBILITY_VALUES: ['private', 'public'], STATUS_VALUES: ['active', 'archived'] });
        const app = readFileSync(new URL('../../apps/app/src/lib/teamDetailService.ts', import.meta.url), 'utf8');
        const normalizeApp = runInNewContext(`${app.slice(app.indexOf('function normalizeTeamTrackingItemDraft('), app.indexOf('function normalizeTeamTrackingItem(item:')).replace('input: TeamTrackingItemForAppInput', 'input')}; normalizeTeamTrackingItemDraft`, { cleanString: (v) => String(v || '').trim() });
        for (const active of [false, true]) {
            const f = fixture(); await f.lifecycle.prepare({ ...lifecycle, active }); await f.lifecycle.confirm({ proposalId }, accept); const actual = f.records.get(itemPath).data;
            const fields = { name: actual.name, description: actual.description, visibility: actual.visibility, status: actual.status, active: actual.active, archived: actual.archived };
            expect(fields).toEqual(normalizeApp({ ...item, status: active ? 'active' : 'archived' })); expect(fields).toEqual(normalizeLegacy({ ...item, status: active ? 'active' : 'archived' }));
        }
    });
    it.each([[], Array.from({ length: 21 }, (_, i) => ({ playerId: `p${i}`, complete: true })), [{ playerId: 'p1', complete: true }, { playerId: 'p1', complete: false }], [{ playerId: 'p1', complete: 'true' }], [{ playerId: 'p1', complete: true, note: 'No' }], [{ playerId: '../p1', complete: true }]])('rejects invalid batch %#', async (changes) => {
        const f = fixture(); await expect(f.batch.prepare({ ...batch, changes })).rejects.toMatchObject({ code: 'invalid_argument' }); expect(f.store.create).not.toHaveBeenCalled();
    });
    it.each([undefined, null, 'true', 1])('rejects invalid lifecycle state %#', async (active) => { const f = fixture(); await expect(f.lifecycle.prepare({ ...lifecycle, active })).rejects.toThrow(); });
    it.each([{ visibility: 'public' }, { active: false }, { teamId: 'other' }, { public: true }, { status: 'unknown' }, { dueDate: 'legacy' }])('refuses unsupported item state for both commands %#', async (change) => {
        const f = fixture(); f.put(itemPath, { ...item, ...change }); await expect(f.batch.prepare(batch)).rejects.toThrow(); await expect(f.lifecycle.prepare(lifecycle)).rejects.toThrow();
    });
    it.each(['player', 'status', 'item', 'permission', 'expiry'])('rejects changed %s without partial batch writes', async (kind) => {
        const f = fixture(); await f.batch.prepare(batch);
        await expect(f.batch.confirm({ proposalId }, async () => {
            if (kind === 'player') f.put('teams/team-1/players/p2', { active: false }); if (kind === 'status') f.put(statusPath('p2'), status(f, 'p2', true)); if (kind === 'item') f.put(itemPath, { ...item, status: 'archived', active: false, archived: true }); if (kind === 'permission') f.context.teams.clear(); if (kind === 'expiry') f.expire(); return accept();
        })).rejects.toThrow(); expect(f.records.has(statusPath('p1'))).toBe(false); if (kind !== 'status') expect(f.records.has(statusPath('p2'))).toBe(false);
    });
    it('refuses one legacy status or inactive player before preparing the entire batch', async () => {
        const f = fixture(); f.put(statusPath('p2'), { ...status(f, 'p2', false), note: 'Retain legacy note' }); await expect(f.batch.prepare(batch)).rejects.toThrow(); expect(f.store.create).not.toHaveBeenCalled(); expect(f.records.has(statusPath('p1'))).toBe(false);
    });
    it.each(['batch', 'lifecycle'])('requires bound approval, reauthorizes and reconciles one lost %s response', async (kind) => {
        const f = fixture(); const input = kind === 'batch' ? batch : lifecycle; await f[kind].prepare(input);
        await expect(f[kind].confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true, trackingLifecycle: true } }))).rejects.toThrow();
        const original = f.store.transaction.getMockImplementation(); f.store.transaction.mockImplementation(async (...args) => { await original(...args); throw new Error('Synthetic lost response'); });
        expect((await f[kind].confirm({ proposalId }, accept)).status).toBe('completed'); expect((await f[kind].confirm({ proposalId }, accept)).status).toBe('completed'); expect(f.store.transaction).toHaveBeenCalledTimes(1);
        f.context.teams.clear(); await expect(f[kind].status({ proposalId })).rejects.toThrow();
    });
    it.each(['expiry', 'disconnect'])('guards final batch dispatch after awaited preparation for %s', async (kind) => {
        const f = fixture(); const abort = new AbortController(); const authority = createOneActionApproval({ getActor: async () => ({ uid: 'owner', clientId: 'test', grantKey: 'test', expiresAt: f.dependencies.now() + 1000000 }), now: f.dependencies.now });
        await f.batch.prepare(batch); const original = f.store.transaction.getMockImplementation(); f.store.transaction.mockImplementation((callback, settings) => original(callback, { ...settings, beforeDispatch: async () => { const guard = await settings.beforeDispatch(); if (kind === 'disconnect') abort.abort(); else f.advance(120001); return guard; } }));
        await expect(f.batch.confirm({ proposalId }, (preview) => authority(preview, accept, abort.signal))).rejects.toThrow(); expect(f.records.has(statusPath('p1'))).toBe(false); expect(f.records.has(statusPath('p2'))).toBe(false);
    });
    it('rejects tampered derived receipt IDs without changing selected players', async () => {
        const f = fixture(); await f.batch.prepare(batch); f.records.get(`users/owner/privateAiPendingActions/direct_${proposalId}`).data.playerIds = ['other'];
        await expect(f.batch.confirm({ proposalId }, accept)).rejects.toThrow(); expect(f.records.has(statusPath('p1'))).toBe(false);
    });
    it('requires lifecycle acknowledgement, rejects stale lifecycle intent and keeps domains distinct', async () => {
        const f = fixture(); await f.lifecycle.prepare(lifecycle);
        expect(await f.lifecycle.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} }))).toMatchObject({ applied: false }); expect(f.records.get(itemPath).data).toEqual(item);
        await expect(f.batch.confirm({ proposalId }, accept)).rejects.toThrow();
        await expect(f.lifecycle.confirm({ proposalId }, async () => { f.put(itemPath, { ...item, name: 'Changed' }); return accept(); })).rejects.toThrow(); expect(f.records.get(itemPath).data.status).toBe('active');
    });
    it('lifecycle adapter rejects replacement, visibility, completion writes and forged audit', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ transaction: 'synthetic' })));
        const store = createDirectTrackingLifecycleStore({ projectId: 'demo-allplays-mcp-review', uid: 'owner', idToken: 'synthetic', fetchImpl });
        for (const data of [{ ...item }, { active: false, archived: true, status: 'archived', updatedAt: new Date(), updatedBy: 'other' }, { active: false, archived: true, status: 'archived', updatedAt: new Date(), updatedBy: 'owner', visibility: 'public' }]) await expect(store.transaction(async (tx) => tx.patch(itemPath, data))).rejects.toThrow();
        await expect(store.transaction(async (tx) => tx.set(itemPath, item))).rejects.toThrow(); await expect(store.transaction(async (tx) => tx.delete(itemPath))).rejects.toThrow(); await expect(store.get(statusPath('p1'))).rejects.toThrow(); expect(fetchImpl.mock.calls.some(([url]) => url.endsWith(':commit'))).toBe(false);
    });
    it('MCP enforces strict schemas and separate lifecycle confirmation for both workflows', async () => {
        const f = fixture(); const server = createDirectFavoriteMcpSession({ ...f.dependencies, trackingBatchStore: f.store, trackingLifecycleStore: f.store, authorizeAction: createTestActionAuthority() });
        const client = new Client({ name: 'isolated', version: '1' }, { capabilities: { elicitation: { form: {} } } }); let extra = false;
        client.setRequestHandler(ElicitRequestSchema, async (request) => ({ action: 'accept', content: { approve: true, ...(request.params.requestedSchema.required.includes('trackingLifecycle') ? { trackingLifecycle: extra } : {}) } }));
        const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
        try {
            expect((await client.callTool({ name: 'prepare_player_tracking_batch', arguments: batch })).isError).not.toBe(true); expect((await client.callTool({ name: 'confirm_player_tracking_batch', arguments: { proposalId } })).structuredContent.status).toBe('completed');
            expect((await client.callTool({ name: 'prepare_private_tracking_active', arguments: { ...lifecycle, proposalId: second, visibility: 'public' } })).isError).toBe(true);
            expect((await client.callTool({ name: 'prepare_private_tracking_active', arguments: { ...lifecycle, proposalId: second } })).isError).not.toBe(true); expect((await client.callTool({ name: 'confirm_private_tracking_active', arguments: { proposalId: second, confirmed: true } })).isError).toBe(true);
            expect((await client.callTool({ name: 'confirm_private_tracking_active', arguments: { proposalId: second } })).structuredContent.applied).toBe(false); extra = true; expect((await client.callTool({ name: 'confirm_private_tracking_active', arguments: { proposalId: second } })).structuredContent.status).toBe('completed');
        } finally { await client.close(); await server.close(); }
    });
});
