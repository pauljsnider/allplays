import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { createMockUserToken } from '@firebase/util';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { createDirectAssignmentBatchCommands, createDirectAssignmentBatchStore } from '../../services/chatgpt-mcp/src/directAssignmentBatch.js';
import { createDirectAssignmentClaimCommands, createDirectAssignmentClaimStore } from '../../services/chatgpt-mcp/src/directAssignmentClaims.js';
const projectId = 'demo-allplays-mcp-review';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const eventPath = 'teams/team-1/games/event';
const claimPath = (role) => `${eventPath}/assignmentClaims/${role}`;
const header = `users/owner/privateAiPendingActions/direct_${proposalId}`;
const payload = `teams/team-1/privateAiPendingActions/direct_owner_${proposalId}`;
const open = (role) => ({ role, value: '', claimable: true });
const fixed = (role) => ({ role, value: 'Synthetic Staff', claimable: false });
const operation = (action, role, assignment = open(role)) => ({ action, role, assignment });
const input = { proposalId, teamId: 'team-1', eventId: 'event', operations: [operation('update', 'Snack', fixed('Snacks')), operation('create', 'Water')] };
const claim = { claimedByUserId: 'parent', claimedByName: 'Synthetic Parent', claimedAt: new Timestamp(1000000000, 123456789) };
const accept = async () => ({ action: 'accept', content: { approve: true, assignmentChanges: true }, consume: async () => {} });
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('assignment batch under actual rules and REST transactions', () => {
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
    const getContext = async () => { const team = (await getDoc(doc(db(), 'teams/team-1'))).data(); return { uid: 'owner', teams: new Map([['team-1', { roles: new Set(team?.ownerId === 'owner' ? ['owner'] : []) }]]) }; };
    const commands = (fetchImpl = localFetch) => createDirectAssignmentBatchCommands({ uid: 'owner', getContext, store: createDirectAssignmentBatchStore({ projectId, uid: 'owner', idToken: token(), fetchImpl }) });
    const parentCommands = () => createDirectAssignmentClaimCommands({ uid: 'parent', getContext: async () => ({ uid: 'parent', teams: new Map([['team-1', { roles: new Set(['parent']) }]]) }), store: createDirectAssignmentClaimStore({ projectId, uid: 'parent', idToken: token('parent'), fetchImpl: localFetch }) });
    const admin = (fn) => env.withSecurityRulesDisabled((context) => fn(context.firestore()));
    const read = async (path) => (await getDoc(doc(db(), path))).data();
    beforeEach(async () => {
        await env.clearFirestore(); await admin(async (database) => {
            await setDoc(doc(database, 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(database, 'teams/team-1'), { ownerId: 'owner', adminEmails: [], isPublic: false, name: 'Synthetic Team' });
            await setDoc(doc(database, 'users/parent'), { fullName: 'Synthetic Parent', parentTeamIds: ['team-1'] });
            await setDoc(doc(database, eventPath), { type: 'game', date: new Date('2060-01-01'), assignments: [open('Snack'), fixed('Equipment')],
                notes: 'Keep private notes', exactTimestamp: new Timestamp(1000000000, 123456789), extension: { preserved: true } });
        });
    });
    it('saves all slots and clears only reviewed claims atomically with team-private proposal content', async () => {
        await admin(async (database) => { for (const role of ['Snack', 'Snacks', 'Water', 'Equipment']) await setDoc(doc(database, claimPath(role)), claim); });
        const exactBefore = (await read(eventPath)).exactTimestamp; const untouched = await read(claimPath('Equipment')); const engine = commands();
        const prepared = await engine.prepare(input); expect(prepared.preview.removedClaims.map((row) => row.role)).toEqual(['Snack', 'Snacks', 'Water']);
        const opaque = JSON.stringify(await read(header)); expect(opaque).not.toContain('Synthetic Parent'); expect(opaque).not.toContain('Snacks'); await assertFails(getDoc(doc(db('parent'), payload))); await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), payload)));
        await engine.confirm({ proposalId }, accept); const saved = await read(eventPath);
        expect(saved.assignments).toEqual([fixed('Snacks'), fixed('Equipment'), open('Water')]); expect(saved.exactTimestamp).toEqual(exactBefore); expect(saved.notes).toBe('Keep private notes'); expect(saved.extension).toEqual({ preserved: true });
        for (const role of ['Snack', 'Snacks', 'Water']) expect(await read(claimPath(role))).toBeUndefined(); expect(await read(claimPath('Equipment'))).toEqual(untouched);
        expect((await getDoc(doc(db('parent'), eventPath))).data().assignments).toEqual(saved.assignments);
        expect(await read(header)).toMatchObject({ status: 'completed', receiptOnly: true }); expect(JSON.stringify(await read(header))).not.toContain('Snacks'); await admin(async (database) => expect((await getDoc(doc(database, payload))).exists()).toBe(false));
    });
    it('handles twenty claim removals plus slot edits and receipt within actual rules limits', async () => {
        const slots = Array.from({ length: 20 }, (_, i) => open(`Role${i}`));
        await admin(async (database) => { await updateDoc(doc(database, eventPath), { assignments: slots }); for (const row of slots) await setDoc(doc(database, claimPath(row.role)), claim); });
        const engine = commands(); await engine.prepare({ ...input, operations: slots.map((row) => operation('update', row.role, fixed(row.role))) }); await engine.confirm({ proposalId }, accept);
        expect((await read(eventPath)).assignments).toEqual(slots.map((row) => fixed(row.role))); for (const row of slots) expect(await read(claimPath(row.role))).toBeUndefined();
    });
    it('creates twenty new slots and rejects a prepared conflicting case-insensitive destination', async () => {
        const engine = commands(); const operations = Array.from({ length: 20 }, (_, i) => operation('create', `New${i}`)); await engine.prepare({ ...input, operations }); await engine.confirm({ proposalId }, accept); expect((await read(eventPath)).assignments).toHaveLength(22);
        await expect(engine.prepare({ ...input, proposalId: '00112233-4455-4677-8899-aabbccddeeaa', operations: [operation('create', 'new0')] })).rejects.toThrow();
    });
    it.each(['claim', 'destination', 'event', 'manager'])('rejects changed %s while the form is open without partial batch writes', async (kind) => {
        const engine = commands(); await engine.prepare(input);
        await expect(engine.confirm({ proposalId }, async () => { await admin((database) => kind === 'manager'
            ? updateDoc(doc(database, 'teams/team-1'), { ownerId: 'newowner' }) : kind === 'event'
                ? updateDoc(doc(database, eventPath), { location: 'Competing edit' }) : setDoc(doc(database, claimPath(kind === 'claim' ? 'Snack' : 'Water')), claim)); return accept(); })).rejects.toThrow();
        await admin(async (database) => expect((await getDoc(doc(database, eventPath))).data().assignments).toEqual([open('Snack'), fixed('Equipment')]));
    });
    it.each(['outsider', 'unverified'])('rejects %s final credentials without any partial claim deletion', async (kind) => {
        await admin((database) => setDoc(doc(database, claimPath('Snack')), claim)); let commits = 0;
        const engine = commands(async (url, options) => { if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; return localFetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${kind === 'outsider' ? token('outsider') : token('owner', false)}` } }); } return localFetch(url, options); });
        await engine.prepare(input); await expect(engine.confirm({ proposalId }, accept)).rejects.toThrow(); expect(commits).toBe(1);
        expect((await read(eventPath)).assignments).toEqual([open('Snack'), fixed('Equipment')]); expect(await read(claimPath('Snack'))).toBeDefined(); expect((await read(header)).status).toBe('prepared');
    });
    it('reconciles a lost successful acknowledgment once and preserves a later authorized edit', async () => {
        let commits = 0; const engine = commands(async (url, options) => { const response = await localFetch(url, options); if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; if (response.ok) throw new Error('Synthetic lost acknowledgment'); } return response; });
        await engine.prepare(input); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed');
        await admin((database) => updateDoc(doc(database, eventPath), { assignments: [open('Later edit')] })); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect(commits).toBe(1); expect((await read(eventPath)).assignments).toEqual([open('Later edit')]);
    });
    it('refuses stale fixed-slot reopening while preserving the claim', async () => {
        await admin((database) => setDoc(doc(database, claimPath('Equipment')), claim)); const engine = commands(); await expect(engine.prepare({ ...input, operations: [operation('update', 'Equipment')] })).rejects.toThrow(/stale claim/); expect(await read(claimPath('Equipment'))).toBeDefined();
    });
    it('requires the distinct acknowledgement before any mutation transaction', async () => {
        let commits = 0; const engine = commands(async (url, options) => { if (url.endsWith(':commit') && JSON.parse(options.body).transaction) commits++; return localFetch(url, options); });
        await engine.prepare(input); expect(await engine.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} }))).toMatchObject({ applied: false }); expect(commits).toBe(0);
    });
    it('serializes the entire batch against a competing parent claim without stranded claims or partial creates', async () => {
        const staff = commands(); const parent = parentCommands(); await staff.prepare(input); await parent.prepare({ proposalId, teamId: 'team-1', eventId: 'event', action: 'claim', role: 'Snack' });
        const results = await Promise.allSettled([staff.confirm({ proposalId }, accept), parent.confirm({ proposalId }, accept)]);
        const event = await read(eventPath); const savedClaim = await read(claimPath('Snack')); const staffWon = results[0].status === 'fulfilled';
        if (staffWon) { expect(event.assignments).toEqual([fixed('Snacks'), fixed('Equipment'), open('Water')]); expect(savedClaim).toBeUndefined(); }
        else { expect(event.assignments).toEqual([open('Snack'), fixed('Equipment')]); expect((await read(header)).status).toBe('prepared'); }
        if (savedClaim) { expect(savedClaim.claimedByUserId).toBe('parent'); expect(staffWon).toBe(false); }
        // Firestore may abort both lock upgrades. Neither command retries the write.
        if (results.every((row) => row.status === 'rejected')) expect(savedClaim).toBeUndefined();
    }, 20000);
});
