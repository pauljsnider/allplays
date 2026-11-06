import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { createMockUserToken } from '@firebase/util';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { createDirectTeamSetupCommands, createDirectTeamSetupStore, teamSetupPreset, TEAM_SETUP_PRESET_IDS } from '../../services/chatgpt-mcp/src/directTeamSetup.js';
const projectId = 'demo-allplays-mcp-review';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const details = { proposalId, mode: 'details', teamId: 'team-1', changes: { name: 'Synthetic New Team', zip: '12345' } };
const preset = { proposalId, mode: 'preset', teamId: 'team-1', configId: `mcp_${proposalId}`, presetId: 'basketball', name: 'Synthetic New Config' };
const target = `teams/team-1/statTrackerConfigs/${preset.configId}`;
const header = `users/owner/privateAiPendingActions/direct_${proposalId}`;
const payload = `teams/team-1/privateAiPendingActions/direct_owner_${proposalId}`;
const accept = async () => ({ action: 'accept', content: { approve: true, publicConfiguration: true }, consume: async () => {} });
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('team setup with actual user-credentialed rules', () => {
    let env; let clock;
    beforeAll(async () => { env = await initializeTestEnvironment({ projectId, firestore: { rules: compactFirestoreRules(readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')) } }); }, 30000);
    afterAll(async () => env?.cleanup());
    const db = (uid = 'owner') => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
    const token = (uid = 'owner', verified = true) => createMockUserToken({ sub: uid, email: `${uid}@example.test`, email_verified: verified }, projectId);
    const localFetch = (url, options) => {
        const host = process.env.FIRESTORE_EMULATOR_HOST;
        if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !url.startsWith(`https://firestore.googleapis.com/v1/projects/${projectId}/`)) throw new Error('Only isolated demo-emulator requests are allowed');
        return fetch(url.replace('https://firestore.googleapis.com', `http://${host}`), options);
    };
    const getContext = async () => ({ uid: 'owner', teams: new Map([['team-1', { roles: new Set(['owner']) }]]) });
    const commands = (fetchImpl = localFetch) => createDirectTeamSetupCommands({ uid: 'owner', getContext, now: () => clock,
        store: createDirectTeamSetupStore({ projectId, uid: 'owner', idToken: token(), fetchImpl }) });
    const admin = (fn) => env.withSecurityRulesDisabled((context) => fn(context.firestore()));
    const read = async (path) => (await getDoc(doc(db(), path))).data();
    beforeEach(async () => {
        clock = Date.now(); await env.clearFirestore(); await admin(async (database) => {
            await setDoc(doc(database, 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(database, 'users/owner'), { isAdmin: false });
            await setDoc(doc(database, 'users/parent'), { parentTeamIds: ['team-1'] });
            await setDoc(doc(database, 'users/other'), { isAdmin: false });
            await setDoc(doc(database, 'teams/team-1'), { name: 'Synthetic Team', ownerId: 'owner', adminEmails: ['admin@example.test'], sport: 'Basketball', zip: '54321', isPublic: false,
                privateCalendarToken: 'Never copy', photoUrl: 'Preserve', active: true, archived: false, createdAt: new Timestamp(1000000000, 123456789), unknown: { retain: true }, diamondScorebook: { enabled: false } });
            await setDoc(doc(database, 'teams/team-1/statTrackerConfigs/existing'), { name: 'Existing', columns: ['PTS'], privateExtension: { preserve: true } });
            await setDoc(doc(database, 'teams/team-1/games/game'), { configId: 'existing', homeScore: 10, awayScore: 4 });
        });
    });
    it('patches selected details preserving all other fields and strips completed proposal content', async () => {
        const before = await read('teams/team-1'); const engine = commands(); await engine.prepare(details);
        expect(JSON.stringify(await read(header))).not.toMatch(/Synthetic|12345|54321|Never copy/); expect((await read(payload)).preview.after).toEqual(details.changes);
        await assertFails(getDoc(doc(db('parent'), payload))); await assertFails(getDoc(doc(db('other'), header)));
        await engine.confirm({ proposalId }, accept); expect(await read('teams/team-1')).toEqual({ ...before, ...details.changes, updatedAt: Timestamp.fromMillis(clock) });
        expect(await read(header)).toMatchObject({ status: 'completed', receiptOnly: true, configId: null }); expect((await read(header)).preview).toBeUndefined();
        await admin(async (database) => expect((await getDoc(doc(database, payload))).exists()).toBe(false));
        await engine.prepare({ ...details, proposalId: second, changes: { zip: '' } }); await engine.confirm({ proposalId: second }, accept); expect((await read('teams/team-1')).zip).toBe('');
    });
    it.each(TEAM_SETUP_PRESET_IDS)('creates %s publicly readable metadata exactly as disclosed without game or team changes', async (presetId) => {
        const before = await read('teams/team-1'); const engine = commands(); await engine.prepare({ ...preset, presetId }); await engine.confirm({ proposalId }, accept);
        expect(await read(target)).toEqual({ ...teamSetupPreset(presetId), name: preset.name, createdAt: Timestamp.fromMillis(clock) });
        expect((await getDoc(doc(env.unauthenticatedContext().firestore(), target))).data().name).toBe(preset.name);
        expect(await read('teams/team-1')).toEqual(before); expect(await read('teams/team-1/games/game')).toEqual({ configId: 'existing', homeScore: 10, awayScore: 4 });
        expect(await read('teams/team-1/statTrackerConfigs/existing')).toMatchObject({ privateExtension: { preserve: true } });
        expect(await read(header)).toMatchObject({ status: 'completed', receiptOnly: true, mode: 'preset', configId: preset.configId }); expect((await read(header)).name).toBeUndefined();
    });
    it.each(['owner', 'visibility', 'archive', 'config', 'target'])('rejects %s changes after preparation', async (kind) => {
        const engine = commands(); await engine.prepare(preset);
        await expect(engine.confirm({ proposalId }, async () => {
            await admin(async (database) => {
                if (kind === 'owner') await updateDoc(doc(database, 'teams/team-1'), { ownerId: 'other' });
                if (kind === 'visibility') await updateDoc(doc(database, 'teams/team-1'), { isPublic: true });
                if (kind === 'archive') await updateDoc(doc(database, 'teams/team-1'), { archived: true });
                if (kind === 'config') await setDoc(doc(database, 'teams/team-1/statTrackerConfigs/competing'), { name: preset.name });
                if (kind === 'target') await setDoc(doc(database, target), { name: 'Competing' });
            }); return accept();
        })).rejects.toThrow(); await admin(async (database) => expect((await getDoc(doc(database, target))).data()?.name).not.toBe(preset.name));
    });
    it.each(['details_other', 'preset_other', 'details_unverified', 'preset_unverified'])('rules reject %s credentials at the atomic commit', async (kind) => {
        const input = kind.startsWith('details') ? details : preset; const before = await read('teams/team-1'); let commits = 0;
        const engine = commands(async (url, options) => {
            if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; return localFetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${kind.endsWith('unverified') ? token('owner', false) : token('other')}` } }); } return localFetch(url, options);
        });
        await engine.prepare(input); await expect(engine.confirm({ proposalId }, accept)).rejects.toThrow(); expect(commits).toBe(1); expect(await read('teams/team-1')).toEqual(before); expect(await read(target)).toBeUndefined();
    });
    it.each([details, preset])('reconciles lost %s responses without repeat writes', async (input) => {
        let commits = 0; const engine = commands(async (url, options) => {
            const response = await localFetch(url, options); if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; if (response.ok) throw new Error('Synthetic lost response'); } return response;
        });
        await engine.prepare(input); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect(commits).toBe(1);
    });
    it('invalidates a competing detail update after the first one commits', async () => {
        const engine = commands(); await engine.prepare(details); await engine.prepare({ ...details, proposalId: second, changes: { name: 'Competing Name' } });
        await engine.confirm({ proposalId }, accept); await expect(engine.confirm({ proposalId: second }, accept)).rejects.toThrow(); expect((await read('teams/team-1')).name).toBe(details.changes.name);
    });
    it('requires public acknowledgement before any preset transaction commit', async () => {
        let commits = 0; const engine = commands(async (url, options) => { if (url.endsWith(':commit') && JSON.parse(options.body).transaction) commits++; return localFetch(url, options); });
        await engine.prepare(preset); expect(await engine.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} }))).toMatchObject({ applied: false });
        expect(commits).toBe(0); expect(await read(target)).toBeUndefined();
    });
    it('a currently authorized admin can update details without changing owner-controlled fields', async () => {
        const before = await read('teams/team-1'); const engine = createDirectTeamSetupCommands({ uid: 'admin', getContext: async () => ({ uid: 'admin', teams: new Map([['team-1', { roles: new Set(['admin']) }]]) }), now: () => clock,
            store: createDirectTeamSetupStore({ projectId, uid: 'admin', idToken: token('admin'), fetchImpl: localFetch }) });
        await engine.prepare(details); await engine.confirm({ proposalId }, accept); expect(await read('teams/team-1')).toEqual({ ...before, ...details.changes, updatedAt: Timestamp.fromMillis(clock) });
    });
});
