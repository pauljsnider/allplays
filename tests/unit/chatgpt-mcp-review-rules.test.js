import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, writeBatch } from 'firebase/firestore';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { createMockUserToken } from '@firebase/util';
import { createUserDb } from '../../services/chatgpt-mcp/src/firestoreRest.js';
import { getManagedTeamRoster } from '../../services/chatgpt-mcp/src/rosterDiscovery.js';
const id = 'mcp_00112233-4455-4677-8899-aabbccddeeff';
const userPath = `users/owner/privateAiPendingActions/${id}`;
const teamPath = `teams/team-1/privateAiPendingActions/${id}`;
const envelope = { userId: 'owner', toolName: 'mcp_review_request', requestTool: 'apply_roster_import', status: 'mcp_request', reviewStatus: 'requested', payloadScope: 'team', teamId: 'team-1', args: {}, expiresAt: new Date(Date.now() + 1800000).toISOString() };
const payload = { ...envelope, status: 'pending', args: { teamId: 'team-1', operations: [{ name: 'Synthetic Child' }] }, expiresAtAt: new Date(Date.now() + 1800000) };
describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('MCP review envelopes under real Firestore rules', () => {
    let env;
    beforeAll(async () => {
        env = await initializeTestEnvironment({ projectId: 'demo-allplays-mcp-review', firestore: { rules: compactFirestoreRules(readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')) } });
    }, 30000);
    afterAll(async () => { await env?.cleanup(); });
    beforeEach(async () => {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(context.firestore(), 'teams/team-1'), { ownerId: 'owner', name: 'Synthetic', adminEmails: [] });
        });
    });
    const userDb = (uid, verified = true) => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: verified }).firestore();
    it('accepts an atomic manager request while other accounts and unverified users cannot write it', async () => {
        const db = userDb('owner');
        const batch = writeBatch(db);
        batch.set(doc(db, userPath), envelope); batch.set(doc(db, teamPath), payload);
        await assertSucceeds(batch.commit());
        expect((await getDoc(doc(db, userPath))).data().args).toEqual({});
        await assertFails(getDoc(doc(userDb('other'), userPath)));
        await assertFails(getDoc(doc(userDb('other'), teamPath)));
        await assertFails(setDoc(doc(userDb('owner', false), userPath), envelope));
        await assertFails(setDoc(doc(userDb('other'), teamPath), { ...payload, userId: 'other' }));
    });
    it('revoked managers retain only empty user metadata and lose the roster payload', async () => {
        const db = userDb('owner');
        await setDoc(doc(db, userPath), envelope); await setDoc(doc(db, teamPath), payload);
        await env.withSecurityRulesDisabled(async (context) => updateDoc(doc(context.firestore(), 'teams/team-1'), { ownerId: 'replacement' }));
        expect((await getDoc(doc(db, userPath))).data().args).toEqual({});
        await assertFails(getDoc(doc(db, teamPath)));
        await assertFails(updateDoc(doc(db, teamPath), { args: {} }));
    });
    it('makes expired team request payloads unreadable', async () => {
        const db = userDb('owner');
        await setDoc(doc(db, teamPath), { ...payload, expiresAtAt: new Date(0) });
        await assertFails(getDoc(doc(db, teamPath)));
    });
    it('runs projected roster pagination through real REST rules and rejects a revoked manager', async () => {
        const host = process.env.FIRESTORE_EMULATOR_HOST;
        if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Only a local emulator is allowed.');
        await env.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'teams/team-1/players/a'), { name: 'Synthetic A', active: false });
            await setDoc(doc(context.firestore(), 'teams/team-1/players/b'), { name: 'Synthetic B', active: true });
        });
        const db = createUserDb({
            projectId: 'demo-allplays-mcp-review',
            idToken: createMockUserToken({ sub: 'owner', email: 'owner@example.test', email_verified: true }, 'demo-allplays-mcp-review'),
            fetchImpl: (url, options) => {
                if (!url.startsWith('https://firestore.googleapis.com/v1/')) throw new Error('Unexpected test request');
                return fetch(url.replace('https://firestore.googleapis.com', `http://${host}`), options);
            }
        });
        const context = { teams: new Map([['team-1', { roles: new Set(['owner']) }]]) };
        const first = await getManagedTeamRoster(db, context, { teamId: 'team-1', limit: 1 });
        expect(first).toMatchObject({ players: [{ id: 'a', active: false }], hasMore: true, nextCursor: 'a' });
        expect(await getManagedTeamRoster(db, context, { teamId: 'team-1', limit: 1, cursor: first.nextCursor })).toMatchObject({ players: [{ id: 'b', active: true }], hasMore: false });
        await env.withSecurityRulesDisabled(async (context) => updateDoc(doc(context.firestore(), 'teams/team-1'), { ownerId: 'replacement' }));
        await expect(getManagedTeamRoster(db, context, { teamId: 'team-1' })).rejects.toMatchObject({ code: 'permission_denied' });
    });
});
