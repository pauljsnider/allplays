'use strict';
require('./resource-packets-network-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { ROOT } = require('../resource-packets-core.cjs');
const { createResourcePacketDelivery } = require('../resource-packets-delivery.cjs');
const { cleanupResourcePacketAccount } = require('../resource-packets-deletion.cjs');
const projectId = 'demo-allplays-resource';
if (process.env.GCLOUD_PROJECT !== projectId || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8280' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9299') throw new Error('Real isolated emulator stack required; tests must not skip');
admin.initializeApp({ projectId, credential: { getAccessToken: async () => ({ access_token: 'local-emulator-only', expires_in: 3600 }) } });
const db = new (require('firebase-admin/firestore').Firestore)({ projectId });
const tokens = {};
let sequence = 0;
async function call(uid, data, method = 'command') {
  const response = await fetch(`http://127.0.0.1:5201/${projectId}/us-central1/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(tokens[uid] ? { Authorization: `Bearer ${tokens[uid]}` } : {}) },
    body: JSON.stringify({ data })
  });
  const body = await response.json();
  if (body.error) throw Object.assign(new Error(body.error.message), { code: body.error.status });
  assert.equal(response.status, 200);
  return body.result;
}
const command = (uid, data) => call(uid, { teamId: 'team-a', requestId: `request-${++sequence}`, ...data });
const denied = (promise, code = 'PERMISSION_DENIED') => assert.rejects(promise, (error) => error.code === code);
test('real Auth, callable and Firestore isolation with separate households', async (t) => {
  for (const uid of ['staff', 'parent-a', 'co-guardian', 'parent-b', 'outsider', 'admin', 'player']) {
    const email = `${uid}@example.invalid`; const password = 'OnlyLocalFixture-123!';
    await admin.auth().createUser({ uid, email, password, emailVerified: true });
    await db.doc(`users/${uid}`).set({ active: true, isAdmin: uid === 'admin', parentPlayerKeys: ['parent-a', 'co-guardian'].includes(uid) ? ['team-a::child-a', 'team-a::sibling'] : uid === 'parent-b' ? ['team-a::child-b'] : [] });
    const response = await fetch('http://127.0.0.1:9299/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-only', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
    const result = await response.json(); assert.ok(result.idToken); tokens[uid] = result.idToken;
  }
  await db.doc('teams/team-a').set({ ownerId: 'staff', active: true });
  await db.doc('teams/team-b').set({ ownerId: 'outsider', active: true });
  for (const player of ['child-a', 'sibling', 'child-b']) await db.doc(`teams/team-a/players/${player}`).set({ name: player, active: true });
  await db.doc('teams/team-a/players/child-a').update({ userId: 'player' });
  const resource = { action: 'saveResource', resourceId: 'resource-1', expectedRevision: 0, title: 'Footwork', teachingPoint: 'Keep your balance', url: 'https://www.youtube.com/watch?v=example' };
  await t.test('linked-player discovery finds self-only accounts and isolates other households', async () => {
    const own = await call('player', { view: 'linkedPlayers' }, 'query');
    assert.deepEqual(own.players.map(row => row.playerId), ['child-a']);
    const parent = await call('parent-a', { view: 'linkedPlayers' }, 'query');
    assert.deepEqual(parent.players.map(row => row.playerId).sort(), ['child-a', 'sibling']);
    assert.deepEqual((await call('outsider', { view: 'linkedPlayers' }, 'query')).players, []);
    // The canonical userId wins over a stale alias that points at another account.
    await db.doc('teams/team-a/players/child-a').update({ authUid: 'outsider' });
    assert.deepEqual((await call('outsider', { view: 'linkedPlayers' }, 'query')).players, []);
    await db.doc('teams/team-b').update({ active: false });
  });
  await t.test('staff authors, unrelated and family cannot author', async () => {
    await denied(command('parent-a', resource)); await denied(command('outsider', resource));
    await denied(command('missing', resource), 'UNAUTHENTICATED');
    const saved = await command('staff', resource); assert.equal(saved.version, 1);
  });
  await t.test('unsafe links rejected and resource revisions enforced', async () => {
    for (const url of ['javascript:alert(1)', 'http://example.com', 'https://localhost/x', 'https://127.0.0.1', 'https://user:pass@example.com', 'https://example.com:444']) await denied(command('staff', { ...resource, expectedRevision: 1, url }), 'INVALID_ARGUMENT');
    await denied(command('staff', resource), 'ABORTED');
  });
  await command('staff', { action: 'saveDraft', assignmentId: 'packet-1', expectedRevision: 0, title: 'Practice at home', resourceIds: ['resource-1'], playerIds: ['child-a', 'sibling'] });
  await t.test('drafts invisible, explicit publish, durable duplicate protection', async () => {
    assert.deepEqual((await call('parent-a', { teamId: 'team-a', view: 'family', playerId: 'child-a' }, 'query')).tasks, []);
    await denied(command('staff', { action: 'publish', assignmentId: 'packet-1', expectedRevision: 1, notify: true }), 'FAILED_PRECONDITION');
    const publication = { action: 'publish', assignmentId: 'packet-1', expectedRevision: 1, notify: true, confirm: true, requestId: 'publish-once' };
    assert.deepEqual(await command('staff', publication), await command('staff', publication));
    assert.equal((await db.collection(`${ROOT}/team-a/outbox`).get()).size, 1);
    await denied(command('staff', { ...publication, notify: false }), 'ALREADY_EXISTS');
  });
  await t.test('family isolation, sibling attribution, deliberate open and distinct reports', async () => {
    for (const uid of ['parent-b', 'outsider']) await denied(call(uid, { teamId: 'team-a', view: 'family', playerId: 'child-a' }, 'query'));
    await denied(call('parent-a', { teamId: 'team-b', view: 'family', playerId: 'child-a' }, 'query'));
    const query = { teamId: 'team-a', view: 'family', playerId: 'child-a' };
    assert.equal((await call('parent-a', query, 'query')).tasks.length, 1);
    assert.equal((await db.collection(`${ROOT}/team-a/evidence`).get()).size, 0);
    const report = { action: 'report', assignmentId: 'packet-1', version: 1, playerId: 'child-a', resourceId: 'resource-1', kind: 'opened', requestId: 'open-once' };
    assert.equal((await command('parent-a', report)).url, resource.url);
    await command('parent-a', report);
    await command('co-guardian', { ...report, kind: 'practiced', value: true, requestId: 'practice-once' });
    const task = (await call('parent-a', query, 'query')).tasks[0];
    assert.equal(task.signals['resource-1'].opened.actorUid, 'parent-a');
    assert.equal(task.signals['resource-1'].practiced.actorUid, 'co-guardian');
    assert.equal(task.signals['resource-1'].watched, undefined);
    assert.deepEqual((await call('parent-a', { ...query, playerId: 'sibling' }, 'query')).tasks[0].signals, {});
    assert.equal((await db.collection(`${ROOT}/team-a/evidence`).get()).size, 2);
  });
  await t.test('isolated notification sink selects households and cannot duplicate dispatch', async () => {
    const deliveries = [];
    const deliver = createResourcePacketDelivery({ db, auth: admin.auth(), enabled: () => true,
      resolveTargets: async (_team, uids) => uids.filter((uid) => uid !== 'co-guardian').map((uid) => ({ uid })),
      dispatch: async ({ deliveryId, targets, beforeEffects }) => { const grant = await beforeEffects(); if (!grant) return null; targets = targets.filter((target) => grant.allowedUserIds.includes(target.uid)); deliveries.push({ deliveryId, uids: targets.map((target) => target.uid) }); return { failureCount: 0 }; }
    });
    const outbox = (await db.collection(`${ROOT}/team-a/outbox`).get()).docs[0];
    await Promise.all([deliver('team-a', outbox.id), deliver('team-a', outbox.id)]);
    assert.equal(deliveries.length, 1); assert.deepEqual(deliveries[0].uids, ['parent-a']);
    assert.equal((await outbox.ref.get()).data().state, 'sent');
    await outbox.ref.set({ ...outbox.data(), state: 'pending' });
    const ambiguous = createResourcePacketDelivery({ db, auth: admin.auth(), enabled: () => true,
      resolveTargets: async (_team, uids) => uids.map((uid) => ({ uid })),
      dispatch: async () => { deliveries.push('ambiguous'); throw new Error('Synthetic provider timeout'); }
    });
    assert.equal((await ambiguous('team-a', outbox.id)).state, 'uncertain');
    await ambiguous('team-a', outbox.id); assert.equal(deliveries.length, 2);
    await outbox.ref.set({ ...outbox.data(), state: 'pending' });
    const revoked = createResourcePacketDelivery({ db, auth: admin.auth(), enabled: () => true,
      resolveTargets: async () => [{ uid: 'parent-a' }],
      dispatch: async ({ beforeEffects }) => {
        await db.doc('users/parent-a').update({ parentPlayerKeys: ['team-a::child-b'] });
        assert.equal(await beforeEffects(), false);
        return null;
      }
    });
    assert.equal((await revoked('team-a', outbox.id)).state, 'suppressed');
    await db.doc('users/parent-a').update({ parentPlayerKeys: ['team-a::child-a', 'team-a::sibling'] });
    await outbox.ref.set({ ...outbox.data(), state: 'pending' });
    let gate = false;
    const paused = createResourcePacketDelivery({ db, auth: admin.auth(), enabled: () => gate, resolveTargets: async () => [], dispatch: async () => { assert.fail('Disabled or empty recipients must not send'); } });
    assert.equal((await paused('team-a', outbox.id)).state, 'disabled');
    assert.equal((await outbox.ref.get()).data().state, 'pending');
    gate = true;
    await command('staff', { action: 'retryNotification', deliveryId: outbox.id, confirm: true });
    assert.equal((await paused('team-a', outbox.id)).state, 'suppressed');
    await outbox.ref.set({ ...outbox.data(), state: 'dispatching', attemptedAt: '2020-01-01T00:00:00.000Z' });
    assert.deepEqual(await command('staff', { action: 'retryNotification', deliveryId: outbox.id, confirm: true }), { notification: 'uncertain', resent: false });
  });
  await t.test('rules engine denies direct private records to every client role', async () => {
    const evidence = (await db.collection(`${ROOT}/team-a/evidence`).get()).docs[0];
    for (const uid of ['staff', 'parent-a', 'parent-b', 'outsider', 'admin', 'missing']) {
      const headers = tokens[uid] ? { Authorization: `Bearer ${tokens[uid]}` } : {};
      const response = await fetch(`http://127.0.0.1:8280/v1/projects/${projectId}/databases/(default)/documents/${evidence.ref.path}`, { headers });
      assert.equal(response.status, 403, `direct evidence read denied: ${uid}`);
      const write = await fetch(`http://127.0.0.1:8280/v1/projects/${projectId}/databases/(default)/documents/${evidence.ref.path}`, { method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ fields: { forged: { booleanValue: true } } }) });
      assert.equal(write.status, 403, `direct evidence write denied: ${uid}`);
      for (const collectionId of ['evidence', 'tasks', 'operations', 'assignments', 'resources', 'outbox', 'versions', 'records']) {
        const query = await fetch(`http://127.0.0.1:8280/v1/projects/${projectId}/databases/(default)/documents:runQuery`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ structuredQuery: { from: [{ collectionId, allDescendants: true }] } }) });
        assert.equal(query.status, 403, `collection group denied: ${uid}/${collectionId}`);
      }
    }
  });
  await t.test('linked player has own access only and versions preserve prior evidence', async () => {
    assert.equal((await call('player', { teamId: 'team-a', view: 'family', playerId: 'child-a' }, 'query')).tasks.length, 1);
    await denied(call('player', { teamId: 'team-a', view: 'family', playerId: 'sibling' }, 'query'));
    await command('staff', { action: 'saveDraft', assignmentId: 'packet-2', expectedRevision: 0, title: 'Historical video', resourceIds: ['resource-1'], playerIds: ['child-a'] });
    await command('staff', { action: 'publish', assignmentId: 'packet-2', expectedRevision: 1, confirm: true, notify: false });
    await command('parent-a', { action: 'report', assignmentId: 'packet-2', version: 1, playerId: 'child-a', resourceId: 'resource-1', kind: 'opened' });
    await command('staff', { ...resource, expectedRevision: 1, title: 'Updated footwork', url: 'https://example.com/updated-footwork' });
    await command('staff', { action: 'saveDraft', assignmentId: 'packet-2', expectedRevision: 2, title: 'Historical video', notes: 'New coaching note', resourceIds: ['resource-1'], resourceVersions: [1], playerIds: ['child-a'] });
    await command('staff', { action: 'publish', assignmentId: 'packet-2', expectedRevision: 3, confirm: true, notify: false });
    const historical = (await call('parent-a', { teamId: 'team-a', view: 'family', playerId: 'child-a', assignmentId: 'packet-2' }, 'query')).tasks[0];
    assert.equal(historical.items[0].url, resource.url);
    assert.equal(historical.signals['resource-1'].opened.actorUid, 'parent-a');
    assert.equal((await db.doc(ROOT + '/team-a/resources/resource-1').get()).data().title, 'Updated footwork');
    await command('staff', { action: 'saveDraft', assignmentId: 'packet-1', expectedRevision: 2, title: 'Second practice', resourceIds: ['resource-1'], playerIds: ['child-a'] });
    await command('staff', { action: 'publish', assignmentId: 'packet-1', expectedRevision: 3, confirm: true, notify: false });
    await denied(command('player', { action: 'report', assignmentId: 'packet-1', version: 1, playerId: 'child-a', resourceId: 'resource-1', kind: 'opened' }), 'FAILED_PRECONDITION');
    const task = (await call('player', { teamId: 'team-a', view: 'family', playerId: 'child-a' }, 'query')).tasks[0];
    assert.equal(task.version, 2); assert.equal(task.items[0].resourceVersion, 2); assert.equal(task.items[0].url, 'https://example.com/updated-footwork'); assert.deepEqual(task.signals, {});
    assert.equal((await db.collection(`${ROOT}/team-a/evidence`).get()).size, 3);
    assert.deepEqual((await call('parent-a', { teamId: 'team-a', view: 'family', playerId: 'sibling' }, 'query')).tasks, []);
  });
  await t.test('exact assignment reads retain household authorization and replaced videos lose completion', async () => {
    const query = { teamId: 'team-a', view: 'family', playerId: 'child-a', assignmentId: 'packet-1' };
    assert.equal((await call('parent-a', query, 'query')).tasks.length, 1);
    await denied(call('parent-b', query, 'query'));
    assert.deepEqual((await call('parent-a', { ...query, assignmentId: 'unknown' }, 'query')).tasks, []);
    await command('staff', { ...resource, expectedRevision: 2, teachingPoint: '', url: 'https://example.com/replacement' });
    await command('staff', { action: 'saveDraft', assignmentId: 'packet-1', expectedRevision: 4, title: 'New video', resourceIds: ['resource-1'], playerIds: ['child-a'] });
    await command('staff', { action: 'publish', assignmentId: 'packet-1', expectedRevision: 5, confirm: true, notify: false });
    const task = (await call('parent-a', query, 'query')).tasks[0];
    assert.deepEqual(task.signals, {});
    assert.equal(task.items[0].teachingPoint, '');
    assert.equal((await db.collection(`${ROOT}/team-a/evidence`).get()).size, 3);
  });
  await t.test('revoked guardians and account deletion requests block reads and retry', async () => {
    await db.doc('users/parent-a').update({ parentPlayerKeys: [] });
    await denied(call('parent-a', { teamId: 'team-a', view: 'family', playerId: 'child-a' }, 'query'));
    await db.doc('accountDeletionRequests/co-guardian').set({ status: 'pending' });
    await denied(call('co-guardian', { teamId: 'team-a', view: 'family', playerId: 'child-a' }, 'query'));
  });
  await t.test('account deletion scrubs actor evidence and is safely repeatable', async () => {
    await cleanupResourcePacketAccount(db, 'parent-a');
    await cleanupResourcePacketAccount(db, 'parent-a');
    const evidence = (await db.collection(`${ROOT}/team-a/evidence`).get()).docs.map((doc) => doc.data());
    assert.equal(evidence.some((row) => row.actorUid === 'parent-a'), false);
    assert.equal(evidence.some((row) => row.actorUid === 'co-guardian'), true);
    assert.equal((await db.collection('resourcePacketActors/parent-a/records').get()).size, 0);
    await db.doc('users/parent-a').update({ parentPlayerKeys: ['team-a::child-a'] });
    await denied(call('parent-a', { teamId: 'team-a', view: 'family', playerId: 'child-a' }, 'query'));
  });
  await t.test('publication does not retain another editor attribution after account deletion', async () => {
    await command('admin', { action: 'saveDraft', assignmentId: 'different-editor', expectedRevision: 0, title: 'Shared staff draft', resourceIds: ['resource-1'], playerIds: ['child-a'] });
    await command('staff', { action: 'publish', assignmentId: 'different-editor', expectedRevision: 1, confirm: true, notify: false });
    await cleanupResourcePacketAccount(db, 'admin');
    const snapshot = (await db.doc(`${ROOT}/team-a/assignments/different-editor/versions/1`).get()).data();
    assert.equal(snapshot.publishedBy, 'staff');
    assert.equal(snapshot.updatedBy, undefined);
    assert.equal(JSON.stringify(snapshot).includes('admin'), false);
  });
  await t.test('staff history paginates instead of disabling the entire page', async () => {
    const batch = db.batch();
    for (let i = 0; i < 101; i++) batch.set(db.doc(`${ROOT}/team-a/resources/page-${String(i).padStart(3, '0')}`), { resourceId: `page-${i}`, version: 1, title: 'Synthetic paginated resource' });
    await batch.commit();
    const first = await call('staff', { teamId: 'team-a', view: 'staff' }, 'query');
    assert.equal(first.resources.length, 100); assert.ok(first.cursors.resources);
    const next = await call('staff', { teamId: 'team-a', view: 'staff', cursors: first.cursors }, 'query');
    assert.equal(next.resources.length, 2); assert.equal(next.cursors.resources, null); assert.equal(next.assignments.length, 0);
  });
});
