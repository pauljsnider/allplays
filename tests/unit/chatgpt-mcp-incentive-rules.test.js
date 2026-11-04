import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { createMockUserToken } from '@firebase/util';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { createDirectIncentiveCommands, createDirectIncentiveStore } from '../../services/chatgpt-mcp/src/directIncentives.js';
const projectId = 'demo-allplays-mcp-review';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const terms = { statKey: 'pts', type: 'per_unit', amountCents: 25, threshold: null, thresholdOp: null, active: true };
const input = { proposalId, teamId: 'team-1', playerId: 'p1', mode: 'create', resultId: `mcp_${proposalId}`, terms };
const path = (id) => `users/parent/incentiveRules/${id}`;
const header = `users/parent/privateAiPendingActions/direct_${proposalId}`;
const paidPath = 'users/parent/incentivePaidGames/game__p1';
const accept = async () => ({ action: 'accept', content: { approve: true, incentiveTerms: true }, consume: async () => {} });
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('private incentives through REST with actual rules', () => {
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
    const commands = (fetchImpl = localFetch) => createDirectIncentiveCommands({ uid: 'parent', getContext, now: () => clock,
        store: createDirectIncentiveStore({ projectId, uid: 'parent', idToken: token(), fetchImpl }) });
    const admin = (fn) => env.withSecurityRulesDisabled((context) => fn(context.firestore()));
    const read = async (target) => (await getDoc(doc(db(), target))).data();
    beforeEach(async () => {
        clock = Date.now(); await env.clearFirestore(); await admin(async (database) => {
            await setDoc(doc(database, 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(database, 'teams/team-1'), { ownerId: 'owner', adminEmails: [] });
            await setDoc(doc(database, 'users/parent'), { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1'] });
            await setDoc(doc(database, 'users/other'), { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1'] });
            await setDoc(doc(database, 'teams/team-1/players/p1'), { name: 'Synthetic Player', active: true, medicalInfo: 'Never copy' });
            await setDoc(doc(database, 'teams/team-1/statTrackerConfigs/config'), { columns: ['PTS', 'REB'], baseType: 'Basketball' });
            const previous = Timestamp.fromMillis(clock - 10000);
            await setDoc(doc(database, path('existing-rule')), { teamId: 'team-1', playerId: 'p1', playerName: 'Synthetic Player', ...terms, createdAt: previous, updatedAt: previous, effectiveFrom: previous, effectiveTo: null });
            await setDoc(doc(database, paidPath), { paid: true, totalCents: 999, original: new Timestamp(1000000000, 123456789) });
        });
    });
    it('creates privately and reduces completed proposal to a receipt; even team owner cannot read it', async () => {
        const engine = commands(); await engine.prepare(input); await assertFails(getDoc(doc(db('other'), header))); await assertFails(getDoc(doc(db('owner'), header)));
        await engine.confirm({ proposalId }, accept); expect(await read(path(input.resultId))).toMatchObject({ ...terms, teamId: 'team-1', playerId: 'p1' });
        expect(await read(header)).toMatchObject({ status: 'completed', receiptOnly: true }); expect((await read(header)).preview).toBeUndefined(); expect((await read(header)).terms).toBeUndefined();
        for (const uid of ['other', 'owner']) await assertFails(getDoc(doc(db(uid), path(input.resultId))));
    });
    it('revises with atomic interval boundaries and preserves old nanosecond timestamps and paid records', async () => {
        await admin((database) => updateDoc(doc(database, path('existing-rule')), { createdAt: new Timestamp(1000000000, 123456789), effectiveFrom: new Timestamp(1000000000, 987654321) }));
        const old = await read(path('existing-rule')); const paid = await read(paidPath); const engine = commands();
        await engine.prepare({ ...input, mode: 'revise', sourceId: 'existing-rule', terms: { ...terms, amountCents: 50 } }); await engine.confirm({ proposalId }, accept);
        const closed = await read(path('existing-rule')); const next = await read(path(input.resultId));
        expect(closed).toEqual({ ...old, updatedAt: closed.effectiveTo, effectiveTo: expect.any(Timestamp) });
        expect(closed.effectiveTo.toMillis()).toBeGreaterThanOrEqual(clock); expect(closed.effectiveTo.toMillis()).toBeLessThanOrEqual(Date.now());
        expect(next.effectiveFrom).toEqual(closed.effectiveTo); expect(next.supersedesRuleId).toBe('existing-rule'); expect(next.amountCents).toBe(50); expect(await read(paidPath)).toEqual(paid);
    });
    it('explicit disable and retire preserve every prior version', async () => {
        const engine = commands(); await engine.prepare({ ...input, mode: 'set_active', sourceId: 'existing-rule', active: false }); await engine.confirm({ proposalId }, accept);
        expect((await read(path('existing-rule'))).active).toBe(true); expect((await read(path(input.resultId))).active).toBe(false);
        clock = Date.now() + 1000; await engine.prepare({ ...input, proposalId: second, mode: 'retire', sourceId: input.resultId }); await engine.confirm({ proposalId: second }, accept);
        expect((await read(path(input.resultId))).effectiveTo.toMillis()).toBeLessThan(clock); expect((await getDocs(collection(db(), 'users/parent/incentiveRules'))).size).toBe(2);
    });
    it('uses server time rather than an ahead-of-server broker clock for all new version dates', async () => {
        clock += 3600000; const before = Date.now(); const engine = commands(); await engine.prepare(input); await engine.confirm({ proposalId }, accept);
        const created = await read(path(input.resultId)); expect(created.createdAt).toEqual(created.effectiveFrom); expect(created.updatedAt).toEqual(created.effectiveFrom);
        expect(created.effectiveFrom.toMillis()).toBeGreaterThanOrEqual(before); expect(created.effectiveFrom.toMillis()).toBeLessThanOrEqual(Date.now()); expect(created.effectiveFrom.toMillis()).toBeLessThan(clock);
    });
    it('sets and clears cap without changing rule history or paid records', async () => {
        const old = await read(path('existing-rule')); const paid = await read(paidPath); const engine = commands();
        await engine.prepare({ ...input, mode: 'cap', resultId: '_cap_p1', maxPerGameCents: 0 }); await engine.confirm({ proposalId }, accept);
        expect(await read(path('_cap_p1'))).toMatchObject({ teamId: 'team-1', playerId: 'p1', maxPerGameCents: 0 });
        await engine.prepare({ ...input, proposalId: second, mode: 'cap', resultId: '_cap_p1', maxPerGameCents: null }); await engine.confirm({ proposalId: second }, accept);
        expect(await read(path('_cap_p1'))).toBeUndefined(); expect(await read(path('existing-rule'))).toEqual(old); expect(await read(paidPath)).toEqual(paid);
    });
    it.each(['team_link', 'player_link', 'ambiguous_link', 'inactive', 'config', 'competing_rule', 'cap'])('rejects %s change after approval without a partial version close', async (kind) => {
        const engine = commands(); const old = await read(path('existing-rule')); await engine.prepare({ ...input, mode: 'revise', sourceId: 'existing-rule' });
        await expect(engine.confirm({ proposalId }, async () => {
            await admin(async (database) => {
                if (kind === 'team_link') await updateDoc(doc(database, 'users/parent'), { parentTeamIds: [] });
                if (kind === 'player_link') await updateDoc(doc(database, 'users/parent'), { parentPlayerKeys: [] });
                if (kind === 'ambiguous_link') await updateDoc(doc(database, 'users/parent'), { parentPlayerKeys: ['team-1::p1', 'other::p1'] });
                if (kind === 'inactive') await updateDoc(doc(database, 'teams/team-1/players/p1'), { active: false });
                if (kind === 'config') await updateDoc(doc(database, 'teams/team-1/statTrackerConfigs/config'), { columns: ['REB'] });
                if (kind === 'competing_rule') await setDoc(doc(database, path('competing')), old);
                if (kind === 'cap') await setDoc(doc(database, path('_cap_p1')), { teamId: 'team-1', playerId: 'p1', maxPerGameCents: 100, updatedAt: new Date(clock) });
            }); return accept();
        })).rejects.toThrow(); expect(await read(path(input.resultId))).toBeUndefined(); expect(await read(path('existing-rule'))).toEqual(old);
    });
    it.each(['other', 'unverified'])('rules deny %s commit credentials atomically', async (kind) => {
        let commits = 0; const old = await read(path('existing-rule')); const engine = commands(async (url, options) => {
            if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; return localFetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${kind === 'other' ? token('other') : token('parent', false)}` } }); } return localFetch(url, options);
        });
        await engine.prepare({ ...input, mode: 'revise', sourceId: 'existing-rule' }); await expect(engine.confirm({ proposalId }, accept)).rejects.toThrow(); expect(commits).toBe(1);
        expect(await read(path('existing-rule'))).toEqual(old); expect(await read(path(input.resultId))).toBeUndefined();
    });
    it('reconciles a lost response once without creating or closing another version', async () => {
        let commits = 0; const engine = commands(async (url, options) => {
            const response = await localFetch(url, options); if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; if (response.ok) throw new Error('Synthetic lost acknowledgment'); } return response;
        });
        await engine.prepare({ ...input, mode: 'revise', sourceId: 'existing-rule' }); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect(commits).toBe(1);
        expect((await getDocs(collection(db(), 'users/parent/incentiveRules'))).size).toBe(2);
    });
    it('rejects a stale competing revision after the first one commits', async () => {
        const engine = commands(); await engine.prepare({ ...input, mode: 'revise', sourceId: 'existing-rule' });
        await engine.prepare({ ...input, proposalId: second, resultId: `mcp_${second}`, mode: 'revise', sourceId: 'existing-rule', terms: { ...terms, amountCents: 50 } });
        await engine.confirm({ proposalId }, accept); await expect(engine.confirm({ proposalId: second }, accept)).rejects.toThrow(); expect(await read(path(`mcp_${second}`))).toBeUndefined();
    });
    it('fails closed on legacy or cross-team cap ownership', async () => {
        await admin((database) => setDoc(doc(database, path('_cap_p1')), { teamId: 'other', playerId: 'p1', maxPerGameCents: 100, updatedAt: new Date(clock) }));
        await expect(commands().prepare({ ...input, mode: 'cap', resultId: '_cap_p1', maxPerGameCents: null })).rejects.toThrow(); expect((await read(path('_cap_p1'))).teamId).toBe('other');
    });
    it('requires the extra acknowledgement before any transaction commit', async () => {
        let commits = 0; const engine = commands(async (url, options) => { if (url.endsWith(':commit') && JSON.parse(options.body).transaction) commits++; return localFetch(url, options); });
        await engine.prepare(input); expect(await engine.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} }))).toMatchObject({ applied: false });
        expect(commits).toBe(0); expect(await read(path(input.resultId))).toBeUndefined();
    });
});
