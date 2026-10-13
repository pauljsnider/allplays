'use strict';

const crypto = require('node:crypto');
const { normalizeAuthEmail, getAuthEmailActionSettings, AUTH_EMAIL_TYPES } = require('./auth-email-core.cjs');
const { buildAppUrl } = require('./app-links-core.cjs');
const PILOT_EMAIL = 'paul@allplays.ai';
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const safeNext = (value) => ['/home', '/teams', '/schedule', '/profile'].includes(value) ? value : '/home';

// Deliberately not an environment toggle. Firebase OOB redemption can create a
// replacement account after deletion. An Auth-level guard must be reviewed and
// approved before changing this boundary or configuring the existing UID.
const PILOT_RELEASE_APPROVED = false;

function createWebSignInPilot({ auth, firestore, queueDelivery, HttpsError, logger,
  enabled = false, pilotUid = '', now = Date.now }) {
  const eligible = (user) => Boolean(pilotUid && user?.uid === pilotUid &&
    normalizeAuthEmail(user.email) === PILOT_EMAIL && user.emailVerified === true &&
    !user.disabled && user.providerData?.some((provider) => provider.providerId === 'password') &&
    !user.multiFactor?.enrolledFactors?.length);
  const unavailable = () => new HttpsError('failed-precondition', 'This link cannot be used. Request a new link or sign in with your password.');

  async function request(data) {
    // Every input, including disabled/unavailable accounts, receives the same reply.
    const response = { queued: true };
    if (!enabled || !pilotUid || normalizeAuthEmail(data?.email) !== PILOT_EMAIL) return response;
    try {
      // A durable pilot-wide budget applies across instances and IP addresses.
      // Retain reservations on all failures, including ambiguous provider replies.
      const time = now();
      const limit = firestore.collection('authEmailRateLimits').doc('web-sign-in-pilot');
      const reserved = await firestore.runTransaction(async (tx) => {
        const previous = (await tx.get(limit)).data() || {};
        const day = Math.floor(time / 86400000);
        const count = previous.day === day ? previous.count : 0;
        if (previous.nextAt > time || count >= 5) return false;
        tx.set(limit, { day, count: count + 1, nextAt: time + 60000 });
        return true;
      });
      if (!reserved) return response;
      const user = await auth.getUser(pilotUid);
      if (!eligible(user)) return response;
      const next = safeNext(data?.next);
      const generated = await auth.generateSignInWithEmailLink(PILOT_EMAIL,
        getAuthEmailActionSettings(AUTH_EMAIL_TYPES.SIGN_IN, buildAppUrl('/email-sign-in', { next })));
      const url = new URL(generated);
      const code = url.searchParams.get('oobCode');
      if (!code || url.searchParams.get('mode') !== 'signIn') throw new Error('Unexpected action link.');
      const id = hash(code);
      await firestore.collection('authEmailPilotLinks').doc(id).create({
        uid: pilotUid, next, expiresAt: time + 15 * 60000
      });
      await queueDelivery({ type: AUTH_EMAIL_TYPES.WEB_SIGN_IN, email: PILOT_EMAIL,
        uid: pilotUid, deliveryId: `web-sign-in-${id}`,
        actionUrl: buildAppUrl('/email-sign-in', {
          mode: 'signIn', oobCode: code, apiKey: url.searchParams.get('apiKey') || '', next
        }) });
    } catch (error) {
      logger.warn('Web sign-in pilot request could not be completed.', { code: error?.code || null });
    }
    return response;
  }

  async function preflight(data, context = {}) {
    if (!enabled || !pilotUid || normalizeAuthEmail(data?.email) !== PILOT_EMAIL ||
      typeof data?.code !== 'string' || !data.code || data.code.length > 2048) throw unavailable();
    try {
      const record = (await firestore.collection('authEmailPilotLinks').doc(hash(data.code)).get()).data();
      if (!record || record.uid !== pilotUid || record.expiresAt <= now() ||
        (context.auth?.uid && context.auth.uid !== pilotUid)) throw unavailable();
      if (!eligible(await auth.getUser(pilotUid))) throw unavailable();
      return { uid: pilotUid, next: safeNext(record.next) };
    } catch {
      throw unavailable();
    }
  }
  return { request, preflight };
}

module.exports = { createWebSignInPilot, PILOT_RELEASE_APPROVED, safeNext };
