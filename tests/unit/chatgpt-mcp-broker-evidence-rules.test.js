import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, runTransaction, collection, query, where, limit, getDocs, orderBy, startAfter } from 'firebase/firestore';
import { createMockUserToken } from '@firebase/util';
import { compactFirestoreRules } from '../../scripts/compact-firestore-rules.mjs';
import { createOAuthBroker, s256Challenge } from '../../services/chatgpt-mcp/src/oauth.js';
import { createIdentityResolver } from '../../services/chatgpt-mcp/src/identity.js';
import { createDirectSessionAuthenticator } from '../../services/chatgpt-mcp/src/directSessionAuth.js';
import { createDirectSessionRouter } from '../../services/chatgpt-mcp/src/directSessionTransport.js';
import { createDirectScheduleStore } from '../../services/chatgpt-mcp/src/directSchedule.js';
import { createDirectFavoriteStore } from '../../services/chatgpt-mcp/src/directFavoriteStore.js';
import { createBrokerScheduleEvidenceBridge, createCredentialedEvidenceReader, canonicalEvidenceFields } from '../../services/chatgpt-mcp/src/directScheduleEvidence.js';
import express from '../../services/chatgpt-mcp/node_modules/express/index.js';
import { Client } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js';
import { StreamableHTTPClientTransport } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js';
import { ElicitRequestSchema } from '../../services/chatgpt-mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/types.js';
const require = createRequire(import.meta.url);
const { createScheduleEvidenceAuthority } = require('../../functions/schedule-delivery-evidence.cjs');
const { createFirestoreNotificationJournalStore } = require('../../functions/notification-attempt-journal.cjs');
const { createScheduleDeliveryCoordinator } = require('../../functions/schedule-delivery-coordinator.cjs');
const { createScheduleDeliveryProviders } = require('../../functions/schedule-delivery-providers.cjs');
const { createCanonicalScheduleMembership, createCanonicalScheduleReadiness } = require('../../functions/schedule-canonical-membership.cjs');
const { createScheduleDeliveryAudience, createFirestoreScheduleRecipientLoader } = require('../../functions/schedule-delivery-audience.cjs');
const { createScheduleRecoveryPipeline, createFirestoreScheduleRecoveryScanner } = require('../../functions/schedule-recovery-pipeline.cjs');
const projectId = 'demo-allplays-mcp-review';
const proposalId = '00112233-4455-4677-8899-aabbccddeeff';
const secondId = '00112233-4455-4677-8899-aabbccddeeaa';
const eventId = `mcp_${proposalId}`;
const eventPath = `teams/team-1/games/${eventId}`;
const input = { proposalId, teamId: 'team-1', eventType: 'game', changes: { startDate: '2060-12-01T17:00Z', opponent: 'Synthetic Visitors' } };
const token = (uid = 'owner') => createMockUserToken({ sub: uid, email: `${uid}@example.test`, email_verified: true }, projectId);

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)('actual broker, form protocol, credentialed writer and durable evidence', () => {
    let env;
    beforeAll(async () => { env = await initializeTestEnvironment({ projectId, firestore: { rules: compactFirestoreRules(readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8')) } }); }, 30000);
    afterAll(async () => env?.cleanup());
    const userDb = (uid = 'owner') => env.authenticatedContext(uid, { email: `${uid}@example.test`, email_verified: true }).firestore();
    beforeEach(async () => {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'securityPolicies/verifiedEmail'), { mode: 'enforce', exemptUserIds: [] });
            await setDoc(doc(context.firestore(), 'teams/team-1'), { ownerId: 'owner', adminEmails: [], name: 'Synthetic Team' });
        });
    });
    async function fixture(database, mode = 'normal') {
        const serverDb = {
            collection: (path) => {
                const builder = (constraints = []) => ({
                    where: (field, op, value) => builder([...constraints, where(field, op, value)]),
                    orderBy: (field) => builder([...constraints, orderBy(field)]), limit: (count) => builder([...constraints, limit(count)]),
                    startAfter: (cursor) => builder([...constraints, startAfter(cursor)]),
                    get: () => getDocs(query(collection(database, path), ...constraints))
                }); return builder();
            },
            doc: (path) => ({ path, get: async () => { const row = await getDoc(doc(database, path)); return { exists: row.exists(), data: () => row.data() }; } }),
            runTransaction: (callback) => runTransaction(database, (tx) => callback({ get: async (ref) => { const row = await tx.get(doc(database, ref.path)); return { exists: row.exists(), data: () => row.data() }; }, set: (ref, data) => tx.set(doc(database, ref.path), data) }))
        };
        const store = createFirestoreNotificationJournalStore(serverDb);
        let pipeline; let pipelineFactory; let pipelineClockOffset = 0; let pipelineEffect; let earlyPipelineResult; let pipelineSends = 0; let eventBeforeVersion = null; let readinessUnavailable = false;
        const triggerHandles = new WeakMap();
        let commits = 0; let exchanges = 0; let pushes = 0; let acknowledge = true; let revoked = false;
        const localFetch = async (url, options) => {
            const host = process.env.FIRESTORE_EMULATOR_HOST;
            if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) || !url.startsWith('https://firestore.googleapis.com/v1/')) throw new Error('Only isolated emulator requests are allowed');
            const committing = url.endsWith(':commit') && JSON.parse(options.body).transaction;
            if (committing) { commits++; if (mode === 'wrong-user') options = { ...options, headers: { ...options.headers, Authorization: `Bearer ${token('other')}` } }; }
            if (committing && pipeline) {
                const fences = await getDocs(query(collection(database, 'teams/team-1/notificationSendLog'), where('kind', '==', 'schedule-proof-fence')));
                if (mode === 'pipeline-legacy-required') expect(fences.docs).toHaveLength(0);
                else expect(fences.docs.some((row) => row.data().producerState === 'dispatched')).toBe(true);
            }
            const response = await fetch(url.replace('https://firestore.googleapis.com', `http://${host}`), options);
            if (pipeline && url.endsWith(':batchGet') && JSON.parse(options.body).transaction && JSON.parse(options.body).documents[0].endsWith(`/documents/${eventPath}`)) {
                const rows = await response.clone().json(); eventBeforeVersion = rows[0].found?.updateTime || null;
            }
            if (committing && response.ok) {
                if (pipeline) {
                    const prefix = `projects/${projectId}/databases/(default)/documents/`;
                    const read = await fetch(`http://${host}/v1/${prefix.slice(0, -1)}:batchGet`, { method: 'POST', headers: options.headers, body: JSON.stringify({ documents: [prefix + eventPath] }) });
                    const row = (await read.json())[0].found;
                    if (mode === 'pipeline-readiness-changed') await setDoc(doc(database, 'teams/team-1'), { ownerId: 'owner', adminEmails: [' admin@example.test '], name: 'Synthetic Team' });
                    const handle = Object.freeze({}); triggerHandles.set(handle, { teamId: 'team-1', eventId, sourceVersion: row.updateTime, beforeVersion: eventBeforeVersion,
                        fields: canonicalEvidenceFields(row.fields), actorUid: 'owner', title: 'Schedule event added', body: 'Review the schedule in the app.' });
                    pipelineEffect = await pipeline.capture(handle);
                    earlyPipelineResult = await pipeline.process(pipelineEffect);
                    if (mode === 'pipeline-lost-response') throw new Error('Synthetic lost commit response after durable trigger capture');
                }
                if (mode === 'lost-response') throw new Error('Synthetic lost commit response');
                if (mode === 'forged-version') {
                    const body = await response.json(); body.writeResults[0].updateTime = '1970-01-01T00:00:01Z'; body.commitTime = '1970-01-01T00:00:01Z';
                    return new Response(JSON.stringify(body), { status: 200 });
                }
            }
            return response;
        };
        const oauth = createOAuthBroker(); const redirectUri = 'https://chatgpt.com/connector/oauth/synthetic-evidence';
        const clientId = oauth.registerClient({ redirect_uris: [redirectUri] }).client_id;
        const verifier = 'synthetic-verifier-more-than-forty-three-characters';
        const code = await oauth.approveAuthorization({ clientId, redirectUri, codeChallenge: s256Challenge(verifier), firebaseRefreshToken: 'synthetic-refresh-owner', scope: 'allplays.review', reviewApproved: true });
        const bearer = (await oauth.exchange({ grant_type: 'authorization_code', code, code_verifier: verifier })).access_token;
        // Actual resolver/broker code, synthetic refresh endpoint only. No real
        // Firebase accounts, refresh credentials or persistent grants created.
        const resolveIdentity = createIdentityResolver({ apiKey: 'synthetic-only', fetchImpl: async (url, options) => {
            expect(url).toBe('https://securetoken.googleapis.com/v1/token'); exchanges++;
            expect(new URLSearchParams(options.body).get('refresh_token')).toBe('synthetic-refresh-owner');
            return new Response(JSON.stringify(revoked ? {} : { id_token: token(), user_id: 'owner', expires_in: '3600' }), { status: revoked ? 401 : 200 });
        } });
        const authenticate = createDirectSessionAuthenticator({ oauth, resolveIdentity });
        const evidence = []; const authorities = [];
        const getContext = async (actor) => {
            const team = (await getDoc(doc(userDb(actor.uid), 'teams/team-1'))).data();
            return { uid: actor.uid, teams: new Map([['team-1', { team, roles: new Set(team?.ownerId === actor.uid ? ['owner'] : []) }]]) };
        };
        if (mode.startsWith('pipeline-')) {
            await setDoc(doc(database, 'users/owner'), {});
            await setDoc(doc(database, 'users/member'), { parentTeamIds: ['team-1'] });
            if (mode === 'pipeline-legacy-required') await setDoc(doc(database, 'teams/team-1'), { ownerId: 'owner', adminEmails: [' admin@example.test '], name: 'Synthetic Team' });
            const auth = { getUser: async (uid) => ({ uid, disabled: false, emailVerified: true, email: `${uid}@example.test` }), getUserByEmail: async () => { throw new Error('Synthetic fixture has no valid email admins'); } };
            const membership = createCanonicalScheduleMembership({ firestore: serverDb, auth });
            const audience = createScheduleDeliveryAudience({ ...membership, loadRecipient: createFirestoreScheduleRecipientLoader({ firestore: serverDb, auth, resolveCanonicalRoles: membership.resolveCanonicalRoles }) });
            const assess = createCanonicalScheduleReadiness({ readTeam: async (teamId) => (await serverDb.doc(`teams/${teamId}`).get()).data(), resolveAudience: audience.resolve });
            const providers = createScheduleDeliveryProviders({ firestore: serverDb });
            pipelineFactory = () => createScheduleRecoveryPipeline({ store, now: () => Date.now() + pipelineClockOffset,
                authority: { verifyConsumedApproval: (ref) => authorities[0].verifyConsumedApproval(ref), verifyCommit: (ref) => authorities[0].verifyCommit(ref) },
                verifyPlatformTrigger: async (handle) => { if (!triggerHandles.has(handle)) throw new Error('Untrusted trigger'); return triggerHandles.get(handle); },
                assessAudience: async (args) => { if (readinessUnavailable) throw new Error('Synthetic temporary audience read failure'); return assess(args); },
                // Synthetic legacy adapter only; production legacy trigger is unchanged.
                prepareLegacyPlan: async () => [{ recipientUid: 'member', channel: 'inbox', endpoint: 'member' }],
                authorizeDelivery: async ({ request }) => ({ actorAllowed: (await getContext({ uid: request.actorUid })).teams.get('team-1').roles.has('owner'), sourceCurrent: true,
                    recipientAllowed: (await getDoc(doc(database, `users/${request.recipientUid}`))).data()?.parentTeamIds?.includes(request.teamId) === true }),
                providers: { ...providers, send: async (...args) => { pipelineSends++; return providers.send(...args); } },
                readVerifiedDeploymentGate: async () => ({ mode: 'journal', legacyHead: 'a'.repeat(40), journalHead: 'b'.repeat(40), legacyCompatible: true, bothConsumersGated: true, compatibleProducersVerified: true }),
                scanWork: createFirestoreScheduleRecoveryScanner(serverDb)
            });
            pipeline = pipelineFactory();
        }
        const service = createDirectSessionRouter({ authenticate,
            createDependencies: (actor, current) => {
                const options = { projectId, uid: actor.uid, getIdToken: async () => (await current()).idToken, fetchImpl: localFetch };
                return { uid: actor.uid, store: createDirectFavoriteStore(options), scheduleStore: createDirectScheduleStore(options), getContext: async () => getContext(await current()) };
            },
            createExecutionEvidence: ({ getActor, sessionId }) => {
                const bridge = createBrokerScheduleEvidenceBridge({ projectId, getActor, sessionId,
                    readEvent: createCredentialedEvidenceReader({ projectId, getActor, fetchImpl: localFetch }),
                    createAuthority: (interfaces) => { const authority = createScheduleEvidenceAuthority({ store, ...interfaces }); authorities.push(authority); return authority; },
                    authorizeCommand: async (actor) => (await getContext(actor)).teams.get('team-1').roles.has('owner'),
                    onEvidence: (reference) => evidence.push(reference),
                    ...(pipeline ? { producer: mode === 'pipeline-cancel-before-dispatch' ? { ...pipeline.producer, beginWrite: async () => { throw new Error('Synthetic cancellation before dispatch'); } } : pipeline.producer } : {})
                });
                if (mode !== 'unapproved-opponent') return bridge;
                return { ...bridge, beforeCommit: (attempt) => {
                    const plan = structuredClone(attempt.plan);
                    plan.writes.find((write) => write.update?.name.endsWith(`/documents/${eventPath}`)).update.fields.opponent = { stringValue: 'Unapproved Visitors' };
                    return bridge.beforeCommit({ ...attempt, plan });
                } };
            }
        });
        const app = express(); app.use('/direct', service.router); const http = createServer(app);
        await new Promise((resolve) => http.listen(0, '127.0.0.1', resolve));
        const client = new Client({ name: 'synthetic-evidence-client', version: '1' }, { capabilities: { elicitation: { form: {} } } }); client.onerror = () => {};
        client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'accept', content: { approve: true, notifyTeam: acknowledge } }));
        const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${http.address().port}/direct`), { requestInit: { headers: { Authorization: `Bearer ${bearer}` } } });
        await client.connect(transport);
        const create = async () => { await client.callTool({ name: 'prepare_create_schedule_event', arguments: input }); return client.callTool({ name: 'confirm_schedule_event', arguments: { proposalId } }); };
        const coordinator = () => createScheduleDeliveryCoordinator({ store, authenticate, verifyApproval: authorities[0].verifyApproval, verifyCommit: authorities[0].verifyCommit,
            readEvent: createCredentialedEvidenceReader({ projectId, getActor: () => authenticate(`Bearer ${bearer}`), fetchImpl: localFetch }),
            authorize: async ({ actor }) => ({ actorAllowed: (await getContext(actor)).teams.get('team-1').roles.has('owner'), recipientAllowed: true }),
            resolveRecipients: async () => [{ recipientUid: 'member', channel: 'inbox', endpoint: 'member' }, { recipientUid: 'member', channel: 'push', endpoint: 'synthetic-device' }],
            providers: createScheduleDeliveryProviders({ firestore: serverDb, messaging: { send: async () => { pushes++; throw new Error('Isolated unknown push outcome'); } } }) });
        return { create, client, bearer, evidence, authorities, store, pipeline, pipelineFactory, pipelineEffect: () => pipelineEffect, earlyPipelineResult: () => earlyPipelineResult, pipelineSends: () => pipelineSends, expirePipeline: () => { pipelineClockOffset += 180000; }, setReadinessUnavailable: (value) => { readinessUnavailable = value; }, authenticate, coordinator, commits: () => commits, exchanges: () => exchanges, pushes: () => pushes,
            setAcknowledge: (value) => { acknowledge = value; }, revoke: () => { revoked = true; }, localFetch,
            close: async () => { await client.close().catch(() => {}); await service.close(); http.closeAllConnections(); await new Promise((resolve) => http.close(resolve)); } };
    }
    it('pages the private recovery collection without dropping the lookahead row or crossing teams', async () => {
        await env.withSecurityRulesDisabled(async (context) => {
            const database = context.firestore();
            const backend = { doc: (path) => doc(database, path), collection: (path) => {
                const builder = (constraints = []) => ({ orderBy: (field) => builder([...constraints, orderBy(field)]),
                    limit: (count) => builder([...constraints, limit(count)]), startAfter: (ref) => builder([...constraints, startAfter(ref)]),
                    get: () => getDocs(query(collection(database, path), ...constraints)) });
                return builder();
            } };
            await Promise.all(Array.from({ length: 43 }, (_, index) => setDoc(doc(database, `teams/team-1/notificationSendLog/scan_${String(index).padStart(3, '0')}`), { index })));
            await setDoc(doc(database, 'teams/other/notificationSendLog/scan_000'), { index: 'other' });
            const scan = createFirestoreScheduleRecoveryScanner(backend); const rows = []; let cursor = null; const sizes = [];
            do { const page = await scan({ teamId: 'team-1', cursor }); rows.push(...page.rows); sizes.push(page.rows.length); cursor = page.nextCursor; } while (cursor);
            expect(sizes).toEqual([20, 20, 3]); expect(rows.map((row) => row.index)).toEqual(Array.from({ length: 43 }, (_, index) => index));
            for (const invalid of [{ teamId: 123 }, { teamId: 'team-1', cursor: ['scan_000'] }, { teamId: '../other' }]) await expect(scan(invalid)).rejects.toThrow();
        });
    });
    it.each(['pipeline-normal', 'pipeline-lost-response', 'pipeline-legacy-required', 'pipeline-readiness-changed'])('composes the actual approved writer, durable trigger and restarted recovery: %s', async (mode) => {
        await env.withSecurityRulesDisabled(async (context) => {
            const f = await fixture(context.firestore(), mode);
            try {
                const created = await f.create(); expect(created.structuredContent?.status, JSON.stringify(created.content)).toBe('completed'); expect(f.commits()).toBe(1);
                if (mode === 'pipeline-legacy-required') expect(f.earlyPipelineResult().owner).toBe('legacy');
                else expect(f.earlyPipelineResult().state).toBe('waiting');
                if (mode === 'pipeline-lost-response') f.expirePipeline();
                const result = await f.pipelineFactory().process(f.pipelineEffect()); expect(result.state).toBe('completed');
                const expectedOwner = mode === 'pipeline-normal' ? 'journal' : 'legacy';
                const owners = await getDocs(query(collection(context.firestore(), 'teams/team-1/notificationSendLog'), where('kind', '==', 'schedule-consumer-owner')));
                expect(owners.docs.map((row) => row.data().owner)).toEqual([expectedOwner]); expect(f.pipelineSends()).toBe(1);
                await f.pipelineFactory().recover({ teamId: 'team-1' }); expect(f.pipelineSends()).toBe(1);
                const jobs = await getDocs(query(collection(context.firestore(), 'teams/team-1/notificationSendLog'), where('kind', '==', 'schedule-recovery-job')));
                expect(jobs.docs).toHaveLength(1); expect(jobs.docs[0].data().payload.fields.opponent.stringValue).toBe('Synthetic Visitors');
                await assertFails(getDoc(doc(userDb(), jobs.docs[0].ref.path)));
            } finally { await f.close(); }
        });
    }, 20000);
    it('does not select ownership while audience discovery fails, then recovers its retained payload', async () => {
        await env.withSecurityRulesDisabled(async (context) => {
            const f = await fixture(context.firestore(), 'pipeline-normal');
            try {
                await f.create(); f.setReadinessUnavailable(true);
                await expect(f.pipelineFactory().process(f.pipelineEffect())).rejects.toThrow();
                const owners = await getDocs(query(collection(context.firestore(), 'teams/team-1/notificationSendLog'), where('kind', '==', 'schedule-consumer-owner')));
                expect(owners.docs).toHaveLength(0); expect(f.pipelineSends()).toBe(0);
                f.setReadinessUnavailable(false); await f.pipelineFactory().recover({ teamId: 'team-1' }); expect(f.pipelineSends()).toBe(1);
            } finally { await f.close(); }
        });
    });
    it('cancels the actual writer fence before dispatch without a business commit or notification', async () => {
        await env.withSecurityRulesDisabled(async (context) => {
            const f = await fixture(context.firestore(), 'pipeline-cancel-before-dispatch');
            try {
                expect((await f.create()).isError).toBe(true); expect(f.commits()).toBe(0); expect(f.pipelineSends()).toBe(0);
                const fences = await getDocs(query(collection(context.firestore(), 'teams/team-1/notificationSendLog'), where('kind', '==', 'schedule-proof-fence')));
                expect(fences.docs.map((row) => row.data().state)).toEqual(['cancelled']);
                expect((await getDoc(doc(userDb(), eventPath))).exists()).toBe(false);
            } finally { await f.close(); }
        });
    });
    it.each([
        ['exact owner', { ownerId: 'owner' }, true, true],
        ['padded owner', { ownerId: ' owner ' }, false, false],
        ['tabbed owner', { ownerId: '\towner\t' }, false, false],
        ['null owner', { ownerId: null, ownerEmail: 'owner@example.test' }, false, false],
        ['numeric owner', { ownerId: 0, ownerEmail: 'owner@example.test' }, false, false],
        ['blank owner', { ownerId: ' ', ownerEmail: 'owner@example.test' }, false, false],
        ['exact owner email', { ownerId: '', ownerEmail: 'OWNER@example.test' }, true, true],
        ['missing owner ID', { ownerEmail: 'OWNER@example.test' }, true, true],
        ['padded owner email', { ownerId: '', ownerEmail: ' owner@example.test ' }, false, false],
        ['tabbed owner email', { ownerId: '', ownerEmail: '\towner@example.test\t' }, false, false],
        ['null owner alias', { ownerId: '', ownerEmail: 'owner@example.test', ownerEmailLower: null }, false, false],
        ['exact admin', { ownerId: 'other', adminEmails: ['owner@example.test'] }, true, true],
        ['tabbed admin', { ownerId: 'other', adminEmails: ['\towner@example.test\t'] }, false, false],
        ['uppercase stored admin', { ownerId: 'other', adminEmails: ['OWNER@example.test'] }, false, false],
        ['single-space admin', { ownerId: 'other', adminEmails: [' owner@example.test '] }, false, true],
        ['leading-space admin', { ownerId: 'other', adminEmails: [' owner@example.test'] }, false, true],
        ['trailing-space admin', { ownerId: 'other', adminEmails: ['owner@example.test '] }, false, true],
        ['exact mixed-case Auth admin', { ownerId: 'other', adminEmails: ['Owner@example.test'] }, true, true, { email: 'Owner@example.test' }],
        ['lowercase grant mixed-case Auth admin', { ownerId: 'other', adminEmails: ['owner@example.test'] }, true, true, { email: 'Owner@example.test' }],
        ['leading-space exact mixed-case admin', { ownerId: 'other', adminEmails: [' Owner@example.test'] }, false, true, { email: 'Owner@example.test' }],
        ['trailing-space exact mixed-case admin', { ownerId: 'other', adminEmails: ['Owner@example.test '] }, false, true, { email: 'Owner@example.test' }],
        ['both-spaces exact mixed-case admin', { ownerId: 'other', adminEmails: [' Owner@example.test '] }, false, true, { email: 'Owner@example.test' }],
        ['global-admin-only actor', { ownerId: 'other' }, false, true, { user: { isAdmin: true } }],
        ['unverified owner actor', { ownerId: 'owner' }, false, true, { emailVerified: false }],
        ['phone-only owner actor', { ownerId: 'owner' }, false, true, { email: null, emailVerified: false }],
        ['owner without user profile', { ownerId: 'owner' }, false, true, { user: null }]
    ])('keeps canonical manager authority within actual rules: %s', async (_label, team, expectedManager, expectedRules, options = {}) => {
        const email = Object.hasOwn(options, 'email') ? options.email : 'owner@example.test';
        const emailVerified = options.emailVerified ?? true;
        const user = Object.hasOwn(options, 'user') ? options.user : { isAdmin: false };
        await env.withSecurityRulesDisabled(async (context) => {
            await setDoc(doc(context.firestore(), 'teams/team-1'), team);
            if (user) await setDoc(doc(context.firestore(), 'users/owner'), user);
            const backend = { doc: (path) => ({ get: async () => { const snap = await getDoc(doc(context.firestore(), path)); return { exists: snap.exists(), data: () => snap.data() }; } }), collection: () => ({}) };
            const canonical = createCanonicalScheduleMembership({ firestore: backend, auth: { getUser: async (uid) => ({ uid, email, emailVerified, disabled: false }), getUserByEmail: async () => { throw new Error('Not used by manager authorization'); } } });
            expect(await canonical.authorizeActor({ uid: 'owner' }, 'team-1')).toBe(expectedManager);
        });
        const rulesDb = env.authenticatedContext('owner', { ...(email === null ? {} : { email }), email_verified: emailVerified }).firestore();
        const write = setDoc(doc(rulesDb, 'teams/team-1/practiceTemplates/authority-check'), { title: 'Synthetic authority check' });
        if (expectedRules) await assertSucceeds(write); else await assertFails(write);
        expect(expectedManager && !expectedRules).toBe(false);
    });
    it('resolves canonical audience records and rechecks revoked membership using the emulator', async () => {
        await env.withSecurityRulesDisabled(async (context) => {
            const database = context.firestore();
            for (const [path, data] of [
                ['users/owner', {}], ['users/member', { parentTeamIds: ['team-1'] }], ['users/fan', { favoriteTeams: ['team-1'], coachOf: ['team-1'] }],
                ['users/member/notificationDevices/device', { token: 'synthetic-canonical-device' }]
            ]) await setDoc(doc(database, path), data);
            const backend = { doc: (path) => ({ get: async () => { const snap = await getDoc(doc(database, path)); return { exists: snap.exists(), data: () => snap.data() }; } }),
                collection: (path) => {
                    const builder = (constraints = []) => ({ where: (field, op, value) => builder([...constraints, where(field, op, value)]),
                        limit: (count) => builder([...constraints, limit(count)]), get: () => getDocs(query(collection(database, path), ...constraints)) });
                    return builder();
                }
            };
            const auth = { getUser: async (uid) => ({ uid, disabled: false, emailVerified: true, email: `${uid}@example.test` }),
                getUserByEmail: async () => { throw new Error('No email administrators in this isolated fixture'); } };
            const canonical = createCanonicalScheduleMembership({ firestore: backend, auth });
            const audience = createScheduleDeliveryAudience({ ...canonical, loadRecipient: createFirestoreScheduleRecipientLoader({ firestore: backend, auth, resolveCanonicalRoles: canonical.resolveCanonicalRoles }) });
            expect(await audience.resolve({ teamId: 'team-1', actorUid: 'owner' })).toEqual([
                { recipientUid: 'member', channel: 'inbox', endpoint: 'member' },
                { recipientUid: 'member', channel: 'push', endpoint: 'synthetic-canonical-device' }
            ]);
            const check = { actor: { uid: 'owner' }, binding: { teamId: 'team-1' }, request: { teamId: 'team-1', actorUid: 'owner', recipientUid: 'member', channel: 'push', endpoint: 'synthetic-canonical-device' } };
            expect((await audience.authorize(check)).recipientAllowed).toBe(true);
            await setDoc(doc(database, 'users/member'), { parentTeamIds: [] });
            expect((await audience.authorize(check)).recipientAllowed).toBe(false);
            expect(await canonical.authorizeActor({ uid: 'fan' }, 'team-1')).toBe(false);
        });
    });
    it('binds real broker/form/write evidence and reconciles isolated partial delivery exactly once', async () => {
        await env.withSecurityRulesDisabled(async (context) => {
            const f = await fixture(context.firestore());
            try {
                expect((await f.authenticate(`Bearer ${f.bearer}`)).reviewRequests).toBe(true);
                const result = await f.create(); expect(result.structuredContent?.status, JSON.stringify(result.content)).toBe('completed'); expect(f.evidence).toHaveLength(1); expect(f.commits()).toBe(1); expect(f.exchanges()).toBeGreaterThan(4);
                const proof = await f.authorities[0].verifyCommit(f.evidence[0]); expect(proof.sessionId).toMatch(/^[a-f0-9-]{36}$/);
                const coordinator = f.coordinator(); const binding = await coordinator.bind(`Bearer ${f.bearer}`, { approvalHandle: f.evidence[0], commitHandle: f.evidence[0] });
                expect(await coordinator.deliver(`Bearer ${f.bearer}`, binding)).toMatchObject({ accepted: 1, uncertain: 1 });
                expect(await coordinator.status(`Bearer ${f.bearer}`, binding, { reconcile: true })).toMatchObject({ accepted: 1, uncertain: 1 });
                await coordinator.deliver(`Bearer ${f.bearer}`, binding); expect(f.pushes()).toBe(1);
                await f.client.callTool({ name: 'confirm_schedule_event', arguments: { proposalId } }); expect(f.commits()).toBe(1); expect(f.evidence).toHaveLength(1);
                const receipt = (await getDoc(doc(userDb(), `users/owner/privateAiPendingActions/direct_${proposalId}`))).data();
                expect(JSON.stringify(receipt)).not.toMatch(/grantKey|sessionId|dispatchId|formEvidence/);
                await assertFails(getDoc(doc(userDb(), `teams/team-1/notificationSendLog/durable_${f.evidence[0].evidenceId}`)));
                f.revoke(); await expect(coordinator.status(`Bearer ${f.bearer}`, binding)).rejects.toThrow();
            } finally { await f.close(); }
        });
    }, 20000);
    it('rejects a trusted-composer write mismatch before any business commit or private delivery proof', async () => {
        await env.withSecurityRulesDisabled(async (context) => {
            const f = await fixture(context.firestore(), 'unapproved-opponent');
            try {
                expect((await f.create()).isError).toBe(true);
                expect(f.commits()).toBe(0); expect(f.evidence).toHaveLength(0);
                expect((await getDoc(doc(userDb(), eventPath))).exists()).toBe(false);
            } finally { await f.close(); }
        });
    });
    it('refuses missing notification acknowledgment and model-supplied evidence fields', async () => {
        await env.withSecurityRulesDisabled(async (context) => {
            const f = await fixture(context.firestore());
            try {
                f.setAcknowledge(false); expect((await f.create()).structuredContent?.applied).toBe(false);
                expect(f.evidence).toHaveLength(0); expect(f.commits()).toBe(0); expect((await getDoc(doc(userDb(), eventPath))).exists()).toBe(false);
                const injected = await f.client.callTool({ name: 'confirm_schedule_event', arguments: { proposalId, formEvidence: {}, confirmed: true } }); expect(injected.isError).toBe(true);
            } finally { await f.close(); }
        });
    });
    it.each(['wrong-user', 'lost-response', 'forged-version'])('never promotes a client receipt to send authority after %s', async (mode) => {
        await env.withSecurityRulesDisabled(async (context) => {
            const f = await fixture(context.firestore(), mode);
            try {
                await f.create(); expect(f.evidence).toHaveLength(0); expect(f.commits()).toBe(1);
                const exists = (await getDoc(doc(context.firestore(), eventPath))).exists(); expect(exists).toBe(mode !== 'wrong-user');
                if (exists) { expect((await f.client.callTool({ name: 'confirm_schedule_event', arguments: { proposalId } })).structuredContent?.status).toBe('completed'); expect(f.commits()).toBe(1); }
                const receipt = (await getDoc(doc(context.firestore(), `users/owner/privateAiPendingActions/direct_${proposalId}`))).data();
                await expect(f.authorities[0].verifyCommit(receipt)).rejects.toThrow(); expect(f.pushes()).toBe(0);
            } finally { await f.close(); }
        });
    }, 20000);
    it('attests masked updates while preserving exact unrelated wire timestamps and references', async () => {
        await env.withSecurityRulesDisabled(async (context) => {
            const f = await fixture(context.firestore());
            try {
                await f.create();
                const prefix = `projects/${projectId}/databases/(default)/documents/`;
                await f.localFetch(`https://firestore.googleapis.com/v1/${prefix.slice(0, -1)}:commit`, { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ writes: [{
                    update: { name: `${prefix}${eventPath}`, fields: { customTime: { timestampValue: '2060-01-01T10:00:00.123456789Z' }, customReference: { referenceValue: `${prefix}teams/team-1` } } }, updateMask: { fieldPaths: ['customTime', 'customReference'] }
                }] }) });
                const priorTimestamp = (await getDoc(doc(context.firestore(), eventPath))).data().customTime;
                expect(priorTimestamp.nanoseconds).toBeGreaterThan(123000000);
                await f.client.callTool({ name: 'prepare_update_schedule_event', arguments: { proposalId: secondId, teamId: 'team-1', eventId, eventType: 'game', changes: { location: 'Synthetic changed field' } } });
                expect((await f.client.callTool({ name: 'confirm_schedule_event', arguments: { proposalId: secondId } })).structuredContent?.status).toBe('completed');
                expect(f.evidence).toHaveLength(2); const proof = await f.authorities[0].verifyCommit(f.evidence[1]); expect(proof.mode).toBe('update');
                const stored = (await getDoc(doc(context.firestore(), eventPath))).data(); expect(stored.customTime.isEqual(priorTimestamp)).toBe(true); expect(stored.customReference.path).toBe('teams/team-1');
            } finally { await f.close(); }
        });
    }, 20000);
});
