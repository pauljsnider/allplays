import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { createMockUserToken } from '@firebase/util';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { createDirectPlayerProfileCommands, createDirectPlayerProfileStore } from '../../services/chatgpt-mcp/src/directPlayerProfile.js';
const projectId = 'demo-allplays-mcp-review';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const input = { proposalId, teamId: 'team-1', playerId: 'p1', changes: { emergencyContactName: 'Synthetic Contact', emergencyContactPhone: '555-0100', medicalInfo: 'Synthetic private note\nSecond line' } };
const target = 'teams/team-1/players/p1/private/profile';
const header = `users/parent/privateAiPendingActions/direct_${proposalId}`;
const accept = async () => ({ action: 'accept', content: { approve: true, privatePlayerProfile: true }, consume: async () => {} });
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('linked-player private profile with actual rules and REST', () => {
    let env; let clock;
    beforeAll(async () => { env = await initializeTestEnvironment({ projectId, firestore: { rules: compactFirestoreRules(readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')) } }); }, 30000);
    afterAll(async () => env?.cleanup());
    const db = (uid = 'parent') => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
    const token = (uid = 'parent', verified = true) => createMockUserToken({ sub: uid, email: `${uid}@example.test`, email_verified: verified }, projectId);
    const localFetch = (url, options) => {
        const host = process.env.FIRESTORE_EMULATOR_HOST;
        if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !url.startsWith(`https://firestore.googleapis.com/v1/projects/${projectId}/`)) throw new Error('Only isolated demo-emulator requests are allowed');
        return fetch(url.replace('https://firestore.googleapis.com', `http://${host}`), options);
    };
    const getContext = async () => ({ uid: 'parent', teams: new Map([['team-1', { roles: new Set(['parent']) }]]) });
    const commands = (fetchImpl = localFetch) => createDirectPlayerProfileCommands({ uid: 'parent', getContext, now: () => clock,
        store: createDirectPlayerProfileStore({ projectId, uid: 'parent', idToken: token(), fetchImpl }) });
    const admin = (fn) => env.withSecurityRulesDisabled((context) => fn(context.firestore()));
    const read = async (path, uid = 'parent') => (await getDoc(doc(db(uid), path))).data();
    const noProfile = async () => admin(async (database) => expect((await getDoc(doc(database, target))).exists()).toBe(false));
    beforeEach(async () => {
        clock = Date.now(); await env.clearFirestore(); await admin(async (database) => {
            await setDoc(doc(database, 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(database, 'teams/team-1'), { ownerId: 'owner', adminEmails: [], isPublic: true, name: 'Synthetic Team' });
            await setDoc(doc(database, 'users/parent'), { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1'] });
            await setDoc(doc(database, 'users/co_parent'), { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1'] });
            await setDoc(doc(database, 'users/other'), { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p2'] });
            for (const id of ['p1', 'p2']) await setDoc(doc(database, `teams/team-1/players/${id}`), { name: `Synthetic ${id}`, active: true, photoUrl: 'https://example.test/preserved' });
        });
    });
    it('creates private fields and a minimal receipt; only exact linked parents and staff can read the profile', async () => {
        const engine = commands(); const prepared = await engine.prepare(input); expect(prepared.preview.audience).toMatch(/every parent/);
        await assertFails(getDoc(doc(db('co_parent'), header))); await assertFails(getDoc(doc(db('owner'), header))); await engine.confirm({ proposalId }, accept);
        const expected = { emergencyContact: { name: input.changes.emergencyContactName, phone: input.changes.emergencyContactPhone }, medicalInfo: input.changes.medicalInfo };
        for (const uid of ['parent', 'co_parent', 'owner']) expect(await read(target, uid)).toMatchObject(expected);
        await assertFails(getDoc(doc(db('other'), target))); await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), target)));
        const receipt = await read(header); expect(receipt).toMatchObject({ status: 'completed', receiptOnly: true }); expect(receipt.changes).toBeUndefined(); expect(receipt.preview).toBeUndefined();
        expect(await read('teams/team-1/players/p1')).toEqual({ name: 'Synthetic p1', active: true, photoUrl: 'https://example.test/preserved' });
    });
    it('patches selected nested keys without copying or re-encoding unrelated private values', async () => {
        const old = { emergencyContact: { name: 'Prior private name', phone: 'Prior private phone', relation: { custom: true } }, medicalInfo: { legacy: 'Keep original' }, photoPath: 'private-path', parentEmail: 'private@example.test', createdAt: new Timestamp(1000000000, 123456789), extension: { reference: doc(db(), 'teams/team-1'), timestamp: new Timestamp(1000000001, 987654321) } };
        await admin((database) => setDoc(doc(database, target), old)); const original = await read(target); const engine = commands();
        const prepared = await engine.prepare({ ...input, changes: { emergencyContactName: 'New contact' } }); expect(JSON.stringify(prepared)).not.toMatch(/Prior private|Keep original|private-path|private@example/); expect(JSON.stringify(await read(header))).not.toMatch(/Prior private|Keep original|private-path|private@example/);
        await engine.confirm({ proposalId }, accept); const after = await read(target);
        expect(after.emergencyContact).toEqual({ ...original.emergencyContact, name: 'New contact' });
        for (const key of ['medicalInfo', 'photoPath', 'parentEmail', 'createdAt']) expect(after[key]).toEqual(original[key]); expect(after.extension.timestamp).toEqual(original.extension.timestamp); expect(after.extension.reference.path).toBe(original.extension.reference.path);
        await engine.prepare({ ...input, proposalId: second, changes: { emergencyContactPhone: '' } }); await engine.confirm({ proposalId: second }, accept); expect((await read(target)).emergencyContact).toEqual({ ...original.emergencyContact, name: 'New contact', phone: '' });
    });
    it.each(['medicalInfo', 'emergencyContactName', 'emergencyContactPhone'])('creates explicit empty %s without introducing other editable fields', async (field) => {
        const engine = commands(); await engine.prepare({ ...input, changes: { [field]: '' } }); await engine.confirm({ proposalId }, accept);
        const record = await read(target); expect(Object.keys(record).sort()).toEqual([field === 'medicalInfo' ? 'medicalInfo' : 'emergencyContact', 'updatedAt'].sort());
        if (field === 'medicalInfo') expect(record.medicalInfo).toBe(''); else expect(record.emergencyContact).toEqual({ [field === 'emergencyContactName' ? 'name' : 'phone']: '' });
    });
    it('patches a missing nested contact into an existing profile without touching its other fields', async () => {
        await admin((database) => setDoc(doc(database, target), { medicalInfo: 'Keep', photoPath: 'Keep' })); const engine = commands();
        await engine.prepare({ ...input, changes: { emergencyContactName: 'New' } }); await engine.confirm({ proposalId }, accept); expect(await read(target)).toMatchObject({ medicalInfo: 'Keep', photoPath: 'Keep', emergencyContact: { name: 'New' } });
    });
    it.each(['player_link', 'team_link', 'player', 'team', 'profile'])('rejects %s changes after preparation without a business write', async (kind) => {
        const engine = commands(); await engine.prepare(input);
        await expect(engine.confirm({ proposalId }, async () => {
            await admin(async (database) => {
                if (kind === 'player_link') await updateDoc(doc(database, 'users/parent'), { parentPlayerKeys: ['team-2::p1'] });
                if (kind === 'team_link') await updateDoc(doc(database, 'users/parent'), { parentTeamIds: [] });
                if (kind === 'player') await updateDoc(doc(database, 'teams/team-1/players/p1'), { active: false });
                if (kind === 'team') await updateDoc(doc(database, 'teams/team-1'), { archived: true });
                if (kind === 'profile') await setDoc(doc(database, target), { medicalInfo: 'Competing private edit' });
            }); return accept();
        })).rejects.toThrow(); if (kind === 'profile') expect(await read(target)).toEqual({ medicalInfo: 'Competing private edit' }); else await noProfile();
        expect((await read(header)).status).toBe('prepared');
    });
    it.each(['other', 'unverified'])('denies %s final commit credentials atomically', async (kind) => {
        let commits = 0; const engine = commands(async (url, options) => {
            if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; return localFetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${kind === 'other' ? token('other') : token('parent', false)}` } }); } return localFetch(url, options);
        });
        await engine.prepare(input); await expect(engine.confirm({ proposalId }, accept)).rejects.toThrow(); expect(commits).toBe(1); await noProfile(); expect((await read(header)).status).toBe('prepared');
    });
    it('reconciles a lost atomic commit response without repeating a profile write', async () => {
        let commits = 0; const engine = commands(async (url, options) => { const response = await localFetch(url, options); if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; if (response.ok) throw new Error('Synthetic lost acknowledgment'); } return response; });
        await engine.prepare(input); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect(commits).toBe(1);
        expect((await read(target)).medicalInfo).toBe(input.changes.medicalInfo);
        await admin((database) => updateDoc(doc(database, 'users/parent'), { parentPlayerKeys: [] })); await expect(engine.status({ proposalId })).rejects.toThrow();
    });
    it('requires the separate private-audience confirmation before transaction dispatch', async () => {
        let commits = 0; const engine = commands(async (url, options) => { if (url.endsWith(':commit') && JSON.parse(options.body).transaction) commits++; return localFetch(url, options); });
        await engine.prepare(input); expect(await engine.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} }))).toMatchObject({ applied: false }); expect(commits).toBe(0); await noProfile();
    });
    it('does not confuse proposal expiry with pending-text deletion', async () => {
        const engine = commands(); await engine.prepare(input); clock += 300001; await expect(engine.confirm({ proposalId }, accept)).rejects.toThrow(); await noProfile();
        // Explicit privacy gate: expiry blocks execution, but no TTL/cleanup is mounted.
        expect((await read(header)).changes.medicalInfo).toBe(input.changes.medicalInfo);
    });
});
