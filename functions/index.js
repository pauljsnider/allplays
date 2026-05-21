const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Stripe = require('stripe');
const crypto = require('node:crypto');
const { isPrivateIpAddress, isBlockedHostname, assertPublicHost, normalizeTargetUrl, fetchWithTimeout } = require('./utils/security-utils');
const {
  normalizeTeamPassCheckoutInput,
  isEligibleTeamPassPurchaser,
  shouldUnlockTeamPassFromEvent,
  buildTeamPassEntitlement
} = require('./team-pass-core.cjs');
const {
  normalizeTeamFeeCheckoutInput,
  getTeamFeeBalanceCents,
  isTeamFeeCheckoutEligible,
  isEligibleTeamFeePayer,
  buildTeamFeeCheckoutUrls,
  buildTeamFeeCheckoutMetadata,
  canReuseTeamFeeCheckoutSession,
  shouldMarkTeamFeePaidFromEvent,
  shouldRecordTeamFeeCheckoutNotPaidFromEvent,
  buildTeamFeePaidUpdate
} = require('./team-fees-core.cjs');
const { createInMemoryRateLimiter } = require('./rate-limit.cjs');
const { buildPublicGamesIcs, canExposeEmptyPublicFeed, isPublicFanGame } = require('./public-calendar-core.cjs');
const {
  buildTeamCalendarIcs,
  normalizeCalendarRequest
} = require('./team-calendar-feed-core.cjs');
const {
  hashRsvpToken,
  createRawRsvpToken,
  normalizeRsvpTokenCreateInput,
  buildScopedRsvpDocId,
  validateRsvpTokenRedemption,
  buildRsvpTokenAuditPayload
} = require('./rsvp-token-core.cjs');
const {
  normalizeText,
  resolveTeamEmailRecipients,
  buildTeamEmailMailJob
} = require('./team-email-core.cjs');

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const firestore = admin.firestore();
const checkStripeWebhookRateLimit = createInMemoryRateLimiter({
  windowMs: 60_000,
  maxRequests: 120,
  maxKeys: 2_000
});

function getStripeConfig() {
  const stripeConfig = functions.config()?.stripe || {};
  return {
    secretKey: process.env.STRIPE_SECRET_KEY || stripeConfig.secret_key,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || stripeConfig.webhook_secret,
    teamPassPriceId: process.env.STRIPE_TEAM_PASS_PRICE_ID || stripeConfig.team_pass_price_id,
    appUrl: process.env.ALLPLAYS_APP_URL || stripeConfig.app_url || 'https://allplays.ai'
  };
}

function createStripeClient() {
  const { secretKey } = getStripeConfig();
  if (!secretKey) {
    throw new functions.https.HttpsError('failed-precondition', 'Stripe secret key is not configured.');
  }
  return new Stripe(secretKey, { apiVersion: '2024-06-20' });
}

function buildTeamPassCheckoutUrls(appUrl, teamId) {
  const baseUrl = String(appUrl || 'https://allplays.ai').replace(/\/$/, '');
  const encodedTeamId = encodeURIComponent(teamId);
  return {
    successUrl: `${baseUrl}/team.html?teamId=${encodedTeamId}&teamPass=success`,
    cancelUrl: `${baseUrl}/team.html?teamId=${encodedTeamId}&teamPass=cancelled`
  };
}

function buildTeamFeeRecipientRef({ teamId, batchId, recipientId }) {
  return firestore.doc(`teams/${teamId}/feeBatches/${batchId}/feeRecipients/${recipientId}`);
}

function normalizeFirestoreId(value, label) {
  const id = String(value || '').trim();
  if (!id || id.includes('/')) {
    throw new Error(`${label} is required.`);
  }
  return id;
}

function normalizeRegistrationCheckoutInput(data = {}) {
  const amountCents = Math.round(Number(data.amount ?? data.amountCents ?? 0));
  const currency = String(data.currency || 'usd').trim().toLowerCase();
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error('A positive checkout amount is required.');
  }
  if (!/^[a-z]{3}$/.test(currency)) {
    throw new Error('A valid checkout currency is required.');
  }
  return {
    teamId: normalizeFirestoreId(data.teamId, 'teamId'),
    formId: normalizeFirestoreId(data.formId, 'formId'),
    registrationId: normalizeFirestoreId(data.registrationId, 'registrationId'),
    amountCents,
    currency
  };
}

function buildRegistrationRef({ teamId, formId, registrationId }) {
  return firestore.doc(`teams/${teamId}/registrationForms/${formId}/registrations/${registrationId}`);
}

function buildRegistrationCheckoutUrls(appUrl, input) {
  const baseUrl = String(appUrl || 'https://allplays.ai').replace(/\/$/, '');
  const params = new URLSearchParams({
    teamId: input.teamId,
    formId: input.formId,
    registrationId: input.registrationId
  });
  return {
    successUrl: `${baseUrl}/registration.html?${params.toString()}&status=success`,
    cancelUrl: `${baseUrl}/registration.html?${params.toString()}&status=cancelled`
  };
}

function getRegistrationCheckoutAmountCents(registration = {}) {
  return Math.max(0, Math.round(Number(registration.feeSnapshot?.finalAmountDueCents ?? registration.feeAmountCents ?? 0)));
}

function getRegistrationCustomerEmail(registration = {}) {
  const guardian = registration.guardian || {};
  return ['email', 'guardianEmail', 'parentEmail']
    .map((key) => String(guardian[key] || '').trim())
    .find(Boolean) || undefined;
}

function canReuseRegistrationCheckoutSession(registration = {}, amountCents) {
  return Boolean(
    registration.checkoutUrl
    && registration.stripeCheckoutSessionId
    && registration.checkoutStatus === 'open'
    && Number(registration.checkoutAmountCents || 0) === amountCents
  );
}

function buildRegistrationCheckoutMetadata({ input, registration }) {
  return {
    product: 'registration',
    teamId: input.teamId,
    formId: input.formId,
    registrationId: input.registrationId,
    selectedOptionId: String(registration.selectedOption?.id || ''),
    paymentPlanId: String(registration.paymentPlan?.id || '')
  };
}

function shouldProcessRegistrationCheckoutEvent(event) {
  const session = event?.data?.object || {};
  return session.metadata?.product === 'registration'
    && ['checkout.session.completed', 'checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event?.type);
}

function shouldMarkRegistrationPaidFromEvent(event) {
  const session = event?.data?.object || {};
  return event?.type === 'checkout.session.completed'
    && session.metadata?.product === 'registration'
    && session.payment_status === 'paid';
}

function buildRegistrationRefFromStripeSession(session = {}) {
  const metadata = session.metadata || {};
  return buildRegistrationRef({
    teamId: normalizeFirestoreId(metadata.teamId, 'teamId'),
    formId: normalizeFirestoreId(metadata.formId, 'formId'),
    registrationId: normalizeFirestoreId(metadata.registrationId, 'registrationId')
  });
}

async function getUserForEligibility(uid) {
  const userSnap = await firestore.doc(`users/${uid}`).get();
  return userSnap.exists ? userSnap.data() || {} : {};
}

function hasTeamAdminAccess({ team, uid, email }) {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  const adminEmails = Array.isArray(team?.adminEmails) ? team.adminEmails.map((entry) => String(entry || '').trim().toLowerCase()) : [];
  return Boolean(uid && team?.ownerId === uid) || Boolean(normalizedEmail && adminEmails.includes(normalizedEmail));
}

async function logRsvpTokenRedemptionAttempt({ teamId, payload }) {
  const auditPayload = {
    ...payload,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  };
  const collectionPath = teamId ? `teams/${teamId}/rsvpTokenAudit` : 'rsvpTokenAudit';
  await firestore.collection(collectionPath).add(auditPayload);
}

exports.createScopedRsvpToken = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before creating RSVP tokens.');
  }

  let input;
  try {
    input = normalizeRsvpTokenCreateInput(data || {});
  } catch (error) {
    throw new functions.https.HttpsError('invalid-argument', error.message || 'Invalid RSVP token request.');
  }

  const [teamSnap, gameSnap] = await Promise.all([
    firestore.doc(`teams/${input.teamId}`).get(),
    firestore.doc(`teams/${input.teamId}/games/${input.gameId}`).get()
  ]);
  if (!teamSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Team not found.');
  }
  if (!gameSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Event not found.');
  }

  const team = teamSnap.data() || {};
  const user = await getUserForEligibility(context.auth.uid);
  const email = context.auth.token?.email || user.email || '';
  if (!hasTeamAdminAccess({ team, uid: context.auth.uid, email })) {
    throw new functions.https.HttpsError('permission-denied', 'Only team owners and admins can create RSVP tokens.');
  }

  const token = createRawRsvpToken();
  const tokenHash = hashRsvpToken(token);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const expiresAt = admin.firestore.Timestamp.fromMillis(input.expiresAtMs);
  const tokenRef = firestore.doc(`teams/${input.teamId}/rsvpTokens/${tokenHash}`);
  const rsvpDocId = buildScopedRsvpDocId(input);
  await tokenRef.set({
    tokenHash,
    teamId: input.teamId,
    gameId: input.gameId,
    playerId: input.playerId,
    guardianEmailHash: buildRsvpTokenAuditPayload({ guardianEmail: input.guardianEmail }).guardianEmailHash,
    response: input.response,
    rsvpDocId,
    createdBy: context.auth.uid,
    createdByEmail: email || null,
    createdAt: now,
    expiresAt,
    revoked: false,
    usedAt: null
  });

  return {
    token,
    tokenHash,
    teamId: input.teamId,
    gameId: input.gameId,
    playerId: input.playerId,
    guardianEmail: input.guardianEmail,
    response: input.response,
    expiresAt: expiresAt.toDate().toISOString()
  };
});

