'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createWebSignInPilot, safeNext } = require('../web-sign-in-pilot.cjs');
const { buildAuthEmailMessage, AUTH_EMAIL_TYPES } = require('../auth-email-core.cjs');
function fixture(options = {}) {
  let time = 1700000000000;
  const documents = new Map();
  const deliveries = [];
  let generated = 0;
  let transactionTail = Promise.resolve();
  const user = { uid: 'original-uid', email: 'member@example.test', emailVerified: true, providerData: [{ providerId: 'password' }] };
  const firestore = {
    collection: (collection) => ({ doc: (id) => ({
      id: `${collection}/${id}`, get: async () => ({ data: () => documents.get(`${collection}/${id}`) }),
      create: async (data) => { documents.set(`${collection}/${id}`, data); }
    }) }),
    runTransaction: (fn) => {
      // Serialize committed transactions, as Firestore does for contended documents.
      const result = transactionTail.then(async () => {
        const writes = new Map();
        const value = await fn({
          get: (ref) => { assert.equal(writes.size, 0, 'reads precede writes'); return ref.get(); },
          set: (ref, data) => writes.set(ref.id, data)
        });
        for (const [key, data] of writes) documents.set(key, data);
        return value;
      });
      transactionTail = result.catch(() => {});
      return result;
    }
  };
  const pilot = createWebSignInPilot({ auth: {
    getUser: async () => user,
    getUserByEmail: async () => user,
    generateSignInWithEmailLink: async () => `https://example.test/?mode=signIn&oobCode=code${++generated}&apiKey=public`
  }, firestore, queueDelivery: async (data) => deliveries.push(data),
  HttpsError: Error, logger: { warn() {} }, enabled: true, now: () => time, ...options });
  return { ...pilot, documents, deliveries, user, advance: (ms) => { time += ms; } };
}
test('disabled handler does no auth or delivery work', async () => {
  const f = fixture({ enabled: false, auth: null, firestore: null });
  assert.deepEqual(await f.request({ email: 'member@example.test' }), { queued: true });
  await assert.rejects(f.preflight({ email: 'member@example.test', code: 'code1' }));
});
test('all ineligible states fail closed with identical request results', async () => {
  for (const change of [{ uid: '' }, { email: 'someone@else.test' }, { disabled: true }, { emailVerified: false }, { providerData: [] }, { providerData: [{ providerId: 'google.com' }] },
    { providerData: [{ providerId: 'password' }, { providerId: 'google.com' }] },
    { providerData: [{ providerId: 'password' }, { providerId: 'apple.com' }] },
    { providerData: [{ providerId: 'apple.com' }] }, { multiFactor: { enrolledFactors: [{}] } }]) {
    const f = fixture(); Object.assign(f.user, change);
    assert.deepEqual(await f.request({ email: 'member@example.test' }), { queued: true });
    assert.equal(f.deliveries.length, 0);
  }
});
test('malformed inputs never cause account lookup', async () => {
  const f = fixture({ auth: null });
  for (const email of ['', null, {}, 42, 'not-email', 'a'.repeat(321) + '@example.test']) {
    assert.deepEqual(await f.request({ email }), { queued: true });
  }
  assert.equal(f.deliveries.length, 0);
});
test('canonical completion has no invitation context and binds hashed code to original UID', async () => {
  const f = fixture();
  await f.request({ email: ' MEMBER@Example.test ', next: '/profile' });
  assert.equal(f.deliveries.length, 1);
  const mail = f.deliveries[0];
  assert.equal(mail.uid, 'original-uid');
  assert.match(mail.actionUrl, /#\/email-sign-in\?/);
  assert.doesNotMatch(mail.actionUrl, /accept-invite|email=/);
  assert.deepEqual(await f.preflight({ email: 'member@example.test', code: 'code1' }), { uid: 'original-uid', next: '/profile' });
  assert.ok([...f.documents.keys()].some((key) => /^authEmailPilotLinks\/[a-f0-9]{64}$/.test(key)));
});
test('minute cooldown and five-per-day cap survive requests and roll over', async () => {
  const f = fixture();
  for (let i = 0; i < 8; i++) {
    await f.request({ email: 'member@example.test' });
    await f.request({ email: 'member@example.test' });
    f.advance(60001);
  }
  assert.equal(f.deliveries.length, 5);
  f.advance(86400000); await f.request({ email: 'member@example.test' });
  assert.equal(f.deliveries.length, 6);
});
test('ambiguous delivery keeps reservation and generic response', async () => {
  let sends = 0;
  const f = fixture({ queueDelivery: async () => { sends++; throw Error('network'); } });
  assert.deepEqual(await f.request({ email: 'member@example.test' }), { queued: true });
  await f.request({ email: 'member@example.test' });
  assert.equal(sends, 1);
});
test('completion rejects unknown/expired code, wrong email/account and changed identity', async () => {
  const f = fixture(); await f.request({ email: 'member@example.test' });
  await assert.rejects(f.preflight({ email: 'other@example.test', code: 'code1' }));
  await assert.rejects(f.preflight({ email: 'member@example.test', code: 'unknown' }));
  await assert.rejects(f.preflight({ email: 'member@example.test', code: 'code1' }, { auth: { uid: 'another-uid' } }));
  for (const change of [{ uid: 'replacement' }, { emailVerified: false }, { disabled: true }, { providerData: [] }]) {
    const original = { ...f.user }; Object.assign(f.user, change);
    await assert.rejects(f.preflight({ email: 'member@example.test', code: 'code1' }));
    Object.assign(f.user, original);
  }
  f.advance(900000); await assert.rejects(f.preflight({ email: 'member@example.test', code: 'code1' }));
});
test('return destinations are exact non-action route allowlist', () => {
  for (const route of ['//evil.test', '/accept-invite', '/auth', '/home?code=BAD', '/\\evil.test', 'https://evil.test', '/profile#x', '/%2f%2fevil']) assert.equal(safeNext(route), '/home');
  assert.equal(safeNext('/profile'), '/profile');
});
test('new sign-in copy has no invitation language; invitation copy is preserved', () => {
  const message = buildAuthEmailMessage({ type: AUTH_EMAIL_TYPES.WEB_SIGN_IN, actionUrl: 'https://allplays.ai/app/#/email-sign-in' });
  assert.match(message.text, /Complete sign-in in the app within 15 minutes/); assert.doesNotMatch(message.text, /link expires in 15 minutes/i); assert.doesNotMatch(message.text, /invitation/i);
  assert.match(buildAuthEmailMessage({ type: AUTH_EMAIL_TYPES.SIGN_IN, actionUrl: 'https://allplays.ai/app/#/accept-invite' }).text, /invitation/i);
});

test('unknown accounts return the generic response without generating a capability', async () => {
  let lookedUp = 0;
  const f = fixture({ auth: { getUserByEmail: async () => { lookedUp++; throw Error('not found'); } } });
  assert.deepEqual(await f.request({ email: 'unknown@example.test' }), { queued: true });
  assert.equal(lookedUp, 1);
  assert.equal(f.deliveries.length, 0);
});
test('global ceiling spans recipients and retains the deployed rate document', async () => {
  const f = fixture();
  for (let i = 0; i < 7; i++) {
    f.user.uid = `existing-${i}`;
    f.user.email = `member${i}@example.test`;
    await f.request({ email: f.user.email });
    f.advance(60001);
  }
  assert.equal(f.deliveries.length, 5);
  assert.equal(f.documents.get('authEmailRateLimits/web-sign-in-pilot').count, 5);
  const recipients = [...f.documents.keys()].filter(key => key.includes('web-sign-in-recipient-'));
  assert.equal(recipients.length, 5);
  assert.ok(recipients.every(key => /-[a-f0-9]{64}$/.test(key)));
});
test('recipient budget independently blocks after a global document reset', async () => {
  const f = fixture();
  await f.request({ email: f.user.email });
  f.documents.delete('authEmailRateLimits/web-sign-in-pilot');
  await f.request({ email: f.user.email });
  assert.equal(f.deliveries.length, 1);
  for (let i = 0; i < 6; i++) {
    f.advance(60001);
    f.documents.delete('authEmailRateLimits/web-sign-in-pilot');
    await f.request({ email: f.user.email });
  }
  assert.equal(f.deliveries.length, 5);
});
test('preflight fails closed on legacy records and email/provider drift', async () => {
  const f = fixture(); await f.request({ email: f.user.email });
  const key = [...f.documents.keys()].find(key => key.startsWith('authEmailPilotLinks/'));
  const record = f.documents.get(key);
  for (const change of [{ email: undefined }, { uid: 'replacement' }, { expiresAt: undefined }]) {
    f.documents.set(key, { ...record, ...change });
    await assert.rejects(f.preflight({ email: f.user.email, code: 'code1' }));
  }
  f.documents.set(key, record);
  f.user.email = 'renamed@example.test';
  await assert.rejects(f.preflight({ email: f.user.email, code: 'code1' }));
  await assert.rejects(f.preflight({ email: record.email, code: 'code1' }));
  f.user.email = record.email;
  f.user.providerData.push({ providerId: 'google.com' });
  await assert.rejects(f.preflight({ email: record.email, code: 'code1' }));
});

test('concurrent same-recipient and different-recipient requests reserve one global slot', async () => {
  for (const emails of [Array(12).fill('member@example.test'),
    Array.from({ length: 12 }, (_, i) => `member${i}@example.test`)]) {
    let generated = 0;
    const f = fixture({ auth: {
      getUserByEmail: async (email) => ({ uid: email, email, emailVerified: true, providerData: [{ providerId: 'password' }] }),
      generateSignInWithEmailLink: async () => `https://example.test/?mode=signIn&oobCode=concurrent${++generated}`
    } });
    assert.ok((await Promise.all(emails.map(email => f.request({ email })))).every(result => result.queued));
    assert.equal(f.deliveries.length, 1);
    assert.equal(generated, 1);
    assert.equal(f.documents.get('authEmailRateLimits/web-sign-in-pilot').count, 1);
  }
});
test('verified email-link-only accounts share the email provider and preserve their existing UID', async () => {
  // Firebase represents email/password and email-link authentication as 'password'.
  // Eligibility intentionally does not read password hashes or claim a password is set.
  const f = fixture();
  await f.request({ email: f.user.email });
  assert.equal((await f.preflight({ email: f.user.email, code: 'code1' })).uid, f.user.uid);
});
