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
const input = { proposalId, teamId: 'team-1', eventId: 'event', playerIds: ['p1', 'p2'], response: 'going', note: 'Synthetic availability note' };
const eventPath = 'teams/team-1/games/event';
const responsePath = (id) => `${eventPath}/rsvps/parent__${id}`;
const notePath = (id) => `${eventPath}/rsvpNotes/parent__${id}`;
const header = `users/parent/privateAiPendingActions/direct_${proposalId}`;
const accept = async () => ({ action: 'accept', content: { approve: true, staffRsvpNote: true }, consume: async () => {} });
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('staff RSVP notes with actual rules', () => {
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
    const commands = (fetchImpl = localFetch) => createDirectFamilyRsvpCommands({ uid: 'parent', getContext, now: () => clock,
        store: createDirectFamilyRsvpStore({ projectId, uid: 'parent', idToken: token(), fetchImpl }, { staffNotes: true }) }, { staffNotes: true });
    const admin = (fn) => env.withSecurityRulesDisabled((context) => fn(context.firestore()));
    const read = async (path, uid = 'parent') => (await getDoc(doc(db(uid), path))).data();
    const noteRecord = (id) => ({ userId: 'parent', displayName: null, playerIds: [id], playerId: id, childId: id, response: 'maybe', note: 'Prior private note', visibility: 'admins', updatedAt: new Date(clock - 1000), respondedAt: new Date(clock - 1000), createdAt: new Timestamp(1000000000, 123456789) });
    const noWrites = async () => admin(async (database) => { for (const id of input.playerIds) { expect((await getDoc(doc(database, responsePath(id)))).exists()).toBe(false); expect((await getDoc(doc(database, notePath(id)))).exists()).toBe(false); } });
    beforeEach(async () => {
        clock = Date.now(); await env.clearFirestore(); await admin(async (database) => {
            await setDoc(doc(database, 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(database, 'teams/team-1'), { ownerId: 'owner', adminEmails: [], availabilityPreferences: { noteVisibility: 'admins', cutoffMinutesBeforeStart: 1 } });
            await setDoc(doc(database, 'users/parent'), { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1', 'team-1::p2'] });
            await setDoc(doc(database, 'users/other'), { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1'] });
            for (const id of input.playerIds) await setDoc(doc(database, `teams/team-1/players/${id}`), { name: `Synthetic ${id}`, active: true });
            await setDoc(doc(database, eventPath), { type: 'game', date: new Date(clock + 120000), rsvpSummary: { going: 0 } });
            await setDoc(doc(database, `${eventPath}/rsvpNotes/other__p1`), { ...noteRecord('p1'), userId: 'other', note: 'Other author' });
        });
    });
    it('saves responses and private notes atomically; author/staff can read while another linked parent cannot', async () => {
        const engine = commands(); await engine.prepare(input); await assertFails(getDoc(doc(db('other'), header))); await engine.confirm({ proposalId }, accept);
        for (const id of input.playerIds) {
            expect((await read(responsePath(id), 'other')).response).toBe('going'); expect((await read(responsePath(id), 'other')).note).toBeUndefined();
            expect(await read(notePath(id))).toMatchObject({ userId: 'parent', playerId: id, childId: id, playerIds: [id], note: input.note, response: 'going', visibility: 'admins' });
            expect((await read(notePath(id), 'owner')).note).toBe(input.note); await assertFails(getDoc(doc(db('other'), notePath(id))));
            await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), notePath(id))));
        }
        expect(await read(header)).toMatchObject({ status: 'completed', receiptOnly: true }); expect((await read(header)).note).toBeUndefined(); expect((await read(header)).preview).toBeUndefined();
        expect((await read(eventPath)).rsvpSummary).toEqual({ going: 0 }); expect((await read(`${eventPath}/rsvpNotes/other__p1`, 'other')).note).toBe('Other author');
        expect(await read(`${eventPath}/rsvps/parent`)).toBeUndefined();
    });
    it('replaces then clears own text without copying old text to the proposal or re-encoding history', async () => {
        await admin((database) => setDoc(doc(database, notePath('p1')), noteRecord('p1'))); const original = await read(notePath('p1')); const engine = commands();
        await engine.prepare(input); expect(JSON.stringify(await read(header))).not.toContain('Prior private note'); await engine.confirm({ proposalId }, accept);
        expect((await read(notePath('p1'))).createdAt).toEqual(original.createdAt);
        await engine.prepare({ ...input, proposalId: second, playerIds: ['p1'], response: 'maybe', note: '' }); await engine.confirm({ proposalId: second }, accept);
        expect(await read(notePath('p1'))).toMatchObject({ note: null, visibility: 'admins', response: 'maybe', createdAt: original.createdAt });
        expect((await read(notePath('p2'))).note).toBe(input.note); expect((await read(responsePath('p2'))).response).toBe('going');
    });
    it('supports the full ten-child response and note transaction under actual rules limits', async () => {
        const playerIds = Array.from({ length: 10 }, (_, i) => `child${i}`); await admin(async (database) => {
            await updateDoc(doc(database, 'users/parent'), { parentPlayerKeys: playerIds.map((id) => `team-1::${id}`) });
            for (const id of playerIds) await setDoc(doc(database, `teams/team-1/players/${id}`), { name: id, active: true });
        });
        const engine = commands(); await engine.prepare({ ...input, playerIds }); await engine.confirm({ proposalId }, accept);
        for (const id of playerIds) { expect((await read(responsePath(id))).response).toBe('going'); expect((await read(notePath(id))).note).toBe(input.note); }
    });
    it.each(['audience', 'link', 'team_link', 'child', 'event', 'legacy_note', 'cutoff'])('rejects %s changes after preparation with no partial response/note writes', async (kind) => {
        const engine = commands(); await engine.prepare(input);
        await expect(engine.confirm({ proposalId }, async () => {
            await admin(async (database) => {
                if (kind === 'audience') await updateDoc(doc(database, 'teams/team-1'), { availabilityPreferences: { noteVisibility: 'team' } });
                if (kind === 'link') await updateDoc(doc(database, 'users/parent'), { parentPlayerKeys: ['team-1::p1'] });
                if (kind === 'team_link') await updateDoc(doc(database, 'users/parent'), { parentTeamIds: [] });
                if (kind === 'child') await updateDoc(doc(database, 'teams/team-1/players/p2'), { active: false });
                if (kind === 'event') await updateDoc(doc(database, eventPath), { status: 'cancelled' });
                if (kind === 'legacy_note') await setDoc(doc(database, `${eventPath}/rsvpNotes/parent`), { userId: 'parent', note: 'Legacy', visibility: 'admins', updatedAt: new Date(clock) });
            }); if (kind === 'cutoff') clock += 60000; return accept();
        })).rejects.toThrow(); await noWrites();
    });
    it.each(['other', 'unverified'])('rules reject %s commit credentials without committing either domain record', async (kind) => {
        let commits = 0; const engine = commands(async (url, options) => {
            if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; return localFetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${kind === 'other' ? token('other') : token('parent', false)}` } }); } return localFetch(url, options);
        });
        await engine.prepare(input); await expect(engine.confirm({ proposalId }, accept)).rejects.toThrow(); expect(commits).toBe(1); await noWrites();
    });
    it('rejects a competing note without overwriting it or partially applying another child', async () => {
        const engine = commands(); await engine.prepare(input);
        await expect(engine.confirm({ proposalId }, async () => { await admin((database) => setDoc(doc(database, notePath('p2')), noteRecord('p2'))); return accept(); })).rejects.toThrow();
        expect(await read(responsePath('p1'))).toBeUndefined(); expect(await read(responsePath('p2'))).toBeUndefined(); expect(await read(notePath('p1'))).toBeUndefined(); expect((await read(notePath('p2'))).note).toBe('Prior private note');
    });
    it('reconciles a lost atomic commit response once and reauthorizes status', async () => {
        let commits = 0; const engine = commands(async (url, options) => { const response = await localFetch(url, options); if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; if (response.ok) throw new Error('Synthetic lost acknowledgment'); } return response; });
        await engine.prepare(input); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect(commits).toBe(1);
        await admin((database) => updateDoc(doc(database, 'users/parent'), { parentPlayerKeys: ['team-1::p1'] })); await expect(engine.status({ proposalId })).rejects.toThrow();
    });
    it('requires the extra note acknowledgement before dispatching any transaction commit', async () => {
        let commits = 0; const engine = commands(async (url, options) => { if (url.endsWith(':commit') && JSON.parse(options.body).transaction) commits++; return localFetch(url, options); });
        await engine.prepare(input); expect(await engine.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} }))).toMatchObject({ applied: false }); expect(commits).toBe(0); await noWrites();
    });
    it('refuses existing team-visible notes even after the team changes to staff-only', async () => {
        await admin((database) => setDoc(doc(database, notePath('p1')), { ...noteRecord('p1'), visibility: 'team' })); await expect(commands().prepare(input)).rejects.toThrow();
        expect((await read(notePath('p1'))).visibility).toBe('team'); expect(await read(responsePath('p1'))).toBeUndefined();
    });
});