exports.redeemScopedRsvpToken = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  let body = req.body && typeof req.body === 'object' ? req.body : {};
  if (typeof req.body === 'string' && req.body.trim()) {
    try {
      body = JSON.parse(req.body);
    } catch (error) {
      res.status(400).json({ ok: false, error: 'Invalid JSON body' });
      return;
    }
  }
  const teamId = String(body.teamId || req.query.teamId || '').trim();
  const token = String(body.token || req.query.token || '').trim();
  const tokenHash = hashRsvpToken(token);
  if (!teamId || !tokenHash) {
    await logRsvpTokenRedemptionAttempt({
      teamId: teamId || null,
      payload: buildRsvpTokenAuditPayload({ status: 'rejected', reason: 'missing_token', teamId, tokenHash })
    });
    res.status(400).json({ ok: false, error: 'Missing RSVP token' });
    return;
  }

  if (teamId.includes('/')) {
    res.status(400).json({ ok: false, error: 'Invalid teamId' });
    return;
  }

  const tokenRef = firestore.doc(`teams/${teamId}/rsvpTokens/${tokenHash}`);
  const auditRef = firestore.collection(`teams/${teamId}/rsvpTokenAudit`).doc();

  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const tokenSnap = await transaction.get(tokenRef);
      if (!tokenSnap.exists) {
        transaction.set(auditRef, {
          ...buildRsvpTokenAuditPayload({ status: 'rejected', reason: 'invalid', teamId, tokenHash }),
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return { ok: false, status: 403, error: 'Invalid RSVP token' };
      }

      const tokenData = tokenSnap.data() || {};
      const validation = validateRsvpTokenRedemption({ tokenData, requestBody: body });
      if (!validation.ok || tokenData.teamId !== teamId) {
        const reason = tokenData.teamId !== teamId ? 'mismatched_team' : validation.reason;
        transaction.set(auditRef, {
          ...buildRsvpTokenAuditPayload({
            status: 'rejected',
            reason,
            tokenHash,
            teamId,
            gameId: tokenData.gameId,
            playerId: tokenData.playerId,
            response: tokenData.response
          }),
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return { ok: false, status: 403, error: 'RSVP token cannot be used' };
      }

      const rsvpDocId = tokenData.rsvpDocId || buildScopedRsvpDocId(tokenData);
      const rsvpRef = firestore.doc(`teams/${teamId}/games/${tokenData.gameId}/rsvps/${rsvpDocId}`);
      const now = admin.firestore.FieldValue.serverTimestamp();
      transaction.set(rsvpRef, {
        userId: null,
        displayName: 'Email RSVP',
        playerIds: [tokenData.playerId],
        response: tokenData.response,
        respondedAt: now,
        note: null,
        submittedVia: 'scoped_rsvp_token',
        guardianEmailHash: tokenData.guardianEmailHash || buildRsvpTokenAuditPayload({ guardianEmail: tokenData.guardianEmail }).guardianEmailHash,
        tokenHash
      }, { merge: true });
      transaction.update(tokenRef, {
        usedAt: now,
        usedForRsvpDocId: rsvpDocId,
        usedFromIp: req.headers['x-forwarded-for'] || req.ip || null,
        updatedAt: now
      });
      transaction.set(auditRef, {
        ...buildRsvpTokenAuditPayload({
          status: 'accepted',
          tokenHash,
          teamId,
          gameId: tokenData.gameId,
          playerId: tokenData.playerId,
          response: tokenData.response
        }),
        rsvpDocId,
        createdAt: now
      });

      return { ok: true, gameId: tokenData.gameId, playerId: tokenData.playerId, response: tokenData.response };
    });

    if (!result.ok) {
      res.status(result.status || 403).json({ ok: false, error: result.error });
      return;
    }

    res.status(200).json(result);
  } catch (error) {
    console.error('Failed to redeem scoped RSVP token:', error);
    res.status(500).json({ ok: false, error: 'RSVP token redemption failed' });
  }
});

exports.createStripeTeamPassCheckout = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before purchasing a team pass.');
  }

  const { teamId, seasonId, tier } = normalizeTeamPassCheckoutInput(data || {});
  const teamSnap = await firestore.doc(`teams/${teamId}`).get();
  if (!teamSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Team not found.');
  }

  const team = { id: teamId, ...(teamSnap.data() || {}) };
  const user = await getUserForEligibility(context.auth.uid);
  const email = context.auth.token?.email || user.email || '';
  if (!isEligibleTeamPassPurchaser({ team, user, uid: context.auth.uid, email })) {
    throw new functions.https.HttpsError('permission-denied', 'You do not have team access for this purchase.');
  }

  const { teamPassPriceId, appUrl } = getStripeConfig();
  if (!teamPassPriceId) {
    throw new functions.https.HttpsError('failed-precondition', 'Stripe team pass price is not configured.');
  }

  const stripe = createStripeClient();
  const { successUrl, cancelUrl } = buildTeamPassCheckoutUrls(appUrl, teamId);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: teamPassPriceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: email || undefined,
    client_reference_id: `${teamId}:${seasonId}:${context.auth.uid}`,
    metadata: {
      teamId,
      seasonId,
      tier,
      purchaserUid: context.auth.uid
    }
  });

  return { checkoutUrl: session.url, sessionId: session.id };
});

exports.createStripeTeamFeeCheckout = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before paying a team fee.');
  }

  let input;
  try {
    input = normalizeTeamFeeCheckoutInput(data || {});
  } catch (error) {
    throw new functions.https.HttpsError('invalid-argument', error.message || 'Invalid team fee checkout request.');
  }

  const teamSnap = await firestore.doc(`teams/${input.teamId}`).get();
  if (!teamSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Team not found.');
  }

  const recipientRef = buildTeamFeeRecipientRef(input);
  const recipientSnap = await recipientRef.get();
  if (!recipientSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Fee recipient not found.');
  }

  const team = { id: input.teamId, ...(teamSnap.data() || {}) };
  const recipient = { id: input.recipientId, ...(recipientSnap.data() || {}) };
  if (recipient.teamId !== input.teamId || recipient.batchId !== input.batchId) {
    throw new functions.https.HttpsError('failed-precondition', 'Fee recipient does not match the requested fee batch.');
  }

  if (!isTeamFeeCheckoutEligible(recipient)) {
    throw new functions.https.HttpsError('failed-precondition', 'This team fee is not eligible for online checkout.');
  }

  const user = await getUserForEligibility(context.auth.uid);
  const email = context.auth.token?.email || user.email || '';
  if (!isEligibleTeamFeePayer({ team, user, uid: context.auth.uid, email, recipient })) {
    throw new functions.https.HttpsError('permission-denied', 'You do not have access to pay this team fee.');
  }

  const amountCents = getTeamFeeBalanceCents(recipient);
  if (canReuseTeamFeeCheckoutSession(recipient, amountCents)) {
    return { checkoutUrl: recipient.checkoutUrl, sessionId: recipient.stripeCheckoutSessionId };
  }

  const stripe = createStripeClient();
  const { appUrl } = getStripeConfig();
  const { successUrl, cancelUrl } = buildTeamFeeCheckoutUrls(appUrl, input);
  const title = recipient.feeTitle || recipient.title || 'Team fee';
  const playerName = recipient.playerName || recipient.childName || '';
  const description = playerName ? `${title} for ${playerName}` : title;
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: 'usd',
        unit_amount: amountCents,
        product_data: {
          name: description
        }
      },
      quantity: 1
    }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: email || recipient.parentEmail || recipient.email || undefined,
    client_reference_id: `${input.teamId}:${input.batchId}:${input.recipientId}`,
    metadata: buildTeamFeeCheckoutMetadata({ ...input, payerUid: context.auth.uid })
  });

  const now = admin.firestore.FieldValue.serverTimestamp();
  await recipientRef.set({
    checkoutUrl: session.url,
    paymentLink: session.url,
    checkoutStatus: 'open',
    paymentProvider: 'stripe',
    stripeCheckoutSessionId: session.id,
    stripePaymentStatus: session.payment_status || 'unpaid',
    checkoutAmountCents: amountCents,
    balanceDueCents: amountCents,
    checkoutCreatedAt: now,
    updatedAt: now
  }, { merge: true });

  return { checkoutUrl: session.url, sessionId: session.id };
});

exports.createStripeRegistrationCheckout = functions.https.onCall(async (data) => {
  let input;
  try {
    input = normalizeRegistrationCheckoutInput(data || {});
  } catch (error) {
    throw new functions.https.HttpsError('invalid-argument', error.message || 'Invalid registration checkout request.');
  }

  const [formSnap, registrationSnap] = await Promise.all([
    firestore.doc(`teams/${input.teamId}/registrationForms/${input.formId}`).get(),
    buildRegistrationRef(input).get()
  ]);
  if (!formSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Registration form not found.');
  }
  if (!registrationSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Registration not found.');
  }

  const form = formSnap.data() || {};
  const registration = registrationSnap.data() || {};
  if (form.published !== true && form.status !== 'published') {
    throw new functions.https.HttpsError('failed-precondition', 'This registration form is not accepting submissions.');
  }
  if (form.paymentSettings?.onlineCheckoutEnabled !== true) {
    throw new functions.https.HttpsError('failed-precondition', 'Online checkout is not enabled for this registration.');
  }
  if (registration.teamId !== input.teamId || registration.formId !== input.formId) {
    throw new functions.https.HttpsError('failed-precondition', 'Registration does not match the requested form.');
  }
  if (registration.status === 'waitlisted') {
    throw new functions.https.HttpsError('failed-precondition', 'Waitlisted registrations cannot be paid online yet.');
  }
  if (registration.paymentStatus === 'paid') {
    throw new functions.https.HttpsError('failed-precondition', 'This registration has already been paid.');
  }

  const expectedAmountCents = getRegistrationCheckoutAmountCents(registration);
  if (input.amountCents !== expectedAmountCents) {
    throw new functions.https.HttpsError('failed-precondition', 'Checkout amount does not match the registration fee.');
  }
  if (canReuseRegistrationCheckoutSession(registration, input.amountCents)) {
    return { checkoutUrl: registration.checkoutUrl, sessionId: registration.stripeCheckoutSessionId };
  }

  const stripe = createStripeClient();
  const { appUrl } = getStripeConfig();
  const { successUrl, cancelUrl } = buildRegistrationCheckoutUrls(appUrl, input);
  const title = registration.programName || form.programName || form.title || form.name || 'Program registration';
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{
      price_data: {
        currency: input.currency,
        unit_amount: input.amountCents,
        product_data: {
          name: title
        }
      },
      quantity: 1
    }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    customer_email: getRegistrationCustomerEmail(registration),
    client_reference_id: `${input.teamId}:${input.formId}:${input.registrationId}`,
    metadata: buildRegistrationCheckoutMetadata({ input, registration })
  });

  const now = admin.firestore.FieldValue.serverTimestamp();
  await buildRegistrationRef(input).set({
    checkoutUrl: session.url,
    paymentLink: session.url,
    checkoutStatus: 'open',
    paymentProvider: 'stripe',
    paymentStatus: 'checkout_open',
    stripeCheckoutSessionId: session.id,
    stripePaymentStatus: session.payment_status || 'unpaid',
    checkoutAmountCents: input.amountCents,
    checkoutCreatedAt: now,
    updatedAt: now
  }, { merge: true });

  return { checkoutUrl: session.url, sessionId: session.id };
});

