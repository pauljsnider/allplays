import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { rosterFixture } from '../helpers/direct-roster-fixture.js';
import { createTestActionAuthority } from '../helpers/direct-test-authority.js';
import { createOneActionApproval } from '../../services/chatgpt-mcp/src/directActionApproval.js';
import { createDirectPlayerProfileCommands, createDirectPlayerProfileStore } from '../../services/chatgpt-mcp/src/directPlayerProfile.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const target = 'teams/team-1/players/p1/private/profile';
const header = `users/owner/privateAiPendingActions/direct_${proposalId}`;
const input = { proposalId, teamId: 'team-1', playerId: 'p1', changes: { emergencyContactName: 'Synthetic Contact', emergencyContactPhone: '555-0100', medicalInfo: 'Synthetic note\nSecond line' } };
const accept = async () => ({ action: 'accept', content: { approve: true, privatePlayerProfile: true }, consume: async () => {} });
function fixture() {
    const f = rosterFixture(); f.context.teams.get('team-1').roles = new Set(['parent']);
    f.put('users/owner', { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1'] });
    f.put('teams/team-1/players/p1', { name: 'Synthetic Player', active: true, photoUrl: 'Retain public image' });
    const original = f.store.transaction.getMockImplementation();
    f.store.transaction.mockImplementation((callback, settings) => original((tx) => callback({ ...tx, patchFields: (path, data, masks) => {
        const merged = structuredClone(f.records.get(path).data);
        for (const mask of masks) { const keys = mask.split('.'); let dest = merged; let value = data; for (const key of keys.slice(0, -1)) { dest = dest[key] ||= {}; value = value[key]; } dest[keys.at(-1)] = value[keys.at(-1)]; }
        tx.set(path, merged);
    } }), settings));
    return { ...f, commands: createDirectPlayerProfileCommands(f.dependencies) };
}
describe('linked-player private text creation and updates', () => {
    it('creates only selected private fields and explicitly clears only one field', async () => {
        const f = fixture(); const before = structuredClone(f.records.get('teams/team-1/players/p1').data);
        const prepared = await f.commands.prepare(input); expect(prepared.preview).toMatchObject({ action: 'Create selected private player profile fields', changes: input.changes, requiredAcknowledgements: ['privatePlayerProfile'] });
        expect(prepared.preview.audience).toMatch(/every parent/); expect(prepared.message).toMatch(/Prepared is not applied/); expect(f.records.has(target)).toBe(false);
        await f.commands.confirm({ proposalId }, accept);
        expect(f.records.get(target).data).toEqual({ emergencyContact: { name: input.changes.emergencyContactName, phone: input.changes.emergencyContactPhone }, medicalInfo: input.changes.medicalInfo, updatedAt: new Date(f.dependencies.now()) });
        await f.commands.prepare({ ...input, proposalId: second, changes: { emergencyContactPhone: '' } }); await f.commands.confirm({ proposalId: second }, accept);
        expect(f.records.get(target).data.emergencyContact).toEqual({ name: input.changes.emergencyContactName, phone: '' }); expect(f.records.get(target).data.medicalInfo).toBe(input.changes.medicalInfo); expect(f.records.get('teams/team-1/players/p1').data).toEqual(before);
    });
    it('preserves nested extensions, photos, household contacts and untouched legacy fields without copying them', async () => {
        const f = fixture(); const old = { emergencyContact: { name: 'Prior private name', phone: 'Prior private phone', relation: { keep: 'Never copy' } }, medicalInfo: { legacy: 'Never copy' }, photoPath: 'Preserve', parentEmail: 'private@example.test', createdAt: new Date(0), extension: { secret: 'Never copy' } };
        f.put(target, old); const prepared = await f.commands.prepare({ ...input, changes: { emergencyContactName: 'New contact' } });
        expect(JSON.stringify(prepared)).not.toMatch(/Prior private|Never copy|private@example|Preserve/); expect(JSON.stringify(f.records.get(header).data)).not.toMatch(/Prior private|Never copy|private@example|Preserve/);
        await f.commands.confirm({ proposalId }, accept); expect(f.records.get(target).data).toEqual({ ...old, emergencyContact: { ...old.emergencyContact, name: 'New contact' }, updatedAt: new Date(f.dependencies.now()) });
    });
    it.each(['emergencyContactName', 'emergencyContactPhone', 'medicalInfo'])('supports explicit empty %s without populating omitted fields', async (field) => {
        const f = fixture(); await f.commands.prepare({ ...input, changes: { [field]: '' } }); await f.commands.confirm({ proposalId }, accept);
        const data = f.records.get(target).data; expect(Object.keys(data).sort()).toEqual([field === 'medicalInfo' ? 'medicalInfo' : 'emergencyContact', 'updatedAt'].sort());
    });
    it.each([{}, null, [], { photoPath: '' }, { parentEmail: 'no@example.test' }, { emergencyContact: { name: 'No' } }, { medicalInfo: 1 }, { medicalInfo: ' padded' }, { medicalInfo: 'x'.repeat(2001) }, { medicalInfo: 'bad\u0000text' }, { emergencyContactName: 'x'.repeat(121) }, { emergencyContactName: 'First\nLast' }, { emergencyContactPhone: 'x'.repeat(61) }])('rejects unsupported input %#', async (changes) => {
        const f = fixture(); await expect(f.commands.prepare({ ...input, changes })).rejects.toMatchObject({ code: 'invalid_argument' }); expect(f.store.create).not.toHaveBeenCalled();
    });
    it.each(['role', 'team_link', 'player_link', 'wrong_team', 'inactive', 'archived'])('rejects %s before preparing sensitive text', async (kind) => {
        const f = fixture();
        if (kind === 'role') f.context.teams.get('team-1').roles = new Set(['owner']);
        if (kind === 'team_link') f.put('users/owner', { parentTeamIds: [], parentPlayerKeys: ['team-1::p1'] });
        if (kind === 'player_link') f.put('users/owner', { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p2'] });
        if (kind === 'wrong_team') f.put('users/owner', { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-2::p1'] });
        if (kind === 'inactive') f.put('teams/team-1/players/p1', { active: false }); if (kind === 'archived') f.put('teams/team-1', { archived: true });
        await expect(f.commands.prepare(input)).rejects.toThrow(); expect(f.store.create).not.toHaveBeenCalled();
    });
    it.each([{ emergencyContact: 'legacy' }, { emergencyContact: [] }, { emergencyContact: { name: { legacy: true } } }, { medicalInfo: { legacy: true } }])('refuses lossy replacement of selected legacy data %#', async (old) => {
        const f = fixture(); f.put(target, old); await expect(f.commands.prepare(input)).rejects.toThrow(); expect(f.records.get(target).data).toEqual(old);
    });
    it.each(['profile', 'parent', 'player', 'team', 'role', 'expiry'])('rejects %s change during approval without writing the private profile', async (kind) => {
        const f = fixture(); await f.commands.prepare(input);
        await expect(f.commands.confirm({ proposalId }, async () => {
            if (kind === 'profile') f.put(target, { medicalInfo: 'Competing edit' });
            if (kind === 'parent') f.put('users/owner', { parentTeamIds: ['team-1'], parentPlayerKeys: [] });
            if (kind === 'player') f.put('teams/team-1/players/p1', { active: false });
            if (kind === 'team') f.put('teams/team-1', { archived: true });
            if (kind === 'role') f.context.teams.clear(); if (kind === 'expiry') f.expire(); return accept();
        })).rejects.toThrow(); expect(f.records.get(target)?.data).toEqual(kind === 'profile' ? { medicalInfo: 'Competing edit' } : undefined);
    });
    it.each(['expiry', 'disconnect', 'revoked'])('fails closed after awaited preparation for %s with actual approval authority', async (kind) => {
        const f = fixture(); const abort = new AbortController(); let current = true;
        const authority = createOneActionApproval({ getActor: async () => { if (!current) throw new Error('Revoked'); return { uid: 'owner', clientId: 'test', grantKey: 'test', expiresAt: f.dependencies.now() + 1000000 }; }, now: f.dependencies.now });
        await f.commands.prepare(input); const original = f.store.transaction.getMockImplementation();
        f.store.transaction.mockImplementation((callback, settings) => original(callback, { ...settings, beforeDispatch: async () => { const guard = await settings.beforeDispatch(); if (kind === 'disconnect') abort.abort(); if (kind === 'expiry') f.advance(120001); return guard; } }));
        await expect(f.commands.confirm({ proposalId }, (preview) => authority(preview, async () => { if (kind === 'revoked') current = false; return accept(); }, abort.signal))).rejects.toThrow(); expect(f.records.has(target)).toBe(false);
    });
    it('requires the separate audience acknowledgement and one-use authority', async () => {
        const f = fixture(); await f.commands.prepare(input);
        for (const privatePlayerProfile of [undefined, false, 'true']) expect(await f.commands.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true, privatePlayerProfile }, consume: async () => {} }))).toMatchObject({ applied: false });
        await expect(f.commands.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true, privatePlayerProfile: true } }))).rejects.toThrow(); expect(f.records.has(target)).toBe(false);
    });
    it('rejects proposal reuse with different text and reconciles a lost response without repeated writes', async () => {
        const f = fixture(); await f.commands.prepare(input); await expect(f.commands.prepare({ ...input, changes: { medicalInfo: 'Different' } })).rejects.toThrow();
        const original = f.store.transaction.getMockImplementation(); f.store.transaction.mockImplementation(async (...args) => { await original(...args); throw new Error('Synthetic lost response'); });
        expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed'); expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed'); expect(f.store.transaction).toHaveBeenCalledTimes(1);
        f.put('users/owner', { parentTeamIds: [], parentPlayerKeys: [] }); await expect(f.commands.status({ proposalId })).rejects.toThrow();
    });
    it('adapter rejects whole-record replacement, photos, contacts, mismatched masks and unrelated paths', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ transaction: 'synthetic' })));
        const store = createDirectPlayerProfileStore({ projectId: 'demo-allplays-mcp-review', uid: 'owner', idToken: 'synthetic', fetchImpl });
        await expect(store.get('users/other')).rejects.toThrow(); await expect(store.get('teams/team-1/players/p1/private/other')).rejects.toThrow(); expect(fetchImpl).not.toHaveBeenCalled();
        await expect(store.transaction(async (tx) => tx.set(target, { medicalInfo: 'No', updatedAt: new Date() }))).rejects.toThrow();
        for (const [data, mask] of [[{ photoPath: 'No', updatedAt: new Date() }, ['photoPath', 'updatedAt']], [{ medicalInfo: 'No', updatedAt: new Date() }, ['medicalInfo', 'parentEmail', 'updatedAt']], [{ emergencyContact: { name: 'No' }, updatedAt: new Date() }, ['emergencyContact', 'updatedAt']]]) await expect(store.transaction(async (tx) => tx.patchFields(target, data, mask))).rejects.toThrow();
        await expect(store.transaction(async (tx) => tx.delete(target))).rejects.toThrow(); await expect(store.transaction(async (tx) => tx.patch(target, { medicalInfo: 'No' }))).rejects.toThrow(); expect(fetchImpl.mock.calls.some(([url]) => url.endsWith(':commit'))).toBe(false);
    });
    it('uses the actual legacy private helper field names and blank normalization', async () => {
        const source = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8'); const setDoc = vi.fn(); const clock = new Date(0);
        const update = runInNewContext(`${source.slice(source.indexOf('export async function updatePlayerPrivateProfile('), source.indexOf('export async function getPlayerPrivateProfile(')).replace('export ', '')}; updatePlayerPrivateProfile`, { db: {}, Timestamp: { now: () => clock }, doc: (_, path) => path, setDoc });
        await update('team-1', 'p1', { emergencyContact: { name: input.changes.emergencyContactName, phone: input.changes.emergencyContactPhone }, medicalInfo: '' });
        expect(setDoc).toHaveBeenCalledWith(target, { emergencyContact: { name: input.changes.emergencyContactName, phone: input.changes.emergencyContactPhone }, medicalInfo: '', updatedAt: clock }, { merge: true });
    });
    it('MCP binds the exact private profile form and rejects extra scope or model approval', async () => {
        const f = fixture(); const server = createDirectFavoriteMcpSession({ ...f.dependencies, playerProfileStore: f.store, authorizeAction: createTestActionAuthority() });
        const client = new Client({ name: 'isolated', version: '1' }, { capabilities: { elicitation: { form: {} } } }); let approved = false;
        client.setRequestHandler(ElicitRequestSchema, async (request) => { expect(request.params.requestedSchema.required).toEqual(['approve', 'privatePlayerProfile']); expect(request.params.message).toContain('every parent'); return { action: 'accept', content: { approve: true, privatePlayerProfile: approved } }; });
        const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
        try {
            expect((await client.callTool({ name: 'prepare_linked_player_private_profile', arguments: { ...input, changes: { photoPath: 'No' } } })).isError).toBe(true);
            expect((await client.callTool({ name: 'prepare_linked_player_private_profile', arguments: input })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_linked_player_private_profile', arguments: { proposalId, confirmed: true } })).isError).toBe(true);
            expect((await client.callTool({ name: 'confirm_linked_player_private_profile', arguments: { proposalId } })).structuredContent.applied).toBe(false);
            approved = true; expect((await client.callTool({ name: 'confirm_linked_player_private_profile', arguments: { proposalId } })).structuredContent.status).toBe('completed');
            expect((await client.callTool({ name: 'get_linked_player_private_profile_action', arguments: { proposalId } })).structuredContent.status).toBe('completed');
        } finally { await client.close(); await server.close(); }
    });
});
