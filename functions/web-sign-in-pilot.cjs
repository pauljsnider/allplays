'use strict';

const crypto = require('node:crypto');
const { normalizeAuthEmail, isValidAuthEmail, getAuthEmailActionSettings, AUTH_EMAIL_TYPES } = require('./auth-email-core.cjs');
const { buildAppUrl } = require('./app-links-core.cjs');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const safeNext = (value) => ['/home', '/teams', '/schedule', '/profile'].includes(value) ? value : '/home';

// Release remains controlled by the reviewed deployment, not caller input.
const WEB_SIGN_IN_ENABLED = true;
const validEmail = (value) => typeof value === 'string' && value.length <= 320 && isValidAuthEmail(value);

function createWebSignInPilot({ auth, firestore, queueDelivery, HttpsError, logger,
  enabled = false, now = Date.now }) {
  // Firebase's password provider includes email-link-only accounts. Never inspect
  // password hashes; preserve any existing password without adding a provider.
  const eligible = (user, email) => Boolean(user?.uid &&
    normalizeAuthEmail(user.email) === email && user.emailVerified === true &&
    !user.disabled && user.providerData?.length === 1 &&
    user.providerData[0].providerId === 'password' &&
    !user.multiFactor?.enrolledFactors?.length);
  const unavailable = () => new HttpsError('failed-precondition', 'This link cannot be used. Request a new link or sign in with your password.');

  async function request(data) {
    // Every input, including disabled/unavailable accounts, receives the same reply.
    const response = { queued: true };
    if (!enabled || !validEmail(data?.email)) return response;
    const email = normalizeAuthEmail(data.email);
    try {
      // Retain the existing global five/day and one/minute ceiling across instances.
      // Also reserve a hashed per-recipient budget before account lookup.
      // Retain reservations on all failures, including ambiguous provider replies.
      const time = now();
      const limit = firestore.collection('authEmailRateLimits').doc('web-sign-in-pilot');
      const recipient = firestore.collection('authEmailRateLimits').doc(`web-sign-in-recipient-${hash(email)}`);
      const reserved = await firestore.runTransaction(async (tx) => {
        const previous = (await tx.get(limit)).data() || {};
        const previousRecipient = (await tx.get(recipient)).data() || {};
        const day = Math.floor(time / 86400000);
        const count = previous.day === day ? previous.count : 0;
        const recipientCount = previousRecipient.day === day ? previousRecipient.count : 0;
        if (previous.nextAt > time || count >= 5 ||
          previousRecipient.nextAt > time || recipientCount >= 5) return false;
        tx.set(limit, { day, count: count + 1, nextAt: time + 60000 });
        tx.set(recipient, { day, count: recipientCount + 1, nextAt: time + 60000 });
        return true;
      });
      if (!reserved) return response;
      const user = await auth.getUserByEmail(email);
      if (!eligible(user, email)) return response;
      const next = safeNext(data?.next);
      const generated = await auth.generateSignInWithEmailLink(email,
        getAuthEmailActionSettings(AUTH_EMAIL_TYPES.SIGN_IN, buildAppUrl('/email-sign-in', { next })));
      const url = new URL(generated);
      const code = url.searchParams.get('oobCode');
      if (!code || url.searchParams.get('mode') !== 'signIn') throw new Error('Unexpected action link.');
      const id = hash(code);
      await firestore.collection('authEmailPilotLinks').doc(id).create({
        uid: user.uid, email, next, expiresAt: time + 15 * 60000
      });
      await queueDelivery({ type: AUTH_EMAIL_TYPES.WEB_SIGN_IN, email,
        uid: user.uid, deliveryId: `web-sign-in-${id}`,
        actionUrl: buildAppUrl('/email-sign-in', {
          mode: 'signIn', oobCode: code, apiKey: url.searchParams.get('apiKey') || '', next
        }) });
    } catch (error) {
      logger.warn('Web sign-in pilot request could not be completed.', { code: error?.code || null });
    }
    return response;
  }

  async function preflight(data, context = {}) {
    if (!enabled || !validEmail(data?.email) ||
      typeof data?.code !== 'string' || !data.code || data.code.length > 2048) throw unavailable();
    try {
      const record = (await firestore.collection('authEmailPilotLinks').doc(hash(data.code)).get()).data();
      const email = normalizeAuthEmail(data.email);
      if (!record?.uid || record.email !== email || !Number.isFinite(record.expiresAt) ||
        record.expiresAt <= now() ||
        (context.auth?.uid && context.auth.uid !== record.uid)) throw unavailable();
      // Never re-resolve an outstanding link by email or rebind it to a new UID.
      const user = await auth.getUser(record.uid);
      if (user.uid !== record.uid || !eligible(user, email)) throw unavailable();
      return { uid: record.uid, next: safeNext(record.next) };
    } catch {
      throw unavailable();
    }
  }
  return { request, preflight };
}

module.exports = { createWebSignInPilot, WEB_SIGN_IN_ENABLED, safeNext };
