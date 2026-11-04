import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { createMockUserToken } from '@firebase/util';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { createDirectRosterLifecycleCommands, createDirectRosterLifecycleStore } from '../../services/chatgpt-mcp/src/directRosterLifecycle.js';
const projectId = 'demo-allplays-mcp-review';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const path = (id) => `teams/team-1/players/${id}`;
const input = { proposalId, teamId: 'team-1', changes: [{ playerId: 'p1', active: false }, { playerId: 'p2', active: true }] };
const header = `users/owner/privateAiPendingActions/direct_${proposalId}`;
const payload = `teams/team-1/privateAiPendingActions/direct_owner_${proposalId}`;
const comparable = (value) => value?.type === 'document' && typeof value.path === 'string' ? { path: value.path }
    : value instanceof Timestamp ? value : Array.isArray(value) ? value.map(comparable)
        : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, child]) => [key, comparable(child)])) : value;
const accept = async () => ({ action: 'accept', content: { approve: true, rosterLifecycle: true }, consume: async () => {} });
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('roster lifecycle under actual rules and REST', () => {
    let env; let before;
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
    const commands = (fetchImpl = localFetch) => createDirectRosterLifecycleCommands({ uid: 'owner', getContext, store: createDirectRosterLifecycleStore({ projectId, uid: 'owner', idToken: token(), fetchImpl }) });
    const admin = (fn) => env.withSecurityRulesDisabled((context) => fn(context.firestore()));
    const read = async (key, uid = 'owner') => comparable((await getDoc(doc(db(uid), key))).data());
    const noWrites = async () => admin(async (database) => { for (const id of ['p1', 'p2']) expect(comparable((await getDoc(doc(database, path(id)))).data())).toEqual(before[id]); });
    beforeEach(async () => {
        await env.clearFirestore(); await admin(async (database) => {
            await setDoc(doc(database, 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(database, 'teams/team-1'), { ownerId: 'owner', adminEmails: [], isPublic: true, name: 'Synthetic Team' });
            await setDoc(doc(database, 'users/parent'), { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1'] });
            await setDoc(doc(database, path('p1')), { name: 'Synthetic One', number: 7, active: true, createdAt: new Timestamp(1000000000, 123456789), photoUrl: 'https://example.test/preserved', extension: { reference: doc(database, 'teams/team-1'), when: new Timestamp(1000000001, 987654321) }, medicalInfo: 'Legacy value never copied' });
            await setDoc(doc(database, path('p2')), { name: 'Synthetic Two', active: false, deactivatedAt: new Timestamp(1000000002, 123456789), position: 'Preserve' });
            await setDoc(doc(database, `${path('p1')}/private/profile`), { medicalInfo: 'Private original', photoPath: 'Preserve' });
            await setDoc(doc(database, 'teams/team-1/games/event'), { type: 'game', date: new Date(), roster: ['p1', 'p2'], homeScore: 12 });
        }); before = { p1: await read(path('p1')), p2: await read(path('p2')) };
    });
    it('atomically applies both states, deletes only the reactivation marker and preserves legacy fields and access', async () => {
        const engine = commands(); const privateBefore = await read(`${path('p1')}/private/profile`); const links = await read('users/parent', 'parent'); const event = await read('teams/team-1/games/event');
        const prepared = await engine.prepare(input); expect(JSON.stringify(prepared)).not.toMatch(/Legacy value|Private original|Preserve/); expect(JSON.stringify(await read(header))).not.toContain('Synthetic One'); await assertFails(getDoc(doc(db('parent'), payload)));
        await engine.confirm({ proposalId }, accept); const afterOne = await read(path('p1')); const afterTwo = await read(path('p2'));
        expect(afterOne.active).toBe(false); expect(afterOne.deactivatedAt).toEqual(afterOne.updatedAt); expect(afterTwo.active).toBe(true); expect(afterTwo.deactivatedAt).toBeUndefined();
        for (const key of ['name', 'number', 'createdAt', 'photoUrl', 'medicalInfo']) expect(afterOne[key]).toEqual(before.p1[key]); expect(afterOne.extension.when).toEqual(before.p1.extension.when); expect(afterOne.extension.reference.path).toBe(before.p1.extension.reference.path); expect(afterTwo.position).toBe(before.p2.position);
        expect(await read(`${path('p1')}/private/profile`, 'parent')).toEqual(privateBefore); expect(await read('users/parent', 'parent')).toEqual(links); expect(await read('teams/team-1/games/event')).toEqual(event);
        expect(await read(header)).toMatchObject({ receiptOnly: true, status: 'completed', playerIds: ['p1', 'p2'] }); await admin(async (database) => expect((await getDoc(doc(database, payload))).exists()).toBe(false));
        await engine.prepare({ ...input, proposalId: second, changes: input.changes.map((row) => ({ ...row, active: !row.active })) }); await engine.confirm({ proposalId: second }, accept); expect((await read(path('p1'))).deactivatedAt).toBeUndefined(); expect((await read(path('p2'))).active).toBe(false);
    });
    it('supports twenty mixed lifecycle changes within actual rules limits', async () => {
        const changes = Array.from({ length: 20 }, (_, i) => ({ playerId: `child${i}`, active: i % 2 === 0 }));
        await admin(async (database) => { for (const { playerId, active } of changes) await setDoc(doc(database, path(playerId)), { name: playerId, active: !active, ...(!active ? {} : { deactivatedAt: new Date(0) }) }); });
        const engine = commands(); await engine.prepare({ ...input, changes }); await engine.confirm({ proposalId }, accept); for (const { playerId, active } of changes) { const result = await read(path(playerId)); expect(result.active).toBe(active); if (active) expect(result.deactivatedAt).toBeUndefined(); }
    });
    it.each(['permission', 'team'])('rejects changed %s before committing any player', async (kind) => {
        const engine = commands(); await engine.prepare(input); await expect(engine.confirm({ proposalId }, async () => { await admin((database) => updateDoc(doc(database, 'teams/team-1'), kind === 'team' ? { archived: true } : { ownerId: 'newowner' })); return accept(); })).rejects.toThrow(); await noWrites();
    });
    it('preserves a competing player edit without changing the other player', async () => {
        const engine = commands(); await engine.prepare(input); await expect(engine.confirm({ proposalId }, async () => { await admin((database) => updateDoc(doc(database, path('p2')), { position: 'Competing' })); return accept(); })).rejects.toThrow(); expect(await read(path('p1'))).toEqual(before.p1); expect(await read(path('p2'))).toEqual({ ...before.p2, position: 'Competing' });
    });
    it.each(['other', 'unverified'])('rejects %s final credentials without partial records or receipts', async (kind) => {
        let commits = 0; const engine = commands(async (url, options) => { if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; return localFetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${kind === 'other' ? token('other') : token('owner', false)}` } }); } return localFetch(url, options); });
        await engine.prepare(input); await expect(engine.confirm({ proposalId }, accept)).rejects.toThrow(); expect(commits).toBe(1); await noWrites(); expect((await read(header)).status).toBe('prepared'); expect(await read(payload)).toBeDefined();
    });
    it('reconciles a lost response without repeating the write or resetting deactivatedAt', async () => {
        let commits = 0; const engine = commands(async (url, options) => { const response = await localFetch(url, options); if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; if (response.ok) throw new Error('Synthetic lost acknowledgment'); } return response; });
        await engine.prepare(input); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); const saved = await read(path('p1')); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect(await read(path('p1'))).toEqual(saved); expect(commits).toBe(1);
        await admin((database) => updateDoc(doc(database, 'teams/team-1'), { ownerId: 'newowner' })); await expect(engine.status({ proposalId })).rejects.toThrow();
    });
    it('requires the lifecycle acknowledgement and rejects no-op rows before changing a timestamp', async () => {
        const engine = commands(); await engine.prepare(input); expect(await engine.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} }))).toMatchObject({ applied: false }); await noWrites();
        await expect(engine.prepare({ ...input, proposalId: second, changes: [{ playerId: 'p2', active: false }] })).rejects.toThrow(); await noWrites();
    });
    it('does not overwrite an unrelated private edit made while the form is open', async () => {
        const engine = commands(); await engine.prepare(input); await engine.confirm({ proposalId }, async () => { await admin((database) => updateDoc(doc(database, `${path('p1')}/private/profile`), { medicalInfo: 'New private value' })); return accept(); }); expect((await read(`${path('p1')}/private/profile`, 'parent')).medicalInfo).toBe('New private value');
    });
});
