import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { createMockUserToken } from '@firebase/util';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { createDirectPracticeAttendanceCommands, createDirectPracticeAttendanceStore } from '../../services/chatgpt-mcp/src/directPracticeAttendance.js';
import { createDirectPracticeTimelineCommands, createDirectPracticeTimelineStore } from '../../services/chatgpt-mcp/src/directPracticeTimeline.js';
const projectId = 'demo-allplays-mcp-review';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const ids = { teamId: 'team-1', eventId: 'practice', sessionId: 'session' };
const eventPath = 'teams/team-1/games/practice'; const path = 'teams/team-1/practiceSessions/session';
const input = { ...ids, proposalId, changes: [{ playerId: 'p1', status: 'late' }, { playerId: 'p3', status: 'present' }] };
const blockInput = { ...ids, proposalId, mode: 'update', changes: { blockDurations: [{ order: 0, duration: 20 }], blockOrder: [1, 0] } };
const block = (order) => ({ order, drillId: null, drillTitle: `Block ${order}`, type: 'Technical', duration: 10, description: 'Preserve drill description', notes: 'Preserve coach note', notesLog: [] });
const accept = async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} });
const persisted = (value) => value instanceof Timestamp ? { seconds: value.seconds, nanoseconds: value.nanoseconds }
    : value?.type === 'document' ? { referencePath: value.path, projectId: value.firestore.app.options.projectId }
        : Array.isArray(value) ? value.map(persisted) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, persisted(entry)])) : value;
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('practice operations under real rules', () => {
    let env;
    beforeAll(async () => { env = await initializeTestEnvironment({ projectId, firestore: { rules: compactFirestoreRules(readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')) } }); }, 30000);
    afterAll(async () => env?.cleanup());
    const db = (uid = 'owner') => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
    const token = (uid = 'owner') => createMockUserToken({ sub: uid, email: `${uid}@example.test`, email_verified: true }, projectId);
    const localFetch = (url, options) => {
        const host = process.env.FIRESTORE_EMULATOR_HOST;
        if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !url.startsWith(`https://firestore.googleapis.com/v1/projects/${projectId}/`)) throw new Error('Only demo-emulator requests are allowed');
        return fetch(url.replace('https://firestore.googleapis.com', `http://${host}`), options);
    };
    const getContext = async () => {
        const team = (await getDoc(doc(db(), 'teams/team-1'))).data(); return { uid: 'owner', teams: new Map([['team-1', { roles: new Set(team?.ownerId === 'owner' ? ['owner'] : []) }]]) };
    };
    const command = (kind, fetchImpl = localFetch) => {
        const options = { projectId, uid: 'owner', idToken: token(), fetchImpl };
        return kind === 'attendance' ? createDirectPracticeAttendanceCommands({ uid: 'owner', getContext, store: createDirectPracticeAttendanceStore(options) })
            : createDirectPracticeTimelineCommands({ uid: 'owner', getContext, store: createDirectPracticeTimelineStore(options) });
    };
    const admin = (fn) => env.withSecurityRulesDisabled((context) => fn(context.firestore()));
    beforeEach(async () => {
        await env.clearFirestore(); await admin(async (database) => {
            await setDoc(doc(database, 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(database, 'teams/team-1'), { ownerId: 'owner', adminEmails: [], name: 'Synthetic Team' });
            await setDoc(doc(database, 'users/parent'), { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1'] });
            for (const id of ['p1', 'p2', 'p3']) await setDoc(doc(database, `teams/team-1/players/${id}`), { name: `Synthetic ${id}`, active: true });
            await setDoc(doc(database, eventPath), { type: 'practice', title: 'Practice', date: new Date('2060-01-01'), notes: 'Preserve event notes' });
            await setDoc(doc(database, path), { eventId: 'practice', eventType: 'practice', status: 'draft', homePacketGenerated: false, homePacketContent: null,
                title: 'Plan', blocks: [block(0), block(1)], duration: 20, extraReference: doc(database, 'teams/team-1'),
                attendance: { rosterSize: 3, checkedInCount: 1, updatedAt: new Date('2020-01-01'), players: [
                    { playerId: 'p1', displayName: 'Synthetic p1', status: 'present', checkedInAt: new Timestamp(1000000000, 123456000), note: 'Preserve attendance note' },
                    { playerId: 'p2', displayName: 'Synthetic p2', status: 'absent', checkedInAt: null, note: 'Preserve absent note' }
                ] }, attendancePlayers: 1, aiContext: { privateExtension: { reference: doc(database, 'teams/team-1'), at: new Timestamp(1000000000, 987654000) },
                    presentPlayerIds: ['p1'], attendanceSummary: { present: 1, late: 0, absent: 1 } } });
        });
    });
    it('preserves exact check-in timestamps, notes, references and unrelated AI fields while atomically refreshing attendance totals', async () => {
        const before = (await getDoc(doc(db(), path))).data(); const engine = command('attendance'); await engine.prepare(input);
        const payload = `teams/team-1/privateAiPendingActions/direct_owner_${proposalId}`; const header = `users/owner/privateAiPendingActions/direct_${proposalId}`;
        expect(JSON.stringify((await getDoc(doc(db(), payload))).data())).not.toContain('Preserve attendance note'); expect(JSON.stringify((await getDoc(doc(db(), header))).data())).not.toContain('Synthetic p1'); await assertFails(getDoc(doc(db('parent'), payload)));
        await engine.confirm({ proposalId }, accept); const after = (await getDoc(doc(db(), path))).data();
        expect(after.attendance.players[0]).toEqual({ ...before.attendance.players[0], status: 'late' }); expect(after.attendance.players[0].checkedInAt.nanoseconds).toBe(123456000);
        expect(after.attendance.players[1]).toEqual(before.attendance.players[1]); expect(after.attendance.players[2]).toMatchObject({ playerId: 'p3', status: 'present', note: null });
        expect(after.attendance).toMatchObject({ rosterSize: 3, checkedInCount: 2 }); expect(after.attendancePlayers).toBe(2);
        expect(after.aiContext.attendanceSummary).toEqual({ present: 1, late: 1, absent: 1 }); expect(after.aiContext.presentPlayerIds).toEqual(['p1', 'p3']);
        expect(persisted(after.aiContext.privateExtension)).toEqual(persisted(before.aiContext.privateExtension)); expect(after.extraReference.path).toBe('teams/team-1'); expect(after.blocks).toEqual(before.blocks);
        expect((await getDoc(doc(db(), header))).data()).toMatchObject({ status: 'completed', receiptOnly: true }); await admin(async (database) => expect((await getDoc(doc(database, payload))).exists()).toBe(false));
    });
    it('reorders/retimes blocks without rewriting attendance timestamp precision or other data', async () => {
        const before = (await getDoc(doc(db(), path))).data(); const engine = command('blocks'); await engine.prepare(blockInput); await engine.confirm({ proposalId }, accept);
        const after = (await getDoc(doc(db(), path))).data(); expect(after.blocks).toEqual([{ ...before.blocks[1], order: 0 }, { ...before.blocks[0], order: 1, duration: 20 }]); expect(after.duration).toBe(30);
        expect(after.attendance).toEqual(before.attendance); expect(persisted(after.aiContext)).toEqual(persisted(before.aiContext)); expect(persisted(after.extraReference)).toEqual(persisted(before.extraReference));
    });
    it('initializes empty attendance then saves the full bounded twenty-player batch', async () => {
        const playerIds = Array.from({ length: 20 }, (_, i) => `extra${i}`); await admin(async (database) => {
            for (const id of playerIds) await setDoc(doc(database, `teams/team-1/players/${id}`), { name: id, active: true });
            await updateDoc(doc(database, path), { attendance: { rosterSize: 0, checkedInCount: 0, updatedAt: new Date(), players: [] }, attendancePlayers: 0 });
        });
        const engine = command('attendance'); await engine.prepare({ ...input, changes: playerIds.map((playerId) => ({ playerId, status: 'present' })) }); await engine.confirm({ proposalId }, accept);
        const saved = (await getDoc(doc(db(), path))).data(); expect(saved.attendance.players).toHaveLength(20); expect(saved.attendance.rosterSize).toBe(23); expect(saved.attendance.checkedInCount).toBe(20);
    });
    it.each(['packet', 'duplicate_session', 'roster_change', 'inactive_player'])('rejects %s introduced after attendance preparation', async (kind) => {
        const engine = command('attendance'); await engine.prepare(input); const before = (await getDoc(doc(db(), path))).data().attendance;
        await expect(engine.confirm({ proposalId }, async () => {
            await admin(async (database) => {
                if (kind === 'packet') await updateDoc(doc(database, path), { homePacketGenerated: true, homePacketContent: { blocks: ['Synthetic'] } });
                if (kind === 'duplicate_session') await setDoc(doc(database, 'teams/team-1/practiceSessions/other'), { eventId: 'practice' });
                if (kind === 'roster_change') await setDoc(doc(database, 'teams/team-1/players/new'), { name: 'New', active: true });
                if (kind === 'inactive_player') await updateDoc(doc(database, 'teams/team-1/players/p3'), { active: false });
            }); return accept();
        })).rejects.toThrow(); expect((await getDoc(doc(db(), path))).data().attendance).toEqual(before);
    });
    it.each(['attendance', 'blocks'])('rejects manager revocation and commit-time wrong credentials for %s', async (kind) => {
        let commits = 0; const engine = command(kind, async (url, options) => {
            if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; return localFetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token('parent')}` } }); } return localFetch(url, options);
        });
        const before = (await getDoc(doc(db(), path))).data(); await engine.prepare(kind === 'attendance' ? input : blockInput); await expect(engine.confirm({ proposalId }, accept)).rejects.toThrow(); expect(commits).toBe(1);
        expect(persisted((await getDoc(doc(db(), path))).data())).toEqual(persisted(before));
        await admin((database) => updateDoc(doc(database, 'teams/team-1'), { ownerId: 'replacement' })); await expect(engine.status({ proposalId })).rejects.toThrow();
    });
    it.each(['attendance', 'blocks'])('reconciles a lost %s commit response without repeating the change', async (kind) => {
        let commits = 0; const engine = command(kind, async (url, options) => {
            const response = await localFetch(url, options); if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; if (response.ok) throw new Error('Synthetic lost response'); } return response;
        });
        await engine.prepare(kind === 'attendance' ? input : blockInput); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect(commits).toBe(1);
    });
    it('rejects a stale plan proposal after attendance commits and succeeds after a new review', async () => {
        const attendance = command('attendance'); const blocks = command('blocks'); await attendance.prepare(input); await blocks.prepare({ ...blockInput, proposalId: second });
        await attendance.confirm({ proposalId }, accept); await expect(blocks.confirm({ proposalId: second }, accept)).rejects.toThrow();
        const next = '00112233-4455-4677-8899-aabbccddeebb'; await blocks.prepare({ ...blockInput, proposalId: next }); await blocks.confirm({ proposalId: next }, accept);
        expect((await getDoc(doc(db(), path))).data()).toMatchObject({ duration: 30, attendancePlayers: 2 });
    });
});
