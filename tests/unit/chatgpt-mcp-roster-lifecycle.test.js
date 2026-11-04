import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import teamEmail from '../../functions/team-email-core.cjs';
import familyShare from '../../functions/family-share-core.cjs';
import { rosterFixture } from '../helpers/direct-roster-fixture.js';
import { createTestActionAuthority } from '../helpers/direct-test-authority.js';
import { createOneActionApproval } from '../../services/chatgpt-mcp/src/directActionApproval.js';
import { createDirectRosterLifecycleCommands, createDirectRosterLifecycleStore } from '../../services/chatgpt-mcp/src/directRosterLifecycle.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const path = (id) => `teams/team-1/players/${id}`;
const input = { proposalId, teamId: 'team-1', changes: [{ playerId: 'p1', active: false }, { playerId: 'p2', active: true }] };
const accept = async () => ({ action: 'accept', content: { approve: true, rosterLifecycle: true }, consume: async () => {} });
function fixture() {
    const f = rosterFixture(); f.put(path('p1'), { name: 'Synthetic One', number: 7, active: true, createdAt: new Date(0), contact: 'Never copy', extension: { keep: true } });
    f.put(path('p2'), { name: 'Synthetic Two', active: false, deactivatedAt: new Date(1000), photoUrl: 'Preserve' });
    f.put(`${path('p1')}/private/profile`, { medicalInfo: 'Never copy', photoPath: 'Preserve' }); f.put('users/parent', { parentPlayerKeys: ['team-1::p1'] });
    const original = f.store.transaction.getMockImplementation(); f.store.transaction.mockImplementation((callback, settings) => original((tx) => callback({ ...tx, patchFields: (key, data, mask) => {
        const next = structuredClone(f.records.get(key).data); for (const field of mask) { if (Object.hasOwn(data, field)) next[field] = data[field]; else delete next[field]; } tx.set(key, next);
    } }), settings));
    return { ...f, commands: createDirectRosterLifecycleCommands(f.dependencies) };
}
describe('single and atomic roster lifecycle commands', () => {
    it('deactivates and reactivates together, preserves all other fields, and can reverse the changes', async () => {
        const f = fixture(); const before = new Map([...f.records].map(([key, row]) => [key, structuredClone(row.data)])); const prepared = await f.commands.prepare(input);
        expect(prepared.preview.changes).toEqual([{ playerId: 'p1', name: 'Synthetic One', before: true, active: false }, { playerId: 'p2', name: 'Synthetic Two', before: false, active: true }]); expect(prepared.preview.effect).toMatch(/deactivation is not access revocation/); expect(JSON.stringify(prepared)).not.toMatch(/Never copy|Preserve/);
        await f.commands.confirm({ proposalId }, accept); expect(f.records.get(path('p1')).data).toEqual({ ...before.get(path('p1')), active: false, deactivatedAt: new Date(f.dependencies.now()), updatedAt: new Date(f.dependencies.now()) });
        const { deactivatedAt, ...oldTwo } = before.get(path('p2')); expect(f.records.get(path('p2')).data).toEqual({ ...oldTwo, active: true, updatedAt: new Date(f.dependencies.now()) });
        expect(f.records.get(`${path('p1')}/private/profile`).data).toEqual(before.get(`${path('p1')}/private/profile`)); expect(f.records.get('users/parent').data).toEqual(before.get('users/parent'));
        await f.commands.prepare({ ...input, proposalId: second, changes: input.changes.map((row) => ({ ...row, active: !row.active })) }); await f.commands.confirm({ proposalId: second }, accept);
        expect(f.records.get(path('p1')).data.active).toBe(true); expect(f.records.get(path('p1')).data.deactivatedAt).toBeUndefined(); expect(f.records.get(path('p2')).data.active).toBe(false);
    });
    it('matches the actual legacy single-player and grouped-import lifecycle payloads', async () => {
        const source = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8'); const now = new Date(12345); const deleted = Symbol('deleted'); const writes = [];
        const globals = { db: {}, Timestamp: { now: () => now }, deleteField: () => deleted, doc: (_, collection, id) => ({ path: `${collection}/${id}`, id }), updateDoc: async (ref, data) => writes.push({ path: ref.path, data }), writeBatch: () => ({ update: (ref, data) => writes.push({ path: ref.path, data }), commit: async () => {} }), assertNoSensitivePlayerFields: () => {} };
        const singles = runInNewContext(`${source.slice(source.indexOf('export async function deactivatePlayer('), source.indexOf('function sortRegistrationReviews(')).replaceAll('export ', '')}; ({deactivatePlayer,reactivatePlayer})`, globals);
        const grouped = runInNewContext(`${source.slice(source.indexOf('export async function applyRosterCsvImportOperations('), source.indexOf('export async function deletePlayer(')).replace('export ', '')}; applyRosterCsvImportOperations`, globals);
        await singles.deactivatePlayer('team-1', 'p1'); await singles.reactivatePlayer('team-1', 'p2'); const expected = writes.splice(0);
        await grouped('team-1', [{ type: 'deactivate', playerId: 'p1' }, { type: 'reactivate', playerId: 'p2' }]); expect(writes).toEqual(expected);
        const f = fixture(); const masks = []; const original = f.store.transaction.getMockImplementation(); f.store.transaction.mockImplementation((callback, settings) => original((tx) => callback({ ...tx, patchFields: (key, data, mask) => { masks.push({ path: key, data, mask }); tx.patchFields(key, data, mask); } }), settings));
        await f.commands.prepare(input); await f.commands.confirm({ proposalId }, accept);
        expect(masks.map(({ path, data, mask }) => ({ path, data: { active: data.active, deactivatedAt: Object.hasOwn(data, 'deactivatedAt') ? now : deleted, updatedAt: now }, mask }))).toEqual(expected.map((write) => ({ ...write, mask: ['active', 'deactivatedAt', 'updatedAt'] })));
    });
    it('discloses and verifies actual family-calendar, email-selection and existing RSVP-link effects', async () => {
        const f = fixture(); const getPlayer = () => ({ id: 'p1', ...f.records.get(path('p1')).data, parents: [{ email: 'synthetic@example.test' }] });
        const children = () => familyShare.resolveFamilyShareChildrenFromOwnerProfile({ parentPlayerKeys: ['team-1::p1'] }, { loadTeam: async () => ({ name: 'Synthetic' }), loadPlayer: async () => getPlayer() });
        const recipients = () => teamEmail.resolveTeamEmailRecipients({ players: [getPlayer()] });
        const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
        const assertRsvp = runInNewContext(`${source.slice(source.indexOf('async function assertUsablePublicRsvpToken('), source.indexOf('function assertPublicRsvpTokenMetadataUsable('))}; assertUsablePublicRsvpToken`, { assertPublicRsvpTokenMetadataUsable: () => {}, loadPublicRsvpEvent: async () => ({ data: {} }), firestore: { doc: (key) => ({ get: async () => ({ exists: true, data: () => key === path('p1') ? getPlayer() : {} }) }) } });
        const token = { teamId: 'team-1', playerId: 'p1', gameId: 'event' };
        expect(await children()).toHaveLength(1); expect(recipients()).toHaveLength(1); await expect(assertRsvp(token)).resolves.toBeDefined();
        const prepared = await f.commands.prepare(input); expect(prepared.preview.effect).toMatch(/public RSVP links.*communication eligibility/); await f.commands.confirm({ proposalId }, accept);
        expect(await children()).toEqual([]); expect(recipients()).toEqual([]); await expect(assertRsvp(token)).rejects.toThrow('Invalid RSVP link');
        await f.commands.prepare({ ...input, proposalId: second, changes: [{ playerId: 'p1', active: true }] }); await f.commands.confirm({ proposalId: second }, accept);
        expect(await children()).toHaveLength(1); expect(recipients()).toHaveLength(1); await expect(assertRsvp(token)).resolves.toBeDefined();
    });
    it.each([[], Array.from({ length: 21 }, (_, i) => ({ playerId: `p${i}`, active: false })), [{ playerId: 'p1', active: 'false' }], [{ playerId: 'p1', active: false, name: 'No' }], [{ playerId: 'p1', active: false }, { playerId: 'p1', active: true }], [{ playerId: '../p1', active: false }]])('rejects invalid batch %#', async (changes) => { const f = fixture(); await expect(f.commands.prepare({ ...input, changes })).rejects.toThrow(); expect(f.store.create).not.toHaveBeenCalled(); });
    it.each([{ active: null }, { active: 'true' }, { name: ' padded' }, { deleted: true }, { deactivatedAt: new Date() }, { deactivatedAt: 'legacy' }])('refuses unsupported player state %#', async (change) => { const f = fixture(); f.put(path('p1'), { ...f.records.get(path('p1')).data, ...change }); await expect(f.commands.prepare(input)).rejects.toThrow(); expect(f.store.create).not.toHaveBeenCalled(); });
    it('accepts a missing active flag as active and inactive players without a historical marker', async () => {
        const f = fixture(); f.put(path('p1'), { name: 'Synthetic One' }); f.put(path('p2'), { name: 'Synthetic Two', active: false }); await f.commands.prepare(input); await f.commands.confirm({ proposalId }, accept); expect(f.records.get(path('p1')).data.active).toBe(false); expect(f.records.get(path('p2')).data.deactivatedAt).toBeUndefined();
    });
    it('refuses no-op rows rather than resetting a previous deactivation date', async () => { const f = fixture(); await expect(f.commands.prepare({ ...input, changes: [{ playerId: 'p2', active: false }] })).rejects.toMatchObject({ code: 'conflict' }); expect(f.records.get(path('p2')).data.deactivatedAt).toEqual(new Date(1000)); });
    it.each(['player', 'team', 'permission', 'expiry'])('rejects changed %s without partial roster edits', async (kind) => {
        const f = fixture(); await f.commands.prepare(input); await expect(f.commands.confirm({ proposalId }, async () => { if (kind === 'player') f.put(path('p2'), { ...f.records.get(path('p2')).data, name: 'Changed' }); if (kind === 'team') f.put('teams/team-1', { archived: true }); if (kind === 'permission') f.context.teams.clear(); if (kind === 'expiry') f.expire(); return accept(); })).rejects.toThrow(); expect(f.records.get(path('p1')).data.active).toBe(true); expect(f.records.get(path('p2')).data.active).toBe(false);
    });
    it('requires a separate acknowledgement, bound authority and untampered receipt IDs', async () => {
        const f = fixture(); await f.commands.prepare(input); expect(await f.commands.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} }))).toMatchObject({ applied: false }); await expect(f.commands.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true, rosterLifecycle: true } }))).rejects.toThrow();
        f.records.get(`users/owner/privateAiPendingActions/direct_${proposalId}`).data.playerIds = ['other']; await expect(f.commands.confirm({ proposalId }, accept)).rejects.toThrow(); expect(f.records.get(path('p1')).data.active).toBe(true);
    });
    it.each(['expiry', 'disconnect'])('guards final dispatch after awaited preparation for %s', async (kind) => {
        const f = fixture(); const abort = new AbortController(); const authority = createOneActionApproval({ getActor: async () => ({ uid: 'owner', clientId: 'test', grantKey: 'test', expiresAt: f.dependencies.now() + 1000000 }), now: f.dependencies.now }); await f.commands.prepare(input);
        const original = f.store.transaction.getMockImplementation(); f.store.transaction.mockImplementation((callback, settings) => original(callback, { ...settings, beforeDispatch: async () => { const guard = await settings.beforeDispatch(); if (kind === 'disconnect') abort.abort(); else f.advance(120001); return guard; } }));
        await expect(f.commands.confirm({ proposalId }, (preview) => authority(preview, accept, abort.signal))).rejects.toThrow(); expect(f.records.get(path('p1')).data.active).toBe(true); expect(f.records.get(path('p2')).data.active).toBe(false);
    });
    it('reconciles a lost response once and reauthorizes completed status', async () => {
        const f = fixture(); await f.commands.prepare(input); const original = f.store.transaction.getMockImplementation(); f.store.transaction.mockImplementation(async (...args) => { await original(...args); throw new Error('Synthetic lost response'); }); expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed'); expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed'); expect(f.store.transaction).toHaveBeenCalledTimes(1); f.context.teams.clear(); await expect(f.commands.status({ proposalId })).rejects.toThrow();
    });
    it('adapter forbids unrelated paths, broad masks, replacements, deletes and marker injection', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ transaction: 'synthetic' }))); const store = createDirectRosterLifecycleStore({ projectId: 'demo-allplays-mcp-review', uid: 'owner', idToken: 'synthetic', fetchImpl }); const time = new Date();
        await expect(store.get(`${path('p1')}/private/profile`)).rejects.toThrow(); await expect(store.get('users/parent')).rejects.toThrow(); expect(fetchImpl).not.toHaveBeenCalled();
        for (const [data, mask] of [[{ active: true, updatedAt: time, deactivatedAt: time }, ['active', 'deactivatedAt', 'updatedAt']], [{ active: true, updatedAt: time }, ['active', 'photoUrl', 'deactivatedAt', 'updatedAt']], [{ active: false, updatedAt: time }, ['active', 'deactivatedAt', 'updatedAt']]]) await expect(store.transaction(async (tx) => tx.patchFields(path('p1'), data, mask))).rejects.toThrow();
        await expect(store.transaction(async (tx) => tx.set(path('p1'), { active: false }))).rejects.toThrow(); await expect(store.transaction(async (tx) => tx.delete(path('p1')))).rejects.toThrow(); expect(fetchImpl.mock.calls.some(([url]) => url.endsWith(':commit'))).toBe(false);
    });
    it('MCP uses strict single/batch tools and the separate lifecycle form', async () => {
        const f = fixture(); const server = createDirectFavoriteMcpSession({ ...f.dependencies, rosterLifecycleStore: f.store, authorizeAction: createTestActionAuthority() }); const client = new Client({ name: 'isolated', version: '1' }, { capabilities: { elicitation: { form: {} } } }); let approved = false;
        client.setRequestHandler(ElicitRequestSchema, async (request) => { expect(request.params.requestedSchema.required).toEqual(['approve', 'rosterLifecycle']); return { action: 'accept', content: { approve: true, rosterLifecycle: approved } }; }); const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
        try {
            expect((await client.callTool({ name: 'prepare_roster_lifecycle_batch', arguments: input })).isError).not.toBe(true); expect((await client.callTool({ name: 'confirm_roster_lifecycle', arguments: { proposalId, confirmed: true } })).isError).toBe(true); expect((await client.callTool({ name: 'confirm_roster_lifecycle', arguments: { proposalId } })).structuredContent.applied).toBe(false); approved = true; expect((await client.callTool({ name: 'confirm_roster_lifecycle', arguments: { proposalId } })).structuredContent.status).toBe('completed');
            expect((await client.callTool({ name: 'prepare_roster_player_active', arguments: { proposalId: second, teamId: 'team-1', playerId: 'p1', active: true, revokeAccess: true } })).isError).toBe(true); expect((await client.callTool({ name: 'prepare_roster_player_active', arguments: { proposalId: second, teamId: 'team-1', playerId: 'p1', active: true } })).isError).not.toBe(true); expect((await client.callTool({ name: 'confirm_roster_lifecycle', arguments: { proposalId: second } })).structuredContent.status).toBe('completed');
        } finally { await client.close(); await server.close(); }
    });
});
