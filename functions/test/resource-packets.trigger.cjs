'use strict';
require('./resource-packets-network-guard.cjs');
const test = require('node:test');
const { accountBarrierId } = require('../resource-packets-core.cjs');
const assert = require('node:assert/strict');
const admin = require('firebase-admin');
const { Firestore } = require('firebase-admin/firestore');
const projectId = 'demo-allplays-resource';
if (process.env.GCLOUD_PROJECT !== projectId || process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8280' || process.env.FIREBASE_AUTH_EMULATOR_HOST !== '127.0.0.1:9299') throw new Error('Isolated trigger stack required');
admin.initializeApp({ projectId, credential: { getAccessToken: async () => ({ access_token: 'local-only', expires_in: 3600 }) } });
const db = new Firestore({ projectId });
async function eventually(check) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.fail('Emulator trigger did not reach expected state');
}
test('real outbox and Auth deletion triggers use isolated sinks', async () => {
  const tokens = {};
  for (const uid of ['trigger-staff', 'trigger-parent', 'trigger-disabled', 'trigger-other']) {
    const email = `${uid}@example.invalid`; const password = 'LocalTriggerFixture-123!';
    await admin.auth().createUser({ uid, email, password, emailVerified: true });
    await db.doc(`users/${uid}`).set({ active: true, parentTeamIds: ['trigger-team'], parentPlayerKeys: uid === 'trigger-parent' || uid === 'trigger-disabled' ? ['trigger-team::child'] : ['trigger-team::other-child'], notifications: { enabled: uid !== 'trigger-disabled' } });
    const response = await fetch('http://127.0.0.1:9299/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-only', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
    tokens[uid] = (await response.json()).idToken; assert.ok(tokens[uid]);
  }
  await db.doc('teams/trigger-team').set({ ownerId: 'trigger-staff', active: true });
  await db.doc('teams/trigger-team/players/child').set({ name: 'Synthetic child', active: true });
  let n = 0;
  async function command(uid, data) {
    const response = await fetch(`http://127.0.0.1:5201/${projectId}/us-central1/resourcePacketsCommand`, { method: 'POST', headers: { Authorization: `Bearer ${tokens[uid]}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { teamId: 'trigger-team', requestId: `trigger-${++n}`, ...data } }) });
    const result = await response.json(); assert.equal(response.status, 200, JSON.stringify(result)); return result.result;
  }
  await command('trigger-staff', { action: 'saveResource', resourceId: 'resource', expectedRevision: 0, title: 'Footwork', teachingPoint: 'Stay balanced', url: 'https://example.com/resource' });
  await command('trigger-staff', { action: 'saveDraft', assignmentId: 'packet', expectedRevision: 0, title: 'Practice', resourceIds: ['resource'], playerIds: ['child'] });
  await command('trigger-staff', { action: 'publish', assignmentId: 'packet', expectedRevision: 1, confirm: true, notify: true });
  const outbox = (await db.collection('resourcePacketTeams/trigger-team/outbox').get()).docs[0];
  await eventually(async () => (await outbox.ref.get()).data().state === 'sent');
  const sink = db.collection(`resourcePacketTestSink/${outbox.id}/recipients`);
  assert.deepEqual((await sink.get()).docs.map(doc => doc.id), ['trigger-parent']);
  await outbox.ref.update({ replayTest: true });
  await command('trigger-parent', { action: 'report', assignmentId: 'packet', version: 1, playerId: 'child', resourceId: 'resource', kind: 'practiced', value: true });
  assert.equal((await db.collection('resourcePacketTeams/trigger-team/evidence').get()).size, 1);
  await admin.auth().deleteUser('trigger-parent');
  await eventually(async () => (await db.doc(`resourcePacketAccountBarriers/${accountBarrierId('trigger-parent')}`).get()).exists && (await db.collection('resourcePacketTeams/trigger-team/evidence').get()).empty);
  assert.equal((await db.collection('resourcePacketActors/trigger-parent/records').get()).size, 0);
  assert.equal((await sink.get()).size, 1);
});