exports.stripeTeamPassWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    res.status(405).send('Method not allowed');
    return;
  }

  const rateLimit = checkStripeWebhookRateLimit(req);
  if (!rateLimit.allowed) {
    res.set('Retry-After', String(rateLimit.retryAfterSeconds));
    res.status(429).send('Too many webhook requests');
    return;
  }

  const { secretKey, webhookSecret } = getStripeConfig();
  if (!secretKey || !webhookSecret) {
    res.status(500).send('Stripe webhook configuration is incomplete');
    return;
  }

  const stripe = createStripeClient();
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.rawBody, req.headers['stripe-signature'], webhookSecret);
  } catch (error) {
    console.warn('Rejected Stripe webhook with invalid signature:', error?.message || error);
    res.status(400).send('Invalid Stripe signature');
    return;
  }

  if (shouldProcessRegistrationCheckoutEvent(event)) {
    try {
      const session = event.data.object;
      const receivedAt = admin.firestore.FieldValue.serverTimestamp();
      const eventRef = firestore.doc(`stripeEvents/${event.id}`);
      const registrationRef = buildRegistrationRefFromStripeSession(session);

      await firestore.runTransaction(async (transaction) => {
        const eventSnap = await transaction.get(eventRef);
        if (eventSnap.exists) return;

        const registrationSnap = await transaction.get(registrationRef);
        if (!registrationSnap.exists) {
          throw new Error('Registration not found for Stripe webhook.');
        }

        if (shouldMarkRegistrationPaidFromEvent(event)) {
          transaction.set(registrationRef, {
            checkoutStatus: 'complete',
            paymentStatus: 'paid',
            paidAt: receivedAt,
            stripeCheckoutSessionId: session.id || null,
            stripePaymentIntentId: session.payment_intent || null,
            stripePaymentStatus: session.payment_status || 'paid',
            stripeEventId: event.id,
            updatedAt: receivedAt
          }, { merge: true });
        } else {
          transaction.set(registrationRef, {
            checkoutStatus: event.type === 'checkout.session.expired' ? 'expired' : 'payment_failed',
            paymentStatus: event.type === 'checkout.session.expired' ? 'checkout_expired' : 'payment_failed',
            stripeCheckoutSessionId: session.id || null,
            stripePaymentStatus: session.payment_status || 'unpaid',
            stripeEventId: event.id,
            updatedAt: receivedAt
          }, { merge: true });
        }

        transaction.set(eventRef, {
          provider: 'stripe',
          product: 'registration',
          type: event.type,
          checkoutSessionId: session.id || null,
          registrationPath: registrationRef.path,
          receivedAt
        });
      });

      res.status(200).json({ received: true, registrationUpdated: shouldMarkRegistrationPaidFromEvent(event) });
      return;
    } catch (error) {
      console.error('Failed to process Stripe registration webhook:', error);
      res.status(500).send('Webhook processing failed');
      return;
    }
  }

  if (shouldMarkTeamFeePaidFromEvent(event) || shouldRecordTeamFeeCheckoutNotPaidFromEvent(event)) {
    try {
      const session = event.data.object;
      const { teamId, batchId, recipientId } = session.metadata || {};
      const receivedAt = admin.firestore.FieldValue.serverTimestamp();
      const eventRef = firestore.doc(`stripeEvents/${event.id}`);
      const recipientRef = buildTeamFeeRecipientRef({ teamId, batchId, recipientId });

      await firestore.runTransaction(async (transaction) => {
        const eventSnap = await transaction.get(eventRef);
        if (eventSnap.exists) return;

        const recipientSnap = await transaction.get(recipientRef);
        if (!recipientSnap.exists) {
          throw new Error('Team fee recipient not found for Stripe webhook.');
        }

        if (shouldMarkTeamFeePaidFromEvent(event)) {
          transaction.set(recipientRef, buildTeamFeePaidUpdate({
            recipient: recipientSnap.data() || {},
            session,
            eventId: event.id,
            receivedAt
          }), { merge: true });
        } else {
          transaction.set(recipientRef, {
            checkoutStatus: event.type === 'checkout.session.expired' ? 'expired' : 'payment_failed',
            stripeCheckoutSessionId: session.id || null,
            stripeEventId: event.id,
            updatedAt: receivedAt
          }, { merge: true });
        }

        transaction.set(eventRef, {
          provider: 'stripe',
          product: 'team_fee',
          type: event.type,
          checkoutSessionId: session.id || null,
          recipientPath: recipientRef.path,
          receivedAt
        });
      });

      res.status(200).json({ received: true, teamFeeUpdated: shouldMarkTeamFeePaidFromEvent(event) });
      return;
    } catch (error) {
      console.error('Failed to process Stripe team fee webhook:', error);
      res.status(500).send('Webhook processing failed');
      return;
    }
  }

  if (!shouldUnlockTeamPassFromEvent(event)) {
    res.status(200).json({ received: true, unlocked: false });
    return;
  }

  try {
    const receivedAt = admin.firestore.FieldValue.serverTimestamp();
    const entitlement = buildTeamPassEntitlement({
      session: event.data.object,
      eventId: event.id,
      receivedAt
    });
    const eventRef = firestore.doc(`stripeEvents/${event.id}`);
    const entitlementRef = firestore.doc(entitlement.refPath);

    await firestore.runTransaction(async (transaction) => {
      const eventSnap = await transaction.get(eventRef);
      if (eventSnap.exists) return;
      transaction.set(entitlementRef, entitlement.data, { merge: true });
      transaction.set(eventRef, {
        provider: 'stripe',
        type: event.type,
        checkoutSessionId: event.data.object.id || null,
        entitlementPath: entitlement.refPath,
        receivedAt
      });
    });

    res.status(200).json({ received: true, unlocked: true });
  } catch (error) {
    console.error('Failed to process Stripe team pass webhook:', error);
    res.status(500).send('Webhook processing failed');
  }
});

function normalizeIcsText(text) {
  const marker = 'BEGIN:VCALENDAR';
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) return text;
  return text.slice(markerIndex);
}



function getAllowedOrigins() {
  const configuredOrigins = functions.config()?.calendar?.allowed_origins;
  if (Array.isArray(configuredOrigins)) {
    return configuredOrigins.map((origin) => String(origin).trim()).filter(Boolean);
  }
  if (typeof configuredOrigins === 'string') {
    return configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean);
  }
  return [
    'https://allplays.ai',
    'https://www.allplays.ai',
    'http://localhost:8000',
    'http://127.0.0.1:8000'
  ];
}

const allowedOriginSet = new Set(getAllowedOrigins());

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }
  return allowedOriginSet.has(origin);
}

function isAllowedTelemetryOrigin(origin) {
  return !!origin && allowedOriginSet.has(origin);
}

function writeCorsHeaders(req, res, methods = 'GET,OPTIONS') {
  const origin = req.headers.origin;
  if (origin && allowedOriginSet.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', methods);
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Cache-Control', 'no-store');
}

function normalizeTelemetryString(value, maxLength = 160) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/\s+/g, ' ')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '[phone]')
    .replace(/\b\d{5,}\b/g, '[number]')
    .replace(/\b[A-Za-z0-9_-]{18,}\b/g, '[token]')
    .trim()
    .slice(0, maxLength);
}

function normalizeTelemetryKey(value, maxLength = 80) {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^\w:-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength);
}

function normalizeTelemetryIdentifier(value, maxLength = 120) {
  if (value === null || value === undefined) return '';
  return String(value)
    .trim()
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '')
    .replace(/\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}\b/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^\w:-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, maxLength);
}

function normalizeTelemetryObject(value, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2) {
    return {};
  }

  const normalized = {};
  for (const [key, rawValue] of Object.entries(value).slice(0, 40)) {
    const cleanKey = normalizeTelemetryKey(key, 60);
    if (!cleanKey) continue;

    if (rawValue === null || rawValue === undefined) {
      normalized[cleanKey] = null;
    } else if (typeof rawValue === 'boolean') {
      normalized[cleanKey] = rawValue;
    } else if (typeof rawValue === 'number') {
      const sanitizedNumber = normalizeTelemetryString(rawValue, 240);
      normalized[cleanKey] = sanitizedNumber === String(rawValue) ? rawValue : sanitizedNumber;
    } else if (Array.isArray(rawValue)) {
      normalized[cleanKey] = rawValue
        .slice(0, 10)
        .map((item) => normalizeTelemetryString(item, 80));
    } else if (typeof rawValue === 'object') {
      normalized[cleanKey] = normalizeTelemetryObject(rawValue, depth + 1);
    } else {
      normalized[cleanKey] = normalizeTelemetryString(rawValue, 240);
    }
  }
  return normalized;
}

function normalizeTelemetryPath(value) {
  const path = normalizeTelemetryString(value || '/', 220);
  if (!path || path[0] !== '/') return '/';
  return path.split('?')[0].split('#')[0] || '/';
}

function parseTelemetryBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }

  try {
    if (typeof req.body === 'string') {
      return JSON.parse(req.body);
    }

    if (Buffer.isBuffer(req.body)) {
      return JSON.parse(req.body.toString('utf8'));
    }
  } catch (error) {
    throw new Error('Invalid JSON body');
  }

  throw new Error('Invalid JSON body');
}

function getTelemetryBearerToken(req, payload) {
  const authHeader = req.headers.authorization || '';
  const match = typeof authHeader === 'string' ? authHeader.match(/^Bearer\s+(.+)$/i) : null;
  if (match?.[1]) return match[1].trim();
  return typeof payload?.authToken === 'string' ? payload.authToken.trim() : '';
}

async function verifyTelemetryAuth(req, payload) {
  const token = getTelemetryBearerToken(req, payload);
  if (!token) return null;

  try {
    return await admin.auth().verifyIdToken(token);
  } catch (error) {
    throw new Error('Invalid telemetry auth token');
  }
}

