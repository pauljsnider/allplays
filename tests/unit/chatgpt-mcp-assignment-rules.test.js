import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { createMockUserToken } from '@firebase/util';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { createDirectAssignmentCommands, createDirectAssignmentStore } from '../../services/chatgpt-mcp/src/directAssignments.js';
import { createDirectAssignmentClaimCommands, createDirectAssignmentClaimStore } from '../../services/chatgpt-mcp/src/directAssignmentClaims.js';
const projectId = 'demo-allplays-mcp-review';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const third = '00112233-4455-4677-8899-aabbccddeebb';
const ids = { teamId: 'team-1', eventId: 'event' };
const eventPath = 'teams/team-1/games/event';
const claimPath = `${eventPath}/assignmentClaims/Snack`;
const slot = { role: 'Snack', value: '', claimable: true };
const fixed = { role: 'Equipment', value: 'Staff', claimable: false };
const manage = { ...ids, proposalId, action: 'update', role: 'Snack', assignment: { role: 'Snacks', value: '', claimable: true } };
const own = { ...ids, proposalId, action: 'claim', role: 'Snack' };
const accept = async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} });
const claim = (uid = 'parent') => ({ claimedByUserId: uid, claimedByName: 'Synthetic Parent', claimedAt: new Date('2020-01-01') });
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('assignment lifecycle under actual rules', () => {
    let env;
    beforeAll(async () => { env = await initializeTestEnvironment({ projectId, firestore: { rules: compactFirestoreRules(readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')) } }); }, 30000);
    afterAll(async () => env?.cleanup());
    const db = (uid = 'owner') => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
    const token = (uid) => createMockUserToken({ sub: uid, email: `${uid}@example.test`, email_verified: true }, projectId);
    const localFetch = (url, options) => {
        const host = process.env.FIRESTORE_EMULATOR_HOST;
        if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !url.startsWith(`https://firestore.googleapis.com/v1/projects/${projectId}/`)) throw new Error('Only local demo emulator requests are allowed');
        return fetch(url.replace('https://firestore.googleapis.com', `http://${host}`), options);
    };
    const getContext = (uid) => async () => {
        const profile = (await getDoc(doc(db(uid), `users/${uid}`))).data() || {};
        const roles = new Set(profile.parentTeamIds?.includes('team-1') ? ['parent'] : []);
        if (uid === 'owner') { const team = (await getDoc(doc(db(uid), 'teams/team-1'))).data(); if (team?.ownerId === uid) roles.add('owner'); }
        return { uid, teams: new Map([['team-1', { roles }]]) };
    };
    const manager = (fetchImpl = localFetch, uid = 'owner') => createDirectAssignmentCommands({ uid, getContext: getContext(uid), store: createDirectAssignmentStore({ projectId, uid, idToken: token(uid), fetchImpl }) });
    const parent = (uid = 'parent', fetchImpl = localFetch) => createDirectAssignmentClaimCommands({ uid, getContext: getContext(uid), store: createDirectAssignmentClaimStore({ projectId, uid, idToken: token(uid), fetchImpl }) });
    const admin = (fn) => env.withSecurityRulesDisabled((context) => fn(context.firestore()));
    beforeEach(async () => {
        await env.clearFirestore(); await admin(async (database) => {
            await setDoc(doc(database, 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(database, 'teams/team-1'), { ownerId: 'owner', adminEmails: [], name: 'Synthetic private team', isPublic: false });
            for (const uid of ['owner', 'parent', 'other']) await setDoc(doc(database, `users/${uid}`), { fullName: `Synthetic ${uid}`, parentTeamIds: uid === 'owner' ? [] : ['team-1'], email: 'never-copy@example.test' });
            await setDoc(doc(database, eventPath), { type: 'game', date: new Date('2060-01-01'), assignments: [slot, fixed], location: 'Field', notes: 'Preserve private notes', exactTimestamp: new Timestamp(1000000000, 123456789) });
        });
    });
    it('atomically renames a slot and clears exactly its affected claims, with manager-only proposal details', async () => {
        await admin(async (database) => {
            await setDoc(doc(database, claimPath), claim()); await setDoc(doc(database, `${eventPath}/assignmentClaims/Snacks`), claim('other'));
            await setDoc(doc(database, `${eventPath}/assignmentClaims/Equipment`), claim('other'));
        });
        const exactBefore = (await getDoc(doc(db(), eventPath))).data().exactTimestamp;
        const engine = manager(); const preview = await engine.prepare(manage); expect(preview.preview.removedClaims).toHaveLength(2);
        const header = `users/owner/privateAiPendingActions/direct_${proposalId}`;
        const payload = `teams/team-1/privateAiPendingActions/direct_owner_${proposalId}`;
        expect(JSON.stringify((await getDoc(doc(db(), header))).data())).not.toContain('Synthetic Parent'); await assertFails(getDoc(doc(db('parent'), payload)));
        await engine.confirm({ proposalId }, accept);
        const event = (await getDoc(doc(db(), eventPath))).data(); expect(event.assignments).toEqual([manage.assignment, fixed]); expect(event.notes).toBe('Preserve private notes'); expect(event.exactTimestamp).toEqual(exactBefore); expect(event.exactTimestamp.nanoseconds % 1000000).not.toBe(0);
        expect((await getDoc(doc(db(), claimPath))).exists()).toBe(false); expect((await getDoc(doc(db(), `${eventPath}/assignmentClaims/Snacks`))).exists()).toBe(false); expect((await getDoc(doc(db(), `${eventPath}/assignmentClaims/Equipment`))).exists()).toBe(true);
        expect((await getDoc(doc(db(), header))).data()).toMatchObject({ receiptOnly: true, status: 'completed' });
        await admin(async (database) => expect((await getDoc(doc(database, payload))).exists()).toBe(false));
    });
    it('creates, updates and removes a fixed slot through real rules', async () => {
        const engine = manager(); const create = { ...manage, action: 'create', role: 'Water', assignment: { role: 'Water', value: 'Staff', claimable: false } };
        await engine.prepare(create); await engine.confirm({ proposalId }, accept);
        await engine.prepare({ ...create, proposalId: second, action: 'update', assignment: { ...create.assignment, value: '' , claimable: true } }); await engine.confirm({ proposalId: second }, accept);
        await engine.prepare({ ...ids, proposalId: third, action: 'remove', role: 'Water' }); await engine.confirm({ proposalId: third }, accept);
        expect((await getDoc(doc(db(), eventPath))).data().assignments).toEqual([slot, fixed]);
    });
    it('allows a real linked parent to discover, claim and release without requiring team-document reads', async () => {
        const engine = parent('parent', async (url, options) => {
            expect((JSON.parse(options.body).documents || []).some((path) => path.endsWith('/documents/teams/team-1'))).toBe(false);
            return localFetch(url, options);
        }); expect((await engine.discover(ids)).slots[0]).toEqual({ role: 'Snack', state: 'open' });
        const prepared = await engine.prepare(own); expect(prepared.preview.displayName).toBe('Synthetic parent');
        const header = `users/parent/privateAiPendingActions/direct_${proposalId}`;
        await assertFails(getDoc(doc(db('other'), header))); expect(JSON.stringify((await getDoc(doc(db('parent'), header))).data())).not.toContain('never-copy');
        await engine.confirm({ proposalId }, accept); expect((await getDoc(doc(db('parent'), claimPath))).data()).toMatchObject({ claimedByUserId: 'parent', claimedByName: 'Synthetic parent' });
        expect((await getDoc(doc(db('parent'), header))).data()).toMatchObject({ status: 'completed', receiptOnly: true }); expect((await getDoc(doc(db('parent'), header))).data().preview).toBeUndefined();
        expect((await engine.discover(ids)).slots[0].state).toBe('mine');
        await engine.prepare({ ...own, proposalId: second, action: 'release' }); await engine.confirm({ proposalId: second }, accept); expect((await getDoc(doc(db('parent'), claimPath))).exists()).toBe(false);
    });
    it.each(['claim', 'release'])('does not let a parent %s another person’s existing claim', async (action) => {
        await admin((database) => setDoc(doc(database, claimPath), claim('other')));
        await expect(parent().prepare({ ...own, action })).rejects.toThrow(); expect((await getDoc(doc(db('parent'), claimPath))).data().claimedByUserId).toBe('other');
    });
    it('does not allow a manager without parent linkage to claim a slot', async () => {
        await expect(parent('owner').prepare(own)).rejects.toThrow(); expect((await getDoc(doc(db(), claimPath))).exists()).toBe(false);
    });
    it.each(['parent', 'manager'])('rejects revoked %s authorization while the form is open', async (kind) => {
        const engine = kind === 'parent' ? parent() : manager(); await engine.prepare(kind === 'parent' ? own : manage);
        await expect(engine.confirm({ proposalId }, async () => {
            await admin((database) => updateDoc(doc(database, kind === 'parent' ? 'users/parent' : 'teams/team-1'), kind === 'parent' ? { parentTeamIds: [] } : { ownerId: 'replacement' })); return accept();
        })).rejects.toThrow();
        await admin(async (database) => { expect((await getDoc(doc(database, claimPath))).exists()).toBe(false); expect((await getDoc(doc(database, eventPath))).data().assignments).toEqual([slot, fixed]); });
    });
    it.each(['claim', 'event', 'profile'])('rejects changed %s state after parent preparation', async (change) => {
        const engine = parent(); await engine.prepare(own);
        await expect(engine.confirm({ proposalId }, async () => {
            await admin((database) => change === 'claim' ? setDoc(doc(database, claimPath), claim('other'))
                : change === 'event' ? updateDoc(doc(database, eventPath), { assignments: [fixed] }) : updateDoc(doc(database, 'users/parent'), { fullName: 'Changed Name' }));
            return accept();
        })).rejects.toThrow();
        await admin(async (database) => expect((await getDoc(doc(database, claimPath))).data()?.claimedByUserId).not.toBe('parent'));
    });
    it.each(['manager', 'parent'])('rejects incorrect commit credentials for %s without partial business effects', async (kind) => {
        let commits = 0; const transport = async (url, options) => {
            if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; return localFetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token('outsider')}` } }); }
            return localFetch(url, options);
        };
        const engine = kind === 'manager' ? manager(transport) : parent('parent', transport); await engine.prepare(kind === 'manager' ? manage : own);
        await expect(engine.confirm({ proposalId }, accept)).rejects.toThrow(); expect(commits).toBe(1);
        expect((await getDoc(doc(db(), eventPath))).data().assignments).toEqual([slot, fixed]); expect((await getDoc(doc(db(), claimPath))).exists()).toBe(false);
    });
    it.each(['manager', 'claim', 'release'])('reconciles a lost %s response and does not repeat writes', async (kind) => {
        if (kind === 'release') await admin((database) => setDoc(doc(database, claimPath), claim()));
        let commits = 0; const transport = async (url, options) => {
            const response = await localFetch(url, options);
            if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; if (response.ok) throw new Error('Synthetic lost response'); }
            return response;
        };
        const engine = kind === 'manager' ? manager(transport) : parent('parent', transport);
        await engine.prepare(kind === 'manager' ? manage : { ...own, action: kind }); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed');
        expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect(commits).toBe(1);
    });
    it('serializes two parents claiming the same slot without overwriting the winner', async () => {
        const first = parent(); const other = parent('other'); await first.prepare(own); await other.prepare(own);
        const results = await Promise.allSettled([first.confirm({ proposalId }, accept), other.confirm({ proposalId }, accept)]);
        expect(results.filter((r) => r.status === 'fulfilled').length).toBeLessThanOrEqual(1);
        // The emulator may abort both competing lock upgrades. Neither command
        // retries automatically; prove no effect, then explicitly review again.
        if (results.every((r) => r.status === 'rejected')) {
            expect((await getDoc(doc(db(), claimPath))).exists()).toBe(false);
            expect((await first.status({ proposalId })).status).toBe('prepared'); expect((await other.status({ proposalId })).status).toBe('prepared');
            expect((await first.confirm({ proposalId }, accept)).status).toBe('completed');
        }
        const saved = (await getDoc(doc(db(), claimPath))).data(); const winner = results[1].status === 'fulfilled' ? 'other' : 'parent'; expect(saved.claimedByUserId).toBe(winner);
        const receipt = (await getDoc(doc(db(winner), `users/${winner}/privateAiPendingActions/direct_${proposalId}`))).data(); expect(receipt.status).toBe('completed');
    }, 20000);
    it('serializes staff closing a slot against a concurrent parent claim without a stranded claim', async () => {
        const staff = manager(); const family = parent();
        await staff.prepare({ ...manage, assignment: { ...slot, value: 'Staff', claimable: false } }); await family.prepare(own);
        const results = await Promise.allSettled([staff.confirm({ proposalId }, accept), family.confirm({ proposalId }, accept)]);
        expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
        const event = (await getDoc(doc(db(), eventPath))).data(); const saved = await getDoc(doc(db(), claimPath));
        if (event.assignments[0].claimable === false) expect(saved.exists()).toBe(false);
        if (saved.exists()) expect(event.assignments[0]).toEqual(slot);
    }, 20000);
});
