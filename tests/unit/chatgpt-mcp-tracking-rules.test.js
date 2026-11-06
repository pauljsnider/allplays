import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { createMockUserToken } from '@firebase/util';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { createDirectTrackingItemCommands, createDirectTrackingItemStore } from '../../services/chatgpt-mcp/src/directTrackingItem.js';
import { createDirectDiscovery } from '../../services/chatgpt-mcp/src/directDiscovery.js';
import { createDirectTrackingStatusCommands, createDirectTrackingStatusStore } from '../../services/chatgpt-mcp/src/directTrackingStatus.js';
import { createUserDb } from '../../services/chatgpt-mcp/src/firestoreRest.js';
const projectId = 'demo-allplays-mcp-review';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const secondId = '00112233-4455-4677-8899-aabbccddeeaa';
const input = { proposalId, mode: 'create', teamId: 'team-1', itemId: `mcp_${proposalId}`, changes: { name: 'Synthetic private checklist', description: 'Staff-only text' } };
const path = `teams/team-1/trackingItems/${input.itemId}`;
const header = `users/owner/privateAiPendingActions/direct_${proposalId}`;
const payload = `teams/team-1/privateAiPendingActions/direct_owner_${proposalId}`;
const accept = async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} });
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('private tracking commands under actual Firestore rules', () => {
    let env;
    beforeAll(async () => { env = await initializeTestEnvironment({ projectId, firestore: { rules: compactFirestoreRules(readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')) } }); }, 30000);
    afterAll(async () => env?.cleanup());
    const db = (uid = 'owner') => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
    const token = (uid = 'owner') => createMockUserToken({ sub: uid, email: `${uid}@example.test`, email_verified: true }, projectId);
    const localFetch = (url, options) => {
        const host = process.env.FIRESTORE_EMULATOR_HOST;
        if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !url.startsWith(`https://firestore.googleapis.com/v1/projects/${projectId}/`)) throw new Error('Only isolated emulator requests are allowed');
        return fetch(url.replace('https://firestore.googleapis.com', `http://${host}`), options);
    };
    const getContext = async () => {
        const team = (await getDoc(doc(db(), 'teams/team-1'))).data();
        return { uid: 'owner', teams: new Map([['team-1', { team, roles: new Set(team?.ownerId === 'owner' ? ['owner'] : []) }]]) };
    };
    const commands = (fetchImpl = localFetch) => createDirectTrackingItemCommands({ uid: 'owner', getContext,
        store: createDirectTrackingItemStore({ projectId, uid: 'owner', idToken: token(), fetchImpl }) });
    const statusInput = { proposalId: secondId, teamId: 'team-1', itemId: input.itemId, playerId: 'player', complete: true };
    const statusPath = `${path}/memberTracking/player`;
    const statusCommands = (fetchImpl = localFetch) => createDirectTrackingStatusCommands({ uid: 'owner', getContext,
        store: createDirectTrackingStatusStore({ projectId, uid: 'owner', idToken: token(), fetchImpl }) });
    const seedStatus = async () => {
        const engine = commands(); await engine.prepare(input); await engine.confirm({ proposalId }, accept);
        await env.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'teams/team-1/players/player'), { name: 'Synthetic Player', number: '07', active: true });
            await setDoc(doc(context.firestore(), `${path}/memberTracking/untouched`), { complete: false, note: 'Preserve' });
        });
    };
    beforeEach(async () => {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(context.firestore(), 'teams/team-1'), { ownerId: 'owner', adminEmails: [], name: 'Synthetic Team' });
        });
    });
    it('creates and patches the app-compatible private item while isolating proposal text and preserving creation audit', async () => {
        const engine = commands(); await engine.prepare(input);
        expect(JSON.stringify((await getDoc(doc(db(), header))).data())).not.toContain('Staff-only');
        expect((await getDoc(doc(db(), payload))).data().preview.after.description).toBe('Staff-only text');
        await assertFails(getDoc(doc(db('other'), payload)));
        await engine.confirm({ proposalId }, accept); const original = (await getDoc(doc(db(), path))).data();
        expect(original).toMatchObject({ ...input.changes, visibility: 'private', status: 'active', active: true, archived: false, createdBy: 'owner', updatedBy: 'owner' });
        await assertFails(getDoc(doc(db('member'), path)));
        expect((await getDoc(doc(db(), header))).data()).toMatchObject({ receiptOnly: true, status: 'completed', teamId: 'team-1', itemId: input.itemId });
        await env.withSecurityRulesDisabled(async (context) => expect((await getDoc(doc(context.firestore(), payload))).exists()).toBe(false));
        await engine.prepare({ ...input, proposalId: secondId, mode: 'update', changes: { description: '' } });
        await engine.confirm({ proposalId: secondId }, accept);
        const updated = (await getDoc(doc(db(), path))).data(); expect(updated.name).toBe(original.name); expect(updated.description).toBe(''); expect(updated.createdAt).toEqual(original.createdAt); expect(updated.createdBy).toBe(original.createdBy);
        expect((await engine.confirm({ proposalId: secondId }, () => { throw new Error('No second confirmation'); })).status).toBe('completed');
    });
    it.each(['decline', 'cancel'])('does not create an item after %s', async (action) => {
        const engine = commands(); await engine.prepare(input); await engine.confirm({ proposalId }, async () => ({ action })); expect((await getDoc(doc(db(), path))).exists()).toBe(false);
    });
    it('denies a different user at the business commit even if an upstream context incorrectly reports manager', async () => {
        let businessCommits = 0;
        const engine = commands(async (url, options) => {
            if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { businessCommits++; return localFetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token('other')}` } }); }
            return localFetch(url, options);
        });
        await engine.prepare(input); await expect(engine.confirm({ proposalId }, accept)).rejects.toThrow(); expect(businessCommits).toBe(1); expect((await getDoc(doc(db(), path))).exists()).toBe(false);
    });
    it('rejects a duplicate introduced while the form is open without overwriting it', async () => {
        const engine = commands(); await engine.prepare(input);
        await expect(engine.confirm({ proposalId }, async () => {
            await env.withSecurityRulesDisabled((context) => setDoc(doc(context.firestore(), 'teams/team-1/trackingItems/competing'), { name: input.changes.name, visibility: 'public' }));
            return accept();
        })).rejects.toThrow(); expect((await getDoc(doc(db(), path))).exists()).toBe(false);
    });
    it('reconciles a lost business commit response without creating or updating twice', async () => {
        let commits = 0; const engine = commands(async (url, options) => {
            const response = await localFetch(url, options);
            if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; if (response.ok) throw new Error('Synthetic lost commit response'); }
            return response;
        });
        await engine.prepare(input); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed');
        expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect(commits).toBe(1);
    });
    it('refuses a newly public item and preserves player tracking completions', async () => {
        const engine = commands(); await engine.prepare(input); await engine.confirm({ proposalId }, accept);
        const memberPath = `${path}/memberTracking/player`; await setDoc(doc(db(), memberPath), { complete: true });
        await engine.prepare({ ...input, proposalId: secondId, mode: 'update', changes: { description: 'Proposed' } });
        await updateDoc(doc(db(), path), { visibility: 'public', updatedBy: 'owner' });
        await expect(engine.confirm({ proposalId: secondId }, accept)).rejects.toThrow();
        expect((await getDoc(doc(db(), memberPath))).data()).toEqual({ complete: true }); expect((await getDoc(doc(db(), path))).data().description).toBe(input.changes.description);
    });
    it('pages exact IDs from the actual REST projection without private descriptions or statuses', async () => {
        const engine = commands(); await engine.prepare(input); await engine.confirm({ proposalId }, accept);
        const discovery = createDirectDiscovery({ uid: 'owner', getContext, getDb: async () => createUserDb({ projectId, idToken: token(), fetchImpl: localFetch }) });
        const result = await discovery.trackingItems({ teamId: 'team-1', limit: 1 }); expect(result.items[0]).toMatchObject({ id: input.itemId, name: input.changes.name, visibility: 'private' });
        expect(result.hasMore).toBe(false); expect(JSON.stringify(result)).not.toContain(input.changes.description);
    });
    it('creates and updates only one private completion under real rules, without names in personal metadata', async () => {
        await seedStatus(); const engine = statusCommands(); await engine.prepare(statusInput);
        const statusHeader = `users/owner/privateAiPendingActions/direct_${secondId}`;
        const statusPayload = `teams/team-1/privateAiPendingActions/direct_owner_${secondId}`;
        expect(JSON.stringify((await getDoc(doc(db(), statusHeader))).data())).not.toContain('Synthetic Player');
        await assertFails(getDoc(doc(db('other'), statusPayload)));
        await engine.confirm({ proposalId: secondId }, accept);
        expect((await getDoc(doc(db(), statusPath))).data()).toMatchObject({ teamId: 'team-1', trackingItemId: input.itemId, playerId: 'player', playerName: 'Synthetic Player', playerNumber: '07', complete: true, status: 'complete', updatedBy: 'owner', updatedByEmail: null });
        await assertFails(getDoc(doc(db('other'), statusPath)));
        expect((await getDoc(doc(db(), statusHeader))).data()).toMatchObject({ receiptOnly: true, status: 'completed', playerId: 'player' });
        expect(JSON.stringify((await getDoc(doc(db(), statusHeader))).data())).not.toContain('Synthetic Player');
        await env.withSecurityRulesDisabled(async (context) => expect((await getDoc(doc(context.firestore(), statusPayload))).exists()).toBe(false));
        const thirdId = '00112233-4455-4677-8899-aabbccddeebb';
        await engine.prepare({ ...statusInput, proposalId: thirdId, complete: false }); await engine.confirm({ proposalId: thirdId }, accept);
        expect((await getDoc(doc(db(), statusPath))).data()).toMatchObject({ complete: false, status: 'incomplete' });
        expect((await getDoc(doc(db(), `${path}/memberTracking/untouched`))).data()).toEqual({ complete: false, note: 'Preserve' });
        expect((await getDoc(doc(db(), path))).data().name).toBe(input.changes.name);
    });
    it.each(['publication', 'archival', 'player_deactivation', 'player_rename'])('rejects %s during completion approval', async (kind) => {
        await seedStatus(); const engine = statusCommands(); await engine.prepare(statusInput);
        await expect(engine.confirm({ proposalId: secondId }, async () => {
            await env.withSecurityRulesDisabled(async (context) => {
                if (kind === 'publication') await updateDoc(doc(context.firestore(), path), { visibility: 'public' });
                if (kind === 'archival') await updateDoc(doc(context.firestore(), path), { status: 'archived', active: false, archived: true });
                if (kind === 'player_deactivation') await updateDoc(doc(context.firestore(), 'teams/team-1/players/player'), { active: false });
                if (kind === 'player_rename') await updateDoc(doc(context.firestore(), 'teams/team-1/players/player'), { name: 'Different Player' });
            }); return accept();
        })).rejects.toThrow();
        expect((await getDoc(doc(db(), statusPath))).exists()).toBe(false);
    });
    it('denies incorrect credentials at the status business commit', async () => {
        await seedStatus(); let commits = 0; const engine = statusCommands(async (url, options) => {
            if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; return localFetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token('other')}` } }); }
            return localFetch(url, options);
        });
        await engine.prepare(statusInput); await expect(engine.confirm({ proposalId: secondId }, accept)).rejects.toThrow(); expect(commits).toBe(1); expect((await getDoc(doc(db(), statusPath))).exists()).toBe(false);
    });
    it('reconciles a lost completion response without another business commit', async () => {
        await seedStatus(); let commits = 0; const engine = statusCommands(async (url, options) => {
            const response = await localFetch(url, options);
            if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; if (response.ok) throw new Error('Synthetic lost response'); }
            return response;
        });
        await engine.prepare(statusInput); expect((await engine.confirm({ proposalId: secondId }, accept)).status).toBe('completed');
        expect((await engine.confirm({ proposalId: secondId }, accept)).status).toBe('completed'); expect(commits).toBe(1);
    });
    it('preserves legacy completion notes and refuses conversion', async () => {
        await seedStatus(); const original = { complete: false, note: 'Preserve historical staff note' }; await setDoc(doc(db(), statusPath), original);
        await expect(statusCommands().prepare(statusInput)).rejects.toMatchObject({ code: 'unsupported_tracking_status' }); expect((await getDoc(doc(db(), statusPath))).data()).toEqual(original);
    });
});
