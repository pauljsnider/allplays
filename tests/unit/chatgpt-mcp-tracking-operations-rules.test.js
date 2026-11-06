import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, Timestamp } from 'firebase/firestore';
import { createMockUserToken } from '@firebase/util';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { buildTrackingStatusPayload } from '../../js/tracking-status-admin.js';
import { createDirectTrackingBatchCommands, createDirectTrackingBatchStore, createDirectTrackingLifecycleCommands, createDirectTrackingLifecycleStore } from '../../services/chatgpt-mcp/src/directTrackingOperations.js';
const projectId = 'demo-allplays-mcp-review';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const second = '00112233-4455-4677-8899-aabbccddeeaa';
const third = '00112233-4455-4677-8899-aabbccddeebb';
const itemPath = 'teams/team-1/trackingItems/item';
const statusPath = (id) => `${itemPath}/memberTracking/${id}`;
const batch = { proposalId, teamId: 'team-1', itemId: 'item', changes: [{ playerId: 'p1', complete: true }, { playerId: 'p2', complete: false }] };
const lifecycle = { proposalId, teamId: 'team-1', itemId: 'item', active: false };
const header = `users/owner/privateAiPendingActions/direct_${proposalId}`;
const payload = `teams/team-1/privateAiPendingActions/direct_owner_${proposalId}`;
const accept = async () => ({ action: 'accept', content: { approve: true, trackingLifecycle: true }, consume: async () => {} });
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('tracking batch and lifecycle under actual rules', () => {
    let env; let seededStatus;
    beforeAll(async () => { env = await initializeTestEnvironment({ projectId, firestore: { rules: compactFirestoreRules(readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')) } }); }, 30000);
    afterAll(async () => env?.cleanup());
    const db = (uid = 'owner') => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
    const token = (uid = 'owner', verified = true) => createMockUserToken({ sub: uid, email: `${uid}@example.test`, email_verified: verified }, projectId);
    const localFetch = (url, options) => {
        const host = process.env.FIRESTORE_EMULATOR_HOST;
        if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !url.startsWith(`https://firestore.googleapis.com/v1/projects/${projectId}/`)) throw new Error('Only isolated demo-emulator requests are allowed');
        return fetch(url.replace('https://firestore.googleapis.com', `http://${host}`), options);
    };
    const getContext = async () => {
        const team = (await getDoc(doc(db(), 'teams/team-1'))).data();
        return { uid: 'owner', teams: new Map([['team-1', { team, roles: new Set(team?.ownerId === 'owner' ? ['owner'] : []) }]]) };
    };
    const commands = (kind, fetchImpl = localFetch) => (kind === 'batch' ? createDirectTrackingBatchCommands : createDirectTrackingLifecycleCommands)({ uid: 'owner', getContext,
        store: (kind === 'batch' ? createDirectTrackingBatchStore : createDirectTrackingLifecycleStore)({ projectId, uid: 'owner', idToken: token(), fetchImpl }) });
    const admin = (fn) => env.withSecurityRulesDisabled((context) => fn(context.firestore()));
    const read = async (path, uid = 'owner') => (await getDoc(doc(db(uid), path))).data();
    const status = (id, complete) => ({ ...buildTrackingStatusPayload({ teamId: 'team-1', itemId: 'item', player: { id, name: `Synthetic ${id}`, number: '07' }, complete, actorId: 'owner', actorEmail: null }), updatedAt: new Timestamp(1000000000, 123456789) });
    const noBatchWrites = async () => admin(async (database) => { expect((await getDoc(doc(database, statusPath('p1')))).exists()).toBe(false); expect((await getDoc(doc(database, statusPath('p2')))).data()).toEqual(seededStatus); });
    beforeEach(async () => {
        await env.clearFirestore(); await admin(async (database) => {
            await setDoc(doc(database, 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(database, 'teams/team-1'), { ownerId: 'owner', adminEmails: [], isPublic: true, name: 'Synthetic Team' });
            await setDoc(doc(database, 'users/parent'), { parentTeamIds: ['team-1'], parentPlayerKeys: ['team-1::p1'] });
            await setDoc(doc(database, itemPath), { teamId: 'team-1', name: 'Private requirement', description: 'Staff-only text', visibility: 'private', status: 'active', active: true, archived: false, createdAt: new Timestamp(1000000000, 987654321), createdBy: 'owner' });
            for (const id of ['p1', 'p2']) await setDoc(doc(database, `teams/team-1/players/${id}`), { name: `Synthetic ${id}`, number: '07', active: true });
            await setDoc(doc(database, statusPath('p2')), status('p2', true)); await setDoc(doc(database, statusPath('other')), { note: 'Preserve unselected', createdAt: new Timestamp(1000000001, 123456789) });
        });
        seededStatus = await read(statusPath('p2'));
    });
    it('applies mixed create/update together and retains team-only proposals and minimal receipts', async () => {
        const engine = commands('batch'); const original = await read(itemPath); const other = await read(statusPath('other')); await engine.prepare(batch);
        expect(JSON.stringify(await read(header))).not.toContain('Synthetic p1'); await assertFails(getDoc(doc(db('parent'), payload))); await assertFails(getDoc(doc(db('parent'), statusPath('p2'))));
        await engine.confirm({ proposalId }, accept);
        for (const { playerId, complete } of batch.changes) expect(await read(statusPath(playerId))).toMatchObject({ ...buildTrackingStatusPayload({ teamId: 'team-1', itemId: 'item', player: { id: playerId, name: `Synthetic ${playerId}`, number: '07' }, complete, actorId: 'owner', actorEmail: null }) });
        expect(await read(itemPath)).toEqual(original); expect(await read(statusPath('other'))).toEqual(other); await admin(async (database) => expect((await getDoc(doc(database, payload))).exists()).toBe(false)); expect(await read(header)).toMatchObject({ receiptOnly: true, status: 'completed', playerIds: ['p1', 'p2'] });
        await assertFails(getDoc(doc(db('parent'), statusPath('p1'))));
    });
    it('supports all twenty selected players within actual rules limits', async () => {
        const changes = Array.from({ length: 20 }, (_, i) => ({ playerId: `child${i}`, complete: i % 2 === 0 }));
        await admin(async (database) => { for (const { playerId } of changes) await setDoc(doc(database, `teams/team-1/players/${playerId}`), { name: playerId, active: true }); });
        const engine = commands('batch'); await engine.prepare({ ...batch, changes }); await engine.confirm({ proposalId }, accept); for (const { playerId, complete } of changes) expect((await read(statusPath(playerId))).complete).toBe(complete);
    });
    it('archives then reactivates with exact creation audit and all completion records preserved', async () => {
        const original = await read(itemPath); const previous = await read(statusPath('p2')); const other = await read(statusPath('other')); const engine = commands('lifecycle');
        await engine.prepare(lifecycle); await engine.confirm({ proposalId }, accept); expect(await read(itemPath)).toMatchObject({ ...original, active: false, archived: true, status: 'archived' });
        await expect(commands('batch').prepare({ ...batch, proposalId: second })).rejects.toThrow();
        await engine.prepare({ ...lifecycle, proposalId: second, active: true }); await engine.confirm({ proposalId: second }, accept);
        expect(await read(itemPath)).toMatchObject(original); expect(await read(statusPath('p2'))).toEqual(previous); expect(await read(statusPath('other'))).toEqual(other); await assertFails(getDoc(doc(db('parent'), itemPath)));
        await commands('batch').prepare({ ...batch, proposalId: third });
    });
    it('preserves a later authorized status edit during lifecycle approval as the form discloses', async () => {
        const engine = commands('lifecycle'); await engine.prepare(lifecycle);
        await engine.confirm({ proposalId }, async () => { await admin((database) => updateDoc(doc(database, statusPath('p2')), { note: 'Later retained extension' })); return accept(); });
        expect((await read(itemPath)).status).toBe('archived'); expect((await read(statusPath('p2'))).note).toBe('Later retained extension');
    });
    it.each(['player', 'item', 'permission'])('rejects changed %s without partial batch writes', async (kind) => {
        const engine = commands('batch'); await engine.prepare(batch);
        await expect(engine.confirm({ proposalId }, async () => {
            await admin(async (database) => {
                if (kind === 'player') await updateDoc(doc(database, 'teams/team-1/players/p2'), { active: false });
                if (kind === 'item') await updateDoc(doc(database, itemPath), { active: false, archived: true, status: 'archived' });
                if (kind === 'permission') await updateDoc(doc(database, 'teams/team-1'), { ownerId: 'newowner' });
            }); return accept();
        })).rejects.toThrow(); await noBatchWrites();
    });
    it('retains a competing status and refuses all remaining batch rows', async () => {
        const engine = commands('batch'); await engine.prepare(batch);
        await expect(engine.confirm({ proposalId }, async () => { await admin((database) => updateDoc(doc(database, statusPath('p2')), { updatedAt: new Timestamp(1000000002, 999999999) })); return accept(); })).rejects.toThrow();
        expect(await read(statusPath('p1'))).toBeUndefined(); expect((await read(statusPath('p2'))).complete).toBe(true);
    });
    it.each(['batch', 'lifecycle'])('rules reject different final actor for %s with no partial write', async (kind) => {
        let commits = 0; const original = await read(itemPath); const engine = commands(kind, async (url, options) => {
            if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; return localFetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token('other')}` } }); } return localFetch(url, options);
        });
        await engine.prepare(kind === 'batch' ? batch : lifecycle); await expect(engine.confirm({ proposalId }, accept)).rejects.toThrow(); expect(commits).toBe(1); expect(await read(itemPath)).toEqual(original); await noBatchWrites(); expect((await read(header)).status).toBe('prepared'); expect(await read(payload)).toBeDefined();
    });
    it.each(['batch', 'lifecycle'])('reconciles one lost %s response without repeating the business write', async (kind) => {
        let commits = 0; const engine = commands(kind, async (url, options) => { const response = await localFetch(url, options); if (url.endsWith(':commit') && JSON.parse(options.body).transaction) { commits++; if (response.ok) throw new Error('Synthetic lost acknowledgment'); } return response; });
        await engine.prepare(kind === 'batch' ? batch : lifecycle); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect((await engine.confirm({ proposalId }, accept)).status).toBe('completed'); expect(commits).toBe(1);
        await admin((database) => updateDoc(doc(database, 'teams/team-1'), { ownerId: 'newowner' })); await expect(engine.status({ proposalId })).rejects.toThrow();
    });
    it('requires distinct lifecycle acknowledgement before dispatch', async () => {
        const engine = commands('lifecycle'); await engine.prepare(lifecycle); expect(await engine.confirm({ proposalId }, async () => ({ action: 'accept', content: { approve: true }, consume: async () => {} }))).toMatchObject({ applied: false }); expect((await read(itemPath)).status).toBe('active'); await noBatchWrites();
    });
    it('rejects a stale lifecycle proposal without overwriting the edited item', async () => {
        const engine = commands('lifecycle'); await engine.prepare(lifecycle);
        await expect(engine.confirm({ proposalId }, async () => { await admin((database) => updateDoc(doc(database, itemPath), { description: 'Later text' })); return accept(); })).rejects.toThrow(); expect((await read(itemPath)).description).toBe('Later text'); expect((await read(itemPath)).status).toBe('active');
    });
});