function normalizeTelemetryEvent(rawEvent, receivedAt, authUid = null) {
  if (!rawEvent || typeof rawEvent !== 'object') {
    return null;
  }

  const name = normalizeTelemetryKey(rawEvent.name, 80);
  const sessionId = normalizeTelemetryIdentifier(rawEvent.sessionId, 120);
  const visitorId = normalizeTelemetryIdentifier(rawEvent.visitorId, 120);

  if (!name || !sessionId || !visitorId) {
    return null;
  }

  const clientTimestamp = Number.isNaN(Date.parse(rawEvent.clientTimestamp))
    ? receivedAt.toISOString()
    : new Date(rawEvent.clientTimestamp).toISOString();

  return {
    id: normalizeTelemetryIdentifier(rawEvent.id, 120) || `${sessionId}_${receivedAt.getTime()}`,
    name,
    version: normalizeTelemetryString(rawEvent.version, 24),
    sessionId,
    visitorId,
    userId: authUid || null,
    signedIn: !!authUid && rawEvent.signedIn === true,
    clientTimestamp,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    receivedAt: receivedAt.toISOString(),
    pagePath: normalizeTelemetryPath(rawEvent.pagePath),
    pageTitle: normalizeTelemetryString(rawEvent.pageTitle, 140),
    queryKeys: Array.isArray(rawEvent.queryKeys)
      ? rawEvent.queryKeys.slice(0, 20).map((key) => normalizeTelemetryKey(key, 60)).filter(Boolean)
      : [],
    referrer: normalizeTelemetryString(rawEvent.referrer, 160),
    viewport: normalizeTelemetryObject(rawEvent.viewport),
    screen: normalizeTelemetryObject(rawEvent.screen),
    timezone: normalizeTelemetryString(rawEvent.timezone, 80),
    language: normalizeTelemetryString(rawEvent.language, 32),
    userAgent: normalizeTelemetryString(rawEvent.userAgent, 260),
    properties: normalizeTelemetryObject(rawEvent.properties)
  };
}

function telemetryDocId(value) {
  return normalizeTelemetryKey(value, 140) || 'unknown';
}

function getDateKey(date) {
  return date.toISOString().slice(0, 10);
}

function applyTelemetryAggregateWrites(batch, event, dateKey, options = {}) {
  const db = admin.firestore();
  const increment = admin.firestore.FieldValue.increment;
  const serverTimestamp = admin.firestore.FieldValue.serverTimestamp;
  const isPageView = event.name === 'page_view';
  const isInteraction = event.name.startsWith('interaction_');
  const isError = event.name.startsWith('js_');

  batch.set(db.collection('telemetryDaily').doc(dateKey), {
    date: dateKey,
    totalEvents: increment(1),
    pageViews: increment(isPageView ? 1 : 0),
    interactions: increment(isInteraction ? 1 : 0),
    errors: increment(isError ? 1 : 0),
    signedInEvents: increment(event.signedIn ? 1 : 0),
    updatedAt: serverTimestamp()
  }, { merge: true });

  const pageDocId = `${dateKey}_${telemetryDocId(event.pagePath)}`;
  batch.set(db.collection('telemetryPagesDaily').doc(pageDocId), {
    date: dateKey,
    pagePath: event.pagePath,
    totalEvents: increment(1),
    pageViews: increment(isPageView ? 1 : 0),
    interactions: increment(isInteraction ? 1 : 0),
    errors: increment(isError ? 1 : 0),
    updatedAt: serverTimestamp()
  }, { merge: true });

  const eventDocId = `${dateKey}_${telemetryDocId(event.name)}`;
  batch.set(db.collection('telemetryEventsDaily').doc(eventDocId), {
    date: dateKey,
    name: event.name,
    count: increment(1),
    updatedAt: serverTimestamp()
  }, { merge: true });

  const sessionUpdate = {
    sessionId: event.sessionId,
    visitorId: event.visitorId,
    userId: event.userId || null,
    signedIn: event.signedIn,
    lastPage: event.pagePath,
    lastEventName: event.name,
    eventCount: increment(1),
    pageViews: increment(isPageView ? 1 : 0),
    interactions: increment(isInteraction ? 1 : 0),
    errors: increment(isError ? 1 : 0),
    updatedAt: serverTimestamp()
  };

  if (isPageView && !options.sessionExists) {
    sessionUpdate.entryPage = event.pagePath;
  }

  batch.set(db.collection('telemetrySessions').doc(event.sessionId), sessionUpdate, { merge: true });
}

const MAX_TELEMETRY_EVENTS_PER_REQUEST = 25;
const TELEMETRY_WRITES_PER_EVENT = 5;
const FIRESTORE_WRITE_SAFETY_LIMIT = 450;

async function commitTelemetryEvent(db, event, dateKey) {
  const eventRef = db.collection('telemetryEvents').doc(event.id);
  const sessionRef = db.collection('telemetrySessions').doc(event.sessionId);
  return db.runTransaction(async (transaction) => {
    const [existing, sessionSnap] = await Promise.all([
      transaction.get(eventRef),
      transaction.get(sessionRef)
    ]);
    if (existing.exists) {
      return false;
    }

    transaction.create(eventRef, event);
    applyTelemetryAggregateWrites(transaction, event, dateKey, { sessionExists: sessionSnap.exists });
    return true;
  });
}

async function commitTelemetryEvents(db, events, dateKey) {
  const maxEventsPerChunk = Math.max(1, Math.floor(FIRESTORE_WRITE_SAFETY_LIMIT / TELEMETRY_WRITES_PER_EVENT));
  let stored = 0;
  let duplicates = 0;

  for (let i = 0; i < events.length; i += maxEventsPerChunk) {
    const chunk = events.slice(i, i + maxEventsPerChunk);
    const results = await Promise.all(chunk.map((event) => commitTelemetryEvent(db, event, dateKey)));
    stored += results.filter(Boolean).length;
    duplicates += results.filter((result) => !result).length;
  }

  return { stored, duplicates };
}

const calendarServiceAccount =
  functions.config()?.calendar?.service_account ||
  process.env.CALENDAR_FETCH_SERVICE_ACCOUNT ||
  null;
const fetchCalendarRuntime = calendarServiceAccount
  ? { serviceAccount: calendarServiceAccount }
  : {};

exports.publicTeamGamesIcs = functions
  .runWith(fetchCalendarRuntime)
  .https
  .onRequest(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).send('Method not allowed');
      return;
    }

    const teamId = String(req.query.teamId || '').trim();
    if (!teamId || !/^[A-Za-z0-9_-]{1,128}$/.test(teamId)) {
      res.status(400).send('Missing or invalid teamId');
      return;
    }

    try {
      const teamSnap = await firestore.doc(`teams/${teamId}`).get();
      if (!teamSnap.exists) {
        res.status(404).send('Calendar not found');
        return;
      }

      const team = { id: teamId, ...(teamSnap.data() || {}) };
      const gamesSnap = await firestore.collection(`teams/${teamId}/games`).get();
      const games = [];
      gamesSnap.forEach((docSnap) => games.push({ id: docSnap.id, ...(docSnap.data() || {}) }));
      const publicGames = games.filter((game) => isPublicFanGame(team, game));

      if (!publicGames.length && !canExposeEmptyPublicFeed(team)) {
        res.status(404).send('Calendar not found');
        return;
      }

      const icsText = buildPublicGamesIcs({ teamId, team, games: publicGames });
      res.set('Content-Type', 'text/calendar; charset=utf-8');
      res.set('Content-Disposition', `inline; filename="${teamId}-public-games.ics"`);
      res.set('Cache-Control', 'public, max-age=300');
      res.status(200).send(req.method === 'HEAD' ? '' : icsText);
    } catch (error) {
      console.error('Failed to build public team games ICS:', error);
      res.status(500).send('Calendar unavailable');
    }
  });

async function getCalendarTokenSnapshot(teamId, tokenHash, token) {
  const tokenRef = firestore.doc(`teams/${teamId}/calendarTokens/${tokenHash}`);
  const tokenSnap = await tokenRef.get();
  if (tokenSnap.exists) return tokenSnap;

  // Backward-compatible fallback for any pre-existing URL-safe raw-token documents.
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return tokenSnap;
  const legacyRef = firestore.doc(`teams/${teamId}/calendarTokens/${token}`);
  return legacyRef.get();
}

async function getCalendarTokenHolderUser(tokenData) {
  const uid = tokenData.uid || tokenData.userId || tokenData.createdBy || null;
  if (!uid) return null;
  const userSnap = await firestore.doc(`users/${uid}`).get();
  if (!userSnap.exists) return null;
  return { uid, ...(userSnap.data() || {}) };
}

function calendarTokenHasTeamAccess({ team, user, tokenData }) {
  if (!team || !tokenData) return false;
  const uid = user?.uid || tokenData.uid || tokenData.userId || tokenData.createdBy || null;
  const email = String(user?.email || tokenData.email || tokenData.userEmail || '').trim().toLowerCase();
  const adminEmails = Array.isArray(team.adminEmails) ? team.adminEmails.map((entry) => String(entry || '').toLowerCase()) : [];
  const parentTeamIds = Array.isArray(user?.parentTeamIds) ? user.parentTeamIds : [];
  return team.ownerId === uid ||
    (email && adminEmails.includes(email)) ||
    parentTeamIds.includes(tokenData.teamId);
}

exports.teamCalendarFeed = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).send('Method not allowed');
    return;
  }

  const { teamId, token, tokenHash } = normalizeCalendarRequest(req.query || {});
  if (!teamId || !token || !tokenHash) {
    res.status(401).send('Missing calendar token');
    return;
  }

  try {
    const [teamSnap, tokenSnap] = await Promise.all([
      firestore.doc(`teams/${teamId}`).get(),
      getCalendarTokenSnapshot(teamId, tokenHash, token)
    ]);

    if (!teamSnap.exists || !tokenSnap.exists) {
      res.status(403).send('Invalid calendar token');
      return;
    }

    const team = teamSnap.data() || {};
    const tokenData = { ...(tokenSnap.data() || {}), teamId };
    if (tokenData.revoked === true || tokenData.disabled === true || tokenData.active === false) {
      res.status(403).send('Revoked calendar token');
      return;
    }

    const expiresAt = tokenData.expiresAt?.toDate ? tokenData.expiresAt.toDate() : (tokenData.expiresAt ? new Date(tokenData.expiresAt) : null);
    if (expiresAt && !Number.isNaN(expiresAt.getTime()) && expiresAt <= new Date()) {
      res.status(403).send('Expired calendar token');
      return;
    }

    const tokenUser = await getCalendarTokenHolderUser(tokenData);
    if (!calendarTokenHasTeamAccess({ team, user: tokenUser, tokenData })) {
      res.status(403).send('Calendar token no longer has team access');
      return;
    }

    const eventsSnap = await firestore.collection(`teams/${teamId}/games`).orderBy('date').get();
    const enrichedEvents = await Promise.all(eventsSnap.docs.map(async (docSnap) => {
      const game = { id: docSnap.id, ...(docSnap.data() || {}) };
      const rsvpsSnap = await firestore.collection(`teams/${teamId}/games/${game.id}/rsvps`).get();
      game.rsvps = rsvpsSnap.docs.map((rsvpDoc) => ({ id: rsvpDoc.id, ...(rsvpDoc.data() || {}) }));
      // Assuming officiating details are directly on the game document
      game.officiating = Array.isArray(game.officiating) ? game.officiating : (Array.isArray(game.officials) ? game.officials : []);
      return game;
    }));
    const events = enrichedEvents;
    const icsText = buildTeamCalendarIcs({ teamId, team, events });

    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', `inline; filename="${teamId}-schedule.ics"`);
    res.set('Cache-Control', 'private, max-age=300');
    res.status(200).send(icsText);
  } catch (error) {
    console.error('Failed to build team calendar feed:', error);
    res.status(500).send('Calendar feed failed');
  }
});

