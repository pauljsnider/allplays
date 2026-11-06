import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { createMockUserToken } from '@firebase/util';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { createDirectPracticeTimelineCommands, createDirectPracticeTimelineStore } from '../../services/chatgpt-mcp/src/directPracticeTimeline.js';
const projectId = 'demo-allplays-mcp-review';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const path = 'teams/team-1/practiceSessions/session';
const eventPath = 'teams/team-1/games/practice';
const header = `users/owner/privateAiPendingActions/direct_${proposalId}`;
const payload = `teams/team-1/privateAiPendingActions/direct_owner_${proposalId}`;
const input = { proposalId, mode: 'update', teamId: 'team-1', eventId: 'practice', sessionId: 'session', changes: { blockReplacements: [{ order: 3, block: { drillId: 'drill', duration: 12 } }], removeBlocks: [0] } };
const block = (order) => ({ order, drillId: null, drillTitle: `Block ${order}`, type: 'Technical', duration: 10, description: `Original content ${order}`, notes: order === 2 ? 'Retain coaching note' : '', notesLog: [] });
const accept = async () => ({ action: 'accept', content: { approve: true, practiceBlockContent: true }, consume: async () => {} });
const persisted = (value) => value instanceof Timestamp ? { seconds: value.seconds, nanoseconds: value.nanoseconds }
    : value?.type === 'document' ? { referencePath: value.path, projectId: value.firestore.app.options.projectId }
        : Array.isArray(value) ? value.map(persisted) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, persisted(entry)])) : value;
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('practice block content with actual rules', () => {
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
    const getContext = async () => ({ uid: 'owner', teams: new Map([['team-1', { roles: new Set(['owner']) }]]) }); // Cached deliberately: real rules still enforce revocation.
    const commands = (fetchImpl = localFetch) => createDirectPracticeTimelineCommands({ uid: 'owner', getContext, store: createDirectPracticeTimelineStore({ projectId, uid: 'owner', idToken: token(), fetchImpl }) });
    const admin = (fn) => env.withSecurityRulesDisabled((context) => fn(context.firestore()));
    const read = async (target = path) => (await getDoc(doc(db(), target))).data();
    beforeEach(async () => {
        await env.clearFirestore(); await admin(async (database) => {
            await setDoc(doc(database, 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(database, 'teams/team-1'), { ownerId: 'owner', adminEmails: [], name: 'Synthetic Team' });
            await setDoc(doc(database, 'users/parent'), { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1'] });
            await setDoc(doc(database, eventPath), { type: 'practice', title: 'Synthetic practice', date: new Date('2060-01-01'), notes: 'Keep schedule notes' });
            await setDoc(doc(database, 'drillLibrary/drill'), { source: 'community', title: 'Synthetic replacement', type: 'Technical', description: 'New planned content' });
            await setDoc(doc(database, path), { eventId: 'practice', eventType: 'practice', status: 'draft', title: 'Plan', homePacketGenerated: false, homePacketContent: null,
                blocks: [block(0), block(1), block(2), block(3)], duration: 40,
                attendance: { players: [{ playerId: 'p1', checkedInAt: new Timestamp(1000000000, 123456789), note: 'Private attendance note' }] },
                aiContext: { protectedReference: doc(database, 'teams/team-1'), at: new Timestamp(1000000000, 987654321) },
                extraReference: doc(database, 'teams/team-1'), unknown: { retain: true } });
        });
    });
    it('replaces/removes approved content atomically while preserving notes, stored timestamp precision, references and private payload scope', async () => {
        const before = await read(); const event = await read(eventPath); const engine = commands(); await engine.prepare(input);
        expect(JSON.stringify(await read(header))).not.toMatch(/Original content|New planned|Retain coaching|Private attendance/); await assertFails(getDoc(doc(db('parent'), payload)));
        expect((await read(payload)).preview.replacements[0].after.order).toBe(2); await engine.confirm({ proposalId }, accept);
        const after = await read(); expect(after.blocks.slice(0, 2)).toEqual([{ ...before.blocks[1], order: 0 }, { ...before.blocks[2], order: 1 }]);
        expect(after.blocks[2]).toEqual({ order: 2, drillId: 'drill', drillTitle: 'Synthetic replacement', type: 'Technical', duration: 12, description: 'New planned content', notes: '', notesLog: [] }); expect(after.duration).toBe(32);
        for (const key of ['attendance', 'aiContext', 'extraReference', 'unknown', 'homePacketContent', 'homePacketGenerated']) expect(persisted(after[key])).toEqual(persisted(before[key])); expect(await read(eventPath)).toEqual(event);
        expect(await read(header)).toMatchObject({ status: 'completed', receiptOnly: true }); await admin(async (database) => expect((await getDoc(doc(database, payload))).exists()).toBe(false));
    });
    it('supports the full bounded thirty-block removal while retaining remaining content', async () => {
        const blocks = Array.from({ length: 40 }, (_, order) => ({ ...block(order), duration: 5, notes: '' })); await admin((database) => updateDoc(doc(database, path), { blocks, duration: 200 }));
        const engine = commands(); await engine.prepare({ ...input, changes: { removeBlocks: Array.from({ length: 30 }, (_, index) => index) } }); await engine.confirm({ proposalId }, accept);
        expect((await read()).blocks).toEqual(blocks.slice(30).map((entry, order) => ({ ...entry, order }))); expect((await read()).duration).toBe(50);
    });
    it.each(['selected_notes', 'historical_log', 'extended', 'packet', 'active', 'imported'])('refuses %s and preserves all stored content', async (kind) => {
        await admin(async (database) => {
            if (kind === 'selected_notes') await updateDoc(doc(database, path), { blocks: [block(0), block(1), block(2), { ...block(3), notes: 'Keep recorded note' }] });
            if (kind === 'historical_log') await updateDoc(doc(database, path), { blocks: [block(0), { ...block(1), notesLog: [{ text: 'History', at: new Timestamp(1000000000, 123456789) }] }, block(2), block(3)] });
            if (kind === 'extended') await updateDoc(doc(database, path), { blocks: [block(0), { ...block(1), reference: doc(database, 'teams/team-1') }, block(2), block(3)] });
            if (kind === 'packet') await updateDoc(doc(database, path), { homePacketContent: { blocks: [] } });
            if (kind === 'active') await updateDoc(doc(database, path), { status: 'in_progress' });
            if (kind === 'imported') await updateDoc(doc(database, eventPath), { source: 'calendar' });
        });
        const before = persisted(await read()); await expect(commands().prepare(input)).rejects.toThrow(); expect(persisted(await read())).toEqual(before);
    });
    it.each(['owner', 'drill', 'session', 'duplicate'])('rejects %s changes while approval is open', async (kind) => {
        const engine = commands(); await engine.prepare(input); const before = await read();
        await expect(engine.confirm({ proposalId }, async () => {
            await admin(async (database) => {
                if (kind === 'owner') await updateDoc(doc(database, 'teams/team-1'), { ownerId: 'other' });
                if (kind === 'drill') await updateDoc(doc(database, 'drillLibrary/drill'), { title: 'Changed after review' });
                if (kind === 'session') await updateDoc(doc(database, path), { title: 'Changed after review' });
                if (kind === 'duplicate') await setDoc(doc(database, 'teams/team-1/practiceSessions/duplicate'), { eventId: 'practice' });
            }); return accept();
        })).rejects.toThrow(); await admin(async (database) => expect((await getDoc(doc(database, path))).data().blocks).toEqual(before.blocks));
    });
    it.each(['wrong', 'unverified'])('rules reject %s commit credentials with no timeline changes', async (kind) => {
        const before = persisted(await read()); let commits = 0; const engine = commands(async (url, options) => {
            if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; return localFetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${kind === 'wrong' ? token('parent') : token('owner', false)}` } }); } return localFetch(url, options);
        }); await engine.prepare(input); await expect(engine.confirm({ proposalId }, accept)).rejects.toThrow(); expect(commits).toBe(1); expect(persisted(await read())).toEqual(before);
    });
    it('reconciles lost response once without applying original indices twice', async () => {
        let commits = 0; const engine = commands(async (url, options) => { const response = await localFetch(url, options); if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; if (response.ok) throw new Error('Synthetic lost response'); } return response; });
        await engine.prepare(input); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect(commits).toBe(1); expect((await read()).blocks).toHaveLength(3);
    });
    it('invalidates a competing edit after another approved edit commits', async () => {
        const engine = commands(); await engine.prepare(input); await engine.prepare({ ...input, proposalId: second, changes: { removeBlocks: [1] } });
        await engine.confirm({ proposalId }, accept); await expect(engine.confirm({ proposalId: second }, accept)).rejects.toThrow(); expect((await read()).blocks).toHaveLength(3);
    });
    it('requires extra content approval before any transaction commit', async () => {
        const before = persisted(await read()); let commits = 0; const engine = commands(async (url, options) => { if (url.endsWith(':commit') && JSON.parse(options.body).transaction) commits++; return localFetch(url, options); });
        await engine.prepare(input); expect(await engine.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} }))).toMatchObject({ applied: false }); expect(commits).toBe(0); expect(persisted(await read())).toEqual(before);
    });
});
