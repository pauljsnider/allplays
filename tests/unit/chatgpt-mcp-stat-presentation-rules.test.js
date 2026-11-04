import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { createMockUserToken } from '@firebase/util';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { TEAM_SETUP_PRESET_IDS, teamSetupPreset } from '../../services/chatgpt-mcp/src/directTeamSetup.js';
import { createDirectStatPresentationCommands, createDirectStatPresentationStore } from '../../services/chatgpt-mcp/src/directStatPresentation.js';
const projectId = 'demo-allplays-mcp-review';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const path = 'teams/team-1/statTrackerConfigs/existing'; const newPath = `teams/team-1/statTrackerConfigs/mcp_${proposalId}`;
const update = { proposalId, mode: 'update', teamId: 'team-1', configId: 'existing', changes: [{ statId: 'pts', precision: 2, format: 'percentage', rankingOrder: 'asc' }] };
const create = { ...update, mode: 'create', configId: `mcp_${proposalId}`, presetId: 'basketball', name: 'Customized Basketball' };
const header = `users/owner/privateAiPendingActions/direct_${proposalId}`; const payload = `teams/team-1/privateAiPendingActions/direct_owner_${proposalId}`;
const accept = async () => ({ action: 'accept', content: { approve: true, publicConfiguration: true, statPresentation: true }, consume: async () => {} });
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('stat presentation with actual rules and REST', () => {
    let env;
    beforeAll(async () => { env = await initializeTestEnvironment({ projectId, firestore: { rules: compactFirestoreRules(readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')) } }); }, 30000);
    afterAll(async () => env?.cleanup());
    const db = (uid = 'owner') => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
    const token = (uid = 'owner', verified = true) => createMockUserToken({ sub: uid, email: `${uid}@example.test`, email_verified: verified }, projectId);
    const localFetch = (url, options) => {
        const host = process.env.FIRESTORE_EMULATOR_HOST;
        if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !url.startsWith(`https://firestore.googleapis.com/v1/projects/${projectId}/`)) throw new Error('Only isolated demo-emulator requests are allowed');
        return fetch(url.replace('https://firestore.googleapis.com', `http://${host}`), options);
    };
    const getContext = async () => { const team = (await getDoc(doc(db(), 'teams/team-1'))).data(); return { uid: 'owner', teams: new Map([['team-1', { team, roles: new Set(team?.ownerId === 'owner' ? ['owner'] : []) }]]) }; };
    const commands = (fetchImpl = localFetch) => createDirectStatPresentationCommands({ uid: 'owner', getContext, store: createDirectStatPresentationStore({ projectId, uid: 'owner', idToken: token(), fetchImpl }) });
    const admin = (fn) => env.withSecurityRulesDisabled((context) => fn(context.firestore()));
    const read = async (key) => (await getDoc(doc(db(), key))).data();
    beforeEach(async () => {
        await env.clearFirestore(); await admin(async (database) => {
            await setDoc(doc(database, 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(database, 'teams/team-1'), { ownerId: 'owner', adminEmails: [], isPublic: false, name: 'Synthetic Team' });
            await setDoc(doc(database, path), { ...teamSetupPreset('basketball'), createdAt: new Timestamp(1000000000, 123456789), id: 'existing' });
            await setDoc(doc(database, 'teams/team-1/games/game'), { type: 'game', date: new Date(), configId: 'existing', homeScore: 10, playerStats: { p1: { pts: 10 } } });
        });
    });
    it.each(TEAM_SETUP_PRESET_IDS)('creates customized %s metadata that is actually anonymous-readable even for a private team', async (presetId) => {
        const preset = teamSetupPreset(presetId); const engine = commands(); const input = { ...create, presetId, changes: preset.statDefinitions.map((row) => ({ statId: row.id, precision: 3 })) };
        const prepared = await engine.prepare(input); expect(prepared.preview.effect).toMatch(/publicly readable.*private team/); await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), payload))); expect(JSON.stringify(await read(header))).not.toContain('Customized');
        await engine.confirm({ proposalId }, accept); const saved = (await getDoc(doc(env.unauthenticatedContext().firestore(), newPath))).data(); expect(saved.name).toBe(create.name); expect(saved.statDefinitions).toEqual(preset.statDefinitions.map((row) => ({ ...row, precision: 3 }))); expect(saved.columns).toEqual(preset.columns);
        expect(await read(header)).toMatchObject({ receiptOnly: true, status: 'completed' }); await admin(async (database) => expect((await getDoc(doc(database, payload))).exists()).toBe(false)); expect((await read('teams/team-1/games/game')).configId).toBe('existing');
    });
    it('updates only selected presentation while preserving stored creation precision, identities and scoring data', async () => {
        const before = await read(path); const game = await read('teams/team-1/games/game'); const engine = commands(); await engine.prepare(update); await engine.confirm({ proposalId }, accept);
        const after = await read(path); expect(after.createdAt).toEqual(before.createdAt); expect(after.id).toBe(before.id); expect(after.name).toBe(before.name); expect(after.columns).toEqual(before.columns); expect(after.baseType).toBe(before.baseType);
        expect(after.statDefinitions).toEqual(before.statDefinitions.map((d) => d.id === 'pts' ? { ...d, precision: 2, format: 'percentage', rankingOrder: 'asc' } : d)); expect(await read('teams/team-1/games/game')).toEqual(game);
    });
    it('rejects a competing duplicate name without creating a second configuration', async () => {
        const engine = commands(); await engine.prepare(create); await expect(engine.confirm({ proposalId }, async () => { await admin((database) => setDoc(doc(database, 'teams/team-1/statTrackerConfigs/competing'), { name: create.name })); return accept(); })).rejects.toThrow(); expect(await read(newPath)).toBeUndefined();
    });
    it('rejects changed definitions without overwriting a later authorized edit', async () => {
        const before = await read(path); const defs = before.statDefinitions.map((d) => d.id === 'pts' ? { ...d, precision: 1 } : d); const engine = commands(); await engine.prepare(update);
        await expect(engine.confirm({ proposalId }, async () => { await admin((database) => updateDoc(doc(database, path), { statDefinitions: defs })); return accept(); })).rejects.toThrow(); expect((await read(path)).statDefinitions).toEqual(defs);
    });
    it('rejects changed manager authorization without a configuration write', async () => {
        const engine = commands(); await engine.prepare(create); await expect(engine.confirm({ proposalId }, async () => { await admin((database) => updateDoc(doc(database, 'teams/team-1'), { ownerId: 'newowner' })); return accept(); })).rejects.toThrow(); expect(await read(newPath)).toBeUndefined();
    });
    it.each([['create', 'other'], ['create', 'unverified'], ['update', 'other'], ['update', 'unverified']])('rejects %s using %s final credentials atomically', async (mode, actor) => {
        let commits = 0; const original = await read(path); const engine = commands(async (url, options) => { if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; return localFetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${actor === 'other' ? token('other') : token('owner', false)}` } }); } return localFetch(url, options); });
        await engine.prepare(mode === 'create' ? create : update); await expect(engine.confirm({ proposalId }, accept)).rejects.toThrow(); expect(commits).toBe(1); expect(await read(path)).toEqual(original); expect(await read(newPath)).toBeUndefined(); expect((await read(header)).status).toBe('prepared');
    });
    it.each(['create', 'update'])('reconciles a lost %s response without a duplicate write', async (mode) => {
        let commits = 0; const engine = commands(async (url, options) => { const response = await localFetch(url, options); if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; if (response.ok) throw new Error('Synthetic lost acknowledgment'); } return response; });
        await engine.prepare(mode === 'create' ? create : update); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect(commits).toBe(1);
        await admin((database) => updateDoc(doc(database, 'teams/team-1'), { ownerId: 'newowner' })); await expect(engine.status({ proposalId })).rejects.toThrow();
    });
    it('requires both extra acknowledgements before any business commit', async () => {
        const engine = commands(); await engine.prepare(create); for (const content of [{ approve: true, publicConfiguration: true }, { approve: true, statPresentation: true }]) expect(await engine.confirm({ proposalId }, async () => ({ action: 'accept', content, consume: async () => {} }))).toMatchObject({ applied: false }); expect(await read(newPath)).toBeUndefined();
    });
});