exports.fetchCalendarIcs = functions
  .runWith(fetchCalendarRuntime)
  .https
  .onRequest(async (req, res) => {
    writeCorsHeaders(req, res);

    if (!isAllowedOrigin(req.headers.origin)) {
      res.status(403).json({ ok: false, error: 'Origin not allowed' });
      return;
    }

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      const rawUrl = req.query.url;
      const normalizedUrl = await normalizeTargetUrl(rawUrl);

      const response = await fetchWithTimeout(normalizedUrl.url, normalizedUrl.hostname, normalizedUrl.publicIps);
      if (!response.ok) {
        res.status(502).json({
          ok: false,
          error: `Calendar fetch failed: ${response.status} ${response.statusText}`
        });
        return;
      }

      const rawText = await response.text();
      const icsText = normalizeIcsText(rawText);

      if (!icsText.includes('BEGIN:VCALENDAR')) {
        res.status(502).json({ ok: false, error: 'Response was not valid ICS' });
        return;
      }

      const fetchedAt = new Date().toISOString();

      res.status(200).json({
        ok: true,
        source: 'live',
        fetchedAt,
        icsText
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error?.message || 'Unknown error'
      });
    }
  });

const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  liveChat: false,
  liveScore: false,
  schedule: false
});

function normalizeNotificationPreferences(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    liveChat: source.liveChat === true,
    liveScore: source.liveScore === true,
    schedule: source.schedule === true
  };
}

function toNumericScore(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeComparableValue(value) {
  if (value == null) {
    return null;
  }

  if (typeof value?.toMillis === 'function') {
    const millis = value.toMillis();
    if (Number.isFinite(millis)) {
      return { __type: 'timestamp', value: millis };
    }
  }

  if (value instanceof Date) {
    return { __type: 'date', value: value.getTime() };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeComparableValue(entry));
  }

  if (typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((normalized, key) => {
        normalized[key] = normalizeComparableValue(value[key]);
        return normalized;
      }, {});
  }

  return value;
}

function valuesDiffer(beforeValue, afterValue) {
  return JSON.stringify(normalizeComparableValue(beforeValue)) !== JSON.stringify(normalizeComparableValue(afterValue));
}

function detectGameNotificationCategory(beforeGame, afterGame) {
  const beforeHome = toNumericScore(beforeGame?.homeScore);
  const beforeAway = toNumericScore(beforeGame?.awayScore);
  const afterHome = toNumericScore(afterGame?.homeScore);
  const afterAway = toNumericScore(afterGame?.awayScore);
  if (beforeHome !== afterHome || beforeAway !== afterAway) {
    return 'liveScore';
  }

  const scheduleFields = ['date', 'location', 'status', 'opponent', 'title'];
  const scheduleChanged = scheduleFields.some((field) => valuesDiffer(beforeGame?.[field] ?? null, afterGame?.[field] ?? null));

  return scheduleChanged ? 'schedule' : null;
}

function buildNotificationLink({ category, teamId, gameId }) {
  if (category === 'liveChat') {
    return `https://allplays.ai/team-chat.html?teamId=${encodeURIComponent(teamId)}`;
  }
  if (category === 'liveScore' && gameId) {
    return `https://allplays.ai/live-game.html?teamId=${encodeURIComponent(teamId)}&gameId=${encodeURIComponent(gameId)}`;
  }
  return `https://allplays.ai/team.html?teamId=${encodeURIComponent(teamId)}`;
}

async function getUserIdsByEmails(emails) {
  const uniqueEmails = Array.from(new Set(
    (Array.isArray(emails) ? emails : [])
      .map((email) => String(email || '').trim().toLowerCase())
      .filter(Boolean)
  ));
  if (!uniqueEmails.length) return [];

  const ids = new Set();
  const lookupResults = await Promise.allSettled(
    uniqueEmails.map((email) => admin.auth().getUserByEmail(email))
  );
  lookupResults.forEach((result) => {
    if (result.status === 'fulfilled' && result.value?.uid) {
      ids.add(result.value.uid);
    }
  });
  return Array.from(ids);
}

async function getCandidateUserIdsForTeam(teamId) {
  const teamSnap = await firestore.doc(`teams/${teamId}`).get();
  if (!teamSnap.exists) return [];
  const team = teamSnap.data() || {};

  const userIds = new Set();
  if (team.ownerId) userIds.add(team.ownerId);

  const parentSnap = await firestore.collection('users').where('parentTeamIds', 'array-contains', teamId).get();
  parentSnap.forEach((docSnap) => userIds.add(docSnap.id));

  const adminUserIds = await getUserIdsByEmails(team.adminEmails || []);
  adminUserIds.forEach((id) => userIds.add(id));

  return Array.from(userIds);
}

async function getTargetsForCategory(teamId, category, actorUid = null) {
  const userIds = await getCandidateUserIdsForTeam(teamId);
  const queryTasks = userIds
    .filter((uid) => uid && uid !== actorUid)
    .map(async (uid) => {
      const prefRef = firestore.doc(`users/${uid}/notificationPreferences/${teamId}`);
      const devicesRef = firestore.collection(`users/${uid}/notificationDevices`);
      const [prefSnap, devicesSnap] = await Promise.all([
        prefRef.get(),
        devicesRef.get()
      ]);
      const prefs = prefSnap.exists
        ? normalizeNotificationPreferences(prefSnap.data())
        : DEFAULT_NOTIFICATION_PREFERENCES;
      if (prefs[category] !== true) return [];
      return devicesSnap.docs
        .map((docSnap) => {
          const data = docSnap.data() || {};
          const token = String(data.token || '').trim();
          if (!token) return null;
          return {
            uid,
            deviceId: docSnap.id,
            token
          };
        })
        .filter(Boolean);
    });

  const targetGroups = await Promise.all(queryTasks);
  return targetGroups.flat();
}

async function pruneInvalidTokens(sendResult, targets) {
  if (!sendResult || !Array.isArray(sendResult.responses)) return;
  const removableCodes = new Set([
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered'
  ]);

  const removals = [];
  sendResult.responses.forEach((response, index) => {
    if (response.success) return;
    const code = response.error?.code;
    if (!removableCodes.has(code)) return;
    const target = targets[index];
    if (!target?.uid || !target?.deviceId) return;
    removals.push(
      firestore.doc(`users/${target.uid}/notificationDevices/${target.deviceId}`).delete()
    );
  });

  if (removals.length) {
    await Promise.allSettled(removals);
  }
}

async function sendCategoryNotification({
  teamId,
  gameId = null,
  category,
  title,
  body,
  actorUid = null,
  linkOverride = null
}) {
  const targets = await getTargetsForCategory(teamId, category, actorUid);
  if (!targets.length) return null;

  const link = linkOverride || buildNotificationLink({ category, teamId, gameId });
  const maxMulticastTokens = 500;
  const allResponses = [];
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < targets.length; i += maxMulticastTokens) {
    const targetChunk = targets.slice(i, i + maxMulticastTokens);
    const sendResult = await admin.messaging().sendEachForMulticast({
      tokens: targetChunk.map((target) => target.token),
      notification: { title, body },
      data: {
        teamId: String(teamId),
        gameId: String(gameId || ''),
        category: String(category),
        link
      },
      webpush: {
        fcmOptions: { link }
      }
    });
    allResponses.push(...(Array.isArray(sendResult.responses) ? sendResult.responses : []));
    successCount += Number(sendResult.successCount || 0);
    failureCount += Number(sendResult.failureCount || 0);
    await pruneInvalidTokens(sendResult, targetChunk);
  }

  return {
    responses: allResponses,
    successCount,
    failureCount
  };
}

function coerceDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getEventTitle(event) {
  const type = String(event?.type || event?.eventType || '').toLowerCase();
  if (type === 'practice') {
    return event?.title || 'Practice';
  }
  if (event?.title) return event.title;
  return event?.opponent ? `vs. ${event.opponent}` : 'Game';
}

function getReminderDueAt(event) {
  const notifications = event?.scheduleNotifications || {};
  const explicitDueAt = coerceDate(notifications.nextReminderAt);
  if (explicitDueAt) return explicitDueAt;

  const eventDate = coerceDate(event?.date);
  if (!eventDate) return null;
  const reminderHours = Number.parseInt(notifications.reminderHours, 10);
  const supportedHours = [24, 48, 72].includes(reminderHours) ? reminderHours : 24;
  return new Date(eventDate.getTime() - supportedHours * 60 * 60 * 1000);
}

function isEligibleForPreEventReminder(event, now = new Date()) {
  const notifications = event?.scheduleNotifications || {};
  if (notifications.enabled === false) return false;
  if (notifications.reminderSent === true || notifications.reminderStatus === 'sent') return false;
  if (notifications.reminderStatus === 'sending') return false;
  if (event?.deleted === true || event?.isDeleted === true || event?.deletedAt) return false;

  const status = String(event?.status || '').toLowerCase();
  if (status === 'cancelled' || status === 'canceled' || status === 'deleted') return false;

  const eventDate = coerceDate(event?.date);
  if (!eventDate || eventDate <= now) return false;

  const dueAt = getReminderDueAt(event);
  return Boolean(dueAt && dueAt <= now);
}

function buildPreEventReminderPayload({ teamId, gameId, event }) {
  const eventTitle = getEventTitle(event);
  const eventDate = coerceDate(event?.date);
  const dateText = eventDate
    ? eventDate.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: event?.timeZone || 'UTC'
    })
    : 'soon';
  const location = String(event?.location || '').trim();
  const bodyParts = [`${eventTitle} is coming up ${dateText}.`];
  if (location) bodyParts.push(`Location: ${location}`);
  const link = gameId
    ? `https://allplays.ai/game-day.html?teamId=${encodeURIComponent(teamId)}&gameId=${encodeURIComponent(gameId)}`
    : `https://allplays.ai/team.html?teamId=${encodeURIComponent(teamId)}`;

  return {
    title: 'Upcoming team event',
    body: bodyParts.join(' '),
    link,
    chatText: [
      'Schedule reminder: Upcoming team event',
      ...bodyParts
    ].join('\n')
  };
}

