'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWebSignInPilot, PILOT_RELEASE_APPROVED, safeNext } = require('../web-sign-in-pilot.cjs');
const { buildAuthEmailMessage, AUTH_EMAIL_TYPES } = require('../auth-email-core.cjs');
function fixture(options = {}) {
  let time = 1700000000000;
  const documents = new Map();
  const deliveries = [];
  let generated = 0;
  const user = { uid: 'original-uid', email: 'paul@allplays.ai', emailVerified: true, providerData: [{ providerId: 'password' }] };
  const firestore = {
    collection: (collection) => ({ doc: (id) => ({
      id: `${collection}/${id}`, get: async () => ({ data: () => documents.get(`${collection}/${id}`) }),
      create: async (data) => { documents.set(`${collection}/${id}`, data); }
    }) }),
    runTransaction: async (fn) => fn({ get: (ref) => ref.get(), set: (ref, data) => documents.set(ref.id, data) })
  };
  const pilot = createWebSignInPilot({ auth: {
    getUser: async () => user,
    generateSignInWithEmailLink: async () => `https://example.test/?mode=signIn&oobCode=code${++generated}&apiKey=public`
  }, firestore, queueDelivery: async (data) => deliveries.push(data),
  HttpsError: Error, logger: { warn() {} }, enabled: true, pilotUid: user.uid, now: () => time, ...options });
  return { ...pilot, documents, deliveries, user, advance: (ms) => { time += ms; } };
}
test('production release gate is closed; disabled handler does no auth or delivery work', async () => {
  assert.equal(PILOT_RELEASE_APPROVED, false);
  const f = fixture({ enabled: false, auth: null, firestore: null });
  assert.deepEqual(await f.request({ email: 'paul@allplays.ai' }), { queued: true });
  await assert.rejects(f.preflight({ email: 'paul@allplays.ai', code: 'code1' }));
});
test('all ineligible states fail closed with identical request results', async () => {
  for (const change of [{ uid: 'replacement' }, { email: 'someone@else.test' }, { disabled: true }, { emailVerified: false }, { providerData: [] }, { multiFactor: { enrolledFactors: [{}] } }]) {
    const f = fixture(); Object.assign(f.user, change);
    assert.deepEqual(await f.request({ email: 'paul@allplays.ai' }), { queued: true });
    assert.equal(f.deliveries.length, 0);
  }
  const f = fixture({ pilotUid: '' }); await f.request({ email: 'paul@allplays.ai' });
  assert.equal(f.deliveries.length, 0);
});
test('other recipients and malformed inputs never cause account lookup', async () => {
  const f = fixture({ auth: null });
  for (const email of ['', null, 'x@example.test', 'paul@allplays.ai.evil']) {
    assert.deepEqual(await f.request({ email }), { queued: true });
  }
  assert.equal(f.deliveries.length, 0);
});
test('canonical completion has no invitation context and binds hashed code to original UID', async () => {
  const f = fixture();
  await f.request({ email: ' PAUL@Allplays.ai ', next: '/profile' });
  assert.equal(f.deliveries.length, 1);
  const mail = f.deliveries[0];
  assert.equal(mail.uid, 'original-uid');
  assert.match(mail.actionUrl, /#\/email-sign-in\?/);
  assert.doesNotMatch(mail.actionUrl, /accept-invite|email=/);
  assert.deepEqual(await f.preflight({ email: 'paul@allplays.ai', code: 'code1' }), { uid: 'original-uid', next: '/profile' });
  assert.ok([...f.documents.keys()].some((key) => /^authEmailPilotLinks\/[a-f0-9]{64}$/.test(key)));
});
test('minute cooldown and five-per-day cap survive requests and roll over', async () => {
  const f = fixture();
  for (let i = 0; i < 8; i++) {
    await f.request({ email: 'paul@allplays.ai' });
    await f.request({ email: 'paul@allplays.ai' });
    f.advance(60001);
  }
  assert.equal(f.deliveries.length, 5);
  f.advance(86400000); await f.request({ email: 'paul@allplays.ai' });
  assert.equal(f.deliveries.length, 6);
});
test('ambiguous delivery keeps reservation and generic response', async () => {
  let sends = 0;
  const f = fixture({ queueDelivery: async () => { sends++; throw Error('network'); } });
  assert.deepEqual(await f.request({ email: 'paul@allplays.ai' }), { queued: true });
  await f.request({ email: 'paul@allplays.ai' });
  assert.equal(sends, 1);
});
test('completion rejects unknown/expired code, wrong email/account and changed identity', async () => {
  const f = fixture(); await f.request({ email: 'paul@allplays.ai' });
  await assert.rejects(f.preflight({ email: 'other@example.test', code: 'code1' }));
  await assert.rejects(f.preflight({ email: 'paul@allplays.ai', code: 'unknown' }));
  await assert.rejects(f.preflight({ email: 'paul@allplays.ai', code: 'code1' }, { auth: { uid: 'another-uid' } }));
  for (const change of [{ uid: 'replacement' }, { emailVerified: false }, { disabled: true }, { providerData: [] }]) {
    const original = { ...f.user }; Object.assign(f.user, change);
    await assert.rejects(f.preflight({ email: 'paul@allplays.ai', code: 'code1' }));
    Object.assign(f.user, original);
  }
  f.advance(900000); await assert.rejects(f.preflight({ email: 'paul@allplays.ai', code: 'code1' }));
});
test('return destinations are exact non-action route allowlist', () => {
  for (const route of ['//evil.test', '/accept-invite', '/auth', '/home?code=BAD', '/\\evil.test', 'https://evil.test', '/profile#x', '/%2f%2fevil']) assert.equal(safeNext(route), '/home');
  assert.equal(safeNext('/profile'), '/profile');
});
test('new sign-in copy has no invitation language; invitation copy is preserved', () => {
  const message = buildAuthEmailMessage({ type: AUTH_EMAIL_TYPES.WEB_SIGN_IN, actionUrl: 'https://allplays.ai/app/#/email-sign-in' });
  assert.match(message.text, /15 minutes/); assert.doesNotMatch(message.text, /invitation/i);
  assert.match(buildAuthEmailMessage({ type: AUTH_EMAIL_TYPES.SIGN_IN, actionUrl: 'https://allplays.ai/app/#/accept-invite' }).text, /invitation/i);
});
