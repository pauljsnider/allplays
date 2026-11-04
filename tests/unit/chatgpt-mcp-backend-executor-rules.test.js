import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { initializeTestEnvironment, assertFails } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, runTransaction, collection, getDocs } from 'firebase/firestore';
import { createMockUserToken } from '@firebase/util';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { createBackendScheduleExecutor } from '../../services/chatgpt-mcp/src/backendScheduleExecutor.js';
import { createDirectScheduleCommands, createDirectScheduleStore } from '../../services/chatgpt-mcp/src/directSchedule.js';
const require = createRequire(import.meta.url);
const { signBrokerCommand, createScheduleBrokerChannel } = require('../../functions/schedule-broker-channel.cjs');
const { createScheduleBrokerHttpHandler } = require('../../functions/schedule-broker-http.cjs');
const { createScheduleEvidenceAuthority } = require('../../functions/schedule-delivery-evidence.cjs');
const { createFirestoreNotificationJournalStore } = require('../../functions/notification-attempt-journal.cjs');
const { createScheduleRecoveryPipeline } = require('../../functions/schedule-recovery-pipeline.cjs');
const projectId = 'demo-allplays-mcp-review';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const eventId = `mcp_${proposalId}`;
const eventPath = `teams/team-1/games/${eventId}`;
const headerPath = `users/owner/privateAiPendingActions/direct_${proposalId}`;
const audience = 'isolated-schedule-backend';
const token = (uid = 'owner') => createMockUserToken({ sub: uid, email: `${uid}@example.test`, email_verified: true }, projectId);