function getPreEventReminderChatMessageId(gameId, event) {
  const dueAt = getReminderDueAt(event);
  const rawId = [
    String(gameId || 'event'),
    dueAt ? dueAt.toISOString() : 'due'
  ].join('-');
  const normalizedId = rawId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 180);
  return `pre-event-reminder-${normalizedId}`;
}

async function postPreEventReminderChatMessage({ teamId, gameId, event, payload }) {
  const messageId = getPreEventReminderChatMessageId(gameId, event);
  const messageRef = firestore.doc(`teams/${teamId}/chatMessages/${messageId}`);
  const existing = await messageRef.get();
  if (existing.exists) {
    return { messageId, created: false };
  }

  await messageRef.set({
    text: payload.chatText || payload.body,
    senderId: 'scheduled-reminder',
    senderName: 'ALL PLAYS',
    senderEmail: null,
    senderPhotoUrl: null,
    attachments: [],
    imageUrl: null,
    imagePath: null,
    imageName: null,
    imageType: null,
    imageSize: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    editedAt: null,
    deleted: false,
    ai: false,
    aiName: null,
    aiQuestion: null,
    aiMeta: {
      type: 'pre-event-reminder',
      teamId,
      gameId,
      link: payload.link
    },
    targetType: 'full_team',
    recipientIds: [],
    targetRole: null,
    conversationId: null
  });

  return { messageId, created: true };
}

function isPreEventReminderChatMessage(data) {
  return data?.aiMeta?.type === 'pre-event-reminder' || data?.senderId === 'scheduled-reminder';
}

async function markReminderSending(eventRef, claimId, now) {
  return firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(eventRef);
    if (!snap.exists) return null;
    const event = snap.data() || {};
    if (!isEligibleForPreEventReminder(event, now)) return null;
    transaction.update(eventRef, {
      'scheduleNotifications.reminderStatus': 'sending',
      'scheduleNotifications.claimId': claimId,
      'scheduleNotifications.sendingAt': admin.firestore.FieldValue.serverTimestamp()
    });
    return event;
  });
}

async function markReminderSent(eventRef, claimId, sendResult) {
  await eventRef.update({
    'scheduleNotifications.reminderStatus': 'sent',
    'scheduleNotifications.reminderSent': true,
    'scheduleNotifications.reminderSentAt': admin.firestore.FieldValue.serverTimestamp(),
    'scheduleNotifications.sentAt': admin.firestore.FieldValue.serverTimestamp(),
    'scheduleNotifications.nextReminderAt': admin.firestore.FieldValue.delete(),
    'scheduleNotifications.lastSentAt': admin.firestore.FieldValue.serverTimestamp(),
    'scheduleNotifications.lastAction': 'pre_event_reminder',
    'scheduleNotifications.claimId': claimId,
    'scheduleNotifications.pushSuccessCount': Number(sendResult?.successCount || 0),
    'scheduleNotifications.pushFailureCount': Number(sendResult?.failureCount || 0),
    'scheduleNotifications.chatMessageId': sendResult?.chatMessageId || null,
    'scheduleNotifications.chatMessageCreated': sendResult?.chatMessageCreated === true,
    'scheduleNotifications.chatMessageError': sendResult?.chatMessageError
      ? sendResult.chatMessageError
      : admin.firestore.FieldValue.delete(),
    'scheduleNotifications.rsvpEmailCount': Number(sendResult?.rsvpEmailCount || 0)
  });
}

async function markReminderPendingAfterFailure(eventRef, claimId, error) {
  await eventRef.update({
    'scheduleNotifications.reminderStatus': 'pending',
    'scheduleNotifications.claimId': claimId,
    'scheduleNotifications.lastError': error?.message || 'Unknown reminder push error',
    'scheduleNotifications.lastAttemptAt': admin.firestore.FieldValue.serverTimestamp()
  });
}

