import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { rosterFixture } from '../helpers/direct-roster-fixture.js';
import { createTestActionAuthority } from '../helpers/direct-test-authority.js';
import { createOneActionApproval } from '../../services/chatgpt-mcp/src/directActionApproval.js';
import { createDirectTeamSetupCommands, createDirectTeamSetupStore, TEAM_SETUP_PRESET_IDS, teamSetupPreset } from '../../services/chatgpt-mcp/src/directTeamSetup.js';
import { getStatConfigPresetById } from '../../js/stat-config-presets.js';
import { selectAnalyticsConfig } from '../../js/stat-leaderboards.js';
import { createDirectFavoriteMcpSession } from '../../services/chatgpt-mcp/src/directFavoriteMcp.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { InMemoryTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/inMemory.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
import projection from '../../functions/public-user-profile-projection-core.cjs';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const details = { proposalId, mode: 'details', teamId: 'team-1', changes: { name: 'Synthetic New Team', zip: '12345' } };
const preset = { proposalId, mode: 'preset', teamId: 'team-1', configId: `mcp_${proposalId}`, presetId: 'basketball', name: 'Synthetic New Config' };
const target = `teams/team-1/statTrackerConfigs/${preset.configId}`;
const accept = async () => ({ action: 'accept', content: { approve: true, publicConfiguration: true }, consume: async () => {} });
function fixture() {
    const f = rosterFixture(); f.put('teams/team-1', { name: 'Synthetic Team', zip: '54321', sport: 'Basketball', isPublic: false, ownerId: 'owner', ownerEmail: 'private@example.test', adminEmails: ['staff@example.test'],
        privateCalendarToken: 'Never copy', photoUrl: 'Preserve media', diamondScorebook: { enabled: false }, archived: false, active: true, other: { keep: [1, 2] } });
    f.put('teams/team-1/statTrackerConfigs/existing', { name: 'Existing config', baseType: 'Basketball', columns: ['PTS'], extended: { keep: true } });
    f.put('teams/team-1/games/game', { configId: 'existing', homeScore: 10, awayScore: 4 });
    return { ...f, commands: createDirectTeamSetupCommands(f.dependencies) };
}
describe('bounded team setup batch', () => {
    it.each(TEAM_SETUP_PRESET_IDS)('copies the actual normalized %s app preset without mutation', (id) => {
        expect(teamSetupPreset(id)).toEqual(getStatConfigPresetById(id)); const copy = teamSetupPreset(id); copy.statDefinitions[0].visibility = 'private'; expect(teamSetupPreset(id)).toEqual(getStatConfigPresetById(id));
    });
    it('patches only selected details while retaining membership, sport, visibility, media and unknown fields', async () => {
        const f = fixture(); const old = structuredClone(f.records.get('teams/team-1').data); const prepared = await f.commands.prepare(details);
        expect(prepared.preview).toMatchObject({ before: { name: old.name, zip: old.zip }, after: details.changes }); expect(JSON.stringify(prepared)).not.toMatch(/Never copy|private@example|staff@example|Preserve media/);
        await f.commands.confirm({ proposalId }, accept); expect(f.records.get('teams/team-1').data).toEqual({ ...old, ...details.changes, updatedAt: new Date(f.dependencies.now()) });
        expect(projection.buildTeamStaffMembershipKey(old)).toBe(projection.buildTeamStaffMembershipKey(f.records.get('teams/team-1').data));
        await f.commands.prepare({ ...details, proposalId: second, changes: { zip: '' } }); await f.commands.confirm({ proposalId: second }, accept);
        expect(f.records.get('teams/team-1').data.zip).toBe(''); expect(f.records.get('teams/team-1').data.name).toBe(details.changes.name);
    });
    it.each(TEAM_SETUP_PRESET_IDS)('creates %s with exact definitions, no game attachment and distinct public acknowledgement', async (presetId) => {
        const f = fixture(); const prepared = await f.commands.prepare({ ...preset, presetId });
        expect(prepared.preview.after).toEqual({ ...getStatConfigPresetById(presetId), name: preset.name }); expect(prepared.preview.effect).toMatch(/publicly readable/);
        expect(await f.commands.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} }))).toMatchObject({ applied: false }); expect(f.records.has(target)).toBe(false);
        await f.commands.confirm({ proposalId }, accept); expect(f.records.get(target).data).toEqual({ ...getStatConfigPresetById(presetId), name: preset.name, createdAt: new Date(f.dependencies.now()) });
        expect(f.records.get('teams/team-1/games/game').data).toEqual({ configId: 'existing', homeScore: 10, awayScore: 4 }); expect(f.records.get('teams/team-1/statTrackerConfigs/existing').data.extended).toEqual({ keep: true });
    });
    it('discloses the actual app automatic analytics selection effect before approval', async () => {
        const f = fixture(); const old = f.records.get('teams/team-1/statTrackerConfigs/existing').data;
        const prepared = await f.commands.prepare(preset); expect(prepared.preview.effect).toMatch(/automatically select.*analytics.*displayed metrics/);
        expect(selectAnalyticsConfig([old], 'Basketball').name).toBe(old.name);
        expect(selectAnalyticsConfig([old, prepared.preview.after], 'Basketball').name).toBe(preset.name);
        expect(f.records.get('teams/team-1/games/game').data).toEqual({ configId: 'existing', homeScore: 10, awayScore: 4 });
    });
    it.each([{}, { name: '' }, { name: ' padded' }, { name: 'bad\nname' }, { name: 'x'.repeat(121) }, { zip: '1234' }, { zip: '12345-6789' }, { zip: 12345 }, { isPublic: true }, { sport: 'Soccer' }, { ownerId: 'other' }, { adminEmails: [] }, { photoUrl: 'https://example.test' }, { leagueUrl: '' }])('rejects unsupported detail input %#', async (changes) => {
        const f = fixture(); await expect(f.commands.prepare({ ...details, changes })).rejects.toMatchObject({ code: 'invalid_argument' }); expect(f.store.create).not.toHaveBeenCalled();
    });
    it.each(['baseball', 'softball', 'blank', 'custom', '__proto__'])('rejects unsupported preset %s', async (presetId) => {
        const f = fixture(); await expect(f.commands.prepare({ ...preset, presetId })).rejects.toThrow(); expect(teamSetupPreset(presetId)).toBeNull();
    });
    it.each([{ active: false }, { active: 'true' }, { archived: true }, { isPublic: 'true' }, { zip: 'legacy' }, { name: 1 }])('rejects legacy/inactive team state %#', async (change) => {
        const f = fixture(); f.put('teams/team-1', { ...f.records.get('teams/team-1').data, ...change }); await expect(f.commands.prepare(details)).rejects.toThrow(); await expect(f.commands.prepare(preset)).rejects.toThrow();
    });
    it('accepts explicit nine-digit ZIP and handles a no-op without a write', async () => {
        const f = fixture(); await expect(f.commands.prepare({ ...details, changes: { zip: '54321' } })).rejects.toThrow();
        await f.commands.prepare({ ...details, changes: { zip: '123456789' } }); await f.commands.confirm({ proposalId }, accept); expect(f.records.get('teams/team-1').data.zip).toBe('123456789');
    });
    it('rejects duplicate normalized names, existing IDs and oversized config discovery', async () => {
        const f = fixture(); await expect(f.commands.prepare({ ...preset, name: 'EXISTING   CONFIG' })).rejects.toThrow();
        await expect(f.commands.prepare({ ...preset, configId: 'existing' })).rejects.toThrow();
        for (let i = 0; i < 100; i++) f.put(`teams/team-1/statTrackerConfigs/c${i}`, { name: `Config ${i}` });
        await expect(f.commands.prepare(preset)).rejects.toThrow(); await expect(f.commands.discover({ teamId: 'team-1' })).rejects.toThrow();
        await expect(f.commands.prepare(details)).resolves.toMatchObject({ status: 'prepared' });
    });
    it.each(['team', 'visibility', 'new_config', 'existing_config', 'target', 'role', 'actor', 'expiry'])('rejects %s changes during confirmation without creating a config', async (kind) => {
        const f = fixture(); await f.commands.prepare(preset);
        await expect(f.commands.confirm({ proposalId }, async () => {
            if (kind === 'team') f.put('teams/team-1', { ...f.records.get('teams/team-1').data, name: 'Changed' });
            if (kind === 'visibility') f.put('teams/team-1', { ...f.records.get('teams/team-1').data, isPublic: true });
            if (kind === 'new_config') f.put('teams/team-1/statTrackerConfigs/other', { name: preset.name });
            if (kind === 'existing_config') f.put('teams/team-1/statTrackerConfigs/existing', { name: 'Changed' });
            if (kind === 'target') f.put(target, { name: 'Competing' });
            if (kind === 'role') f.context.teams.clear(); if (kind === 'actor') f.context.uid = 'other'; if (kind === 'expiry') f.expire(); return accept();
        })).rejects.toThrow(); expect(f.records.get(target)?.data.name).not.toBe(preset.name);
    });
    it('requires manager access for discovery and preparation and omits private fields', async () => {
        const f = fixture(); const result = await f.commands.discover({ teamId: 'team-1' }); expect(result.presets.map((row) => row.id)).toEqual(TEAM_SETUP_PRESET_IDS); expect(JSON.stringify(result)).not.toMatch(/Never copy|private@example|staff@example|Preserve/);
        f.context.teams.get('team-1').roles = new Set(['parent']); await expect(f.commands.discover({ teamId: 'team-1' })).rejects.toThrow(); await expect(f.commands.prepare(details)).rejects.toThrow();
    });
    it('requires approval authority and fails closed for preview tampering', async () => {
        const f = fixture(); await f.commands.prepare(preset);
        for (const action of ['decline', 'cancel']) expect(await f.commands.confirm({ proposalId }, async () => ({ action }))).toMatchObject({ applied: false });
        await expect(f.commands.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true, publicConfiguration: true } }))).rejects.toThrow();
        f.records.get(`users/owner/privateAiPendingActions/direct_${proposalId}`).data.preview.after.statDefinitions[0].visibility = 'private';
        await expect(f.commands.confirm({ proposalId }, accept)).rejects.toThrow(); expect(f.records.has(target)).toBe(false);
    });
    it.each(['expiry', 'disconnect'])('guards final dispatch against %s using actual approval authority', async (kind) => {
        const f = fixture(); const abort = new AbortController(); const authority = createOneActionApproval({ getActor: async () => ({ uid: 'owner', clientId: 'test', grantKey: 'test', expiresAt: f.dependencies.now() + 1000000 }), now: f.dependencies.now });
        await f.commands.prepare(preset); const original = f.store.transaction.getMockImplementation();
        f.store.transaction.mockImplementation((callback, settings) => original(callback, { ...settings, beforeDispatch: async () => { const guard = await settings.beforeDispatch(); if (kind === 'expiry') f.advance(120001); else abort.abort(); return guard; } }));
        await expect(f.commands.confirm({ proposalId }, (preview) => authority(preview, accept, abort.signal))).rejects.toThrow(); expect(f.records.has(target)).toBe(false);
    });
    it.each([details, preset])('reconciles a lost %s response once and reauthorizes status', async (input) => {
        const f = fixture(); await f.commands.prepare(input); const original = f.store.transaction.getMockImplementation();
        f.store.transaction.mockImplementation(async (...args) => { await original(...args); throw new Error('Synthetic lost response'); });
        expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed'); expect((await f.commands.confirm({ proposalId }, accept)).status).toBe('completed'); expect(f.store.transaction).toHaveBeenCalledTimes(1);
        f.context.teams.clear(); await expect(f.commands.status({ proposalId })).rejects.toThrow();
    });
    it('adapter denies whole-team replacements, privilege/media patches, deletes and unrelated paths', async () => {
        const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ transaction: 'synthetic' }))); const store = createDirectTeamSetupStore({ projectId: 'demo-allplays-mcp-review', uid: 'owner', idToken: 'synthetic', fetchImpl });
        await expect(store.get('users/other')).rejects.toThrow(); expect(fetchImpl).not.toHaveBeenCalled();
        await expect(store.transaction(async (tx) => tx.set('teams/team-1', { name: 'Replacement' }))).rejects.toThrow();
        for (const key of ['isPublic', 'sport', 'ownerId', 'adminEmails', 'photoUrl', 'leagueUrl']) await expect(store.transaction(async (tx) => tx.patch('teams/team-1', { [key]: 'No', updatedAt: new Date() }))).rejects.toThrow();
        await expect(store.transaction(async (tx) => tx.delete('teams/team-1'))).rejects.toThrow(); await expect(store.transaction(async (tx) => tx.patch(target, { name: 'No', updatedAt: new Date() }))).rejects.toThrow();
        expect(fetchImpl.mock.calls.every(([url]) => !url.endsWith(':commit'))).toBe(true);
    });
    it('the actual team-write recipient hook refreshes existing candidate identities without sending', async () => {
        const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
        const code = source.slice(source.indexOf('async function syncNotificationRecipientsForTeamChange('), source.indexOf('exports.syncTeamNotificationRecipientsOnPreferenceWrite'));
        const sync = vi.fn(); const candidates = vi.fn(async (_id, team) => [{ uid: team.ownerId, roles: ['staff'] }]);
        const run = runInNewContext(`${code}; syncNotificationRecipientsForTeamChange`, { getCandidateUsersForTeamData: candidates, syncNotificationRecipientForTeamUser: sync });
        const f = fixture(); const before = f.records.get('teams/team-1').data; const after = { ...before, ...details.changes }; await run('team-1', before, after);
        expect(candidates).toHaveBeenCalledTimes(2); expect(sync).toHaveBeenCalledOnce(); expect(sync).toHaveBeenCalledWith('team-1', 'owner', { teamData: after });
        expect(projection.buildTeamStaffMembershipKey(before)).toBe(projection.buildTeamStaffMembershipKey(after));
    });
    it('MCP schemas reject privilege and arbitrary-config injection and require the public form checkbox', async () => {
        const f = fixture(); const server = createDirectFavoriteMcpSession({ ...f.dependencies, teamSetupStore: f.store, authorizeAction: createTestActionAuthority() });
        const client = new Client({ name: 'isolated', version: '1' }, { capabilities: { elicitation: { form: {} } } }); let acknowledged = false;
        client.setRequestHandler(ElicitRequestSchema, async (request) => { expect(request.params.requestedSchema.required).toEqual(['approve', 'publicConfiguration']); return { action: 'accept', content: { approve: true, publicConfiguration: acknowledged } }; });
        const [ct, st] = InMemoryTransport.createLinkedPair(); await server.connect(st); await client.connect(ct);
        try {
            expect((await client.callTool({ name: 'prepare_team_details', arguments: { proposalId, teamId: 'team-1', changes: { isPublic: true } } })).isError).toBe(true);
            const args = { proposalId, teamId: 'team-1', presetId: preset.presetId, name: preset.name };
            expect((await client.callTool({ name: 'prepare_stat_configuration_preset', arguments: { ...args, columns: ['PRIVATE'] } })).isError).toBe(true);
            expect((await client.callTool({ name: 'prepare_stat_configuration_preset', arguments: args })).isError).not.toBe(true);
            expect((await client.callTool({ name: 'confirm_team_setup', arguments: { proposalId, confirmed: true } })).isError).toBe(true);
            expect((await client.callTool({ name: 'confirm_team_setup', arguments: { proposalId } })).structuredContent.applied).toBe(false);
            acknowledged = true; expect((await client.callTool({ name: 'confirm_team_setup', arguments: { proposalId } })).structuredContent.status).toBe('completed');
        } finally { await client.close(); await server.close(); }
    });
});