describe('backend executor construction boundary', () => {
    it('requires explicit private evidence and producer dependencies', () => {
        expect(() => createBackendScheduleExecutor({ projectId })).toThrow();
    });
    it('rejects serialized input without both channel guards before reading or writing data', async () => {
        let requests = 0;
        const execute = createBackendScheduleExecutor({ projectId, createAuthority: () => {}, createProducer: () => {}, fetchImpl: async () => { requests++; } });
        for (const input of [{}, { assertCurrent: async () => {} }, { assertDispatchReady: () => {} }]) await expect(execute(input)).rejects.toThrow();
        expect(requests).toBe(0);
    });
    for (const kind of ['async', 'non-void']) it(`rejects a ${kind} final guard before any data request`, async () => {
        let requests = 0;
        const execute = createBackendScheduleExecutor({ projectId, now: () => 100000, createAuthority: () => {}, createProducer: () => {}, fetchImpl: async () => { requests++; } });
        await expect(execute({ actor: { uid: 'owner', sessionId: 'session', clientId: 'client', grantKey: 'a'.repeat(64) }, command: { proposalId, eventId, teamId: 'team-1', mode: 'create', eventType: 'game', changes: {} },
            approval: { preview: {}, approve: true, notifyTeam: true }, idToken: 'synthetic', issuedAt: 90000, expiresAt: 150000,
            assertCurrent: async () => {}, assertDispatchReady: kind === 'async' ? async () => {} : () => true })).rejects.toThrow();
        expect(requests).toBe(0);
    });
});

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('signed channel with actual schedule engine and credentialed executor', () => {
    let env;
    beforeAll(async () => { env = await initializeTestEnvironment({ projectId, firestore: { rules: compactFirestoreRules(readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')) } }); }, 30000);
    afterAll(async () => env?.cleanup());
    beforeEach(async () => { await env.clearFirestore(); });
    const ownerDb = () => env.authenticatedContext('owner', { email: 'owner@example.test', email_verified: true }).firestore();
    async function fixture(database, { mode = 'create', eventType = 'game', fault = null } = {}) {
        const host = process.env.FIRESTORE_EMULATOR_HOST;
        if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Only the isolated loopback emulator is allowed');
        await setDoc(doc(database, 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
        await setDoc(doc(database, 'teams/team-1'), { ownerId: 'owner', adminEmails: [], name: 'Synthetic Team' });
        await setDoc(doc(database, 'users/owner'), {});
        if (mode === 'update') await setDoc(doc(database, eventPath), { type: eventType, status: 'scheduled', date: new Date('2060-12-01T17:00Z'),
            location: 'Old field', ...(eventType === 'game' ? { opponent: 'Old Visitors', isHome: true } : { title: 'Old Practice', end: new Date('2060-12-01T18:00Z') }) });
        const serverDb = {
            doc: (path) => ({ path, get: async () => { const row = await getDoc(doc(database, path)); return { exists: row.exists(), data: () => row.data() }; } }),
            runTransaction: (callback) => runTransaction(database, (tx) => callback({ get: async (ref) => { const row = await tx.get(doc(database, ref.path)); return { exists: row.exists(), data: () => row.data() }; }, set: (ref, data) => tx.set(doc(database, ref.path), data) }))
        };
        const privateStore = createFirestoreNotificationJournalStore(serverDb);
        const actor = { uid: 'owner', clientId: 'synthetic-client', grantKey: 'a'.repeat(64), sessionId: 'synthetic-session' };
        const idToken = token(); const signing = generateKeyPairSync('ed25519'); const publicKeys = new Map([['synthetic', signing.publicKey]]);
        let offset = 0; const now = () => Date.now() + offset; let connected = true; let armed = false; let preparing = true; let commits = 0; let executions = 0;
        const trace = []; const transactions = new Set();
        const localFetch = async (url, options) => {
            if (!url.startsWith(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`)) throw new Error('Non-emulator target rejected');
            expect(options.headers.Authorization).toBe(`Bearer ${idToken}`);
            if (!preparing) expect(options.redirect).toBe('error');
            const body = options.body ? JSON.parse(options.body) : {};
            const committing = url.endsWith(':commit') && body.transaction;
            if (committing) { expect(armed).toBe(true); expect(trace.at(-1)).toBe('guard'); trace.push('business-fetch'); commits++; }
            const request = !preparing && fault === 'wrong-user' ? { ...options, headers: { ...options.headers, Authorization: `Bearer ${token('other')}` } } : options;
            const response = await fetch(url.replace('https://firestore.googleapis.com', `http://${host}`), request);
            if (response.ok && url.endsWith(':beginTransaction')) transactions.add((await response.clone().json()).transaction);
            if (response.ok && (committing || url.endsWith(':rollback'))) transactions.delete(body.transaction);
            if (committing && response.ok && fault === 'lost-response') throw new Error('Synthetic lost business commit response');
            return response;
        };
        const getContext = async () => {
            const team = (await getDoc(doc(ownerDb(), 'teams/team-1'))).data();
            return { uid: 'owner', teams: new Map([['team-1', { roles: new Set(team.ownerId === 'owner' ? ['owner'] : []) }]]) };
        };
        const store = createDirectScheduleStore({ projectId, uid: 'owner', idToken, fetchImpl: localFetch });
        const changes = mode === 'create' ? { startDate: '2060-12-01T17:00Z', ...(eventType === 'game' ? { opponent: 'Approved Visitors' } : { title: 'Approved Practice', endDate: '2060-12-01T18:00Z' }) }
            : { location: 'Approved field' };
        const commands = createDirectScheduleCommands({ uid: 'owner', store, getContext, now });
        await commands.prepare({ proposalId, mode, teamId: 'team-1', eventId, eventType, changes });
        const prepared = (await store.get(headerPath)).data;
        const command = { proposalId, mode, teamId: 'team-1', eventId, eventType, changes: prepared.changes };
        const approval = { preview: prepared.preview, approve: true, notifyTeam: true };
        preparing = false;
        const execute = createBackendScheduleExecutor({ projectId, fetchImpl: localFetch, now,
            createAuthority: (interfaces) => {
                const authority = createScheduleEvidenceAuthority({ store: privateStore, now, ...interfaces });
                return fault === 'proof-failure' ? { ...authority, recordCommit: async () => { throw new Error('Synthetic private proof failure'); } } : authority;
            },
            createProducer: ({ authority }) => {
                const pipeline = createScheduleRecoveryPipeline({ store: privateStore, authority, now,
                    assessAudience: async () => ({ state: 'ready', targets: [] }), prepareLegacyPlan: async () => [],
                    verifyPlatformTrigger: async () => { throw new Error('No trigger delivery in this executor fixture'); },
                    authorizeDelivery: async () => { throw new Error('No notification authorization in this fixture'); },
                    providers: { pin: (request) => request, send: async () => { throw new Error('No provider sends in this fixture'); } },
                    readVerifiedDeploymentGate: async () => { throw new Error('No production gate in this fixture'); }, scanWork: async () => ({ rows: [], nextCursor: null }) });
                return { ...pipeline.producer, beginWrite: async (handle) => {
                    await pipeline.producer.beginWrite(handle); armed = true;
                    if (fault === 'expired-ack') offset += 180000;
                    if (fault === 'removed-key') publicKeys.clear();
                    if (fault === 'disconnected') connected = false;
                } };
            }
        });
        const dependencies = { audience, publicKeys, store: privateStore, now,
            verifyUserToken: async (value) => { expect(value).toBe(idToken); return { uid: actor.uid, disabled: false, emailVerified: true, expiresAt: now() + 3600000 }; },
            verifyLiveSession: async () => ({ ...actor, connected, reviewRequests: true, expiresAt: now() + 3600000 }),
            authorizeActor: async () => (await getContext()).teams.get('team-1').roles.has('owner'),
            executeCommand: async (input) => { executions++; return execute({ ...input, assertDispatchReady: () => { trace.push('guard'); input.assertDispatchReady(); } }); }
        };
        const envelope = () => { const issuedAt = now(); return signBrokerCommand({ keyId: 'synthetic', privateKey: signing.privateKey, audience, actor, command, approval, idToken, issuedAt, expiresAt: issuedAt + 120000 }); };
        const rows = async () => (await getDocs(collection(database, 'teams/team-1/notificationSendLog'))).docs;
        return { command, approval, execute, actor, idToken, envelope, create: () => createScheduleBrokerChannel(dependencies), commits: () => commits, executions: () => executions, rows,
            close: async () => {
                // Test-only cleanup after revocation deliberately prevents the
                // application from obtaining credentials for normal rollback.
                for (const transaction of transactions) await fetch(`http://${host}/v1/projects/${projectId}/databases/(default)/documents:rollback`, {
                    method: 'POST', headers: { Authorization: `Bearer ${idToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ transaction })
                });
            } };
    }
    const withFixture = (options, run) => env.withSecurityRulesDisabled(async (context) => {
        const f = await fixture(context.firestore(), options);
        try { await run(f, context.firestore()); } finally { await f.close(); }
    });
    for (const mode of ['create', 'update']) for (const eventType of ['game', 'practice']) it(`executes ${mode} ${eventType} through the signed channel with private proof`, async () => {
        await withFixture({ mode, eventType }, async (f) => {
            expect((await f.create().handle(f.envelope())).status).toBe('committed'); expect(f.commits()).toBe(1);
            expect((await getDoc(doc(ownerDb(), eventPath))).data()).toMatchObject(mode === 'create' ? { type: eventType } : { location: 'Approved field' });
            const rows = await f.rows(); const evidence = rows.filter((row) => row.data().kind === 'schedule-approval-evidence');
            expect(evidence).toHaveLength(1); expect(evidence[0].data().state).toBe('committed');
            expect(rows.find((row) => row.data().kind === 'schedule-proof-fence').data().state).toBe('proof');
            await assertFails(getDoc(doc(ownerDb(), evidence[0].ref.path)));
            expect(JSON.stringify(rows.map((row) => row.data()))).not.toContain(f.idToken);
        });
    });
    it('serializes parallel signed requests and does not repeat a verified mutation across restart', async () => {
        await withFixture({}, async (f) => {
            const result = await Promise.all([f.create().handle(f.envelope()), f.create().handle(f.envelope())]);
            expect(result.some((row) => row.status === 'committed')).toBe(true); expect(f.commits()).toBe(1); expect(f.executions()).toBe(1);
            expect((await f.create().handle(f.envelope())).status).toBe('committed'); expect(f.commits()).toBe(1);
        });
    });
    it('crosses private loopback HTTP into the actual executor and returns only opaque commit status', async () => {
        await withFixture({}, async (f) => {
            let handler; const server = createServer((req, res) => handler(req, res));
            await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
            const host = `127.0.0.1:${server.address().port}`;
            handler = createScheduleBrokerHttpHandler({ channel: f.create(), audience, allowedHosts: [host], allowedPrincipals: ['synthetic-broker'], takeRateLimit: async () => true,
                verifyWorkloadIdentity: async (value) => { if (value !== 'synthetic-workload-token') throw new Error('Untrusted workload'); return { principal: 'synthetic-broker', audience, expiresAt: Date.now() + 60000 }; } });
            try {
                const send = (authorization) => fetch(`http://${host}/internal/v1/schedule-command`, { method: 'POST', headers: { authorization, 'content-type': 'application/json' }, redirect: 'error', body: JSON.stringify(f.envelope()) });
                const response = await send('Bearer synthetic-workload-token'); expect(response.status).toBe(200);
                const result = await response.json(); expect(result.status).toBe('committed'); expect(Object.keys(result).sort()).toEqual(['operationId', 'status']);
                expect(f.commits()).toBe(1); expect((await send('Bearer untrusted-workload')).status).toBe(403); expect(f.commits()).toBe(1);
            } finally { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
        });
    });
    for (const change of ['command', 'preview', 'proposal-id', 'receipt']) it(`rejects substituted ${change} without business writes or private commit evidence`, async () => {
        await withFixture({}, async (f, database) => {
            if (change === 'command') f.command.changes.opponent = 'Unapproved Visitors';
            if (change === 'preview') f.approval.preview.after.opponent = 'Unapproved Visitors';
            if (change === 'proposal-id') f.command.proposalId = 'not-a-uuid';
            if (change === 'receipt') await setDoc(doc(database, headerPath), { ...(await getDoc(doc(database, headerPath))).data(), status: 'completed', receiptOnly: true });
            expect((await f.create().handle(f.envelope())).status).toBe('unverified'); expect(f.commits()).toBe(0);
            expect((await getDoc(doc(database, eventPath))).exists()).toBe(false);
            expect((await f.rows()).some((row) => row.data().kind === 'schedule-approval-evidence')).toBe(false);
        });
    });
    it('rejects a changed event revision after preparation', async () => {
        await withFixture({ mode: 'update' }, async (f, database) => {
            await setDoc(doc(database, eventPath), { location: 'Another edit' }, { merge: true });
            expect((await f.create().handle(f.envelope())).status).toBe('unverified'); expect(f.commits()).toBe(0);
            expect((await getDoc(doc(database, eventPath))).data().location).toBe('Another edit');
        });
    });
    for (const fault of ['expired-ack', 'removed-key', 'disconnected']) it(`enforces channel guards after producer dispatch acknowledgment: ${fault}`, async () => {
        await withFixture({ fault }, async (f, database) => {
            await expect(f.create().handle(f.envelope())).rejects.toThrow(); expect(f.commits()).toBe(0);
            expect((await getDoc(doc(database, eventPath))).exists()).toBe(false);
            const rows = await f.rows(); expect(rows.find((row) => row.data().kind === 'schedule-proof-fence').data().producerState).toBe('dispatched');
            expect(rows.find((row) => row.data().kind === 'schedule-approval-evidence').data().state).toBe('consumed');
        });
    });
    for (const fault of ['lost-response', 'proof-failure']) it(`does not promote a reconciled user receipt after ${fault}`, async () => {
        await withFixture({ fault }, async (f, database) => {
            expect((await f.create().handle(f.envelope())).status).toBe('unverified'); expect(f.commits()).toBe(1);
            expect((await getDoc(doc(database, eventPath))).exists()).toBe(true);
            expect((await getDoc(doc(database, headerPath))).data().status).toBe('completed');
            expect((await f.rows()).find((row) => row.data().kind === 'schedule-approval-evidence').data().state).toBe('consumed');
            expect((await f.create().handle(f.envelope())).status).toBe('unverified'); expect(f.commits()).toBe(1);
        });
    });
    it('keeps reads and writes subject to actual Firestore user rules', async () => {
        await withFixture({ fault: 'wrong-user' }, async (f, database) => {
            expect((await f.create().handle(f.envelope())).status).toBe('unverified'); expect(f.commits()).toBe(0);
            expect((await getDoc(doc(database, eventPath))).exists()).toBe(false);
        });
    });
});
