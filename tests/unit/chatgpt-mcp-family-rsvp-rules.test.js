import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { createMockUserToken } from '@firebase/util';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { createDirectFamilyRsvpCommands, createDirectFamilyRsvpStore } from '../../services/chatgpt-mcp/src/directFamilyRsvp.js';
const projectId = 'demo-allplays-mcp-review';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const input = { proposalId, teamId: 'team-1', eventId: 'event', playerIds: ['p1', 'p2'], response: 'going' };
const eventPath = 'teams/team-1/games/event';
const responsePath = (id) => `${eventPath}/rsvps/parent__${id}`;
const notePath = `${eventPath}/rsvpNotes/parent__p1`;
const header = `users/parent/privateAiPendingActions/direct_${proposalId}`;
const accept = async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} });
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('linked-family RSVP with actual rules', () => {
    let env; let clock;
    beforeAll(async () => { env = await initializeTestEnvironment({ projectId, firestore: { rules: compactFirestoreRules(readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')) } }); }, 30000);
    afterAll(async () => env?.cleanup());
    const db = (uid = 'parent') => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
    const token = (uid = 'parent') => createMockUserToken({ sub: uid, email: `${uid}@example.test`, email_verified: true }, projectId);
    const localFetch = (url, options) => {
        const host = process.env.FIRESTORE_EMULATOR_HOST;
        if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !url.startsWith(`https://firestore.googleapis.com/v1/projects/${projectId}/`)) throw new Error('Only isolated demo-emulator requests are allowed');
        return fetch(url.replace('https://firestore.googleapis.com', `http://${host}`), options);
    };
    const getContext = async () => ({ uid: 'parent', teams: new Map([['team-1', { roles: new Set(['parent']) }]]) }); // Deliberately cached; canonical document checks and rules must still enforce revocation.
    const commands = (fetchImpl = localFetch) => createDirectFamilyRsvpCommands({ uid: 'parent', getContext, now: () => clock,
        store: createDirectFamilyRsvpStore({ projectId, uid: 'parent', idToken: token(), fetchImpl }) });
    const admin = (fn) => env.withSecurityRulesDisabled((context) => fn(context.firestore()));
    const noResponses = async () => admin(async (database) => { for (const id of input.playerIds) expect((await getDoc(doc(database, responsePath(id)))).exists()).toBe(false); });
    beforeEach(async () => {
        clock = Date.now(); await env.clearFirestore(); await admin(async (database) => {
            await setDoc(doc(database, 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(database, 'teams/team-1'), { ownerId: 'owner', adminEmails: [], availabilityPreferences: { cutoffMinutesBeforeStart: 1, noteVisibility: 'admins' } });
            await setDoc(doc(database, 'users/parent'), { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1', 'team-1::p2'] });
            await setDoc(doc(database, 'users/other'), { parentTeamIds: ['team-1'], parentPlayerKeys: [] });
            for (const id of input.playerIds) await setDoc(doc(database, `teams/team-1/players/${id}`), { name: `Synthetic ${id}`, active: true, medicalInfo: 'Never copy' });
            await setDoc(doc(database, eventPath), { type: 'game', date: new Date(clock + 120000), rsvpSummary: { going: 0 }, notes: 'Preserve private event notes' });
            await setDoc(doc(database, notePath), { userId: 'parent', playerId: 'p1', childId: 'p1', playerIds: ['p1'], note: 'Preserve private availability', visibility: 'admins', updatedAt: new Timestamp(1000000000, 123456000) });
            await setDoc(doc(database, `${eventPath}/rsvps/other__p1`), { userId: 'other', response: 'maybe' });
        });
    });
    it('writes selected children atomically and updates one without changing notes, other responders, base access or cached totals', async () => {
        const note = (await getDoc(doc(db(), notePath))).data(); const engine = commands(); await engine.prepare(input);
        await assertFails(getDoc(doc(db('other'), header))); expect(JSON.stringify((await getDoc(doc(db(), header))).data())).not.toMatch(/Never copy|availability|event notes/);
        await engine.confirm({ proposalId }, accept);
        for (const id of input.playerIds) expect((await getDoc(doc(db(), responsePath(id)))).data()).toMatchObject({ userId: 'parent', displayName: null, playerIds: [id], playerId: id, childId: id, response: 'going' });
        expect((await getDoc(doc(db(), header))).data()).toMatchObject({ status: 'completed', receiptOnly: true, playerIds: ['p1', 'p2'] }); expect((await getDoc(doc(db(), header))).data().preview).toBeUndefined();
        await engine.prepare({ ...input, proposalId: second, playerIds: ['p1'], response: 'not_going' }); await engine.confirm({ proposalId: second }, accept);
        expect((await getDoc(doc(db(), responsePath('p1')))).data().response).toBe('not_going'); expect((await getDoc(doc(db(), responsePath('p2')))).data().response).toBe('going');
        expect((await getDoc(doc(db(), notePath))).data()).toEqual(note); await assertFails(getDoc(doc(db('other'), notePath)));
        expect((await getDoc(doc(db(), `${eventPath}/rsvps/other__p1`))).data().response).toBe('maybe'); expect((await getDoc(doc(db(), `${eventPath}/rsvps/parent`))).exists()).toBe(false);
        expect((await getDoc(doc(db(), eventPath))).data().rsvpSummary).toEqual({ going: 0 });
    });
    it('supports the complete bounded ten-child transaction under real rules access limits', async () => {
        const playerIds = Array.from({ length: 10 }, (_, i) => `child${i}`); await admin(async (database) => {
            await updateDoc(doc(database, 'users/parent'), { parentPlayerKeys: playerIds.map((id) => `team-1::${id}`) });
            for (const id of playerIds) await setDoc(doc(database, `teams/team-1/players/${id}`), { name: id, active: true });
        });
        const engine = commands(); await engine.prepare({ ...input, playerIds }); await engine.confirm({ proposalId }, accept);
        for (const id of playerIds) expect((await getDoc(doc(db(), responsePath(id)))).data().response).toBe('going');
    });
    it.each(['team_link', 'child_link', 'cross_team_link', 'child_active', 'event', 'legacy'])('rejects %s changes after preparation without partial writes', async (kind) => {
        const engine = commands(); await engine.prepare(input);
        await expect(engine.confirm({ proposalId }, async () => {
            await admin(async (database) => {
                if (kind === 'team_link') await updateDoc(doc(database, 'users/parent'), { parentTeamIds: [] });
                if (kind === 'child_link') await updateDoc(doc(database, 'users/parent'), { parentPlayerKeys: ['team-1::p1'] });
                if (kind === 'cross_team_link') await updateDoc(doc(database, 'users/parent'), { parentPlayerKeys: ['team-1::p1', 'team-2::p2'] });
                if (kind === 'child_active') await updateDoc(doc(database, 'teams/team-1/players/p2'), { active: false });
                if (kind === 'event') await updateDoc(doc(database, eventPath), { status: 'cancelled' });
                if (kind === 'legacy') await setDoc(doc(database, `${eventPath}/rsvps/parent`), { userId: 'parent', playerIds: ['p1', 'p2'], response: 'going' });
            }); return accept();
        })).rejects.toThrow(); await noResponses();
    });
    it('rejects a cutoff crossed during confirmation', async () => {
        const engine = commands(); await engine.prepare(input); await expect(engine.confirm({ proposalId }, async () => { clock += 60000; return accept(); })).rejects.toThrow(); await noResponses();
    });
    it('rules deny wrong commit credentials atomically even with a stale upstream context', async () => {
        let commits = 0; const engine = commands(async (url, options) => {
            if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; return localFetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token('other')}` } }); } return localFetch(url, options);
        });
        await engine.prepare(input); await expect(engine.confirm({ proposalId }, accept)).rejects.toThrow(); expect(commits).toBe(1); await noResponses();
    });
    it('reconciles a lost batch commit response without applying either child twice', async () => {
        let commits = 0; const engine = commands(async (url, options) => {
            const response = await localFetch(url, options); if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; if (response.ok) throw new Error('Synthetic lost acknowledgment'); } return response;
        });
        await engine.prepare(input); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect(commits).toBe(1);
        await admin((database) => updateDoc(doc(database, 'users/parent'), { parentPlayerKeys: ['team-1::p1'] })); await expect(engine.status({ proposalId })).rejects.toThrow();
    });
    it('does not partially apply a batch when a new conflicting child response appears', async () => {
        const engine = commands(); await engine.prepare(input);
        await expect(engine.confirm({ proposalId }, async () => { await admin((database) => setDoc(doc(database, responsePath('p2')), { response: 'maybe', note: 'Legacy preserve' })); return accept(); })).rejects.toThrow();
        expect((await getDoc(doc(db(), responsePath('p1')))).exists()).toBe(false); expect((await getDoc(doc(db(), responsePath('p2')))).data()).toEqual({ response: 'maybe', note: 'Legacy preserve' });
    });
    it('discovery returns only currently linked names and rechecks canonical membership', async () => {
        const engine = commands(); expect((await engine.discover({ teamId: 'team-1' })).children.map((row) => row.playerId)).toEqual(['p1', 'p2']);
        await admin((database) => updateDoc(doc(database, 'users/parent'), { parentTeamIds: [] })); await expect(engine.discover({ teamId: 'team-1' })).rejects.toThrow();
    });
});