async function dispatchDuePreEventReminders(now = new Date()) {
  const dueIso = now.toISOString();
  const dueSnap = await firestore
    .collectionGroup('games')
    .where('scheduleNotifications.nextReminderAt', '<=', dueIso)
    .limit(50)
    .get();

  const results = [];
  for (const docSnap of dueSnap.docs) {
    const eventRef = docSnap.ref;
    const teamRef = eventRef.parent?.parent;
    const teamId = teamRef?.id;
    const gameId = eventRef.id;
    if (!teamId) continue;

    const claimId = `pre-event-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const claimedEvent = await markReminderSending(eventRef, claimId, now);
    if (!claimedEvent) continue;

    try {
      const payload = buildPreEventReminderPayload({ teamId, gameId, event: claimedEvent });
      let chatResult = { messageId: null, created: false };
      let chatMessageError = null;
      try {
        chatResult = await postPreEventReminderChatMessage({ teamId, gameId, event: claimedEvent, payload });
      } catch (chatError) {
        chatMessageError = chatError;
        console.error('Failed to write pre-event reminder chat fallback', { teamId, gameId, error: chatError });
      }

      const sendResult = await sendCategoryNotification({
        teamId,
        gameId,
        category: 'schedule',
        title: payload.title,
        body: payload.body,
        linkOverride: payload.link
      });
      const emailResult = await createPublicRsvpEmailDeliveries({
        teamId,
        gameId,
        actorUid: 'scheduled-reminder'
      });
      await markReminderSent(eventRef, claimId, {
        ...sendResult,
        chatMessageId: chatResult.messageId,
        chatMessageCreated: chatResult.created,
        chatMessageError: chatMessageError?.message || null,
        rsvpEmailCount: emailResult.sentCount
      });
      results.push({
        teamId,
        gameId,
        sent: Number(sendResult?.successCount || 0),
        chatMessageId: chatResult.messageId,
        chatMessageCreated: chatResult.created,
        rsvpEmailCount: emailResult.sentCount
      });
    } catch (error) {
      await markReminderPendingAfterFailure(eventRef, claimId, error);
      console.error('Failed to dispatch pre-event reminder', { teamId, gameId, error });
    }
  }
  return results;
}

exports.dispatchDuePreEventReminders = functions.pubsub
  .schedule('every 15 minutes')
  .onRun(() => dispatchDuePreEventReminders());

exports.notifyTeamChatMessageCreated = functions.firestore
  .document('teams/{teamId}/chatMessages/{messageId}')
  .onCreate(async (snapshot, context) => {
    const data = snapshot.data() || {};
    const text = String(data.text || '').trim();
    const imageUrl = String(data.imageUrl || '').trim();
    if (!text && !imageUrl) return null;
    if (isPreEventReminderChatMessage(data)) return null;

    const teamId = context.params.teamId;
    const actorUid = data.senderId || null;
    const senderName = String(data.senderName || 'Team').trim();
    const body = text
      ? (text.length > 120 ? `${text.slice(0, 117)}...` : text)
      : 'sent a photo';

    return sendCategoryNotification({
      teamId,
      category: 'liveChat',
      title: `${senderName}: Team Chat`,
      body,
      actorUid
    });
  });

async function requireTeamEmailSender(teamId, context) {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in to send team email.');
  }
  const [teamSnap, userSnap] = await Promise.all([
    firestore.doc(`teams/${teamId}`).get(),
    firestore.doc(`users/${context.auth.uid}`).get()
  ]);
  if (!teamSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Team not found.');
  }
  const team = teamSnap.data() || {};
  const user = userSnap.exists ? userSnap.data() || {} : {};
  const callerEmail = String(context.auth.token?.email || '').trim().toLowerCase();
  const adminEmails = Array.isArray(team.adminEmails)
    ? team.adminEmails.map((email) => String(email || '').trim().toLowerCase())
    : [];
  const canSend = team.ownerId === context.auth.uid ||
    adminEmails.includes(callerEmail) ||
    user.isAdmin === true;
  if (!canSend) {
    throw new functions.https.HttpsError('permission-denied', 'Only team coaches and admins can send team email.');
  }
  return { team, user, callerEmail };
}

exports.sendTeamEmail = functions.https.onCall(async (data, context) => {
  const teamId = normalizeText(data?.teamId, 160);
  const draftId = normalizeText(data?.draftId, 160);
  let subject = normalizeText(data?.subject, 160);
  let body = normalizeText(data?.body, 20000);
  let targetType = ['full_team', 'staff', 'individuals'].includes(data?.targetType) ? data.targetType : 'full_team';
  let recipientIds = Array.isArray(data?.recipientIds) ? data.recipientIds : [];

  if (!teamId) {
    throw new functions.https.HttpsError('invalid-argument', 'Team is required.');
  }

  const { team, user } = await requireTeamEmailSender(teamId, context);
  if (draftId) {
    const draftSnap = await firestore.doc(`teams/${teamId}/teamEmailDrafts/${draftId}`).get();
    if (!draftSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Email draft not found.');
    }
    const draft = draftSnap.data() || {};
    subject = subject || normalizeText(draft.subject, 160);
    body = body || normalizeText(draft.body, 20000);
    targetType = ['full_team', 'staff', 'individuals'].includes(draft.targetType) ? draft.targetType : targetType;
    recipientIds = Array.isArray(draft.recipientIds) && draft.recipientIds.length > 0 ? draft.recipientIds : recipientIds;
  }

  if (!subject || !body) {
    throw new functions.https.HttpsError('invalid-argument', 'Subject and message are required.');
  }
  if (targetType === 'individuals' && recipientIds.length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Select at least one recipient.');
  }

  const [playersSnap, ownerSnap] = await Promise.all([
    firestore.collection(`teams/${teamId}/players`).get(),
    team.ownerId ? firestore.doc(`users/${team.ownerId}`).get() : Promise.resolve(null)
  ]);
  const players = playersSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
  const ownerUser = ownerSnap?.exists ? ownerSnap.data() || {} : null;
  const recipients = resolveTeamEmailRecipients({ targetType, recipientIds, players, team, ownerUser });
  if (recipients.length === 0) {
    throw new functions.https.HttpsError('failed-precondition', 'No email-enabled recipients were found for that audience.');
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const messageRef = firestore.collection(`teams/${teamId}/teamEmails`).doc();
  const mailJobs = recipients.map((recipient) => ({
    ref: firestore.collection('mail').doc(),
    recipient,
    payload: buildTeamEmailMailJob({
      email: recipient.email,
      subject,
      body,
      teamId,
      messageId: messageRef.id,
      senderUid: context.auth.uid
    })
  }));
  const messagePayload = {
    subject,
    body,
    status: 'sent',
    immutable: true,
    targetType,
    draftId: draftId || null,
    recipientCount: recipients.length,
    recipientSummary: recipients.map((recipient) => ({
      playerIds: recipient.playerIds,
      userIds: recipient.userIds,
      roles: recipient.roles
    })),
    senderId: context.auth.uid,
    senderName: user.fullName || context.auth.token?.name || null,
    senderEmail: context.auth.token?.email || null,
    sentAt: now,
    createdAt: now,
    delivery: {
      provider: 'firestore-mail',
      status: 'queued',
      jobCount: mailJobs.length,
      jobIds: mailJobs.map((job) => job.ref.id)
    }
  };

  const chunks = [];
  for (let i = 0; i < mailJobs.length; i += 400) {
    chunks.push(mailJobs.slice(i, i + 400));
  }
  const firstBatch = firestore.batch();
  firstBatch.set(messageRef, messagePayload);
  if (draftId) {
    firstBatch.set(firestore.doc(`teams/${teamId}/teamEmailDrafts/${draftId}`), {
      status: 'sent',
      sentMessageId: messageRef.id,
      sentAt: now,
      updatedAt: now
    }, { merge: true });
  }
  chunks.shift().forEach((job) => {
    firstBatch.set(job.ref, {
      ...job.payload,
      createdAt: now
    });
  });
  await firstBatch.commit();
  try {
    for (const chunk of chunks) {
      const batch = firestore.batch();
      chunk.forEach((job) => batch.set(job.ref, { ...job.payload, createdAt: now }));
      await batch.commit();
    }
  } catch (error) {
    await messageRef.set({
      status: 'partial_failed',
      delivery: {
        ...messagePayload.delivery,
        status: 'partial_failed',
        errorMessage: String(error?.message || 'Some mail jobs could not be queued.')
      }
    }, { merge: true });
    throw new functions.https.HttpsError('internal', 'Some email delivery jobs could not be queued. Check sent history for partial failure details.');
  }

  return {
    messageId: messageRef.id,
    status: 'sent',
    recipientCount: recipients.length,
    delivery: messagePayload.delivery
  };
});

exports.notifyGameUpdated = functions.firestore
  .document('teams/{teamId}/games/{gameId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    const category = detectGameNotificationCategory(before, after);
    if (!category) return null;

    const teamId = context.params.teamId;
    const gameId = context.params.gameId;
    const actorUid = after.updatedBy || null;

    if (category === 'liveScore') {
      return sendCategoryNotification({
        teamId,
        gameId,
        category,
        title: 'Live score update',
        body: `Score is now ${toNumericScore(after.homeScore)}-${toNumericScore(after.awayScore)}`,
        actorUid
      });
    }

    return sendCategoryNotification({
      teamId,
      gameId,
      category,
      title: 'Schedule update',
      body: 'A team event was updated. Tap to review the latest details.',
      actorUid
    });
  });

const PUBLIC_RSVP_TOKEN_TTL_DAYS = 14;
const PUBLIC_RSVP_RESPONSES = new Set(['going', 'maybe', 'not_going']);

function writePublicRsvpCors(req, res) {
  const allowedOrigins = new Set([
    'https://allplays.ai',
    'https://pauljsnider.github.io',
    'http://localhost:8000',
    'http://127.0.0.1:8000',
    'http://localhost:8004',
    'http://127.0.0.1:8004'
  ]);
  const origin = req.headers.origin;
  if (allowedOrigins.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
}

function publicRsvpJsonError(res, status, error) {
  res.status(status).json({ ok: false, error });
}

function normalizePublicRsvpResponse(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return PUBLIC_RSVP_RESPONSES.has(normalized) ? normalized : '';
}

function normalizePublicRsvpEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePublicRsvpText(value) {
  return String(value || '').trim();
}

function publicRsvpHashToken(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function createPublicRsvpToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function coercePublicRsvpDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatPublicRsvpDate(value) {
  const date = coercePublicRsvpDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  }).format(date);
}

function buildPublicRsvpBaseUrl() {
  const { appUrl } = getStripeConfig();
  return String(appUrl || 'https://allplays.ai').replace(/\/$/, '');
}

async function requirePublicRsvpAdmin(req) {
  const authHeader = String(req.headers.authorization || '');
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before sending RSVP email reminders.');
  }
  return admin.auth().verifyIdToken(match[1]);
}

function publicRsvpUserCanManageTeam({ team, user, uid, email }) {
  const normalizedEmail = normalizePublicRsvpEmail(email);
  const adminEmails = Array.isArray(team?.adminEmails) ? team.adminEmails.map(normalizePublicRsvpEmail) : [];
  return user?.isAdmin === true || team?.ownerId === uid || (normalizedEmail && adminEmails.includes(normalizedEmail));
}

function getPublicRsvpParentContacts(player) {
  const parents = Array.isArray(player?.parents) ? player.parents : [];
  const contacts = parents.map((parent) => ({
    name: normalizePublicRsvpText(parent?.name || parent?.displayName || parent?.relation),
    email: normalizePublicRsvpEmail(parent?.email),
    userId: normalizePublicRsvpText(parent?.userId || parent?.uid)
  })).filter((contact) => contact.email);

  const directEmail = normalizePublicRsvpEmail(player?.parentEmail || player?.guardianEmail);
  if (directEmail && !contacts.some((contact) => contact.email === directEmail)) {
    contacts.push({
      name: normalizePublicRsvpText(player?.parentName || player?.guardianName),
      email: directEmail,
      userId: normalizePublicRsvpText(player?.parentUserId || player?.guardianUserId)
    });
  }
  return contacts;
}

function getPublicRsvpPlayerIds(rsvp) {
  const ids = Array.isArray(rsvp?.playerIds) ? rsvp.playerIds : [rsvp?.playerId, rsvp?.childId];
  return ids.map((value) => String(value || '').trim()).filter(Boolean);
}

function publicRsvpIsResponded(response) {
  return PUBLIC_RSVP_RESPONSES.has(String(response || '').trim());
}

function getPublicRsvpResponseSortMs(rsvp, docSnap) {
  const respondedAt = coercePublicRsvpDate(rsvp?.respondedAt || rsvp?.updatedAt || rsvp?.createdAt);
  if (respondedAt) return respondedAt.getTime();
  const updateTime = coercePublicRsvpDate(docSnap?.updateTime);
  return updateTime ? updateTime.getTime() : 0;
}

async function loadPublicRsvpEvent(teamId, gameId) {
  const gameSnap = await firestore.doc(`teams/${teamId}/games/${gameId}`).get();
  if (gameSnap.exists) return { id: gameSnap.id, path: `teams/${teamId}/games/${gameId}`, data: gameSnap.data() || {} };

  const [masterId] = String(gameId || '').split('__');
  if (masterId && masterId !== gameId) {
    const masterSnap = await firestore.doc(`teams/${teamId}/games/${masterId}`).get();
    if (masterSnap.exists) return { id: gameId, path: `teams/${teamId}/games/${masterId}`, data: masterSnap.data() || {} };
  }
  return null;
}

async function buildPublicRsvpSummary(teamId, gameId) {
  const [playersSnap, rsvpsSnap] = await Promise.all([
    firestore.collection(`teams/${teamId}/players`).get(),
    firestore.collection(`teams/${teamId}/games/${gameId}/rsvps`).get()
  ]);
  const activePlayerIds = new Set();
  playersSnap.forEach((docSnap) => {
    const player = docSnap.data() || {};
    if (player.active !== false) activePlayerIds.add(docSnap.id);
  });

  const responsesByPlayerId = new Map();
  const summary = { going: 0, maybe: 0, notGoing: 0, notResponded: 0 };
  rsvpsSnap.forEach((docSnap) => {
    const rsvp = docSnap.data() || {};
    const response = normalizePublicRsvpResponse(rsvp.response);
    if (!response) return;
    const playerIds = getPublicRsvpPlayerIds(rsvp).filter((playerId) => activePlayerIds.has(playerId));
    const respondedAtMs = getPublicRsvpResponseSortMs(rsvp, docSnap);
    playerIds.forEach((playerId) => {
      const existing = responsesByPlayerId.get(playerId);
      if (!existing || respondedAtMs >= existing.respondedAtMs) {
        responsesByPlayerId.set(playerId, { response, respondedAtMs });
      }
    });
  });
  responsesByPlayerId.forEach(({ response }) => {
    if (response === 'going') summary.going += 1;
    if (response === 'maybe') summary.maybe += 1;
    if (response === 'not_going') summary.notGoing += 1;
  });
  summary.notResponded = Math.max(activePlayerIds.size - responsesByPlayerId.size, 0);
  return summary;
}

async function getPublicRsvpTokenData(token) {
  const tokenHash = publicRsvpHashToken(token);
  const tokenRef = firestore.doc(`publicRsvpTokens/${tokenHash}`);
  const tokenSnap = await tokenRef.get();
  if (!tokenSnap.exists) return { tokenHash, tokenRef, tokenData: null };
  return { tokenHash, tokenRef, tokenData: tokenSnap.data() || {} };
}

async function assertUsablePublicRsvpToken(tokenData) {
  if (!tokenData || tokenData.revoked === true || tokenData.disabled === true) {
    throw new Error('Invalid RSVP link.');
  }
  const expiresAt = coercePublicRsvpDate(tokenData.expiresAt);
  if (expiresAt && expiresAt <= new Date()) {
    throw new Error('This RSVP link has expired.');
  }
  const [teamSnap, eventRecord, playerSnap] = await Promise.all([
    firestore.doc(`teams/${tokenData.teamId}`).get(),
    loadPublicRsvpEvent(tokenData.teamId, tokenData.gameId),
    firestore.doc(`teams/${tokenData.teamId}/players/${tokenData.playerId}`).get()
  ]);
  if (!teamSnap.exists || !eventRecord || !playerSnap.exists) {
    throw new Error('Invalid RSVP link.');
  }
  const player = playerSnap.data() || {};
  if (player.active === false) {
    throw new Error('Invalid RSVP link.');
  }
  return { team: teamSnap.data() || {}, event: eventRecord.data, player };
}

function buildPublicRsvpContext({ team, event, player }) {
  return {
    teamName: normalizePublicRsvpText(team.name || 'Team'),
    eventTitle: normalizePublicRsvpText(event.title || event.opponent || 'Team event'),
    eventType: normalizePublicRsvpText(event.type || 'game'),
    eventDateLabel: formatPublicRsvpDate(event.date),
    location: normalizePublicRsvpText(event.location),
    childName: normalizePublicRsvpText(player.name || player.displayName || 'Player'),
    childNumber: normalizePublicRsvpText(player.number || player.jerseyNumber || '')
  };
}

function buildPublicRsvpEmailText({ context, links }) {
  const lines = [
    `RSVP needed: ${context.eventTitle}`,
    '',
    `${context.childName}${context.childNumber ? ` #${context.childNumber}` : ''}`,
    context.eventDateLabel ? `When: ${context.eventDateLabel}` : '',
    context.location ? `Where: ${context.location}` : '',
    '',
    `Going: ${links.going}`,
    `Maybe: ${links.maybe}`,
    `Can't Go: ${links.not_going}`
  ].filter((line) => line !== '');
  return lines.join('\n');
}

function buildPublicRsvpEmailHtml({ context, links }) {
  const esc = (value) => String(value || '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const link = (label, url) => `<a href="${esc(url)}" style="display:inline-block;margin:6px 8px 6px 0;padding:10px 14px;border-radius:8px;background:#4f46e5;color:#fff;text-decoration:none;font-weight:700;">${esc(label)}</a>`;
  return `<p>RSVP needed for <strong>${esc(context.eventTitle)}</strong>.</p>
<p>${esc(context.childName)}${context.childNumber ? ` #${esc(context.childNumber)}` : ''}</p>
${context.eventDateLabel ? `<p><strong>When:</strong> ${esc(context.eventDateLabel)}</p>` : ''}
${context.location ? `<p><strong>Where:</strong> ${esc(context.location)}</p>` : ''}
<p>${link('Going', links.going)}${link('Maybe', links.maybe)}${link("Can't Go", links.not_going)}</p>`;
}


async function createPublicRsvpEmailDeliveries({ teamId, gameId, actorUid = null } = {}) {
  const [teamSnap, eventRecord, playersSnap, rsvpsSnap] = await Promise.all([
    firestore.doc(`teams/${teamId}`).get(),
    loadPublicRsvpEvent(teamId, gameId),
    firestore.collection(`teams/${teamId}/players`).get(),
    firestore.collection(`teams/${teamId}/games/${gameId}/rsvps`).get()
  ]);
  if (!teamSnap.exists || !eventRecord) {
    throw new Error('Event not found.');
  }

  const respondedPlayerIds = new Set();
  rsvpsSnap.forEach((docSnap) => {
    const rsvp = docSnap.data() || {};
    if (!publicRsvpIsResponded(rsvp.response)) return;
    getPublicRsvpPlayerIds(rsvp).forEach((playerId) => respondedPlayerIds.add(playerId));
  });

  const team = teamSnap.data() || {};
  const baseUrl = buildPublicRsvpBaseUrl();
  const expiresAt = admin.firestore.Timestamp.fromDate(new Date(Date.now() + PUBLIC_RSVP_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000));
  const batch = firestore.batch();
  let sentCount = 0;
  let linkCount = 0;

  playersSnap.forEach((docSnap) => {
    const player = { id: docSnap.id, ...(docSnap.data() || {}) };
    if (player.active === false || respondedPlayerIds.has(player.id)) return;
    getPublicRsvpParentContacts(player).forEach((contact) => {
      const rawToken = createPublicRsvpToken();
      const tokenHash = publicRsvpHashToken(rawToken);
      const context = buildPublicRsvpContext({ team, event: eventRecord.data, player });
      const links = {
        going: `${baseUrl}/public-rsvp.html?token=${encodeURIComponent(rawToken)}&response=going`,
        maybe: `${baseUrl}/public-rsvp.html?token=${encodeURIComponent(rawToken)}&response=maybe`,
        not_going: `${baseUrl}/public-rsvp.html?token=${encodeURIComponent(rawToken)}&response=not_going`
      };
      batch.set(firestore.doc(`publicRsvpTokens/${tokenHash}`), {
        teamId,
        gameId,
        playerId: player.id,
        parentEmail: contact.email,
        parentUserId: contact.userId || null,
        parentName: contact.name || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        expiresAt,
        createdBy: actorUid,
        revoked: false
      });
      batch.set(firestore.collection('mail').doc(), {
        to: [contact.email],
        message: {
          subject: `RSVP: ${context.eventTitle}`,
          text: buildPublicRsvpEmailText({ context, links }),
          html: buildPublicRsvpEmailHtml({ context, links })
        },
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        metadata: { teamId, gameId, playerId: player.id, type: 'public_rsvp' }
      });
      sentCount += 1;
      linkCount += 3;
    });
  });

  if (sentCount > 0) {
    await batch.commit();
  }
  return { sentCount, linkCount };
}

exports.sendPublicRsvpEmails = functions.https.onRequest(async (req, res) => {
  writePublicRsvpCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    publicRsvpJsonError(res, 405, 'Method not allowed');
    return;
  }

  try {
    const tokenData = await requirePublicRsvpAdmin(req);
    const teamId = normalizePublicRsvpText(req.body?.teamId);
    const gameId = normalizePublicRsvpText(req.body?.gameId);
    if (!teamId || !gameId) {
      publicRsvpJsonError(res, 400, 'Missing team or event.');
      return;
    }

    const [teamSnap, eventRecord, userSnap] = await Promise.all([
      firestore.doc(`teams/${teamId}`).get(),
      loadPublicRsvpEvent(teamId, gameId),
      firestore.doc(`users/${tokenData.uid}`).get()
    ]);
    if (!teamSnap.exists || !eventRecord) {
      publicRsvpJsonError(res, 404, 'Event not found.');
      return;
    }
    const team = teamSnap.data() || {};
    const user = userSnap.exists ? userSnap.data() || {} : {};
    if (!publicRsvpUserCanManageTeam({ team, user, uid: tokenData.uid, email: tokenData.email })) {
      publicRsvpJsonError(res, 403, 'You do not have permission to send RSVP emails for this team.');
      return;
    }

    const result = await createPublicRsvpEmailDeliveries({
      teamId,
      gameId,
      actorUid: tokenData.uid
    });
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error('Failed to send public RSVP emails:', error);
    publicRsvpJsonError(res, error?.code === 'auth/argument-error' ? 401 : 500, error?.message || 'RSVP email delivery failed.');
  }
});

exports.getPublicRsvp = functions.https.onRequest(async (req, res) => {
  writePublicRsvpCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'GET') {
    publicRsvpJsonError(res, 405, 'Method not allowed');
    return;
  }

  try {
    const token = normalizePublicRsvpText(req.query?.token);
    if (!token) {
      publicRsvpJsonError(res, 400, 'Missing RSVP link token.');
      return;
    }
    const { tokenData } = await getPublicRsvpTokenData(token);
    const records = await assertUsablePublicRsvpToken(tokenData);
    res.status(200).json({ ok: true, context: buildPublicRsvpContext(records) });
  } catch (error) {
    publicRsvpJsonError(res, 403, error?.message || 'Invalid RSVP link.');
  }
});

exports.submitPublicRsvp = functions.https.onRequest(async (req, res) => {
  writePublicRsvpCors(req, res);
  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }
  if (req.method !== 'POST') {
    publicRsvpJsonError(res, 405, 'Method not allowed');
    return;
  }

  try {
    const token = normalizePublicRsvpText(req.body?.token);
    const response = normalizePublicRsvpResponse(req.body?.response);
    if (!token || !response) {
      publicRsvpJsonError(res, 400, 'Choose Going, Maybe, or Can\'t Go.');
      return;
    }
    const { tokenHash, tokenData } = await getPublicRsvpTokenData(token);
    const records = await assertUsablePublicRsvpToken(tokenData);
    const docId = `public_${tokenHash.slice(0, 24)}`;
    await firestore.doc(`teams/${tokenData.teamId}/games/${tokenData.gameId}/rsvps/${docId}`).set({
      userId: docId,
      displayName: tokenData.parentName || tokenData.parentEmail || 'Parent RSVP',
      playerIds: [tokenData.playerId],
      response,
      note: null,
      publicRsvp: true,
      parentEmail: tokenData.parentEmail || null,
      respondedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    const summary = await buildPublicRsvpSummary(tokenData.teamId, tokenData.gameId);
    await firestore.doc(`teams/${tokenData.teamId}/games/${tokenData.gameId}`).set({ rsvpSummary: summary }, { merge: true });
    await firestore.doc(`publicRsvpTokens/${tokenHash}`).set({
      lastSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastResponse: response
    }, { merge: true });
    res.status(200).json({ ok: true, context: buildPublicRsvpContext(records), summary });
  } catch (error) {
    publicRsvpJsonError(res, 403, error?.message || 'Unable to submit RSVP.');
  }
});

exports.collectTelemetry = functions
  .runWith({ timeoutSeconds: 15, memory: '256MB' })
  .https
  .onRequest(async (req, res) => {
    writeCorsHeaders(req, res, 'POST,OPTIONS');

    if (!isAllowedTelemetryOrigin(req.headers.origin)) {
      res.status(403).json({ ok: false, error: 'Origin not allowed' });
      return;
    }

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'Method not allowed' });
      return;
    }

    const rawSize = Number(req.headers['content-length'] || 0);
    if (rawSize > 64 * 1024) {
      res.status(413).json({ ok: false, error: 'Telemetry payload too large' });
      return;
    }

    try {
      const payload = parseTelemetryBody(req);
      const verifiedAuth = await verifyTelemetryAuth(req, payload);
      const rawEvents = Array.isArray(payload?.events)
        ? payload.events.slice(0, MAX_TELEMETRY_EVENTS_PER_REQUEST)
        : [];
      if (!rawEvents.length) {
        res.status(400).json({ ok: false, error: 'No telemetry events provided' });
        return;
      }

      const receivedAt = new Date();
      const dateKey = getDateKey(receivedAt);
      const events = rawEvents
        .map((event) => normalizeTelemetryEvent(event, receivedAt, verifiedAuth?.uid || null))
        .filter(Boolean);

      if (!events.length) {
        res.status(400).json({ ok: false, error: 'No valid telemetry events provided' });
        return;
      }

      const db = admin.firestore();
      await commitTelemetryEvents(db, events, dateKey);
      res.status(204).send('');
    } catch (error) {
      console.error('Telemetry collection failed:', error);
      res.status(400).json({
        ok: false,
        error: error?.message || 'Telemetry collection failed'
      });
    }
  });
