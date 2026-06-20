const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Stripe = require('stripe');
const crypto = require('node:crypto');
const { isPrivateIpAddress, isBlockedHostname, assertPublicHost, normalizeTargetUrl, fetchWithTimeout } = require('./utils/security-utils');
const { createCalendarIcsCache, fetchCalendarIcsWithCache } = require('./calendar-ics-fetch-core.cjs');
const {
  normalizeTeamPassCheckoutInput,
  isEligibleTeamPassPurchaser,
  shouldUnlockTeamPassFromEvent,
  buildTeamPassEntitlement
} = require('./team-pass-core.cjs');
const {
  normalizeTeamFeeCheckoutInput,
  normalizeTeamFeeRefundInput,
  getTeamFeeBalanceCents,
  getTeamFeeRefundableCents,
  isTeamFeeCheckoutEligible,
  isEligibleTeamFeePayer,
  getTeamFeeRecipientTargetUserIds,
  buildTeamFeeCheckoutUrls,
  buildTeamFeeCheckoutMetadata,
  canReuseTeamFeeCheckoutSession,
  getTeamFeeCheckoutGuardFailure,
  shouldApplyTeamFeeCheckoutSession,
  shouldMarkTeamFeePaidFromEvent,
  shouldRecordTeamFeeCheckoutNotPaidFromEvent,
  getTeamFeeStripePaymentRefs,
  buildTeamFeePaidUpdate,
  buildTeamFeeStripeRefundUpdate
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
const {
  normalizeEmail,
  normalizeAccountMergePreviewInput,
  hashAccountMergeVerificationToken,
  validateAccountMergeVerificationRecord,
  assertNotSelfMerge,
  buildAccountMergePreview,
  buildMergedParentAccount,
  buildMergedPlayerParents,
  findDuplicateParentUserIds,
  isVerifiedAccountMergeRequest,
  mergePreferenceObjects
} = require('./account-merge-core.cjs');
const {
  REGISTRATION_PAYMENT_REMINDER_CADENCE_DAYS,
  buildQueuedReminderAuditEntry,
  buildRegistrationFailedPaymentReminderState,
  buildRegistrationPaymentReminderMailDocId,
  buildRegistrationPaymentReminderMessage,
  buildRegistrationPaymentRetryUrl,
  shouldStopRegistrationPaymentReminders
} = require('./registration-payment-reminders-core.cjs');
const { validateAccessCodeCandidates } = require('./access-code-validation.cjs');
const {
  PRE_EVENT_REMINDER_QUERY_PAGE_SIZE,
  PRE_EVENT_REMINDER_MAX_PAGES_PER_RUN,
  PRE_EVENT_REMINDER_MAX_RUNTIME_MS,
  drainDueReminderPages
} = require('./pre-event-reminder-dispatcher-core.cjs');
const {
  NOTIFICATION_CATEGORIES,
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationTargetCategories,
  hasEnabledNotificationCategory,
  buildNotificationTargetDocId,
  buildNotificationTargetPayload,
  notificationAudienceAllowsRoles
} = require('./notification-target-index-core.cjs');
const {
  NOTIFICATION_INBOX_MAX_ITEMS,
  buildNotificationInboxPayload,
  getUniqueNotificationInboxTargets,
  normalizeInboxId
} = require('./notification-inbox-core.cjs');
const {
  WEB_PUSH_NOTIFICATION_ASSETS,
  buildNotificationDeliveryOptions
} = require('./notification-delivery-metadata.cjs');
const {
  coerceDate,
  getEventTitle,
  formatScheduleUpdateDate
} = require('./schedule-notification-utils.cjs');

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const firestore = admin.firestore();
const TEAM_MEDIA_NOTIFICATION_BATCH_WINDOW_MS = 60 * 60 * 1000;
const TEAM_MEDIA_NOTIFICATION_DISPATCH_LIMIT = 50;
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

function buildTeamFeeAdminBillingRef(recipientRef, id) {
  const safeId = String(id || 'latest').trim().replace(/[^\w.-]+/g, '_').slice(0, 120);
  return recipientRef.collection('adminBilling').doc(safeId || 'latest');
}

function withTeamFeeParentBillingClears(update = {}) {
  return {
    ...update,
    stripePaymentIntentId: null,
    stripeCustomerId: null,
    stripeChargeId: null,
    stripeLastRefundId: null,
    stripeEventId: null,
    ...(update.receiptMetadata ? {
      receiptMetadata: {
        ...update.receiptMetadata,
        checkoutSessionId: null,
        paymentIntentId: null,
        receiptEmail: null,
        eventId: null
      }
    } : {})
  };
}

async function fetchTeamFeePaymentAdminBilling(recipientRef) {
  const latestSnap = await buildTeamFeeAdminBillingRef(recipientRef, 'latest').get();
  const latest = latestSnap.exists ? (latestSnap.data() || {}) : {};
  const latestRefs = getTeamFeeStripePaymentRefs(latest);
  if (latestRefs.paymentIntentId || latestRefs.chargeId) {
    return latest;
  }

  const querySnap = await recipientRef.collection('adminBilling')
    .where('type', '==', 'stripe_checkout_paid')
    .limit(10)
    .get();
  for (const doc of querySnap.docs) {
    const data = doc.data() || {};
    const refs = getTeamFeeStripePaymentRefs(data);
    if (refs.paymentIntentId || refs.chargeId) {
      return data;
    }
  }
  return {};
}

function buildTeamFeeRefundRequestId(input, uid) {
  const requested = String(input.refundRequestId || '').trim();
  if (requested) return requested;
  const suffix = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  return `refund_${uid}_${suffix}`.replace(/[^\w.-]+/g, '_').slice(0, 120);
}

function buildTeamFeeRefundIdempotencyKey(input, refundRequestId) {
  const hash = crypto.createHash('sha256')
    .update([input.teamId, input.batchId, input.recipientId, input.amountCents, refundRequestId].join('|'))
    .digest('hex');
  return `team_fee_refund_${hash}`;
}

function hasStripeRefundLedgerEntry(recipient = {}, refundId = '') {
  if (!refundId) return false;
  const ledger = Array.isArray(recipient.paymentLedger) ? recipient.paymentLedger : [];
  return ledger.some((entry) => (
    (entry?.type === 'stripe_refund' || entry?.type === 'online_refund') &&
    String(entry.stripeRefundId || '') === refundId
  ));
}

function normalizeFirestoreId(value, label) {
  const id = String(value || '').trim();
  if (!id || id.includes('/')) {
    throw new Error(`${label} is required.`);
  }
  return id;
}

function normalizeCheckoutAttemptToken(value, label = 'checkoutAttemptToken') {
  const token = String(value || '').trim();
  if (!token) return '';
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) {
    throw new Error(`${label} is invalid.`);
  }
  return token;
}

function normalizePublicCheckoutCapability(value, label = 'publicCheckoutCapability') {
  const capability = String(value || '').trim();
  if (!capability) return '';
  if (!/^[A-Za-z0-9_-]{24,160}$/.test(capability)) {
    throw new Error(`${label} is invalid.`);
  }
  return capability;
}

function createRawPublicCheckoutCapability() {
  return (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(24).toString('hex')).replace(/-/g, '');
}

function hashPublicCheckoutCapability(capability) {
  const normalizedCapability = normalizePublicCheckoutCapability(capability);
  if (!normalizedCapability) return '';
  return crypto.createHash('sha256').update(normalizedCapability).digest('hex');
}

function normalizeRegistrationCheckoutInput(data = {}) {
  const hasAmount = data.amount !== undefined || data.amountCents !== undefined;
  const amountCents = hasAmount ? Math.round(Number(data.amount ?? data.amountCents ?? 0)) : null;
  const currency = String(data.currency || '').trim().toLowerCase();
  if (hasAmount && (!Number.isFinite(amountCents) || amountCents <= 0)) {
    throw new Error('A positive checkout amount is required.');
  }
  if (currency && !/^[a-z]{3}$/.test(currency)) {
    throw new Error('A valid checkout currency is required.');
  }
  const publicCheckoutCapability = normalizePublicCheckoutCapability(data.publicCheckoutCapability);
  return {
    teamId: normalizeFirestoreId(data.teamId, 'teamId'),
    formId: normalizeFirestoreId(data.formId, 'formId'),
    registrationId: publicCheckoutCapability ? String(data.registrationId || '').trim() : normalizeFirestoreId(data.registrationId, 'registrationId'),
    amountCents,
    currency,
    checkoutAttemptToken: normalizeCheckoutAttemptToken(data.checkoutAttemptToken),
    publicCheckoutCapability,
    retryPayment: data.retryPayment === true || String(data.retryPayment || '').trim() === '1'
  };
}

function normalizeRegistrationCheckoutCancelInput(data = {}) {
  const publicCheckoutCapability = normalizePublicCheckoutCapability(data.publicCheckoutCapability);
  return {
    teamId: normalizeFirestoreId(data.teamId, 'teamId'),
    formId: normalizeFirestoreId(data.formId, 'formId'),
    registrationId: publicCheckoutCapability ? String(data.registrationId || '').trim() : normalizeFirestoreId(data.registrationId, 'registrationId'),
    checkoutAttemptToken: normalizeCheckoutAttemptToken(data.checkoutAttemptToken),
    publicCheckoutCapability
  };
}

function buildRegistrationRef({ teamId, formId, registrationId }) {
  return firestore.doc(`teams/${teamId}/registrationForms/${formId}/registrations/${registrationId}`);
}

function buildRegistrationFormRef({ teamId, formId }) {
  return firestore.doc(`teams/${teamId}/registrationForms/${formId}`);
}

function buildRegistrationReminderMailRef(mailDocId) {
  return firestore.collection('mail').doc(mailDocId);
}

function buildRegistrationCheckoutUrls(appUrl, input) {
  const baseUrl = String(appUrl || 'https://allplays.ai').replace(/\/$/, '');
  const params = new URLSearchParams({
    teamId: input.teamId,
    formId: input.formId
  });
  if (input.publicCheckoutCapability) {
    params.set('publicCheckoutCapability', input.publicCheckoutCapability);
  }
  if (input.retryPayment) {
    params.set('retryPayment', '1');
  }
  return {
    successUrl: `${baseUrl}/registration.html?${params.toString()}&status=success`,
    cancelUrl: `${baseUrl}/registration.html?${params.toString()}&status=cancelled`
  };
}

function isServerDiscountRuleEligible(rule, { now }) {
  if (rule.type === 'quantity') return true; // quantity discounts always apply (single registration = quantity 1 satisfies minimum >= 1)
  if (rule.type === 'early_bird') {
    const deadline = Date.parse(`${rule.earlyBirdDeadline}T23:59:59.999`);
    return Number.isFinite(deadline) && now.getTime() <= deadline;
  }
  return false;
}

function normalizeServerRegistrationDiscountRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((rule, index) => {
      const type = String(rule?.type || '').toLowerCase();
      const amountType = rule?.amountType === 'percent' ? 'percent' : 'fixed';
      const amountValue = Math.max(0, Number(rule?.amountValue || 0));
      if (!['early_bird', 'quantity'].includes(type) || amountValue <= 0) return null;
      return {
        id: String(rule?.id || `discount_${index + 1}`).trim(),
        type,
        amountType,
        amountValue,
        earlyBirdDeadline: String(rule?.earlyBirdDeadline || '').trim(),
        minimumQuantity: Math.max(1, Math.floor(Number(rule?.minimumQuantity || 1))),
        active: rule?.active !== false
      };
    })
    .filter(Boolean);
}

/**
 * Recompute the expected checkout amount from the authoritative form document.
 * This prevents clients from submitting a tampered feeSnapshot with a lower amount —
 * pricing authority lives in the server-fetched registrationForm, not in the
 * client-submitted registration document.
 */
function computeRegistrationFeeAmountCentsFromForm(form, now = new Date()) {
  const originalFeeAmountCents = Math.max(0, Math.round(Number(form.feeAmountCents || 0)));
  let remainingAmountCents = originalFeeAmountCents;
  normalizeServerRegistrationDiscountRules(form.discountRules || []).forEach((rule) => {
    if (!rule.active || !isServerDiscountRuleEligible(rule, { now })) return;
    let discountAmountCents;
    if (rule.amountType === 'percent') {
      const percentDiscountRate = rule.amountValue / 100;
      discountAmountCents = Math.round(remainingAmountCents * percentDiscountRate);
    } else {
      discountAmountCents = Math.round(rule.amountValue);
    }
    const appliedAmountCents = Math.min(remainingAmountCents, Math.max(0, discountAmountCents));
    if (appliedAmountCents <= 0) return;
    remainingAmountCents -= appliedAmountCents;
  });
  return Math.max(0, remainingAmountCents);
}

function getRegistrationCheckoutAmountCents(registration = {}, form = null) {
  if (form) {
    // Use the server-recomputed amount from the authoritative form document so
    // a tampered feeSnapshot stored on the registration cannot lower the charge.
    return computeRegistrationFeeAmountCentsFromForm(form);
  }
  return Math.max(0, Math.round(Number(registration.feeSnapshot?.finalAmountDueCents ?? registration.feeAmountCents ?? 0)));
}

function getRegistrationCustomerEmail(registration = {}) {
  const guardian = registration.guardian || {};
  return ['email', 'guardianEmail', 'parentEmail']
    .map((key) => String(guardian[key] || '').trim())
    .find(Boolean) || undefined;
}

function getRegistrationCheckoutAttemptToken(registration = {}) {
  return normalizeCheckoutAttemptToken(registration.checkoutAttemptToken);
}

function registrationCheckoutAttemptMatches(registration = {}, input = {}) {
  const registrationToken = getRegistrationCheckoutAttemptToken(registration);
  const inputToken = normalizeCheckoutAttemptToken(input.checkoutAttemptToken);
  return Boolean(registrationToken && inputToken && registrationToken === inputToken);
}

function registrationCheckoutAttemptStrictlyMatches(registration = {}, input = {}) {
  const registrationToken = getRegistrationCheckoutAttemptToken(registration);
  const inputToken = normalizeCheckoutAttemptToken(input.checkoutAttemptToken);
  return Boolean(registrationToken && inputToken && registrationToken === inputToken);
}

function registrationPublicCheckoutCapabilityMatches(registration = {}, input = {}) {
  const registrationCapabilityHash = String(registration.publicCheckoutCapabilityHash || '').trim();
  const inputCapabilityHash = hashPublicCheckoutCapability(input.publicCheckoutCapability);
  return Boolean(registrationCapabilityHash && inputCapabilityHash && registrationCapabilityHash === inputCapabilityHash);
}

function registrationCheckoutAuthorityMatches(registration = {}, input = {}) {
  return registrationPublicCheckoutCapabilityMatches(registration, input)
    || registrationCheckoutAttemptMatches(registration, input);
}

function registrationCheckoutAuthorityStrictlyMatches(registration = {}, input = {}) {
  return registrationPublicCheckoutCapabilityMatches(registration, input)
    || registrationCheckoutAttemptStrictlyMatches(registration, input);
}

function canReuseRegistrationCheckoutSession(registration = {}, amountCents, input = {}) {
  return Boolean(
    registration.checkoutUrl
    && registration.stripeCheckoutSessionId
    && registration.checkoutStatus === 'open'
    && Number(registration.checkoutAmountCents || 0) === amountCents
    && registrationCheckoutAuthorityMatches(registration, input)
  );
}

function buildRegistrationCheckoutMetadata({ input, registration }) {
  return {
    product: 'registration',
    teamId: input.teamId,
    formId: input.formId,
    registrationId: input.registrationId,
    checkoutAttemptToken: input.checkoutAttemptToken || '',
    publicCheckoutCapability: input.publicCheckoutCapability || '',
    selectedOptionId: String(registration.selectedOption?.id || ''),
    paymentPlanId: String(registration.paymentPlan?.id || '')
  };
}

function buildPublicCheckoutCapabilityError() {
  return new functions.https.HttpsError('failed-precondition', 'Public checkout capability is invalid or expired.');
}

async function resolveRegistrationCheckoutInput(input = {}) {
  if (!input.publicCheckoutCapability) {
    return {
      ...input,
      registrationRef: buildRegistrationRef(input)
    };
  }

  const capabilityHash = hashPublicCheckoutCapability(input.publicCheckoutCapability);
  const querySnap = await firestore.collectionGroup('registrations')
    .where('publicCheckoutCapabilityHash', '==', capabilityHash)
    .limit(2)
    .get();

  if (querySnap.empty || querySnap.size !== 1) {
    throw buildPublicCheckoutCapabilityError();
  }

  const registrationSnap = querySnap.docs[0];
  const pathParts = registrationSnap.ref.path.split('/');
  const resolvedTeamId = pathParts[1] || '';
  const resolvedFormId = pathParts[3] || '';
  const resolvedRegistrationId = pathParts[5] || registrationSnap.id;
  if ((input.teamId && input.teamId !== resolvedTeamId) || (input.formId && input.formId !== resolvedFormId)) {
    throw buildPublicCheckoutCapabilityError();
  }

  return {
    ...input,
    teamId: resolvedTeamId,
    formId: resolvedFormId,
    registrationId: resolvedRegistrationId,
    registrationRef: registrationSnap.ref,
    resolvedPublicCheckoutCapabilityHash: capabilityHash
  };
}

function shouldProcessRegistrationCheckoutEvent(event) {
  const session = event?.data?.object || {};
  return session.metadata?.product === 'registration'
    && ['checkout.session.completed', 'checkout.session.expired', 'checkout.session.async_payment_failed', 'checkout.session.async_payment_succeeded'].includes(event?.type);
}

function shouldMarkRegistrationPaidFromEvent(event) {
  const session = event?.data?.object || {};
  if (event?.type === 'checkout.session.async_payment_succeeded') {
    return session.metadata?.product === 'registration';
  }
  return event?.type === 'checkout.session.completed'
    && session.metadata?.product === 'registration'
    && session.payment_status === 'paid';
}

function isAsyncPaymentPending(session) {
  return ['open', 'unpaid'].includes(String(session?.payment_status || '').trim().toLowerCase());
}

function buildRegistrationRefFromStripeSession(session = {}) {
  const metadata = session.metadata || {};
  return buildRegistrationRef({
    teamId: normalizeFirestoreId(metadata.teamId, 'teamId'),
    formId: normalizeFirestoreId(metadata.formId, 'formId'),
    registrationId: normalizeFirestoreId(metadata.registrationId, 'registrationId')
  });
}

function buildRegistrationReminderMailJob({
  registration = {},
  form = {},
  retryUrl = '',
  reminderLabel,
  metadata = {}
} = {}) {
  const programName = registration.programName || form.programName || form.title || form.name || 'Program registration';
  const amountDueCents = getRegistrationCheckoutAmountCents(registration);
  const currency = registration.currency || 'USD';
  const message = buildRegistrationPaymentReminderMessage({
    programName,
    amountDueCents,
    currency,
    retryUrl,
    reminderLabel
  });
  return {
    to: [metadata.recipientEmail],
    message,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    metadata: {
      type: 'registration_failed_payment',
      teamId: metadata.teamId,
      formId: metadata.formId,
      registrationId: metadata.registrationId,
      reminderKind: metadata.reminderKind,
      reminderNumber: metadata.reminderNumber,
      stripeEventId: metadata.stripeEventId || null,
      retryUrl,
      amountDueCents,
      currency
    }
  };
}

function buildRegistrationReminderStopUpdate({ reason = 'resolved', nowIso = '' } = {}) {
  return {
    'paymentReminder.status': reason,
    'paymentReminder.resolvedAt': nowIso,
    'paymentReminder.nextReminderAt': admin.firestore.FieldValue.delete(),
    'paymentReminder.lastReminderKind': reason,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

async function queueDueRegistrationFailedPaymentReminders() {
  const now = new Date();
  const nowIso = now.toISOString();
  const { appUrl } = getStripeConfig();
  const dueSnap = await firestore.collectionGroup('registrations')
    .where('paymentReminder.nextReminderAt', '<=', nowIso)
    .limit(50)
    .get();

  const results = [];
  for (const docSnap of dueSnap.docs) {
    const registrationRef = docSnap.ref;
    let queued = false;
    await firestore.runTransaction(async (transaction) => {
      const freshSnap = await transaction.get(registrationRef);
      if (!freshSnap.exists) return;

      const registration = freshSnap.data() || {};
      const reminder = registration.paymentReminder || {};
      const nextReminderAt = String(reminder.nextReminderAt || '').trim();
      if (!nextReminderAt || nextReminderAt > nowIso) return;

      if (shouldStopRegistrationPaymentReminders(registration)) {
        transaction.update(registrationRef, buildRegistrationReminderStopUpdate({
          reason: registration.paymentStatus === 'paid' ? 'paid' : 'closed',
          nowIso
        }));
        return;
      }

      const recipientEmail = String(reminder.recipientEmail || getRegistrationCustomerEmail(registration) || '').trim().toLowerCase();
      if (!recipientEmail) {
        transaction.update(registrationRef, {
          'paymentReminder.status': 'missing_email',
          'paymentReminder.lastReminderKind': 'missing_email',
          'paymentReminder.nextReminderAt': admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        return;
      }

      const reminderNumber = Math.max(1, Number(reminder.reminderCount || 0) + 1);
      const registrationInput = {
        teamId: registration.teamId,
        formId: registration.formId,
        registrationId: registration.id || registrationRef.id,
        checkoutAttemptToken: registration.checkoutAttemptToken || ''
      };
      const mailDocId = buildRegistrationPaymentReminderMailDocId({
        teamId: registration.teamId,
        formId: registration.formId,
        registrationId: registration.id || registrationRef.id,
        eventId: reminder.lastEventId || 'manual',
        sequence: `followup_${reminderNumber}`
      });
      const retryUrl = String(reminder.retryUrl || '').trim() || buildRegistrationPaymentRetryUrl(appUrl, registrationInput);
      const form = {
        programName: registration.programName || 'Program registration'
      };
      const mailJob = buildRegistrationReminderMailJob({
        registration,
        form,
        retryUrl,
        reminderLabel: 'Your registration payment is still due.',
        metadata: {
          recipientEmail,
          teamId: registration.teamId,
          formId: registration.formId,
          registrationId: registration.id || registrationRef.id,
          reminderKind: 'followup',
          reminderNumber,
          stripeEventId: reminder.lastEventId || null
        }
      });

      transaction.set(buildRegistrationReminderMailRef(mailDocId), mailJob);
      transaction.update(registrationRef, {
        'paymentReminder.status': 'active',
        'paymentReminder.recipientEmail': recipientEmail,
        'paymentReminder.retryUrl': retryUrl,
        'paymentReminder.reminderCount': reminderNumber,
        'paymentReminder.lastQueuedAt': nowIso,
        'paymentReminder.lastMailId': mailDocId,
        'paymentReminder.lastReminderKind': 'followup',
        'paymentReminder.lastAudit': buildQueuedReminderAuditEntry({
          kind: 'followup',
          eventId: reminder.lastEventId || '',
          mailDocId,
          queuedAtIso: nowIso
        }),
        'paymentReminder.nextReminderAt': new Date(now.getTime() + REGISTRATION_PAYMENT_REMINDER_CADENCE_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      queued = true;
    });

    if (queued) {
      results.push(registrationRef.path);
    }
  }

  return results;
}

async function reserveRegistrationCheckoutCapacityForRetry(input, options = {}) {
  const formRef = buildRegistrationFormRef(input);
  const registrationRef = buildRegistrationRef(input);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const retryCapacityReservationId = String(options.retryCapacityReservationId || '').trim();

  return firestore.runTransaction(async (transaction) => {
    const [formSnap, registrationSnap] = await Promise.all([
      transaction.get(formRef),
      transaction.get(registrationRef)
    ]);
    if (!formSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Registration form not found.');
    }
    if (!registrationSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Registration not found.');
    }

    const form = formSnap.data() || {};
    const registration = registrationSnap.data() || {};
    if (registration.teamId !== input.teamId || registration.formId !== input.formId) {
      throw new functions.https.HttpsError('failed-precondition', 'Registration does not match the requested form.');
    }
    if (!registrationCheckoutAuthorityStrictlyMatches(registration, input)) {
      throw new functions.https.HttpsError('failed-precondition', 'Current public checkout capability is required to retry this payment.');
    }
    if (registration.registrationCapacityReleased !== true) {
      return { reserved: false, reason: 'already-held' };
    }
    if (registration.status !== 'pending') {
      throw new functions.https.HttpsError('failed-precondition', 'Only pending registrations can retry payment.');
    }

    const selectedOption = registration.selectedOption || {};
    const countKey = String(selectedOption.countKey || selectedOption.id || '').trim();
    const counts = form.registrationOptionCounts || {};
    const optionCounts = countKey ? counts[countKey] || {} : {};
    if (!countKey || !counts[countKey] || typeof optionCounts !== 'object') {
      throw new functions.https.HttpsError('failed-precondition', 'Registration form capacity tracking is not properly configured.');
    }

    const capacity = Number(selectedOption.capacityLimit || selectedOption.capacity || 0);
    const enrolled = Math.max(0, Number(optionCounts.enrolled || 0));
    if (capacity > 0 && enrolled >= capacity) {
      throw new functions.https.HttpsError('failed-precondition', 'This registration option is no longer available. Please restart registration or contact the organizer.');
    }

    transaction.update(formRef, {
      [`registrationOptionCounts.${countKey}.enrolled`]: enrolled + 1,
      registrationCapacityUpdateId: input.registrationId,
      updatedAt: now
    });
    transaction.set(registrationRef, {
      registrationCapacityReleased: false,
      capacityReleasedAt: admin.firestore.FieldValue.delete(),
      retryCapacityReservationId: retryCapacityReservationId || admin.firestore.FieldValue.delete(),
      updatedAt: now
    }, { merge: true });

    return {
      reserved: true,
      retryCapacityReservationId: retryCapacityReservationId || null
    };
  });
}

async function releaseRegistrationCheckoutCapacity(input, statusUpdate = {}, options = {}) {
  const formRef = buildRegistrationFormRef(input);
  const registrationRef = buildRegistrationRef(input);
  const now = admin.firestore.FieldValue.serverTimestamp();

  return firestore.runTransaction(async (transaction) => {
    const [formSnap, registrationSnap] = await Promise.all([
      transaction.get(formRef),
      transaction.get(registrationRef)
    ]);
    if (!formSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Registration form not found.');
    }
    if (!registrationSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Registration not found.');
    }

    const form = formSnap.data() || {};
    const registration = registrationSnap.data() || {};
    if (registration.teamId !== input.teamId || registration.formId !== input.formId) {
      throw new functions.https.HttpsError('failed-precondition', 'Registration does not match the requested form.');
    }
    if (registration.publicCheckoutCapabilityHash) {
      const inputCapabilityHash = hashPublicCheckoutCapability(input.publicCheckoutCapability);
      if (!inputCapabilityHash || inputCapabilityHash !== String(registration.publicCheckoutCapabilityHash || '')) {
        throw buildPublicCheckoutCapabilityError();
      }
    }

    if (registration.paymentStatus === 'paid') {
      return { released: false, reason: 'already-paid' };
    }

    const retryCapacityReservationId = String(options.retryCapacityReservationId || '').trim();
    const hasMatchingRetryCapacityReservation = Boolean(
      retryCapacityReservationId
      && String(registration.retryCapacityReservationId || '').trim() === retryCapacityReservationId
    );
    const registrationUpdate = {
      ...statusUpdate,
      retryCapacityReservationId: admin.firestore.FieldValue.delete(),
      updatedAt: now
    };

    if (registration.registrationCapacityReleased === true) {
      transaction.set(registrationRef, registrationUpdate, { merge: true });
      return { released: false, reason: 'already-released' };
    }

    const checkoutIsOpen = registration.checkoutStatus === 'open' || registration.paymentStatus === 'checkout_open';
    const canReleasePreCheckoutReservation = !registration.checkoutStatus
      && !registration.paymentStatus
      && ['pending', 'waitlisted'].includes(registration.status);
    const canReleaseRetryCapacityReservation = hasMatchingRetryCapacityReservation && registration.status === 'pending';
    if (!checkoutIsOpen && !canReleasePreCheckoutReservation && !canReleaseRetryCapacityReservation) {
      throw new functions.https.HttpsError('failed-precondition', 'Registration checkout is not releasable.');
    }
    if (canReleasePreCheckoutReservation && !registrationCheckoutAuthorityStrictlyMatches(registration, input)) {
      throw new functions.https.HttpsError('failed-precondition', 'Current public checkout capability is required to release this reservation.');
    }
    if (canReleaseRetryCapacityReservation && !registrationCheckoutAuthorityStrictlyMatches(registration, input)) {
      throw new functions.https.HttpsError('failed-precondition', 'Current public checkout capability is required to release this reservation.');
    }
    if (!canReleasePreCheckoutReservation && !registrationCheckoutAuthorityMatches(registration, input)) {
      if (!canReleaseRetryCapacityReservation) {
        throw new functions.https.HttpsError('failed-precondition', 'Public checkout capability does not match.');
      }
    }

    const selectedOption = registration.selectedOption || {};
    const countKey = String(selectedOption.countKey || selectedOption.id || '').trim();
    const counts = form.registrationOptionCounts || {};
    const optionCounts = countKey ? counts[countKey] || {} : {};
    const updates = {};
    let released = false;

    if (countKey && registration.status === 'pending') {
      updates[`registrationOptionCounts.${countKey}.enrolled`] = Math.max(0, Number(optionCounts.enrolled || 0) - 1);
      released = true;
    } else if (countKey && registration.status === 'waitlisted') {
      updates[`registrationOptionCounts.${countKey}.waitlisted`] = Math.max(0, Number(optionCounts.waitlisted || 0) - 1);
      released = true;
    }

    if (released) {
      updates.registrationCapacityUpdateId = input.registrationId;
      updates.updatedAt = now;
      transaction.update(formRef, updates);
    }

    const nextPublicCheckoutCapability = createRawPublicCheckoutCapability();

    transaction.set(registrationRef, {
      ...registrationUpdate,
      registrationCapacityReleased: true,
      capacityReleasedAt: now,
      publicCheckoutCapabilityHash: hashPublicCheckoutCapability(nextPublicCheckoutCapability)
    }, { merge: true });

    return { released, nextPublicCheckoutCapability };
  });
}

async function getUserForEligibility(uid) {
  const userSnap = await firestore.doc(`users/${uid}`).get();
  return userSnap.exists ? userSnap.data() || {} : {};
}

function hasTeamAdminAccess({ team, user = {}, uid, email }) {
  if (user?.isAdmin === true) return true;
  const normalizedEmail = String(email || user?.email || user?.profileEmail || '').trim().toLowerCase();
  const adminEmails = Array.isArray(team?.adminEmails) ? team.adminEmails.map((entry) => String(entry || '').trim().toLowerCase()) : [];
  return Boolean(uid && team?.ownerId === uid) || Boolean(normalizedEmail && adminEmails.includes(normalizedEmail));
}

function normalizeOrganizationDraftSlot(slot = {}) {
  const homeTeamId = String(slot.homeTeamId || '').trim();
  const awayTeamId = String(slot.awayTeamId || '').trim();
  const startsAt = new Date(slot.startsAt);
  if (!homeTeamId || !awayTeamId || homeTeamId === awayTeamId) {
    throw new functions.https.HttpsError('invalid-argument', 'Each draft slot must include different home and away teams.');
  }
  if (Number.isNaN(startsAt.getTime())) {
    throw new functions.https.HttpsError('invalid-argument', 'Each draft slot must include a valid start date.');
  }
  return {
    homeTeamId,
    awayTeamId,
    startsAt,
    venueName: String(slot.venueName || '').trim(),
    notes: String(slot.notes || '').trim() || null
  };
}

function buildOrganizationDraftGamePayload({
  homeTeamId,
  awayTeamId,
  homeTeam,
  awayTeam,
  sourceGameId,
  counterpartGameId,
  startsAt,
  venueName,
  notes,
  scheduleId,
  organizationId,
  uid,
  now,
  isMirror = false
}) {
  const sharedScheduleId = `shared_${homeTeamId}_${sourceGameId}`;
  const opponentTeam = isMirror ? homeTeam : awayTeam;
  return {
    type: 'game',
    status: 'scheduled',
    date: admin.firestore.Timestamp.fromDate(startsAt),
    opponent: opponentTeam.name || 'Opponent',
    opponentTeamId: isMirror ? homeTeamId : awayTeamId,
    opponentTeamName: opponentTeam.name || null,
    opponentTeamPhoto: opponentTeam.photoUrl || null,
    location: venueName,
    arrivalTime: null,
    notes,
    isHome: !isMirror,
    homeScore: 0,
    awayScore: 0,
    createdAt: now,
    createdVia: 'organizationScheduleDraftPublish',
    organizationScheduleDraft: {
      organizationId,
      scheduleId,
      publishedBy: uid,
      publishedAt: now
    },
    sharedScheduleId,
    sharedScheduleSourceTeamId: homeTeamId,
    sharedScheduleOpponentTeamId: isMirror ? homeTeamId : awayTeamId,
    sharedScheduleOpponentGameId: isMirror ? sourceGameId : counterpartGameId
  };
}

exports.publishOrganizationScheduleDraft = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'The function must be called while authenticated.');
  }

  const organizationId = String(data?.organizationId || '').trim();
  const scheduleId = String(data?.scheduleId || '').trim();
  const draftSlots = Array.isArray(data?.draftSlots) ? data.draftSlots.map(normalizeOrganizationDraftSlot) : [];
  if (!organizationId || !scheduleId) {
    throw new functions.https.HttpsError('invalid-argument', 'organizationId and scheduleId are required.');
  }
  if (draftSlots.length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'At least one draft slot is required to publish.');
  }
  if (draftSlots.length > 200) {
    throw new functions.https.HttpsError('invalid-argument', 'Draft publishing is limited to 200 slots at a time.');
  }

  const uid = context.auth.uid;
  const callerEmail = String(context.auth.token?.email || '').trim().toLowerCase();
  const [userSnap, organizationSnap] = await Promise.all([
    firestore.doc(`users/${uid}`).get(),
    firestore.doc(`teams/${organizationId}`).get()
  ]);
  if (!organizationSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Organization team was not found.');
  }

  const user = userSnap.exists ? userSnap.data() || {} : {};
  const organizationTeam = organizationSnap.data() || {};
  if (!hasTeamAdminAccess({ team: organizationTeam, user, uid, email: callerEmail })) {
    throw new functions.https.HttpsError('permission-denied', 'Only organization admins can publish draft schedules.');
  }

  const teamIds = Array.from(new Set(draftSlots.flatMap((slot) => [slot.homeTeamId, slot.awayTeamId])));
  const teamSnaps = await Promise.all(teamIds.map((teamId) => firestore.doc(`teams/${teamId}`).get()));
  const teamsById = new Map(teamSnaps
    .filter((snap) => snap.exists)
    .map((snap) => [snap.id, snap.data() || {}]));
  if (teamsById.size !== teamIds.length) {
    throw new functions.https.HttpsError('invalid-argument', 'Every draft slot team must exist.');
  }

  const organizationOwnerId = String(organizationTeam.ownerId || '').trim();
  if (organizationOwnerId) {
    const outsideOrganization = teamIds.find((teamId) => String(teamsById.get(teamId)?.ownerId || '').trim() !== organizationOwnerId);
    if (outsideOrganization) {
      throw new functions.https.HttpsError('permission-denied', 'Draft slots can only include teams in the current organization.');
    }
  }

  const inaccessibleTeamId = teamIds.find((teamId) => !hasTeamAdminAccess({
    team: teamsById.get(teamId),
    user,
    uid,
    email: callerEmail
  }));
  if (inaccessibleTeamId) {
    throw new functions.https.HttpsError('permission-denied', 'Only team admins can publish draft slots to every selected team.');
  }

  const now = admin.firestore.Timestamp.now();
  const batch = firestore.batch();
  draftSlots.forEach((slot) => {
    const sourceRef = firestore.collection(`teams/${slot.homeTeamId}/games`).doc();
    const mirrorRef = firestore.collection(`teams/${slot.awayTeamId}/games`).doc();
    const homeTeam = teamsById.get(slot.homeTeamId);
    const awayTeam = teamsById.get(slot.awayTeamId);

    batch.set(sourceRef, buildOrganizationDraftGamePayload({
      ...slot,
      homeTeam,
      awayTeam,
      sourceGameId: sourceRef.id,
      counterpartGameId: mirrorRef.id,
      scheduleId,
      organizationId,
      uid,
      now
    }));
    batch.set(mirrorRef, buildOrganizationDraftGamePayload({
      ...slot,
      homeTeam,
      awayTeam,
      sourceGameId: sourceRef.id,
      counterpartGameId: mirrorRef.id,
      scheduleId,
      organizationId,
      uid,
      now,
      isMirror: true
    }));
  });

  await batch.commit();
  functions.logger.info('Published organization schedule draft', {
    uid,
    organizationId,
    scheduleId,
    publishedCount: draftSlots.length,
    teamCount: teamIds.length
  });
  return { status: 'success', publishedCount: draftSlots.length, message: 'Draft slots published to team schedules.' };
});

function normalizeParentInviteEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isParentInviteExpired(expiresAt) {
  if (!expiresAt) return false;
  const millis = typeof expiresAt.toMillis === 'function'
    ? expiresAt.toMillis()
    : new Date(expiresAt).getTime();
  return Number.isFinite(millis) && millis < Date.now();
}

function validateAutoAcceptParentInviteCode(data = {}) {
  if (!data || data.type !== 'parent_invite') {
    throw new functions.https.HttpsError('failed-precondition', 'Not a parent invite code.');
  }
  if (data.used || data.revoked === true || data.status === 'removed') {
    throw new functions.https.HttpsError('failed-precondition', 'Parent invite is no longer available.');
  }
  if (isParentInviteExpired(data.expiresAt)) {
    throw new functions.https.HttpsError('failed-precondition', 'Parent invite has expired.');
  }
}

function appendUniqueParentLink(parentOf, link) {
  const links = Array.isArray(parentOf) ? [...parentOf] : [];
  const exists = links.some((entry) => entry?.teamId === link.teamId && entry?.playerId === link.playerId);
  if (!exists) links.push(link);
  return links;
}

function appendUniqueValue(values, value) {
  const nextValues = Array.isArray(values) ? [...values] : [];
  if (!nextValues.includes(value)) nextValues.push(value);
  return nextValues;
}

function buildAutoAcceptedParentLink({ codeData, team, player }) {
  return {
    teamId: codeData.teamId,
    playerId: codeData.playerId,
    teamName: team?.name || codeData.teamName || null,
    playerName: player?.name || codeData.playerName || null,
    playerNumber: player?.number ?? codeData.playerNum ?? null,
    playerPhotoUrl: player?.photoUrl || null,
    relation: codeData.relation || null
  };
}

function hashAccountMergePreviewToken(token) {
  return crypto.createHash('sha256').update(String(token || '').trim()).digest('hex');
}

function normalizeAccountMergeInput(data = {}) {
  return {
    sourceUid: normalizeFirestoreId(data.sourceUid, 'sourceUid'),
    destinationUid: normalizeFirestoreId(data.destinationUid, 'destinationUid'),
    requestId: String(data.requestId || '').trim(),
    previewToken: String(data.previewToken || '').trim()
  };
}

async function resolveAccountMergeRequest(input) {
  if (input.requestId) {
    const requestRef = firestore.doc(`accountMergeRequests/${input.requestId}`);
    const requestSnap = await requestRef.get();
    const previewTokenHash = input.previewToken ? hashAccountMergePreviewToken(input.previewToken) : undefined;
    return { requestRef, requestSnap, previewTokenHash };
  }

  if (!input.previewToken) {
    throw new functions.https.HttpsError('invalid-argument', 'A verified merge request or preview token is required.');
  }

  const previewTokenHash = hashAccountMergePreviewToken(input.previewToken);
  const requestQuery = await firestore.collection('accountMergeRequests')
    .where('previewTokenHash', '==', previewTokenHash)
    .limit(1)
    .get();
  if (requestQuery.empty) {
    throw new functions.https.HttpsError('failed-precondition', 'Verified account merge request not found.');
  }
  return { requestRef: requestQuery.docs[0].ref, requestSnap: requestQuery.docs[0], previewTokenHash };
}

function collectParentPlayerKeys(...users) {
  const keys = new Set();
  users.forEach((user = {}) => {
    (Array.isArray(user.parentPlayerKeys) ? user.parentPlayerKeys : []).forEach((key) => {
      if (typeof key === 'string' && key.includes('::')) keys.add(key);
    });
    (Array.isArray(user.parentOf) ? user.parentOf : []).forEach((link) => {
      if (link?.teamId && link?.playerId) keys.add(`${link.teamId}::${link.playerId}`);
    });
  });
  return [...keys];
}

function buildPlayerRefFromParentKey(parentPlayerKey) {
  const [teamId, playerId] = String(parentPlayerKey || '').split('::');
  if (!teamId || !playerId || teamId.includes('/') || playerId.includes('/')) return null;
  return firestore.doc(`teams/${teamId}/players/${playerId}`);
}

async function mergeNotificationPreferenceDocs({ sourceUid, destinationUid, teamIds, actorUid }) {
  const affected = [];
  await Promise.all([...new Set(teamIds)].map(async (teamId) => {
    const sourceRef = firestore.doc(`users/${sourceUid}/notificationPreferences/${teamId}`);
    const destinationRef = firestore.doc(`users/${destinationUid}/notificationPreferences/${teamId}`);
    const [sourceSnap, destinationSnap] = await Promise.all([sourceRef.get(), destinationRef.get()]);
    if (!sourceSnap.exists) return;
    const merged = {
      ...mergePreferenceObjects(destinationSnap.exists ? destinationSnap.data() || {} : {}, sourceSnap.data() || {}),
      mergedFromUid: sourceUid,
      mergedBy: actorUid,
      mergedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    await destinationRef.set(merged, { merge: true });
    affected.push(`users/${destinationUid}/notificationPreferences/${teamId}`);
  }));
  return affected;
}

exports.confirmParentAccountMerge = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before confirming an account merge.');
  }

  let input;
  try {
    input = normalizeAccountMergeInput(data || {});
  } catch (error) {
    throw new functions.https.HttpsError('invalid-argument', error.message || 'Invalid account merge request.');
  }
  if (input.sourceUid === input.destinationUid) {
    throw new functions.https.HttpsError('invalid-argument', 'Source and destination accounts must be different.');
  }

  const actorSnap = await firestore.doc(`users/${context.auth.uid}`).get();
  const actor = actorSnap.exists ? actorSnap.data() || {} : {};
  if (actor.isAdmin !== true) {
    throw new functions.https.HttpsError('permission-denied', 'Only admins can confirm parent account merges.');
  }

  const { requestRef, requestSnap, previewTokenHash } = await resolveAccountMergeRequest(input);
  if (!requestSnap.exists) {
    throw new functions.https.HttpsError('failed-precondition', 'Verified account merge request not found.');
  }
  const requestData = requestSnap.data() || {};
  if (requestData.sourceUid !== input.sourceUid || requestData.destinationUid !== input.destinationUid) {
    throw new functions.https.HttpsError('failed-precondition', 'Account merge request is not for these accounts.');
  }
  if (requestData.status === 'completed') {
    return { merged: true, idempotent: true, requestId: requestRef.id, affectedCollections: requestData.affectedCollections || [] };
  }
  if (!isVerifiedAccountMergeRequest(requestData, { ...input, previewTokenHash })) {
    throw new functions.https.HttpsError('failed-precondition', 'Account merge request is not verified for these accounts.');
  }

  const sourceRef = firestore.doc(`users/${input.sourceUid}`);
  const destinationRef = firestore.doc(`users/${input.destinationUid}`);
  const affectedCollections = new Set(['users', 'accountMergeRequests']);
  let parentPlayerKeys = [];

  await firestore.runTransaction(async (transaction) => {
    const [sourceSnap, destinationSnap] = await Promise.all([
      transaction.get(sourceRef),
      transaction.get(destinationRef)
    ]);
    if (!sourceSnap.exists || !destinationSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Source and destination users must both exist.');
    }

    const sourceUser = sourceSnap.data() || {};
    const destinationUser = destinationSnap.data() || {};
    const destinationUpdate = buildMergedParentAccount(destinationUser, sourceUser);
    parentPlayerKeys = collectParentPlayerKeys(sourceUser, destinationUser);
    const playerRefs = parentPlayerKeys.map(buildPlayerRefFromParentKey).filter(Boolean);
    const playerSnaps = await Promise.all(playerRefs.map((ref) => transaction.get(ref)));

    transaction.update(destinationRef, {
      ...destinationUpdate,
      mergedParentAccountUids: admin.firestore.FieldValue.arrayUnion(input.sourceUid),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    transaction.update(sourceRef, {
      mergedIntoUid: input.destinationUid,
      mergeStatus: 'merged',
      mergedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    playerSnaps.forEach((playerSnap) => {
      if (!playerSnap.exists) return;
      const playerData = playerSnap.data() || {};
      const currentParents = Array.isArray(playerData.parents) ? playerData.parents : [];
      const result = buildMergedPlayerParents(currentParents, input.sourceUid, input.destinationUid);
      const duplicateParentUserIds = findDuplicateParentUserIds(result.parents);
      if (duplicateParentUserIds.length > 0) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Player parent merge would leave duplicate parent account links. Retry after cleaning up duplicate parent records.'
        );
      }
      if (result.changed) {
        transaction.update(playerSnap.ref, { parents: result.parents, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        affectedCollections.add('teams/players');
      }
    });

    transaction.set(requestRef, {
      sourceUid: input.sourceUid,
      destinationUid: input.destinationUid,
      actorUid: context.auth.uid,
      affectedCollections: [...affectedCollections],
      confirmedAt: admin.firestore.FieldValue.serverTimestamp(),
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      status: 'completed'
    }, { merge: true });
  });

  const preferencePaths = await mergeNotificationPreferenceDocs({
    sourceUid: input.sourceUid,
    destinationUid: input.destinationUid,
    teamIds: parentPlayerKeys.map((key) => key.split('::')[0]).filter(Boolean),
    actorUid: context.auth.uid
  });
  if (preferencePaths.length > 0) {
    affectedCollections.add('users/notificationPreferences');
    await requestRef.set({ affectedCollections: [...affectedCollections], affectedPaths: preferencePaths }, { merge: true });
  }

  return { merged: true, idempotent: false, requestId: requestRef.id, affectedCollections: [...affectedCollections] };
});

exports.autoAcceptParentInviteForExistingUser = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before auto-linking a parent invite.');
  }

  const codeId = normalizeFirestoreId(data?.codeId, 'codeId');
  const codeRef = firestore.doc(`accessCodes/${codeId}`);
  const codeSnap = await codeRef.get();
  if (!codeSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Parent invite could not be found.');
  }

  const codeData = codeSnap.data() || {};
  validateAutoAcceptParentInviteCode(codeData);
  const inviteEmail = normalizeParentInviteEmail(codeData.email);
  if (!inviteEmail) {
    throw new functions.https.HttpsError('failed-precondition', 'Parent invite has no email to auto-link.');
  }

  const teamId = normalizeFirestoreId(codeData.teamId, 'teamId');
  const playerId = normalizeFirestoreId(codeData.playerId, 'playerId');
  const [teamSnap, playerSnap, actorSnap, userQuerySnap] = await Promise.all([
    firestore.doc(`teams/${teamId}`).get(),
    firestore.doc(`teams/${teamId}/players/${playerId}`).get(),
    firestore.doc(`users/${context.auth.uid}`).get(),
    firestore.collection('users').where('email', '==', inviteEmail).limit(1).get()
  ]);

  if (!teamSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Team not found.');
  }
  if (!playerSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Player not found.');
  }
  if (userQuerySnap.empty) {
    return { autoLinked: false, reason: 'no-existing-user' };
  }

  const team = teamSnap.data() || {};
  const actor = actorSnap.exists ? actorSnap.data() || {} : {};
  const actorEmail = context.auth.token?.email || actor.email || '';
  if (!hasTeamAdminAccess({ team, uid: context.auth.uid, email: actorEmail })) {
    throw new functions.https.HttpsError('permission-denied', 'Only team owners and admins can auto-link parent invites.');
  }

  const targetUserDoc = userQuerySnap.docs[0];
  const userRef = targetUserDoc.ref;
  const now = admin.firestore.Timestamp.now();

  await firestore.runTransaction(async (transaction) => {
    const [latestCodeSnap, latestPlayerSnap, latestUserSnap] = await Promise.all([
      transaction.get(codeRef),
      transaction.get(firestore.doc(`teams/${teamId}/players/${playerId}`)),
      transaction.get(userRef)
    ]);

    if (!latestCodeSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Parent invite could not be found.');
    }
    if (!latestPlayerSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Player not found.');
    }
    if (!latestUserSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Existing parent user not found.');
    }

    const latestCodeData = latestCodeSnap.data() || {};
    validateAutoAcceptParentInviteCode(latestCodeData);
    if (normalizeParentInviteEmail(latestCodeData.email) !== inviteEmail) {
      throw new functions.https.HttpsError('failed-precondition', 'Parent invite email changed before auto-linking.');
    }

    const latestUserData = latestUserSnap.data() || {};
    if (normalizeParentInviteEmail(latestUserData.email) !== inviteEmail) {
      throw new functions.https.HttpsError('failed-precondition', 'Existing parent email does not match the invite.');
    }

    const player = latestPlayerSnap.data() || {};
    const parentLink = buildAutoAcceptedParentLink({ codeData: latestCodeData, team, player });
    const playerKey = `${teamId}::${playerId}`;
    transaction.update(userRef, {
      parentOf: appendUniqueParentLink(latestUserData.parentOf, parentLink),
      parentTeamIds: appendUniqueValue(latestUserData.parentTeamIds, teamId),
      parentPlayerKeys: appendUniqueValue(latestUserData.parentPlayerKeys, playerKey),
      roles: appendUniqueValue(latestUserData.roles, 'parent')
    });

    const playerData = latestPlayerSnap.data() || {};
    const existingParents = Array.isArray(playerData.parents) ? [...playerData.parents] : [];
    const alreadyLinked = existingParents.some((parent) => parent?.userId === userRef.id);
    if (!alreadyLinked) {
      existingParents.push({
        userId: userRef.id,
        email: inviteEmail,
        relation: latestCodeData.relation || null,
        addedAt: now,
        status: 'active',
        source: 'parent_invite'
      });
      transaction.update(latestPlayerSnap.ref, { parents: existingParents });
    }

    transaction.update(codeRef, {
      used: true,
      usedBy: userRef.id,
      usedAt: now,
      status: 'accepted',
      autoAccepted: true,
      autoAcceptedAt: now
    });
  });

  return { autoLinked: true, userId: userRef.id };
});

exports.validateAccessCodeForAcceptance = functions.https.onCall(async (data) => {
  const code = String(data?.code || '').trim().toUpperCase();
  if (!code) {
    throw new functions.https.HttpsError('invalid-argument', 'Access code is required.');
  }

  const snapshot = await firestore.collection('accessCodes').where('code', '==', code).get();
  return validateAccessCodeCandidates(snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    data: docSnap.data() || {}
  })));
});

function accountMergePreviewAuditRef() {
  return firestore.collection('accountMergePreviewRequests').doc();
}

async function writeAccountMergePreviewAudit(payload) {
  await accountMergePreviewAuditRef().set({
    ...payload,
    didMutateOwnershipLinks: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

async function findAccountMergeSourceByEmail(sourceEmail) {
  const [emailSnap, profileEmailSnap] = await Promise.all([
    firestore.collection('users')
      .where('email', '==', sourceEmail)
      .limit(1)
      .get(),
    firestore.collection('users')
      .where('profileEmail', '==', sourceEmail)
      .limit(1)
      .get()
  ]);
  return emailSnap.empty ? (profileEmailSnap.empty ? null : profileEmailSnap.docs[0]) : emailSnap.docs[0];
}

async function resolveAccountMergeSource(input, destinationUid) {
  let sourceUid = input.sourceUid;
  let verification = null;

  if (input.verificationToken) {
    const tokenHash = hashAccountMergeVerificationToken(input.verificationToken);
    const tokenSnap = await firestore.doc(`accountMergeVerificationTokens/${tokenHash}`).get();
    if (!tokenSnap.exists) {
      throw new functions.https.HttpsError('failed-precondition', 'Account merge verification token is invalid.');
    }
    verification = {
      ...(tokenSnap.data() || {}),
      id: tokenSnap.id
    };
    try {
      sourceUid = validateAccountMergeVerificationRecord({
        record: verification,
        destinationUid,
        sourceUid: input.sourceUid
      });
    } catch (error) {
      throw new functions.https.HttpsError('failed-precondition', error.message || 'Account merge verification token is invalid.');
    }
  }

  if (sourceUid) {
    const sourceSnap = await firestore.doc(`users/${sourceUid}`).get();
    return { sourceSnap, verification };
  }

  const sourceSnap = await findAccountMergeSourceByEmail(input.sourceEmail);
  return { sourceSnap, verification };
}

exports.previewAccountMerge = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before previewing an account merge.');
  }

  const destinationUid = context.auth.uid;
  const destinationEmail = normalizeEmail(context.auth.token?.email);
  let input;
  try {
    input = normalizeAccountMergePreviewInput(data || {});
    assertNotSelfMerge({
      destinationUid,
      destinationEmail,
      sourceUid: input.sourceUid,
      sourceEmail: input.sourceEmail
    });
  } catch (error) {
    await writeAccountMergePreviewAudit({
      destinationUid,
      destinationEmail,
      status: 'rejected',
      errorCode: 'invalid-argument',
      errorMessage: error.message || 'Invalid account merge preview request.'
    });
    throw new functions.https.HttpsError('invalid-argument', error.message || 'Invalid account merge preview request.');
  }

  try {
    const [destinationSnap, sourceResult] = await Promise.all([
      firestore.doc(`users/${destinationUid}`).get(),
      resolveAccountMergeSource(input, destinationUid)
    ]);

    if (!destinationSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Destination account could not be found.');
    }

    const sourceSnap = sourceResult.sourceSnap;
    if (!sourceSnap?.exists) {
      throw new functions.https.HttpsError('not-found', 'Source account could not be found.');
    }

    const sourceUser = sourceSnap.data() || {};
    if (input.sourceEmail && normalizeEmail(sourceUser.email || sourceUser.profileEmail) !== input.sourceEmail) {
      throw new functions.https.HttpsError('not-found', 'Source account could not be found.');
    }

    const preview = buildAccountMergePreview({
      sourceUid: sourceSnap.id,
      sourceUser,
      destinationUid,
      destinationUser: destinationSnap.data() || {}
    });

    await writeAccountMergePreviewAudit({
      destinationUid,
      destinationEmail: preview.destination.email || destinationEmail,
      sourceUid: sourceSnap.id,
      sourceEmail: preview.source.email || input.sourceEmail || '',
      status: 'previewed',
      verificationTokenAccepted: Boolean(input.verificationToken),
      verificationTokenId: sourceResult.verification?.id || null,
      preview
    });

    return { preview };
  } catch (error) {
    const code = error instanceof functions.https.HttpsError ? error.code : 'internal';
    const message = error instanceof functions.https.HttpsError
      ? error.message
      : 'Account merge preview could not be created.';
    await writeAccountMergePreviewAudit({
      destinationUid,
      destinationEmail,
      sourceUid: input.sourceUid || '',
      sourceEmail: input.sourceEmail || '',
      status: 'rejected',
      errorCode: code,
      errorMessage: message
    });
    if (error instanceof functions.https.HttpsError) throw error;
    throw new functions.https.HttpsError('internal', message);
  }
});

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
  const checkoutAttemptToken = (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')).replace(/-/g, '');
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
    metadata: buildTeamFeeCheckoutMetadata({
      ...input,
      payerUid: context.auth.uid,
      checkoutAttemptToken,
      checkoutAmountCents: amountCents
    })
  });

  const now = admin.firestore.FieldValue.serverTimestamp();
  await recipientRef.set({
    checkoutUrl: session.url,
    paymentLink: session.url,
    checkoutStatus: 'open',
    paymentProvider: 'stripe',
    stripeCheckoutSessionId: session.id,
    checkoutAttemptToken,
    stripePaymentStatus: session.payment_status || 'unpaid',
    checkoutAmountCents: amountCents,
    balanceDueCents: amountCents,
    checkoutCreatedAt: now,
    updatedAt: now
  }, { merge: true });

  return { checkoutUrl: session.url, sessionId: session.id };
});

exports.refundStripeTeamFeePayment = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before refunding a team fee.');
  }

  let input;
  try {
    input = normalizeTeamFeeRefundInput(data || {});
  } catch (error) {
    throw new functions.https.HttpsError('invalid-argument', error.message || 'Invalid team fee refund request.');
  }

  const recipientRef = buildTeamFeeRecipientRef(input);
  const [teamSnap, recipientSnap, user] = await Promise.all([
    firestore.doc(`teams/${input.teamId}`).get(),
    recipientRef.get(),
    getUserForEligibility(context.auth.uid)
  ]);

  if (!teamSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Team not found.');
  }
  if (!recipientSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Fee recipient not found.');
  }

  const team = { id: input.teamId, ...(teamSnap.data() || {}) };
  const email = context.auth.token?.email || user.email || '';
  if (!hasTeamAdminAccess({ team, user, uid: context.auth.uid, email })) {
    throw new functions.https.HttpsError('permission-denied', 'Only team admins can issue team fee refunds.');
  }

  const recipient = { id: input.recipientId, ...(recipientSnap.data() || {}) };
  if (recipient.teamId !== input.teamId || recipient.batchId !== input.batchId) {
    throw new functions.https.HttpsError('failed-precondition', 'Fee recipient does not match the requested fee batch.');
  }
  if (recipient.paymentProvider !== 'stripe') {
    throw new functions.https.HttpsError('failed-precondition', 'Only Stripe team fee payments can be refunded online.');
  }

  const paymentAdminBilling = await fetchTeamFeePaymentAdminBilling(recipientRef);
  const { paymentIntentId, chargeId } = getTeamFeeStripePaymentRefs(recipient, paymentAdminBilling);
  if (!paymentIntentId && !chargeId) {
    throw new functions.https.HttpsError('failed-precondition', 'This payment is missing a Stripe payment intent or charge reference.');
  }

  const refundableCents = getTeamFeeRefundableCents(recipient);
  if (input.amountCents > refundableCents) {
    throw new functions.https.HttpsError('failed-precondition', 'Refund amount exceeds the refundable paid amount.');
  }

  const refundRequestId = buildTeamFeeRefundRequestId(input, context.auth.uid);
  const refundIntentRef = recipientRef.collection('refundIntents').doc(refundRequestId);
  let existingRefundResult = null;
  await firestore.runTransaction(async (transaction) => {
    const latestSnap = await transaction.get(recipientRef);
    if (!latestSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Fee recipient not found.');
    }

    const latestRecipient = { id: input.recipientId, ...(latestSnap.data() || {}) };
    if (latestRecipient.teamId !== input.teamId || latestRecipient.batchId !== input.batchId) {
      throw new functions.https.HttpsError('failed-precondition', 'Fee recipient does not match the requested fee batch.');
    }
    if (latestRecipient.paymentProvider !== 'stripe') {
      throw new functions.https.HttpsError('failed-precondition', 'Only Stripe team fee payments can be refunded online.');
    }

    const intentSnap = await transaction.get(refundIntentRef);
    if (intentSnap.exists) {
      const intent = intentSnap.data() || {};
      if (intent.status === 'recorded' && intent.stripeRefundId) {
        existingRefundResult = {
          refundId: intent.stripeRefundId,
          status: intent.stripeRefundStatus || 'succeeded',
          amountCents: Number(intent.amountCents || input.amountCents)
        };
        return;
      }
      if (Number(intent.amountCents || 0) !== input.amountCents) {
        throw new functions.https.HttpsError('already-exists', 'Refund request ID already exists for a different amount.');
      }
    }

    if (input.amountCents > getTeamFeeRefundableCents(latestRecipient)) {
      throw new functions.https.HttpsError('failed-precondition', 'Refund amount exceeds the refundable paid amount. The recipient state may have changed.');
    }

    transaction.set(refundIntentRef, {
      teamId: input.teamId,
      batchId: input.batchId,
      recipientId: input.recipientId,
      amountCents: input.amountCents,
      reason: input.reason || '',
      requestedBy: context.auth.uid,
      status: 'processing',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });

  if (existingRefundResult) {
    return existingRefundResult;
  }

  const stripe = createStripeClient();
  let refund;
  try {
    refund = await stripe.refunds.create({
      amount: input.amountCents,
      ...(paymentIntentId ? { payment_intent: paymentIntentId } : { charge: chargeId }),
      metadata: {
        product: 'team_fee',
        teamId: input.teamId,
        batchId: input.batchId,
        recipientId: input.recipientId,
        refundedBy: context.auth.uid
      }
    }, {
      idempotencyKey: buildTeamFeeRefundIdempotencyKey(input, refundRequestId)
    });
  } catch (error) {
    console.warn('Stripe team fee refund failed:', error?.message || error);
    await refundIntentRef.set({
      status: 'stripe_failed',
      errorMessage: error?.message || 'Stripe refund failed.',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => {});
    throw new functions.https.HttpsError('failed-precondition', error?.message || 'Stripe refund failed.');
  }

  const actualRefundAmount = Math.round(Number(refund.amount || 0));
  if (actualRefundAmount !== input.amountCents) {
    console.error('Stripe team fee refund amount mismatch', {
      requested: input.amountCents,
      actual: actualRefundAmount,
      refundId: refund.id || null
    });
    await refundIntentRef.set({
      status: 'amount_mismatch',
      stripeRefundId: refund.id || null,
      stripeRefundAmountCents: actualRefundAmount,
      stripeRefundStatus: refund.status || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => {});
    throw new functions.https.HttpsError('failed-precondition', 'Stripe refund amount mismatch. Contact support.');
  }

  const stripeRefundStatus = String(refund.status || '').trim().toLowerCase();
  if (stripeRefundStatus !== 'succeeded') {
    await refundIntentRef.set({
      status: `stripe_${stripeRefundStatus || 'pending'}`,
      stripeRefundId: refund.id || null,
      stripeRefundAmountCents: actualRefundAmount,
      stripeRefundStatus: refund.status || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => {});
    throw new functions.https.HttpsError('failed-precondition', `Refund status is ${refund.status || 'pending'}. Only succeeded refunds can be recorded immediately.`);
  }

  const refundedAt = admin.firestore.FieldValue.serverTimestamp();
  const ledgerRefundedAt = admin.firestore.Timestamp.now();
  try {
    await firestore.runTransaction(async (transaction) => {
      const latestSnap = await transaction.get(recipientRef);
      const refundAdminBillingRef = buildTeamFeeAdminBillingRef(recipientRef, refund.id || refundRequestId);
      const refundAdminBillingSnap = await transaction.get(refundAdminBillingRef);
      if (!latestSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Fee recipient not found.');
      }

      const latestRecipient = { id: input.recipientId, ...(latestSnap.data() || {}) };
      if (refundAdminBillingSnap.exists || hasStripeRefundLedgerEntry(latestRecipient, refund.id)) {
        transaction.set(refundIntentRef, {
          status: 'recorded',
          stripeRefundId: refund.id || null,
          stripeRefundAmountCents: actualRefundAmount,
          stripeRefundStatus: refund.status || null,
          recordedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        return;
      }
      if (input.amountCents > getTeamFeeRefundableCents(latestRecipient)) {
        throw new functions.https.HttpsError('failed-precondition', 'Refund amount exceeds the refundable paid amount.');
      }

      const { ledgerEntries = [], adminBilling, ...update } = buildTeamFeeStripeRefundUpdate({
        recipient: { ...latestRecipient, adminBilling: paymentAdminBilling },
        refund,
        amountCents: actualRefundAmount,
        actorId: context.auth.uid,
        reason: input.reason,
        refundedAt,
        ledgerRefundedAt
      });
      transaction.set(recipientRef, {
        ...withTeamFeeParentBillingClears(update),
        paymentLedger: admin.firestore.FieldValue.arrayUnion(...ledgerEntries)
      }, { merge: true });
      if (adminBilling) {
        transaction.set(refundAdminBillingRef, adminBilling, { merge: true });
      }
      transaction.set(refundIntentRef, {
        status: 'recorded',
        stripeRefundId: refund.id || null,
        stripeRefundAmountCents: actualRefundAmount,
        stripeRefundStatus: refund.status || null,
        recordedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    });
  } catch (error) {
    await refundIntentRef.set({
      status: 'firestore_record_failed',
      stripeRefundId: refund.id || null,
      stripeRefundAmountCents: actualRefundAmount,
      stripeRefundStatus: refund.status || null,
      errorMessage: error?.message || 'Firestore refund recording failed.',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => {});
    throw error;
  }

  return {
    refundId: refund.id || null,
    status: refund.status || 'pending',
    amountCents: actualRefundAmount
  };
});

exports.createStripeRegistrationCheckout = functions.https.onCall(async (data) => {
  let input;
  try {
    input = normalizeRegistrationCheckoutInput(data || {});
  } catch (error) {
    throw new functions.https.HttpsError('invalid-argument', error.message || 'Invalid registration checkout request.');
  }

  const resolvedInput = await resolveRegistrationCheckoutInput(input);

  const [formSnap, registrationSnap] = await Promise.all([
    firestore.doc(`teams/${resolvedInput.teamId}/registrationForms/${resolvedInput.formId}`).get(),
    resolvedInput.registrationRef.get()
  ]);
  if (!formSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Registration form not found.');
  }
  if (!registrationSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Registration not found.');
  }

  const form = formSnap.data() || {};
  const registration = registrationSnap.data() || {};
  if (registration.publicCheckoutCapabilityHash && !resolvedInput.publicCheckoutCapability) {
    throw new functions.https.HttpsError('failed-precondition', 'Public checkout capability is required.');
  }
  if (resolvedInput.publicCheckoutCapability && String(registration.publicCheckoutCapabilityHash || '') !== String(resolvedInput.resolvedPublicCheckoutCapabilityHash || '')) {
    throw buildPublicCheckoutCapabilityError();
  }
  if (form.published !== true && form.status !== 'published') {
    throw new functions.https.HttpsError('failed-precondition', 'This registration form is not accepting submissions.');
  }
  if (form.paymentSettings?.onlineCheckoutEnabled !== true) {
    throw new functions.https.HttpsError('failed-precondition', 'Online checkout is not enabled for this registration.');
  }
  if (registration.teamId !== resolvedInput.teamId || registration.formId !== resolvedInput.formId) {
    throw new functions.https.HttpsError('failed-precondition', 'Registration does not match the requested form.');
  }
  if (registration.status === 'waitlisted') {
    throw new functions.https.HttpsError('failed-precondition', 'Waitlisted registrations cannot be paid online yet.');
  }
  if (registration.paymentStatus === 'paid') {
    throw new functions.https.HttpsError('failed-precondition', 'This registration has already been paid.');
  }

  // Always recompute the expected amount from the authoritative form document.
  // This prevents a tampered feeSnapshot on the stored registration from lowering the charge.
  const expectedAmountCents = getRegistrationCheckoutAmountCents(registration, form);
  const amountCents = expectedAmountCents;
  const currency = String(
    form.currency || registration.feeSnapshot?.currency || registration.currency || 'usd'
  ).trim().toLowerCase() || 'usd';
  if (!registrationCheckoutAuthorityMatches(registration, resolvedInput)) {
    throw new functions.https.HttpsError('failed-precondition', 'Current public checkout capability is required.');
  }
  const retryCapacityReservationId = resolvedInput.retryPayment ? crypto.randomUUID() : '';
  let retryCapacityReservation = { reserved: false, retryCapacityReservationId: null };
  if (resolvedInput.retryPayment && registration.registrationCapacityReleased === true) {
    retryCapacityReservation = await reserveRegistrationCheckoutCapacityForRetry(resolvedInput, {
      retryCapacityReservationId
    });
  }
  if (canReuseRegistrationCheckoutSession(registration, amountCents, resolvedInput)) {
    return { checkoutUrl: registration.checkoutUrl, sessionId: registration.stripeCheckoutSessionId };
  }

  const stripe = createStripeClient();
  const { appUrl } = getStripeConfig();
  const issuedPublicCheckoutCapability = createRawPublicCheckoutCapability();
  const checkoutUrlInput = {
    ...resolvedInput,
    publicCheckoutCapability: issuedPublicCheckoutCapability
  };
  const { successUrl, cancelUrl } = buildRegistrationCheckoutUrls(appUrl, checkoutUrlInput);
  const title = registration.programName || form.programName || form.title || form.name || 'Program registration';
  let session;
  try {
    session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{
        price_data: {
          currency,
          unit_amount: amountCents,
          product_data: {
            name: title
          }
        },
        quantity: 1
      }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: getRegistrationCustomerEmail(registration),
      client_reference_id: `${resolvedInput.teamId}:${resolvedInput.formId}:${resolvedInput.registrationId}`,
      metadata: buildRegistrationCheckoutMetadata({ input: checkoutUrlInput, registration })
    });
  } catch (error) {
    if (retryCapacityReservation.reserved) {
      try {
        await releaseRegistrationCheckoutCapacity({
          ...resolvedInput,
          publicCheckoutCapability: resolvedInput.publicCheckoutCapability || issuedPublicCheckoutCapability
        }, {}, {
          retryCapacityReservationId: retryCapacityReservation.retryCapacityReservationId
        });
      } catch (releaseError) {
        functions.logger.error('Failed to roll back registration retry capacity after Stripe checkout creation failed.', {
          teamId: resolvedInput.teamId,
          formId: resolvedInput.formId,
          registrationId: resolvedInput.registrationId,
          releaseError: releaseError?.message || releaseError
        });
      }
    }
    throw error;
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  await resolvedInput.registrationRef.set({
    checkoutUrl: session.url,
    paymentLink: session.url,
    checkoutStatus: 'open',
    paymentProvider: 'stripe',
    paymentStatus: 'checkout_open',
    stripeCheckoutSessionId: session.id,
    stripePaymentStatus: session.payment_status || 'unpaid',
    checkoutAmountCents: amountCents,
    checkoutAttemptToken: input.checkoutAttemptToken || null,
    publicCheckoutCapabilityHash: hashPublicCheckoutCapability(issuedPublicCheckoutCapability),
    checkoutCreatedAt: now,
    retryCapacityReservationId: admin.firestore.FieldValue.delete(),
    updatedAt: now
  }, { merge: true });

  return { checkoutUrl: session.url, sessionId: session.id };
});

exports.cancelStripeRegistrationCheckout = functions.https.onCall(async (data) => {
  let input;
  try {
    input = normalizeRegistrationCheckoutCancelInput(data || {});
  } catch (error) {
    throw new functions.https.HttpsError('invalid-argument', error.message || 'Invalid registration checkout cancellation request.');
  }

  const resolvedInput = await resolveRegistrationCheckoutInput(input);

  return releaseRegistrationCheckoutCapacity(resolvedInput, {
    checkoutStatus: 'cancelled',
    paymentStatus: 'checkout_cancelled'
  });
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
      const queuedAtIso = new Date().toISOString();
      const { appUrl } = getStripeConfig();
      const eventRef = firestore.doc(`stripeEvents/${event.id}`);
      const registrationRef = buildRegistrationRefFromStripeSession(session);
      const registrationInput = normalizeRegistrationCheckoutCancelInput(session.metadata || {});
      const formRef = buildRegistrationFormRef(registrationInput);

      await firestore.runTransaction(async (transaction) => {
        const eventSnap = await transaction.get(eventRef);
        if (eventSnap.exists) return;

        const [registrationSnap, formSnap] = await Promise.all([
          transaction.get(registrationRef),
          transaction.get(formRef)
        ]);
        if (!registrationSnap.exists) {
          throw new Error('Registration not found for Stripe webhook.');
        }
        if (!formSnap.exists) {
          throw new Error('Registration form not found for Stripe webhook.');
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
          transaction.update(registrationRef, buildRegistrationReminderStopUpdate({ reason: 'paid', nowIso: queuedAtIso }));
        } else {
          const form = formSnap.data() || {};
          const registration = registrationSnap.data() || {};
          if (!registrationCheckoutAuthorityMatches(registration, registrationInput)) {
            transaction.set(eventRef, {
              provider: 'stripe',
              product: 'registration',
              type: event.type,
              checkoutSessionId: session.id || null,
              registrationPath: registrationRef.path,
              ignoredReason: 'checkout_attempt_mismatch',
              receivedAt
            });
            return;
          }
          if (isAsyncPaymentPending(session)) {
            // ACH / bank-transfer: checkout completed but payment is still in-flight.
            // Hold capacity and mark as pending rather than failed.
            transaction.set(registrationRef, {
              checkoutStatus: 'async_pending',
              paymentStatus: 'pending_payment',
              stripeCheckoutSessionId: session.id || null,
              stripePaymentIntentId: session.payment_intent || null,
              stripePaymentStatus: session.payment_status || 'open',
              stripeEventId: event.id,
              updatedAt: receivedAt
            }, { merge: true });
          } else {
          const selectedOption = registration.selectedOption || {};
          const countKey = String(selectedOption.countKey || selectedOption.id || '').trim();
          const counts = form.registrationOptionCounts || {};
          const optionCounts = countKey ? counts[countKey] || {} : {};
          const shouldReleaseCapacity = registration.registrationCapacityReleased !== true && registration.paymentStatus !== 'paid' && countKey;
          if (shouldReleaseCapacity && registration.status === 'pending') {
            transaction.update(formRef, {
              [`registrationOptionCounts.${countKey}.enrolled`]: Math.max(0, Number(optionCounts.enrolled || 0) - 1),
              registrationCapacityUpdateId: registrationInput.registrationId,
              updatedAt: receivedAt
            });
          } else if (shouldReleaseCapacity && registration.status === 'waitlisted') {
            transaction.update(formRef, {
              [`registrationOptionCounts.${countKey}.waitlisted`]: Math.max(0, Number(optionCounts.waitlisted || 0) - 1),
              registrationCapacityUpdateId: registrationInput.registrationId,
              updatedAt: receivedAt
            });
          }
          transaction.set(registrationRef, {
            checkoutStatus: event.type === 'checkout.session.expired' ? 'expired' : 'payment_failed',
            paymentStatus: event.type === 'checkout.session.expired' ? 'checkout_expired' : 'payment_failed',
            stripeCheckoutSessionId: session.id || null,
            stripePaymentStatus: session.payment_status || 'unpaid',
            stripeEventId: event.id,
            registrationCapacityReleased: true,
            capacityReleasedAt: receivedAt,
            updatedAt: receivedAt
          }, { merge: true });

          if (event.type === 'checkout.session.async_payment_failed') {
            const recipientEmail = String(getRegistrationCustomerEmail(registration) || '').trim().toLowerCase();
            if (recipientEmail) {
              const mailDocId = buildRegistrationPaymentReminderMailDocId({
                teamId: registrationInput.teamId,
                formId: registrationInput.formId,
                registrationId: registrationInput.registrationId,
                eventId: event.id,
                sequence: 'initial'
              });
              const reminderState = buildRegistrationFailedPaymentReminderState({
                registration,
                input: registrationInput,
                eventId: event.id,
                appUrl,
                queuedAtIso,
                mailDocId
              });
              transaction.set(buildRegistrationReminderMailRef(mailDocId), buildRegistrationReminderMailJob({
                registration,
                form,
                retryUrl: reminderState.retryUrl,
                reminderLabel: 'We could not process your registration payment.',
                metadata: {
                  recipientEmail,
                  teamId: registrationInput.teamId,
                  formId: registrationInput.formId,
                  registrationId: registrationInput.registrationId,
                  reminderKind: 'initial',
                  reminderNumber: 1,
                  stripeEventId: event.id
                }
              }));
              transaction.set(registrationRef, {
                paymentReminder: {
                  ...reminderState,
                  recipientEmail
                }
              }, { merge: true });
            } else {
              transaction.set(registrationRef, {
                paymentReminder: {
                  status: 'missing_email',
                  reminderCount: 0,
                  lastEventId: event.id,
                  lastReminderKind: 'missing_email',
                  lastQueuedAt: queuedAtIso
                }
              }, { merge: true });
            }
          } else {
            transaction.update(registrationRef, buildRegistrationReminderStopUpdate({ reason: 'closed', nowIso: queuedAtIso }));
          }
          } // end else (not isAsyncPaymentPending)
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

        const recipient = recipientSnap.data() || {};
        const shouldApplyCheckoutEvent = shouldApplyTeamFeeCheckoutSession({ recipient, session });
        const ignoredReason = shouldApplyCheckoutEvent
          ? null
          : getTeamFeeCheckoutGuardFailure({ recipient, session });

        if (shouldMarkTeamFeePaidFromEvent(event) && shouldApplyCheckoutEvent) {
          const { adminBilling, ...recipientUpdate } = buildTeamFeePaidUpdate({
            recipient,
            session,
            eventId: event.id,
            receivedAt
          });
          transaction.set(recipientRef, withTeamFeeParentBillingClears(recipientUpdate), { merge: true });
          if (adminBilling) {
            transaction.set(buildTeamFeeAdminBillingRef(recipientRef, event.id), adminBilling, { merge: true });
            transaction.set(buildTeamFeeAdminBillingRef(recipientRef, 'latest'), adminBilling, { merge: true });
          }
        } else if (shouldRecordTeamFeeCheckoutNotPaidFromEvent(event) && shouldApplyCheckoutEvent) {
          transaction.set(recipientRef, {
            checkoutStatus: event.type === 'checkout.session.expired' ? 'expired' : 'payment_failed',
            stripeCheckoutSessionId: null,
            stripePaymentIntentId: null,
            stripeCustomerId: null,
            stripeEventId: null,
            checkoutAttemptToken: null,
            checkoutUrl: null,
            paymentLink: null,
            checkoutAmountCents: null,
            updatedAt: receivedAt
          }, { merge: true });
          transaction.set(buildTeamFeeAdminBillingRef(recipientRef, event.id), {
            type: event.type,
            provider: 'stripe',
            stripeCheckoutSessionId: session.id || null,
            stripeEventId: event.id,
            paymentStatus: session.payment_status || null,
            recordedAt: receivedAt,
            updatedAt: receivedAt
          }, { merge: true });
        }

        transaction.set(eventRef, {
          provider: 'stripe',
          product: 'team_fee',
          type: event.type,
          checkoutSessionId: session.id || null,
          recipientPath: recipientRef.path,
          ignored: shouldApplyCheckoutEvent !== true,
          ignoredReason,
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
const calendarIcsCache = createCalendarIcsCache({
  ttlMs: process.env.CALENDAR_ICS_CACHE_TTL_MS
});

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
      const forceRefresh = String(req.query.forceRefresh || '').toLowerCase() === 'true';

      const result = await fetchCalendarIcsWithCache({
        cache: calendarIcsCache,
        cacheKey: normalizedUrl.url,
        forceRefresh,
        fetchIcs: async () => {
          const response = await fetchWithTimeout(normalizedUrl.url, normalizedUrl.hostname, normalizedUrl.publicIps);
          if (!response.ok) {
            const upstreamError = new Error(`Calendar fetch failed: ${response.status} ${response.statusText}`);
            upstreamError.statusCode = 502;
            throw upstreamError;
          }

          const rawText = await response.text();
          const icsText = normalizeIcsText(rawText);

          if (!icsText.includes('BEGIN:VCALENDAR')) {
            const invalidIcsError = new Error('Response was not valid ICS');
            invalidIcsError.statusCode = 502;
            throw invalidIcsError;
          }

          return {
            fetchedAt: new Date().toISOString(),
            icsText
          };
        }
      });

      res.status(200).json({
        ok: true,
        source: result.source,
        fetchedAt: result.fetchedAt,
        icsText: result.icsText
      });
    } catch (error) {
      res.status(error?.statusCode || 400).json({
        ok: false,
        error: error?.message || 'Unknown error'
      });
    }
  });

function normalizeNotificationPreferences(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return NOTIFICATION_CATEGORIES.reduce((preferences, category) => {
    preferences[category] = Object.prototype.hasOwnProperty.call(source, category)
      ? source[category] === true
      : DEFAULT_NOTIFICATION_PREFERENCES[category] === true;
    return preferences;
  }, {});
}

function buildTeamNotificationTargetRef(teamId, uid, deviceId) {
  const docId = buildNotificationTargetDocId({ uid, deviceId });
  if (!docId) return null;
  return firestore.doc(`teams/${teamId}/notificationTargets/${docId}`);
}

function buildTeamNotificationRecipientRef(teamId, uid, deviceId) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid || normalizedUid.includes('/')) return null;
  return firestore.doc(`teams/${teamId}/notificationRecipients/${normalizedUid}`);
}

function buildTeamNotificationIndexRefs(teamId, uid, deviceId) {
  return [buildTeamNotificationTargetRef(teamId, uid, deviceId)].filter(Boolean);
}

function normalizeNotificationDeviceRecord(deviceId, raw) {
  const token = String(raw?.token || '').trim();
  if (!token) return null;
  return {
    deviceId,
    token,
    platform: String(raw?.platform || 'web').trim() || 'web',
    userAgent: String(raw?.userAgent || '').trim()
  };
}

async function getNotificationTargetTeamAccessMap(uid, teamIds) {
  const uniqueTeamIds = Array.from(new Set((Array.isArray(teamIds) ? teamIds : []).map((teamId) => String(teamId || '').trim()).filter(Boolean)));
  if (!uid || !uniqueTeamIds.length) return new Map();

  const userSnap = await firestore.doc(`users/${uid}`).get();
  if (!userSnap.exists) {
    return new Map(uniqueTeamIds.map((teamId) => [teamId, false]));
  }

  const user = userSnap.data() || {};
  const email = String(user.email || user.profileEmail || '').trim().toLowerCase();
  const parentTeamIds = new Set(Array.isArray(user.parentTeamIds) ? user.parentTeamIds.map((teamId) => String(teamId || '').trim()).filter(Boolean) : []);
  const teamSnaps = await Promise.all(uniqueTeamIds.map((teamId) => firestore.doc(`teams/${teamId}`).get()));

  return new Map(uniqueTeamIds.map((teamId, index) => {
    const teamSnap = teamSnaps[index];
    if (!teamSnap.exists) return [teamId, false];
    const team = teamSnap.data() || {};
    const hasParentAccess = parentTeamIds.has(teamId);
    return [teamId, hasParentAccess || hasTeamAdminAccess({ team, user, uid, email })];
  }));
}

async function syncNotificationTargetsForPreference(uid, teamId, preferences) {
  const normalizedPreferences = normalizeNotificationPreferences(preferences);
  const devicesSnap = await firestore.collection(`users/${uid}/notificationDevices`).get();
  if (devicesSnap.empty) return;

  const teamAccessMap = await getNotificationTargetTeamAccessMap(uid, [teamId]);
  const batch = firestore.batch();
  devicesSnap.docs.forEach((deviceSnap) => {
    const device = normalizeNotificationDeviceRecord(deviceSnap.id, deviceSnap.data());
    const indexRefs = buildTeamNotificationIndexRefs(teamId, uid, deviceSnap.id);
    if (!indexRefs.length) return;
    if (teamAccessMap.get(teamId) !== true || !device || !hasEnabledNotificationCategory(normalizedPreferences)) {
      indexRefs.forEach((ref) => batch.delete(ref));
      return;
    }

    const payload = {
      ...buildNotificationTargetPayload({
        uid,
        teamId,
        deviceId: device.deviceId,
        token: device.token,
        platform: device.platform,
        userAgent: device.userAgent,
        preferences: normalizedPreferences
      }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    indexRefs.forEach((ref) => batch.set(ref, payload, { merge: true }));
  });
  await batch.commit();
}

async function syncNotificationTargetsForDevice(uid, deviceId, rawDevice) {
  const targetDevice = normalizeNotificationDeviceRecord(deviceId, rawDevice);
  const prefsSnap = await firestore.collection(`users/${uid}/notificationPreferences`).get();
  if (prefsSnap.empty) return;

  const teamAccessMap = await getNotificationTargetTeamAccessMap(uid, prefsSnap.docs.map((prefSnap) => prefSnap.id));
  const batch = firestore.batch();
  prefsSnap.docs.forEach((prefSnap) => {
    const indexRefs = buildTeamNotificationIndexRefs(prefSnap.id, uid, deviceId);
    const preferences = normalizeNotificationPreferences(prefSnap.data());
    if (!indexRefs.length) return;
    if (teamAccessMap.get(prefSnap.id) !== true || !targetDevice || !hasEnabledNotificationCategory(preferences)) {
      indexRefs.forEach((ref) => batch.delete(ref));
      return;
    }

    const payload = {
      ...buildNotificationTargetPayload({
        uid,
        teamId: prefSnap.id,
        deviceId,
        token: targetDevice.token,
        platform: targetDevice.platform,
        userAgent: targetDevice.userAgent,
        preferences
      }),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    indexRefs.forEach((ref) => batch.set(ref, payload, { merge: true }));
  });
  await batch.commit();
}

async function teamNotificationRecipientIndexIsEmpty(teamId) {
  const recipientSnap = await firestore.collection(`teams/${teamId}/notificationRecipients`)
    .limit(1)
    .get();
  return recipientSnap.empty;
}

function getNotificationRecipientRoles({ teamId, team, user, uid, email = '' }) {
  const normalizedTeamId = String(teamId || '').trim();
  const normalizedUid = String(uid || '').trim();
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedTeamId || !normalizedUid || !team || !user) return [];

  const roles = new Set();
  if (team.ownerId === normalizedUid) {
    roles.add('staff');
  }

  const adminEmails = Array.isArray(team.adminEmails)
    ? team.adminEmails.map((entry) => String(entry || '').trim().toLowerCase()).filter(Boolean)
    : [];
  if (normalizedEmail && adminEmails.includes(normalizedEmail)) {
    roles.add('staff');
  }

  const parentTeamIds = new Set(
    Array.isArray(user.parentTeamIds)
      ? user.parentTeamIds.map((entry) => String(entry || '').trim()).filter(Boolean)
      : []
  );
  if (parentTeamIds.has(normalizedTeamId)) {
    roles.add('parent');
  }

  return Array.from(roles);
}

function buildNotificationRecipientTokens(devicesSnap) {
  return (devicesSnap?.docs || [])
    .map((deviceSnap) => normalizeNotificationDeviceRecord(deviceSnap.id, deviceSnap.data()))
    .filter(Boolean)
    .map((device) => ({
      deviceId: device.deviceId,
      token: device.token,
      platform: device.platform,
      userAgent: device.userAgent
    }));
}

async function cleanupLegacyNotificationRecipientDocs(teamId, uid) {
  const recipientRef = buildTeamNotificationRecipientRef(teamId, uid);
  if (!recipientRef) return 0;

  const recipientSnap = await firestore.collection(`teams/${teamId}/notificationRecipients`)
    .where('uid', '==', String(uid || '').trim())
    .get();
  const legacyRefs = recipientSnap.docs
    .map((docSnap) => docSnap.ref)
    .filter((ref) => ref && ref.id !== recipientRef.id);

  if (!legacyRefs.length) return 0;
  await Promise.allSettled(legacyRefs.map((ref) => ref.delete()));
  return legacyRefs.length;
}

async function syncNotificationRecipientForTeamUser(teamId, uid, options = {}) {
  const recipientRef = buildTeamNotificationRecipientRef(teamId, uid);
  if (!recipientRef) return null;

  const normalizedUid = String(uid || '').trim();
  const user = options.userData !== undefined ? options.userData : null;
  const team = options.teamData !== undefined ? options.teamData : null;
  const skipLegacyCleanup = options.skipLegacyCleanup === true;

  const [resolvedUser, resolvedTeam] = await Promise.all([
    user === null ? firestore.doc(`users/${normalizedUid}`).get().then((snap) => (snap.exists ? (snap.data() || {}) : null)) : Promise.resolve(user),
    team === null ? firestore.doc(`teams/${teamId}`).get().then((snap) => (snap.exists ? (snap.data() || {}) : null)) : Promise.resolve(team)
  ]);

  if (!resolvedUser || !resolvedTeam) {
    if (!skipLegacyCleanup) {
      await cleanupLegacyNotificationRecipientDocs(teamId, normalizedUid);
    }
    await recipientRef.delete();
    return null;
  }

  const email = String(resolvedUser.email || resolvedUser.profileEmail || '').trim().toLowerCase();
  const roles = getNotificationRecipientRoles({
    teamId,
    team: resolvedTeam,
    user: resolvedUser,
    uid: normalizedUid,
    email
  });
  if (!roles.length) {
    if (!skipLegacyCleanup) {
      await cleanupLegacyNotificationRecipientDocs(teamId, normalizedUid);
    }
    await recipientRef.delete();
    return null;
  }

  const [prefSnap, devicesSnap] = await Promise.all([
    firestore.doc(`users/${normalizedUid}/notificationPreferences/${teamId}`).get(),
    firestore.collection(`users/${normalizedUid}/notificationDevices`).get()
  ]);
  const preferences = prefSnap.exists
    ? normalizeNotificationPreferences(prefSnap.data())
    : DEFAULT_NOTIFICATION_PREFERENCES;
  const tokens = buildNotificationRecipientTokens(devicesSnap);
  if (!tokens.length || !hasEnabledNotificationCategory(preferences)) {
    if (!skipLegacyCleanup) {
      await cleanupLegacyNotificationRecipientDocs(teamId, normalizedUid);
    }
    await recipientRef.delete();
    return null;
  }

  if (!skipLegacyCleanup) {
    await cleanupLegacyNotificationRecipientDocs(teamId, normalizedUid);
  }

  await recipientRef.set({
    uid: normalizedUid,
    teamId: String(teamId || '').trim(),
    roles,
    categories: normalizeNotificationTargetCategories(preferences),
    tokens,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { uid: normalizedUid, teamId, roles, tokenCount: tokens.length };
}

async function getNotificationRecipientTeamIdsForUser(user, uid, extraTeamIds = []) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid || !user) return Array.from(new Set((extraTeamIds || []).filter(Boolean)));

  const teamIds = new Set(
    [...(Array.isArray(extraTeamIds) ? extraTeamIds : []), ...(Array.isArray(user.parentTeamIds) ? user.parentTeamIds : [])]
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  );

  const queries = [firestore.collection('teams').where('ownerId', '==', normalizedUid).get()];
  const email = String(user.email || user.profileEmail || '').trim().toLowerCase();
  if (email) {
    queries.push(firestore.collection('teams').where('adminEmails', 'array-contains', email).get());
  }

  const querySnaps = await Promise.all(queries);
  querySnaps.forEach((snap) => {
    (snap.docs || []).forEach((docSnap) => teamIds.add(String(docSnap.id || '').trim()));
  });

  return Array.from(teamIds).filter(Boolean);
}

async function syncNotificationRecipientsForUserChange(uid, beforeUser, afterUser) {
  const teamIds = new Set();
  const beforeTeamIds = await getNotificationRecipientTeamIdsForUser(beforeUser, uid);
  const afterTeamIds = await getNotificationRecipientTeamIdsForUser(afterUser, uid);
  beforeTeamIds.forEach((teamId) => teamIds.add(teamId));
  afterTeamIds.forEach((teamId) => teamIds.add(teamId));

  await Promise.all(Array.from(teamIds).map((teamId) => syncNotificationRecipientForTeamUser(teamId, uid, {
    userData: afterUser || null
  })));
}

async function getCandidateUsersForTeamData(teamId, team) {
  if (!team) return [];
  const users = new Map();
  const addRole = (uid, role) => {
    const normalizedUid = String(uid || '').trim();
    if (!normalizedUid) return;
    const entry = users.get(normalizedUid) || { uid: normalizedUid, roles: new Set() };
    entry.roles.add(role);
    users.set(normalizedUid, entry);
  };

  addRole(team.ownerId, 'staff');

  const parentSnap = await firestore.collection('users').where('parentTeamIds', 'array-contains', teamId).get();
  parentSnap.forEach((docSnap) => addRole(docSnap.id, 'parent'));

  const adminUserIds = await getUserIdsByEmails(team.adminEmails || []);
  adminUserIds.forEach((uid) => addRole(uid, 'staff'));

  return Array.from(users.values()).map((entry) => ({
    uid: entry.uid,
    roles: Array.from(entry.roles)
  }));
}

async function syncNotificationRecipientsForTeamChange(teamId, beforeTeam, afterTeam) {
  const beforeUsers = await getCandidateUsersForTeamData(teamId, beforeTeam);
  const afterUsers = await getCandidateUsersForTeamData(teamId, afterTeam);
  const candidateUids = new Set(
    [...beforeUsers, ...afterUsers]
      .map((entry) => String(entry?.uid || '').trim())
      .filter(Boolean)
  );

  await Promise.all(Array.from(candidateUids).map((uid) => syncNotificationRecipientForTeamUser(teamId, uid, {
    teamData: afterTeam || null
  })));
}

exports.syncTeamNotificationRecipientsOnPreferenceWrite = functions.firestore
  .document('users/{uid}/notificationPreferences/{teamId}')
  .onWrite(async (_change, context) => {
    await syncNotificationRecipientForTeamUser(context.params.teamId, context.params.uid);
    return null;
  });

exports.syncTeamNotificationRecipientsOnDeviceWrite = functions.firestore
  .document('users/{uid}/notificationDevices/{deviceId}')
  .onWrite(async (_change, context) => {
    const userSnap = await firestore.doc(`users/${context.params.uid}`).get();
    const user = userSnap.exists ? (userSnap.data() || {}) : null;
    const teamIds = await getNotificationRecipientTeamIdsForUser(user, context.params.uid);
    await Promise.all(teamIds.map((teamId) => syncNotificationRecipientForTeamUser(teamId, context.params.uid, { userData: user })));
    return null;
  });

exports.syncTeamNotificationRecipientsOnUserWrite = functions.firestore
  .document('users/{uid}')
  .onWrite(async (change, context) => {
    const before = change.before.exists ? (change.before.data() || {}) : null;
    const after = change.after.exists ? (change.after.data() || {}) : null;
    await syncNotificationRecipientsForUserChange(context.params.uid, before, after);
    return null;
  });

exports.syncTeamNotificationRecipientsOnTeamWrite = functions.firestore
  .document('teams/{teamId}')
  .onWrite(async (change, context) => {
    const before = change.before.exists ? (change.before.data() || {}) : null;
    const after = change.after.exists ? (change.after.data() || {}) : null;
    await syncNotificationRecipientsForTeamChange(context.params.teamId, before, after);
    return null;
  });

exports.syncTeamNotificationTargetsOnPreferenceWrite = functions.firestore
  .document('users/{uid}/notificationPreferences/{teamId}')
  .onWrite(async (change, context) => {
    const { uid, teamId } = context.params;
    if (!change.after.exists) {
      await syncNotificationTargetsForPreference(uid, teamId, DEFAULT_NOTIFICATION_PREFERENCES);
      return null;
    }
    await syncNotificationTargetsForPreference(uid, teamId, change.after.data() || {});
    return null;
  });

exports.syncTeamNotificationTargetsOnDeviceWrite = functions.firestore
  .document('users/{uid}/notificationDevices/{deviceId}')
  .onWrite(async (change, context) => {
    const { uid, deviceId } = context.params;
    if (!change.after.exists) {
      await syncNotificationTargetsForDevice(uid, deviceId, null);
      return null;
    }
    await syncNotificationTargetsForDevice(uid, deviceId, change.after.data() || {});
    return null;
  });

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

function buildStaffFeeNotificationDestination({ teamId, batchId = null, recipientId = null }) {
  const encodedTeamId = encodeURIComponent(teamId);
  const encodedBatchId = batchId ? encodeURIComponent(batchId) : '';
  const baseRoute = encodedBatchId
    ? `/teams/${encodedTeamId}/fees/${encodedBatchId}`
    : `/teams/${encodedTeamId}/fees`;
  const params = new URLSearchParams();
  if (recipientId) {
    params.set('recipientId', recipientId);
  }
  const query = params.toString();
  const appRoute = `${baseRoute}${query ? `?${query}` : ''}`;
  return {
    appRoute,
    link: `https://allplays.ai/app/#${appRoute}`
  };
}

function buildPracticePacketNotificationDestination({ teamId, eventId = null, sessionId = null }) {
  const encodedTeamId = encodeURIComponent(teamId);
  const effectiveEventId = String(eventId || sessionId || '').trim();
  const packetSectionQuery = 'section=game';
  const appRoute = effectiveEventId
    ? `/schedule/${encodedTeamId}/${encodeURIComponent(effectiveEventId)}?${packetSectionQuery}`
    : `/schedule?teamId=${encodedTeamId}&${packetSectionQuery}`;
  return {
    appRoute,
    link: `https://allplays.ai/app/#${appRoute}`
  };
}

function getPracticePacketNotificationLabel(session = {}) {
  const sessionTitle = String(session?.title || session?.eventTitle || '').trim();
  return sessionTitle ? `home packet for ${sessionTitle}` : 'home packet';
}

function coercePracticePacketDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (typeof value.seconds === 'number') return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatPracticePacketDueDate(value) {
  const date = coercePracticePacketDate(value);
  if (!date) return '';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  });
}

function getPracticePacketNotificationTitle(packet = {}, session = {}) {
  return String(packet.title || packet.packetTitle || packet.name || session.title || session.eventTitle || 'Home packet').trim() || 'Home packet';
}

function getPracticePacketNotificationBody(packet = {}, session = {}) {
  const packetTitle = getPracticePacketNotificationTitle(packet, session);
  const dueDateLabel = formatPracticePacketDueDate(
    packet.dueDate
    || packet.dueAt
    || packet.deadline
    || packet.deadlineAt
    || packet.completeBy
    || packet.completeByAt
    || session.date
  );
  return dueDateLabel
    ? `${packetTitle} is ready. Due ${dueDateLabel}.`
    : `${packetTitle} is ready.`;
}

function hasPracticePacketContent(packet = null) {
  return Array.isArray(packet?.blocks) && packet.blocks.length > 0;
}

function getCertificateNotificationPlayerKey(certificate = {}, teamId = '') {
  const resolvedTeamId = String(certificate.teamId || teamId || '').trim();
  const playerId = String(certificate.playerId || certificate.childId || '').trim();
  if (!resolvedTeamId || !playerId) return '';
  return `${resolvedTeamId}::${playerId}`;
}

async function resolvePublishedCertificateParentUserIds(teamId, certificate = {}) {
  const resolvedTeamId = String(teamId || certificate.teamId || '').trim();
  const playerId = String(certificate.playerId || certificate.childId || '').trim();
  if (!resolvedTeamId || !playerId) return [];

  const playerKey = getCertificateNotificationPlayerKey(certificate, resolvedTeamId);
  const [playerKeySnap, teamParentSnap] = await Promise.all([
    playerKey
      ? firestore.collection('users').where('parentPlayerKeys', 'array-contains', playerKey).get()
      : Promise.resolve({ docs: [] }),
    firestore.collection('users').where('parentTeamIds', 'array-contains', resolvedTeamId).get()
  ]);

  const userIds = new Set(
    (playerKeySnap.docs || [])
      .map((docSnap) => String(docSnap.id || '').trim())
      .filter(Boolean)
  );

  (teamParentSnap.docs || []).forEach((docSnap) => {
    const data = docSnap.data() || {};
    const linkedPlayer = Array.isArray(data.parentOf) && data.parentOf.some((entry) => (
      String(entry?.teamId || '').trim() === resolvedTeamId
      && String(entry?.playerId || '').trim() === playerId
    ));
    if (linkedPlayer) {
      userIds.add(String(docSnap.id || '').trim());
    }
  });

  return Array.from(userIds).filter(Boolean);
}

async function claimPublishedCertificateAwardNotification(certificateRef, eventId = '') {
  if (!certificateRef) return false;

  return firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(certificateRef);
    if (!snap.exists) return false;

    const data = snap.data() || {};
    if (String(data.status || '').trim() !== 'published') {
      return false;
    }
    if (data.awardNotificationProcessedAt) {
      return false;
    }

    const normalizedEventId = String(eventId || '').trim();
    const processingEventId = String(data.awardNotificationProcessingEventId || '').trim();
    if (processingEventId) {
      return normalizedEventId && processingEventId === normalizedEventId;
    }

    transaction.update(certificateRef, {
      awardNotificationProcessingEventId: normalizedEventId || 'pending',
      awardNotificationProcessingStartedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return true;
  });
}

async function markPublishedCertificateAwardNotificationProcessed(certificateRef, eventId = '') {
  if (!certificateRef) return null;

  const normalizedEventId = String(eventId || '').trim();
  const update = {
    awardNotificationProcessedAt: admin.firestore.FieldValue.serverTimestamp(),
    awardNotificationProcessingEventId: admin.firestore.FieldValue.delete(),
    awardNotificationProcessingStartedAt: admin.firestore.FieldValue.delete()
  };

  if (normalizedEventId) {
    update.awardNotificationProcessedEventId = normalizedEventId;
  }

  await certificateRef.update(update);
  return null;
}

function buildAwardNotificationDestination({ teamId, certificateId }) {
  const params = new URLSearchParams();
  if (teamId) {
    params.set('teamId', teamId);
  }
  if (certificateId) {
    params.set('certificateId', certificateId);
  }
  const query = params.toString();
  return {
    link: `https://allplays.ai/app/#/parent-tools/certificates${query ? `?${query}` : ''}`,
    appRoute: `/parent-tools/certificates${query ? `?${query}` : ''}`
  };
}

async function practicePacketAssignedNotification(beforeData = null, afterData = null, context = {}) {
  if (!afterData) return null;

  const beforePacket = beforeData?.homePacketContent || null;
  const afterPacket = afterData.homePacketContent || null;
  if (!hasPracticePacketContent(afterPacket)) return null;
  if (JSON.stringify(beforePacket || null) === JSON.stringify(afterPacket || null)) return null;

  if (!NOTIFICATION_CATEGORIES.includes('practice')) {
    functions.logger.error('notifyPracticePacketAssigned requires the practice notification category.', {
      teamId: context.params?.teamId || null,
      availableCategories: NOTIFICATION_CATEGORIES
    });
    return null;
  }

  const { teamId, sessionId } = context.params || {};
  const [allPracticeTargets, candidateUsers] = await Promise.all([
    getTargetsForCategory(teamId, 'practice', null),
    getCandidateUsersForTeam(teamId)
  ]);
  const parentUserIds = new Set(
    candidateUsers
      .filter((user) => Array.isArray(user?.roles) && user.roles.includes('parent'))
      .map((user) => user.uid)
  );
  const parentTargets = allPracticeTargets.filter((target) => parentUserIds.has(target.uid));

  if (!parentTargets.length) {
    functions.logger.warn('notifyPracticePacketAssigned found no practice-enabled parent targets.', {
      teamId,
      sessionId,
      totalPracticeTargets: allPracticeTargets.length,
      parentUserCount: parentUserIds.size
    });
    return null;
  }

  const scheduleEventId = String(afterData.eventId || '').trim() || sessionId;
  const destination = buildPracticePacketNotificationDestination({ teamId, eventId: scheduleEventId, sessionId });

  await sendDirectTargetsNotification({
    targets: parentTargets,
    category: 'practice',
    title: 'Practice packet ready',
    body: getPracticePacketNotificationBody(afterPacket, afterData),
    teamId,
    eventId: sessionId,
    linkOverride: destination.link,
    appRouteOverride: destination.appRoute
  });
  return null;
}

function buildNotificationLink({ category, teamId, gameId, batchId = null, recipientId = null, conversationId = null }) {
  if (category === 'fees') {
    const params = new URLSearchParams();
    if (teamId) {
      params.set('teamId', teamId);
    }
    if (batchId) {
      params.set('batchId', batchId);
    }
    if (recipientId) {
      params.set('recipientId', recipientId);
    }
    const query = params.toString();
    return `https://allplays.ai/app/#/parent-tools/fees${query ? `?${query}` : ''}`;
  }
  if (category === 'liveChat' || category === 'mentions') {
    const params = [`teamId=${encodeURIComponent(teamId)}`];
    if (conversationId) {
      params.push(`conversationId=${encodeURIComponent(conversationId)}`);
    }
    return `https://allplays.ai/team-chat.html?${params.join('&')}`;
  }
  if (category === 'liveScore' && gameId) {
    return `https://allplays.ai/live-game.html?teamId=${encodeURIComponent(teamId)}&gameId=${encodeURIComponent(gameId)}`;
  }
  if (category === 'media') {
    if (teamId) {
      return `https://allplays.ai/app/#/teams/${encodeURIComponent(teamId)}/media`;
    }
    return 'https://allplays.ai/app/#/teams';
  }
  return `https://allplays.ai/team.html?teamId=${encodeURIComponent(teamId)}`;
}

function buildNotificationAppRoute({ category, teamId, gameId, eventId, batchId = null, recipientId = null, conversationId = null }) {
  if (category === 'fees') {
    const params = new URLSearchParams();
    if (teamId) {
      params.set('teamId', teamId);
    }
    if (batchId) {
      params.set('batchId', batchId);
    }
    if (recipientId) {
      params.set('recipientId', recipientId);
    }
    const query = params.toString();
    return `/parent-tools/fees${query ? `?${query}` : ''}`;
  }
  if ((category === 'liveChat' || category === 'mentions') && teamId) {
    const route = `/messages/${encodeURIComponent(teamId)}`;
    if (!conversationId) {
      return route;
    }
    return `${route}?conversationId=${encodeURIComponent(conversationId)}`;
  }
  if (category === 'liveScore' && gameId) {
    if (teamId) {
      return `/schedule/${encodeURIComponent(teamId)}/${encodeURIComponent(gameId)}?section=game`;
    }
    return '/schedule';
  }
  if (category === 'schedule') {
    if (teamId && eventId) {
      return `/schedule/${encodeURIComponent(teamId)}/${encodeURIComponent(eventId)}`;
    }
    if (teamId) {
      return `/schedule?teamId=${encodeURIComponent(teamId)}`;
    }
    return '/schedule';
  }
  if (category === 'media') {
    if (teamId) {
      return `/teams/${encodeURIComponent(teamId)}/media`;
    }
    return '/teams';
  }
  if (category === 'practice') {
    return buildPracticePacketNotificationDestination({ teamId, eventId }).appRoute;
  }
  return '/home';
}

function normalizeTeamMediaNotificationText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTeamMediaNotificationVisibility(value) {
  return normalizeNotificationAlbumVisibility(value);
}

function normalizeTeamMediaNotificationItemType(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['photo', 'image', 'team_photo'].includes(normalized)) return 'photo';
  if (['file', 'document', 'doc'].includes(normalized)) return 'file';
  if (['video', 'video_link', 'link'].includes(normalized)) return 'video';
  return 'item';
}

function getTeamMediaNotificationWindowStart(date) {
  const timestamp = date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : Date.now();
  return new Date(Math.floor(timestamp / TEAM_MEDIA_NOTIFICATION_BATCH_WINDOW_MS) * TEAM_MEDIA_NOTIFICATION_BATCH_WINDOW_MS);
}

function buildTeamMediaNotificationBatchId(teamId, folderId, windowStartAt) {
  const startedAt = windowStartAt instanceof Date && !Number.isNaN(windowStartAt.getTime())
    ? windowStartAt
    : getTeamMediaNotificationWindowStart(new Date());
  return [teamId, folderId, startedAt.toISOString()]
    .map((part) => String(part || '').trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean)
    .join('__')
    .slice(0, 220);
}

function buildTeamMediaNotificationBatchMetadata({ teamId, itemId, item = {}, folder = {}, now = new Date() } = {}) {
  const normalizedTeamId = normalizeTeamMediaNotificationText(teamId);
  const normalizedItemId = normalizeTeamMediaNotificationText(itemId);
  const folderId = normalizeTeamMediaNotificationText(item.folderId || folder.id);
  if (!normalizedTeamId || !normalizedItemId || !folderId || item.deleted === true) return null;

  const albumVisibility = normalizeTeamMediaNotificationVisibility(folder.visibility);
  if (albumVisibility !== 'team') return null;

  const createdAt = coerceDate(item.createdAt) || (now instanceof Date ? now : new Date(now));
  const windowStartAt = getTeamMediaNotificationWindowStart(createdAt);
  const dueAt = new Date(windowStartAt.getTime() + TEAM_MEDIA_NOTIFICATION_BATCH_WINDOW_MS);
  return {
    batchId: buildTeamMediaNotificationBatchId(normalizedTeamId, folderId, windowStartAt),
    teamId: normalizedTeamId,
    folderId,
    albumName: normalizeTeamMediaNotificationText(folder.name) || 'Team media',
    albumVisibility,
    itemId: normalizedItemId,
    itemType: normalizeTeamMediaNotificationItemType(item.type || item.mediaType),
    itemTitle: normalizeTeamMediaNotificationText(item.title || item.fileName || item.name),
    windowStartAt,
    dueAt
  };
}

function buildTeamMediaNotificationPayload(batch = {}) {
  const itemCount = Math.max(1, Number(batch.itemCount || 0));
  const albumName = normalizeTeamMediaNotificationText(batch.albumName) || 'Team media';
  const itemLabel = `${itemCount} new media item${itemCount === 1 ? '' : 's'}`;
  return {
    title: 'New team media',
    body: truncateNotificationBody(`${albumName} has ${itemLabel}.`)
  };
}

function buildTeamMediaNotificationBatchWrite(batch = {}, metadata = {}) {
  const existingItemIds = Array.from(new Set(
    (Array.isArray(batch.itemIds) ? batch.itemIds : [])
      .map((itemId) => normalizeTeamMediaNotificationText(itemId))
      .filter(Boolean)
  ));
  const existingItemTypes = Array.from(new Set(
    (Array.isArray(batch.itemTypes) ? batch.itemTypes : [])
      .map((itemType) => normalizeTeamMediaNotificationItemType(itemType))
      .filter(Boolean)
  ));
  const nextItemIds = existingItemIds.includes(metadata.itemId)
    ? existingItemIds
    : [...existingItemIds, metadata.itemId];
  const nextItemTypes = metadata.itemType && !existingItemTypes.includes(metadata.itemType)
    ? [...existingItemTypes, metadata.itemType]
    : existingItemTypes;

  return {
    teamId: metadata.teamId,
    folderId: metadata.folderId,
    albumName: metadata.albumName,
    albumVisibility: metadata.albumVisibility,
    windowStartAt: admin.firestore.Timestamp.fromDate(metadata.windowStartAt),
    dueAt: admin.firestore.Timestamp.fromDate(metadata.dueAt),
    status: 'pending',
    itemCount: nextItemIds.length,
    itemIds: nextItemIds,
    itemTypes: nextItemTypes,
    latestItemTitle: metadata.itemTitle || null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

async function queueTeamMediaNotificationBatch({ teamId, itemId, item, now = new Date() } = {}) {
  const folderId = normalizeTeamMediaNotificationText(item?.folderId);
  if (!teamId || !itemId || !folderId || item?.deleted === true) return null;

  const folderRef = firestore.doc(`teams/${teamId}/mediaFolders/${folderId}`);
  const folderSnap = await folderRef.get();
  if (!folderSnap.exists) return null;

  const metadata = buildTeamMediaNotificationBatchMetadata({
    teamId,
    itemId,
    item,
    folder: { id: folderId, ...(folderSnap.data() || {}) },
    now
  });
  if (!metadata) return null;

  const batchRef = firestore.doc(`teamMediaNotificationBatches/${metadata.batchId}`);
  await firestore.runTransaction(async (transaction) => {
    const batchSnap = await transaction.get(batchRef);
    const batch = batchSnap.exists ? (batchSnap.data() || {}) : {};
    const currentStatus = batchSnap.exists ? String(batch.status || '') : '';
    if (['sent', 'sending', 'skipped'].includes(currentStatus)) return;

    transaction.set(batchRef, buildTeamMediaNotificationBatchWrite(batch, metadata), { merge: true });
  });

  return metadata;
}

async function claimTeamMediaNotificationBatch(batchRef, claimId, now = new Date()) {
  return firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(batchRef);
    if (!snap.exists) return null;
    const batch = snap.data() || {};
    const dueAt = coerceDate(batch.dueAt);
    if (batch.status !== 'pending' || (dueAt && dueAt > now)) return null;

    transaction.update(batchRef, {
      status: 'sending',
      claimId,
      lastAttemptAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return { id: snap.id, ...batch };
  });
}

async function markTeamMediaNotificationBatchSkipped(batchRef, claimId, reason) {
  await batchRef.update({
    status: 'skipped',
    claimId,
    skippedReason: reason || null,
    finishedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

async function markTeamMediaNotificationBatchSent(batchRef, claimId, sendResult) {
  await batchRef.update({
    status: 'sent',
    claimId,
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    successCount: Number(sendResult?.successCount || 0),
    failureCount: Number(sendResult?.failureCount || 0),
    inboxWriteCount: Number(sendResult?.inboxWriteCount || 0)
  });
}

async function releaseTeamMediaNotificationBatchAfterFailure(batchRef, claimId, error) {
  await batchRef.update({
    status: 'pending',
    claimId,
    lastError: error?.message || 'Unknown team media notification error',
    lastAttemptAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

async function dispatchDueTeamMediaNotificationBatches(now = new Date()) {
  const dueSnap = await firestore.collection('teamMediaNotificationBatches')
    .where('status', '==', 'pending')
    .where('dueAt', '<=', admin.firestore.Timestamp.fromDate(now))
    .limit(TEAM_MEDIA_NOTIFICATION_DISPATCH_LIMIT)
    .get();
  const results = [];

  for (const docSnap of dueSnap.docs) {
    const batchRef = docSnap.ref;
    const claimId = `team-media-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const batch = await claimTeamMediaNotificationBatch(batchRef, claimId, now);
    if (!batch) continue;

    try {
      const folderSnap = await firestore.doc(`teams/${batch.teamId}/mediaFolders/${batch.folderId}`).get();
      if (!folderSnap.exists) {
        await markTeamMediaNotificationBatchSkipped(batchRef, claimId, 'album_not_found');
        continue;
      }

      const folder = folderSnap.data() || {};
      const albumVisibility = normalizeTeamMediaNotificationVisibility(folder.visibility || batch.albumVisibility);
      if (albumVisibility !== 'team') {
        await markTeamMediaNotificationBatchSkipped(batchRef, claimId, 'album_not_team_visible');
        continue;
      }

      const payload = buildTeamMediaNotificationPayload({
        ...batch,
        albumName: normalizeTeamMediaNotificationText(folder.name || batch.albumName),
        albumVisibility
      });
      const sendResult = await sendCategoryNotification({
        teamId: batch.teamId,
        category: 'media',
        title: payload.title,
        body: payload.body,
        dedupKey: `team-media:${batch.id}`,
        audienceContext: { albumVisibility }
      });
      await markTeamMediaNotificationBatchSent(batchRef, claimId, sendResult);
      results.push({
        teamId: batch.teamId,
        folderId: batch.folderId,
        itemCount: Number(batch.itemCount || 0),
        successCount: Number(sendResult?.successCount || 0),
        failureCount: Number(sendResult?.failureCount || 0)
      });
    } catch (error) {
      await releaseTeamMediaNotificationBatchAfterFailure(batchRef, claimId, error);
      console.error('Failed to dispatch team media notification batch', { batchId: batch.id, error });
    }
  }

  return results;
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

async function getCandidateUsersForTeam(teamId) {
  const teamSnap = await firestore.doc(`teams/${teamId}`).get();
  if (!teamSnap.exists) return [];
  const team = teamSnap.data() || {};

  const users = new Map();
  const addRole = (uid, role) => {
    const normalizedUid = String(uid || '').trim();
    if (!normalizedUid) return;
    const entry = users.get(normalizedUid) || { uid: normalizedUid, roles: new Set() };
    entry.roles.add(role);
    users.set(normalizedUid, entry);
  };

  addRole(team.ownerId, 'staff');

  const parentSnap = await firestore.collection('users').where('parentTeamIds', 'array-contains', teamId).get();
  parentSnap.forEach((docSnap) => addRole(docSnap.id, 'parent'));

  const adminUserIds = await getUserIdsByEmails(team.adminEmails || []);
  adminUserIds.forEach((id) => addRole(id, 'staff'));

  return Array.from(users.values()).map((entry) => ({
    uid: entry.uid,
    roles: Array.from(entry.roles)
  }));
}

async function getUserRecordsByIds(userIds) {
  const uniqueUserIds = Array.from(new Set(
    (Array.isArray(userIds) ? userIds : [])
      .map((uid) => String(uid || '').trim())
      .filter(Boolean)
  ));
  if (!uniqueUserIds.length) return new Map();

  const records = new Map();
  const batchSize = 250;
  for (let index = 0; index < uniqueUserIds.length; index += batchSize) {
    const userIdChunk = uniqueUserIds.slice(index, index + batchSize);
    const refs = userIdChunk.map((uid) => firestore.doc(`users/${uid}`));
    const snaps = await firestore.getAll(...refs);
    snaps.forEach((snap, snapIndex) => {
      if (!snap.exists) return;
      records.set(userIdChunk[snapIndex], snap.data() || {});
    });
  }

  return records;
}

function normalizeNotificationAlbumVisibility(value) {
  const normalized = String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  return ['private', 'staff', 'staff-only'].includes(normalized) ? 'private' : 'team';
}

function canReceiveCategoryNotification(category, user, audienceContext = {}) {
  if (!user?.uid || !notificationAudienceAllowsRoles(category, user.roles)) return false;
  if (category !== 'media') return true;
  const albumVisibility = audienceContext?.staffOnly === true
    ? 'private'
    : normalizeNotificationAlbumVisibility(audienceContext.albumVisibility);
  if (albumVisibility !== 'private') return true;
  return Array.isArray(user.roles) && user.roles.includes('staff');
}

async function getLegacyTargetsForCategory(teamId, category, users, actorUid = null, audienceContext = {}) {
  const queryTasks = users
    .filter((user) => user?.uid && user.uid !== actorUid && canReceiveCategoryNotification(category, user, audienceContext))
    .map(async (user) => {
      const uid = user.uid;
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
            token,
            teamId
          };
        })
        .filter(Boolean);
    });

  const targetGroups = await Promise.all(queryTasks);
  return targetGroups.flat();
}

async function backfillNotificationRecipientsForTeam(teamId, users, options = {}) {
  const uniqueUsers = Array.from(new Map(
    (Array.isArray(users) ? users : [])
      .filter((user) => user?.uid)
      .map((user) => [user.uid, user])
  ).values());
  if (!uniqueUsers.length) return 0;
  const syncOptions = {
    skipLegacyCleanup: options.skipLegacyCleanup === true
  };
  const results = await Promise.all(uniqueUsers.map((user) => syncNotificationRecipientForTeamUser(teamId, user.uid, syncOptions)));
  const writeCount = results.filter(Boolean).length;
  return writeCount;
}

async function getTargetsForCategory(teamId, category, actorUid = null, audienceContext = {}, additionalUsers = []) {
  if (!NOTIFICATION_CATEGORIES.includes(category)) return [];

  const targetSnap = await firestore.collection(`teams/${teamId}/notificationRecipients`)
    .where(`categories.${category}`, '==', true)
    .get();
  const candidateUsers = await getCandidateUsersForTeam(teamId);
  const mergedUsers = new Map();
  const mergeUser = (user) => {
    const uid = String(user?.uid || '').trim();
    if (!uid) return;
    const entry = mergedUsers.get(uid) || { uid, roles: new Set() };
    const roles = Array.isArray(user?.roles) ? user.roles : [];
    roles.forEach((role) => {
      const normalizedRole = String(role || '').trim();
      if (normalizedRole) {
        entry.roles.add(normalizedRole);
      }
    });
    mergedUsers.set(uid, entry);
  };

  candidateUsers.forEach(mergeUser);
  (Array.isArray(additionalUsers) ? additionalUsers : []).forEach(mergeUser);

  const users = Array.from(mergedUsers.values()).map((entry) => ({
    uid: entry.uid,
    roles: Array.from(entry.roles)
  }));
  const eligibleUsers = new Map(users
    .filter((user) => canReceiveCategoryNotification(category, user, audienceContext))
    .map((user) => [user.uid, user]));
  const indexedTargets = targetSnap.docs
    .flatMap((docSnap) => {
      const data = docSnap.data() || {};
      const uid = String(data.uid || '').trim();
      if (!uid || uid === actorUid || !eligibleUsers.has(uid)) return [];

      const tokenEntries = Array.isArray(data.tokens)
        ? data.tokens
        : [{
          deviceId: data.deviceId,
          token: data.token,
          platform: data.platform,
          userAgent: data.userAgent
        }];

      return tokenEntries
        .map((entry) => ({
          uid,
          deviceId: String(entry?.deviceId || '').trim(),
          token: String(entry?.token || '').trim(),
          teamId,
          platform: String(entry?.platform || '').trim(),
          userAgent: String(entry?.userAgent || '').trim()
        }))
        .filter((entry) => entry.deviceId && entry.token);
    })
    .filter(Boolean);

  const indexedUserIds = new Set(indexedTargets.map((target) => target.uid));
  const missingUsers = users.filter((user) => (
    user?.uid
    && user.uid !== actorUid
    && !indexedUserIds.has(user.uid)
    && eligibleUsers.has(user.uid)
  ));
  if (!missingUsers.length) {
    return indexedTargets;
  }

  if (targetSnap.empty && await teamNotificationRecipientIndexIsEmpty(teamId)) {
    try {
      await backfillNotificationRecipientsForTeam(teamId, users, { skipLegacyCleanup: true });
    } catch (error) {
      functions.logger.warn('Failed to backfill notification recipient index after empty lookup', {
        teamId,
        category,
        error: error?.message || String(error || 'Unknown error')
      });
    }
  }

  const fallbackTargets = await getLegacyTargetsForCategory(teamId, category, missingUsers, actorUid, audienceContext);
  return [...indexedTargets, ...fallbackTargets];
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
    const targetRef = buildTeamNotificationTargetRef(target.teamId, target.uid, target.deviceId);
    if (targetRef) {
      removals.push(targetRef.delete());
    }
  });

  if (removals.length) {
    await Promise.allSettled(removals);
  }
}

async function cleanupNotificationInbox(inboxRef) {
  const oldItemsSnap = await inboxRef
    .orderBy('createdAt', 'desc')
    .offset(NOTIFICATION_INBOX_MAX_ITEMS)
    .get();

  if (oldItemsSnap.empty) return 0;

  let batch = firestore.batch();
  let pendingDeletes = 0;
  let deletedCount = 0;
  for (const doc of oldItemsSnap.docs) {
    batch.delete(doc.ref);
    pendingDeletes += 1;
    deletedCount += 1;
    if (pendingDeletes === 450) {
      await batch.commit();
      batch = firestore.batch();
      pendingDeletes = 0;
    }
  }

  if (pendingDeletes) {
    await batch.commit();
  }

  return deletedCount;
}

async function writeNotificationInboxRecords({
  targets,
  category,
  title,
  body,
  appRoute,
  teamId,
  gameId = null,
  eventId = null
}) {
  const uniqueTargets = getUniqueNotificationInboxTargets(targets);
  if (!uniqueTargets.length) {
    return { writeCount: 0, cleanupCount: 0, failureCount: 0 };
  }

  const createdAt = admin.firestore.FieldValue.serverTimestamp();
  const readAt = null;
  const results = await Promise.allSettled(uniqueTargets.map(async (target) => {
    const inboxRef = firestore.collection(`users/${target.uid}/notificationInbox`);
    await inboxRef.add(buildNotificationInboxPayload({
      category,
      title,
      body,
      appRoute,
      teamId,
      gameId,
      eventId,
      createdAt,
      readAt
    }));
    return cleanupNotificationInbox(inboxRef);
  }));

  let writeCount = 0;
  let cleanupCount = 0;
  let failureCount = 0;
  results.forEach((result) => {
    if (result.status === 'fulfilled') {
      writeCount += 1;
      cleanupCount += Number(result.value || 0);
      return;
    }
    failureCount += 1;
    functions.logger.warn('Failed to write notification inbox record', {
      category,
      teamId,
      error: result.reason?.message || String(result.reason || 'Unknown error')
    });
  });

  return { writeCount, cleanupCount, failureCount };
}

async function writeNotificationAuditRecord({
  teamId,
  category,
  title,
  body,
  link,
  appRoute,
  targets,
  successCount,
  failureCount,
  inboxResult,
  gameId = null,
  eventId = null,
  conversationId = null,
  batchId = null,
  recipientId = null,
  dedupGuardApplied = false
}) {
  if (!teamId || !category) return;

  const uniqueUserIds = Array.from(new Set(
    (Array.isArray(targets) ? targets : [])
      .map((target) => String(target?.uid || '').trim())
      .filter(Boolean)
  ));

  try {
    await firestore.collection(`teams/${teamId}/notificationAudit`).add({
      teamId: String(teamId),
      category: String(category),
      title: String(title || ''),
      body: String(body || ''),
      link: String(link || ''),
      appRoute: String(appRoute || ''),
      gameId: gameId || null,
      eventId: eventId || null,
      conversationId: conversationId || null,
      batchId: batchId || null,
      recipientId: recipientId || null,
      dedupGuardApplied: dedupGuardApplied === true,
      targetCount: Array.isArray(targets) ? targets.length : 0,
      targetUserIds: uniqueUserIds,
      successCount: Number(successCount || 0),
      failureCount: Number(failureCount || 0),
      inboxWriteCount: Number(inboxResult?.writeCount || 0),
      inboxCleanupCount: Number(inboxResult?.cleanupCount || 0),
      inboxFailureCount: Number(inboxResult?.failureCount || 0),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
  } catch (error) {
    functions.logger.warn('Failed to write notification audit record', {
      teamId,
      category,
      error: error?.message || String(error || 'Unknown error')
    });
  }
}

const NOTIFICATION_DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function buildNotificationDedupRef(teamId, category, dedupIdentity = '') {
  const key = [teamId, category, dedupIdentity || ''].join('::');
  const hash = crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
  return firestore.doc(`teams/${teamId}/notificationSendLog/${hash}`);
}

async function markNotificationDedupSent(teamId, category, gameId, dedupKey = null) {
  const dedupIdentity = String(dedupKey || gameId || '').trim();
  const dedupRef = buildNotificationDedupRef(teamId, category, dedupIdentity);
  await dedupRef.set({
    teamId,
    category,
    gameId: gameId || null,
    dedupKey: dedupKey || null,
    sentAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function checkAndSetNotificationDedup(teamId, category, gameId, dedupKey = null) {
  const dedupIdentity = String(dedupKey || gameId || '').trim();
  const dedupRef = buildNotificationDedupRef(teamId, category, dedupIdentity);

  const result = await firestore.runTransaction(async (txn) => {
    const snap = await txn.get(dedupRef);
    if (snap.exists) {
      const sentAt = snap.data()?.sentAt?.toMillis?.() || 0;
      if (Date.now() - sentAt < NOTIFICATION_DEDUP_WINDOW_MS) {
        return false;
      }
    }
    txn.set(dedupRef, {
      teamId,
      category,
      gameId: gameId || null,
      dedupKey: dedupKey || null,
      sentAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return true;
  });

  return result;
}


function mergeNotificationWebpushOptions(baseWebpush = {}, deliveryOptions = {}) {
  if (!deliveryOptions?.webpush) return baseWebpush;
  return {
    ...baseWebpush,
    ...deliveryOptions.webpush,
    notification: {
      ...(baseWebpush.notification || {}),
      ...(deliveryOptions.webpush.notification || {})
    },
    fcmOptions: {
      ...(baseWebpush.fcmOptions || {}),
      ...(deliveryOptions.webpush.fcmOptions || {})
    }
  };
}

async function sendCategoryNotification({
  teamId,
  gameId = null,
  eventId = null,
  conversationId = null,
  category,
  title,
  body,
  actorUid = null,
  linkOverride = null,
  dedupKey = null,
  excludeUids = [],
  audienceContext = {}
}) {
  if (!NOTIFICATION_CATEGORIES.includes(category)) return null;

  const ALWAYS_SEND_CATEGORIES = new Set(['liveScore', 'mentions', 'liveChat']);
  if (!ALWAYS_SEND_CATEGORIES.has(category)) {
    const canSend = await checkAndSetNotificationDedup(teamId, category, gameId, dedupKey);
    if (!canSend) {
      functions.logger.info('Notification dedup: skipping duplicate send', { teamId, category, gameId, dedupKey });
      return null;
    }
  }

  const allTargets = await getTargetsForCategory(teamId, category, actorUid, audienceContext);
  const excludeSet = new Set(Array.isArray(excludeUids) ? excludeUids : []);
  const targets = excludeSet.size
    ? allTargets.filter((t) => !excludeSet.has(t.uid))
    : allTargets;
  if (!targets.length) return null;

  const link = linkOverride || buildNotificationLink({ category, teamId, gameId, conversationId });
  const appRoute = buildNotificationAppRoute({ category, teamId, gameId, eventId: eventId || gameId, conversationId });
  const deliveryOptions = typeof buildNotificationDeliveryOptions === 'function'
    ? buildNotificationDeliveryOptions({ category, teamId, gameId, eventId: eventId || gameId })
    : {};
  const mergeWebpushOptions = typeof mergeNotificationWebpushOptions === 'function'
    ? mergeNotificationWebpushOptions
    : (baseWebpush = {}, runtimeDeliveryOptions = {}) => {
      if (!runtimeDeliveryOptions?.webpush) return baseWebpush;
      return {
        ...baseWebpush,
        ...runtimeDeliveryOptions.webpush,
        notification: {
          ...(baseWebpush.notification || {}),
          ...(runtimeDeliveryOptions.webpush.notification || {})
        },
        fcmOptions: {
          ...(baseWebpush.fcmOptions || {}),
          ...(runtimeDeliveryOptions.webpush.fcmOptions || {})
        }
      };
    };
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
        eventId: String(eventId || gameId || ''),
        conversationId: String(conversationId || ''),
        category: String(category),
        appRoute,
        link
      },
      ...deliveryOptions,
      webpush: mergeWebpushOptions({
        notification: WEB_PUSH_NOTIFICATION_ASSETS,
        fcmOptions: { link }
      }, deliveryOptions)
    });
    allResponses.push(...(Array.isArray(sendResult.responses) ? sendResult.responses : []));
    successCount += Number(sendResult.successCount || 0);
    failureCount += Number(sendResult.failureCount || 0);
    await pruneInvalidTokens(sendResult, targetChunk);
  }

  const inboxResult = await writeNotificationInboxRecords({
    targets,
    category,
    title,
    body,
    appRoute,
    teamId,
    gameId,
    eventId: eventId || gameId
  });

  await writeNotificationAuditRecord({
    teamId,
    category,
    title,
    body,
    link,
    appRoute,
    targets,
    successCount,
    failureCount,
    inboxResult,
    gameId,
    eventId: eventId || gameId,
    conversationId,
    dedupGuardApplied: !ALWAYS_SEND_CATEGORIES.has(category)
  });

  return {
    responses: allResponses,
    successCount,
    failureCount,
    inboxWriteCount: inboxResult.writeCount,
    inboxCleanupCount: inboxResult.cleanupCount,
    inboxFailureCount: inboxResult.failureCount
  };
}

function normalizeScheduleImportBatch(batch = {}) {
  const batchId = String(batch?.batchId || '').trim();
  const totalCount = Math.max(0, Number.parseInt(String(batch?.totalCount ?? 0), 10) || 0);
  const rowNumber = Math.max(0, Number.parseInt(String(batch?.rowNumber ?? 0), 10) || 0);
  if (!batchId || totalCount <= 0 || rowNumber <= 0) {
    return null;
  }
  return { batchId, totalCount, rowNumber };
}

function buildScheduleImportSummaryPayload({ totalCount, gameCount, practiceCount }) {
  const safeTotalCount = Math.max(0, Number(totalCount || 0));
  const safeGameCount = Math.max(0, Number(gameCount || 0));
  const safePracticeCount = Math.max(0, Number(practiceCount || 0));
  const parts = [];
  if (safeGameCount > 0) parts.push(`${safeGameCount} game${safeGameCount === 1 ? '' : 's'}`);
  if (safePracticeCount > 0) parts.push(`${safePracticeCount} practice${safePracticeCount === 1 ? '' : 's'}`);
  const detail = parts.length ? ` (${parts.join(', ')})` : '';
  return {
    title: 'Schedule import complete',
    body: `Imported ${safeTotalCount} schedule events${detail}.`
  };
}

async function sendCreatedScheduleEventNotification({ teamId, gameId, game }) {
  if (game.source || game.sourceMetadata) return null;

  const isPractice = String(game.type || '').toLowerCase() === 'practice';
  const category = isPractice ? 'practice' : 'schedule';
  const eventTitle = getEventTitle(game);
  const dateValue = coerceDate(game.date);
  const timeZone = String(game.timeZone || game.timezone || '').trim() || 'America/Chicago';
  const dateLabel = dateValue ? formatScheduleUpdateDate(dateValue, timeZone) : '';
  const title = isPractice ? `New practice: ${eventTitle}` : `New game: ${eventTitle}`;
  const body = dateLabel || (isPractice ? 'Practice scheduled' : 'Game scheduled');

  return sendCategoryNotification({
    teamId,
    gameId,
    category,
    title,
    body,
    actorUid: game.createdBy || null
  });
}

async function sendScheduleImportBatchNotifications({ teamId, batchId, batch }) {
  const batchRef = firestore.doc(`teams/${teamId}/scheduleImportNotificationBatches/${batchId}`);
  const eventIds = Array.isArray(batch?.eventIds)
    ? batch.eventIds.map((value) => String(value || '').trim()).filter(Boolean)
    : [];
  const totalCount = Math.max(0, Number(batch?.totalCount || 0));
  const gameCount = Math.max(0, Number(batch?.gameCount || 0));
  const practiceCount = Math.max(0, Number(batch?.practiceCount || 0));

  if (!eventIds.length || totalCount <= 0 || eventIds.length < totalCount) {
    return null;
  }

  if (totalCount > 3) {
    const payload = buildScheduleImportSummaryPayload({ totalCount, gameCount, practiceCount });
    await sendCategoryNotification({
      teamId,
      category: 'schedule',
      title: payload.title,
      body: payload.body,
      actorUid: batch?.finalizedBy || null,
      dedupKey: `import-batch:${batchId}`
    });
    await Promise.all(eventIds.map((eventId) => markNotificationDedupSent(teamId, 'schedule', eventId)));
    await batchRef.set({
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      summaryTitle: payload.title,
      summaryBody: payload.body
    }, { merge: true });
    return payload;
  }

  const sentEventIds = [];
  for (const eventId of eventIds) {
    const gameSnap = await firestore.doc(`teams/${teamId}/games/${eventId}`).get();
    if (!gameSnap.exists) continue;
    await sendCreatedScheduleEventNotification({ teamId, gameId: eventId, game: gameSnap.data() || {} });
    sentEventIds.push(eventId);
  }

  await Promise.all(sentEventIds.map((eventId) => markNotificationDedupSent(teamId, 'schedule', eventId)));
  await batchRef.set({
    sentAt: admin.firestore.FieldValue.serverTimestamp(),
    summaryTitle: null,
    summaryBody: null
  }, { merge: true });
  return { totalCount, eventIds: sentEventIds };
}

async function registerScheduleImportBatchEvent({ teamId, gameId, game, batch }) {
  const batchRef = firestore.doc(`teams/${teamId}/scheduleImportNotificationBatches/${batch.batchId}`);
  const batchState = await firestore.runTransaction(async (txn) => {
    const snap = await txn.get(batchRef);
    const current = snap.exists ? (snap.data() || {}) : {};
    const currentEventIds = Array.isArray(current.eventIds)
      ? current.eventIds.map((value) => String(value || '').trim()).filter(Boolean)
      : [];
    const nextEventIds = currentEventIds.includes(gameId) ? currentEventIds : [...currentEventIds, gameId];
    const alreadyCounted = currentEventIds.includes(gameId);
    const nextGameCount = Math.max(0, Number(current.gameCount || 0)) + (!alreadyCounted && String(game?.type || '').toLowerCase() !== 'practice' ? 1 : 0);
    const nextPracticeCount = Math.max(0, Number(current.practiceCount || 0)) + (!alreadyCounted && String(game?.type || '').toLowerCase() === 'practice' ? 1 : 0);
    const totalCount = Math.max(batch.totalCount, Number(current.totalCount || 0));
    const shouldSendSummary = !current.sentAt && !current.notificationClaimedAt && nextEventIds.length >= totalCount;

    txn.set(batchRef, {
      batchId: batch.batchId,
      totalCount,
      eventIds: nextEventIds,
      gameCount: nextGameCount,
      practiceCount: nextPracticeCount,
      lastGameId: gameId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(shouldSendSummary ? {
        notificationClaimedAt: admin.firestore.FieldValue.serverTimestamp(),
        notificationClaimedByGameId: gameId
      } : {})
    }, { merge: true });

    return {
      shouldSendSummary,
      totalCount,
      eventIds: nextEventIds,
      gameCount: nextGameCount,
      practiceCount: nextPracticeCount
    };
  });

  if (!batchState.shouldSendSummary) {
    return null;
  }

  return sendScheduleImportBatchNotifications({
    teamId,
    batchId: batch.batchId,
    batch: {
      ...batchState,
      finalizedBy: game.createdBy || null
    }
  });
}

async function sendDirectTargetsNotification({
  targets,
  category,
  title,
  body,
  teamId,
  gameId = null,
  eventId = null,
  batchId = null,
  recipientId = null,
  conversationId = null,
  linkOverride = null,
  appRouteOverride = null
}) {
  if (!targets.length) return null;

  const link = linkOverride || buildNotificationLink({ category, teamId, gameId, batchId, recipientId, conversationId });
  const appRoute = appRouteOverride || buildNotificationAppRoute({ category, teamId, gameId, eventId: eventId || gameId, batchId, recipientId, conversationId });
  const deliveryOptions = typeof buildNotificationDeliveryOptions === 'function'
    ? buildNotificationDeliveryOptions({ category, teamId, gameId, eventId: eventId || gameId })
    : {};
  const mergeWebpushOptions = typeof mergeNotificationWebpushOptions === 'function'
    ? mergeNotificationWebpushOptions
    : (baseWebpush = {}, runtimeDeliveryOptions = {}) => {
      if (!runtimeDeliveryOptions?.webpush) return baseWebpush;
      return {
        ...baseWebpush,
        ...runtimeDeliveryOptions.webpush,
        notification: {
          ...(baseWebpush.notification || {}),
          ...(runtimeDeliveryOptions.webpush.notification || {})
        },
        fcmOptions: {
          ...(baseWebpush.fcmOptions || {}),
          ...(runtimeDeliveryOptions.webpush.fcmOptions || {})
        }
      };
    };
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
        eventId: String(eventId || gameId || ''),
        conversationId: String(conversationId || ''),
        category: String(category),
        appRoute,
        link
      },
      ...deliveryOptions,
      webpush: mergeWebpushOptions({
        notification: WEB_PUSH_NOTIFICATION_ASSETS,
        fcmOptions: { link }
      }, deliveryOptions)
    });
    allResponses.push(...(Array.isArray(sendResult.responses) ? sendResult.responses : []));
    successCount += Number(sendResult.successCount || 0);
    failureCount += Number(sendResult.failureCount || 0);
    await pruneInvalidTokens(sendResult, targetChunk);
  }

  const inboxResult = await writeNotificationInboxRecords({
    targets,
    category,
    title,
    body,
    appRoute,
    teamId,
    gameId,
    eventId: eventId || gameId
  });

  await writeNotificationAuditRecord({
    teamId,
    category,
    title,
    body,
    link,
    appRoute,
    targets,
    successCount,
    failureCount,
    inboxResult,
    gameId,
    eventId: eventId || gameId,
    conversationId,
    batchId,
    recipientId,
    dedupGuardApplied: false
  });

  return {
    responses: allResponses,
    successCount,
    failureCount,
    inboxWriteCount: inboxResult.writeCount,
    inboxCleanupCount: inboxResult.cleanupCount,
    inboxFailureCount: inboxResult.failureCount
  };
}

exports._internal = {
  buildTeamMediaNotificationBatchId,
  buildTeamMediaNotificationBatchMetadata,
  buildTeamMediaNotificationBatchWrite,
  buildTeamMediaNotificationPayload,
  dispatchDueTeamMediaNotificationBatches,
  getTargetsForCategory,
  sendCategoryNotification,
  sendPracticePacketDueTomorrowReminders,
  syncNotificationRecipientForTeamUser,
  syncNotificationRecipientsForUserChange,
  syncNotificationRecipientsForTeamChange
};

exports.queueTeamMediaNotificationBatch = functions.firestore
  .document('teams/{teamId}/mediaItems/{itemId}')
  .onCreate(async (snap, context) => {
    const teamId = String(context.params.teamId || '').trim();
    const itemId = String(context.params.itemId || '').trim();
    const timestamp = context.timestamp ? new Date(context.timestamp) : new Date();
    await queueTeamMediaNotificationBatch({
      teamId,
      itemId,
      item: snap.data() || {},
      now: timestamp
    });
    return null;
  });

exports.dispatchDueTeamMediaNotificationBatches = functions.pubsub
  .schedule('every 15 minutes')
  .timeZone('America/Chicago')
  .onRun(() => dispatchDueTeamMediaNotificationBatches());

exports.markNotificationInboxItemRead = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before updating notification inbox items.');
  }

  const uid = context.auth.uid;
  const itemId = normalizeInboxId(data?.itemId);
  if (!itemId || itemId.includes('/')) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid notification inbox item id is required.');
  }

  const itemRef = firestore.doc(`users/${uid}/notificationInbox/${itemId}`);
  const itemSnap = await itemRef.get();
  if (!itemSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Notification inbox item was not found.');
  }

  await itemRef.update({
    readAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { status: 'success', updatedCount: 1 };
});

exports.markAllNotificationInboxRead = functions.https.onCall(async (_data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before updating notification inbox items.');
  }

  const uid = context.auth.uid;
  const unreadSnap = await firestore
    .collection(`users/${uid}/notificationInbox`)
    .where('readAt', '==', null)
    .limit(NOTIFICATION_INBOX_MAX_ITEMS)
    .get();

  if (unreadSnap.empty) {
    return { status: 'success', updatedCount: 0 };
  }

  const readAt = admin.firestore.FieldValue.serverTimestamp();
  const batch = firestore.batch();
  unreadSnap.docs.forEach((doc) => {
    batch.update(doc.ref, { readAt });
  });
  await batch.commit();

  return { status: 'success', updatedCount: unreadSnap.size };
});

function normalizeScheduleStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function truncateNotificationBody(text, maxLength = 120) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
}

function buildScheduleUpdateNotificationPayload(beforeGame, afterGame) {
  const eventTitle = getEventTitle(afterGame || beforeGame || {});
  const beforeStatus = normalizeScheduleStatus(beforeGame?.status);
  const afterStatus = normalizeScheduleStatus(afterGame?.status);
  const isCanceled = afterStatus === 'cancelled' || afterStatus === 'canceled';
  const becameCanceled = isCanceled && beforeStatus !== afterStatus;
  const dateChanged = valuesDiffer(beforeGame?.date ?? null, afterGame?.date ?? null);
  const locationChanged = valuesDiffer(beforeGame?.location ?? null, afterGame?.location ?? null);
  const titleChanged = valuesDiffer(beforeGame?.title ?? null, afterGame?.title ?? null) ||
    valuesDiffer(beforeGame?.opponent ?? null, afterGame?.opponent ?? null);

  if (becameCanceled) {
    return {
      title: 'Event canceled',
      body: truncateNotificationBody(`${eventTitle} was canceled. Tap to review the latest details.`)
    };
  }

  if (dateChanged) {
    const dateText = formatScheduleUpdateDate(afterGame?.date, afterGame?.timeZone || beforeGame?.timeZone);
    return {
      title: 'Schedule update',
      body: truncateNotificationBody(dateText
        ? `${eventTitle} moved to ${dateText}.`
        : `${eventTitle} date/time changed. Tap to review.`)
    };
  }

  if (locationChanged) {
    const location = String(afterGame?.location || '').trim();
    return {
      title: 'Schedule update',
      body: truncateNotificationBody(location
        ? `${eventTitle} moved to ${location}.`
        : `${eventTitle} location changed. Tap to review.`)
    };
  }

  if (titleChanged) {
    return {
      title: 'Schedule update',
      body: truncateNotificationBody(`Schedule updated: ${eventTitle}. Tap to review.`)
    };
  }

  return {
    title: 'Schedule update',
    body: 'A team event was updated. Tap to review the latest details.'
  };
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
  const drainSummary = await drainDueReminderPages({
    now,
    maxPages: PRE_EVENT_REMINDER_MAX_PAGES_PER_RUN,
    maxRuntimeMs: PRE_EVENT_REMINDER_MAX_RUNTIME_MS,
    loadPage: async ({ dueIso, cursor, limit }) => {
      let query = firestore
        .collectionGroup('games')
        .where('scheduleNotifications.nextReminderAt', '<=', dueIso)
        .orderBy('scheduleNotifications.nextReminderAt')
        .limit(limit || PRE_EVENT_REMINDER_QUERY_PAGE_SIZE);
      if (cursor) {
        query = query.startAfter(cursor);
      }
      const dueSnap = await query.get();
      return {
        docs: dueSnap.docs,
        nextCursor: dueSnap.docs[dueSnap.docs.length - 1] || null
      };
    },
    processReminder: async (docSnap) => {
      const eventRef = docSnap.ref;
      const teamRef = eventRef.parent?.parent;
      const teamId = teamRef?.id;
      const gameId = eventRef.id;
      if (!teamId) return null;

      const claimId = `pre-event-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const claimedEvent = await markReminderSending(eventRef, claimId, now);
      if (!claimedEvent) return null;

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
          eventId: gameId,
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
        return {
          teamId,
          gameId,
          sent: Number(sendResult?.successCount || 0),
          chatMessageId: chatResult.messageId,
          chatMessageCreated: chatResult.created,
          rsvpEmailCount: emailResult.sentCount
        };
      } catch (error) {
        await markReminderPendingAfterFailure(eventRef, claimId, error);
        console.error('Failed to dispatch pre-event reminder', { teamId, gameId, error });
        return null;
      }
    }
  });

  return drainSummary.results.filter(Boolean);
}

exports.dispatchDuePreEventReminders = functions.pubsub
  .schedule('every 15 minutes')
  .onRun(() => dispatchDuePreEventReminders());

exports.queueDueRegistrationFailedPaymentReminders = functions.pubsub
  .schedule('every 6 hours')
  .onRun(() => queueDueRegistrationFailedPaymentReminders());

function getPracticePacketReminderDueDate(packet = {}, session = {}) {
  return coercePracticePacketDate(
    packet.dueDate
    || packet.dueAt
    || packet.deadline
    || packet.deadlineAt
    || packet.completeBy
    || packet.completeByAt
    || session.date
  );
}

function getTomorrowDateRange(now = new Date()) {
  const start = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
    0,
    0,
    0,
    0
  ));
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function isPracticePacketDueTomorrow(packet = {}, session = {}, now = new Date()) {
  const dueDate = getPracticePacketReminderDueDate(packet, session);
  if (!dueDate) return false;
  const { start, end } = getTomorrowDateRange(now);
  return dueDate >= start && dueDate < end;
}

function getPracticePacketReminderDocRef(teamId, sessionId, playerId) {
  return firestore.doc(`teams/${teamId}/practiceSessions/${sessionId}/packetReminderSends/${playerId}`);
}

const PRACTICE_PACKET_REMINDER_CLAIM_TTL_MS = 15 * 60 * 1000;

function buildPracticePacketReminderClaimId() {
  return `practice-packet-${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex')}`;
}

async function claimPracticePacketReminder(teamId, sessionId, playerId, now = new Date()) {
  const reminderRef = getPracticePacketReminderDocRef(teamId, sessionId, playerId);
  return firestore.runTransaction(async (transaction) => {
    const reminderSnap = await transaction.get(reminderRef);
    const reminder = reminderSnap.exists ? (reminderSnap.data() || {}) : {};
    if (reminder.reminderSentAt) {
      return null;
    }

    const deliveryClaimedAt = coercePracticePacketDate(reminder.deliveryClaimedAt);
    const hasActiveClaim = reminder.deliveryClaimId
      && deliveryClaimedAt
      && (now.getTime() - deliveryClaimedAt.getTime()) < PRACTICE_PACKET_REMINDER_CLAIM_TTL_MS;
    if (hasActiveClaim) {
      return null;
    }

    const claimId = buildPracticePacketReminderClaimId();
    transaction.set(reminderRef, {
      playerId,
      deliveryClaimId: claimId,
      deliveryClaimedAt: admin.firestore.FieldValue.serverTimestamp(),
      reminderSentAt: null,
      lastError: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return claimId;
  });
}

async function getPracticePacketReminderTargetUserIds(teamId, playerId, player = {}) {
  const privateProfileSnap = await firestore.doc(`teams/${teamId}/players/${playerId}/private/profile`).get();
  const privateProfile = privateProfileSnap.exists ? (privateProfileSnap.data() || {}) : {};
  return getTeamFeeRecipientTargetUserIds({}, player, privateProfile);
}

async function markPracticePacketReminderSent(teamId, sessionId, playerId, claimId) {
  const reminderRef = getPracticePacketReminderDocRef(teamId, sessionId, playerId);
  return firestore.runTransaction(async (transaction) => {
    const reminderSnap = await transaction.get(reminderRef);
    const reminder = reminderSnap.exists ? (reminderSnap.data() || {}) : {};
    if (reminder.reminderSentAt || reminder.deliveryClaimId !== claimId) {
      return false;
    }

    transaction.set(reminderRef, {
      playerId,
      reminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
      deliveryClaimId: null,
      deliveryClaimedAt: null,
      lastError: null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return true;
  });
}

async function clearPracticePacketReminderClaim(teamId, sessionId, playerId, claimId, error) {
  const reminderRef = getPracticePacketReminderDocRef(teamId, sessionId, playerId);
  return firestore.runTransaction(async (transaction) => {
    const reminderSnap = await transaction.get(reminderRef);
    const reminder = reminderSnap.exists ? (reminderSnap.data() || {}) : {};
    if (reminder.deliveryClaimId !== claimId || reminder.reminderSentAt) {
      return false;
    }

    transaction.set(reminderRef, {
      playerId,
      deliveryClaimId: null,
      deliveryClaimedAt: null,
      lastError: error?.message || 'Unknown practice packet reminder error',
      lastAttemptAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return true;
  });
}

async function sendPracticePacketDueTomorrowReminders(now = new Date()) {
  if (!NOTIFICATION_CATEGORIES.includes('practice')) {
    functions.logger.error('sendPracticePacketDueTomorrowReminders requires the practice notification category.', {
      availableCategories: NOTIFICATION_CATEGORIES
    });
    return [];
  }

  const sessionSnap = await firestore.collectionGroup('practiceSessions')
    .where('homePacketGenerated', '==', true)
    .get();

  const practiceTargetsByTeam = new Map();
  const results = [];

  for (const docSnap of sessionSnap.docs) {
    const session = docSnap.data() || {};
    const packet = session.homePacketContent || null;
    if (!hasPracticePacketContent(packet)) continue;
    if (!isPracticePacketDueTomorrow(packet, session, now)) continue;

    const pathParts = docSnap.ref.path.split('/');
    const teamId = pathParts[1];
    const sessionId = docSnap.id;
    if (!teamId || !sessionId) continue;

    const [playersSnap, completionsSnap] = await Promise.all([
      firestore.collection(`teams/${teamId}/players`).get(),
      firestore.collection(`teams/${teamId}/practiceSessions/${sessionId}/packetCompletions`).get()
    ]);
    const completedPlayerIds = new Set(
      completionsSnap.docs
        .map((completionSnap) => completionSnap.data() || {})
        .filter((completion) => String(completion.status || 'completed').trim().toLowerCase() === 'completed')
        .map((completion) => String(completion.childId || '').trim())
        .filter(Boolean)
    );

    let practiceTargets = practiceTargetsByTeam.get(teamId);
    if (!practiceTargets) {
      practiceTargets = await getTargetsForCategory(teamId, 'practice', null);
      practiceTargetsByTeam.set(teamId, practiceTargets);
    }
    if (!practiceTargets.length) continue;

    const scheduleEventId = String(session.eventId || '').trim() || sessionId;
    const destination = buildPracticePacketNotificationDestination({ teamId, eventId: scheduleEventId, sessionId });
    const packetTitle = getPracticePacketNotificationTitle(packet, session);

    for (const playerSnap of playersSnap.docs) {
      const playerId = String(playerSnap.id || '').trim();
      const player = playerSnap.data() || {};
      if (!playerId || player.active === false) continue;
      if (completedPlayerIds.has(playerId)) continue;

      const candidateUserIds = await getPracticePacketReminderTargetUserIds(teamId, playerId, player);
      if (!candidateUserIds.length) continue;

      const candidateUserIdSet = new Set(candidateUserIds);
      const parentTargets = practiceTargets.filter((target) => candidateUserIdSet.has(target.uid));
      if (!parentTargets.length) continue;

      const claimId = await claimPracticePacketReminder(teamId, sessionId, playerId, now);
      if (!claimId) continue;

      try {
        await sendDirectTargetsNotification({
          targets: parentTargets,
          category: 'practice',
          title: `Reminder: ${packetTitle} is due tomorrow`,
          body: `${String(player.name || 'Your player').trim() || 'Your player'} has not completed the ${getPracticePacketNotificationLabel(session)} yet.`,
          teamId,
          eventId: sessionId,
          linkOverride: destination.link,
          appRouteOverride: destination.appRoute
        });

        const markedSent = await markPracticePacketReminderSent(teamId, sessionId, playerId, claimId);
        if (!markedSent) continue;

        results.push({
          teamId,
          sessionId,
          playerId,
          targetCount: parentTargets.length
        });
      } catch (error) {
        await clearPracticePacketReminderClaim(teamId, sessionId, playerId, claimId, error);
        functions.logger.error('Failed to send practice packet due tomorrow reminder.', {
          teamId,
          sessionId,
          playerId,
          error: error?.message || error
        });
      }
    }
  }

  return results;
}

exports.sendPracticePacketDueTomorrowReminders = functions.pubsub
  .schedule('every 24 hours')
  .onRun(() => sendPracticePacketDueTomorrowReminders());

function getFeeReminderPlayerKey(recipient = {}, teamId = '') {
  const explicitPlayerKey = String(recipient.playerKey || '').trim();
  if (explicitPlayerKey) return explicitPlayerKey;
  const resolvedTeamId = String(recipient.teamId || teamId || '').trim();
  const playerId = String(recipient.playerId || recipient.childId || '').trim();
  if (!resolvedTeamId || !playerId) return '';
  return `${resolvedTeamId}::${playerId}`;
}

function buildFeeReminderCandidateUserIds(recipient = {}, playerOwnerIds = []) {
  return Array.from(new Set([
    recipient.userId,
    recipient.accountUserId,
    recipient.parentUserId,
    ...playerOwnerIds
  ].map((value) => String(value || '').trim()).filter(Boolean)));
}

async function resolveFeeReminderCandidateUserIds(teamId, recipient = {}) {
  const playerKey = getFeeReminderPlayerKey(recipient, teamId);
  let playerOwnerIds = [];
  if (playerKey) {
    const parentSnap = await firestore.collection('users')
      .where('parentPlayerKeys', 'array-contains', playerKey)
      .get();
    playerOwnerIds = parentSnap.docs
      .map((docSnap) => String(docSnap.id || '').trim())
      .filter(Boolean);
  }
  return buildFeeReminderCandidateUserIds(recipient, playerOwnerIds);
}

async function sendFeeUnpaidDueReminders() {
  const now = admin.firestore.Timestamp.now();
  const threeDaysLater = admin.firestore.Timestamp.fromMillis(now.toMillis() + 3 * 24 * 60 * 60 * 1000);

  // Use 'in' filter instead of '!=' to avoid Firestore inequality-on-different-field restriction
  const snap = await firestore.collectionGroup('feeRecipients')
    .where('status', 'in', ['unpaid', 'pending'])
    .where('dueDate', '>=', now)
    .where('dueDate', '<=', threeDaysLater)
    .get();

  const promises = snap.docs.map(async (doc) => {
    const data = doc.data();
    // Skip if reminder already sent (deduplication guard)
    if (data.reminderSentAt) return null;
    const pathParts = doc.ref.path.split('/');
    // Path structure: teams/{teamId}/feeBatches/{batchId}/feeRecipients/{recipientId}
    const teamId = pathParts[1];
    const batchId = pathParts[3];
    const recipientId = pathParts[5];
    if (!teamId) return null;
    const title = data.feeTitle || data.title || 'Team fee due soon';
    const amountLabel = formatMoneyFromCents(getTeamFeeBalanceCents(data), data.currency || 'USD');

    try {
      const candidateUserIds = await resolveFeeReminderCandidateUserIds(teamId, data);
      if (!candidateUserIds.length) return null;

      const allTargets = await getTargetsForCategory(teamId, 'fees', null);
      const candidateUserIdSet = new Set(candidateUserIds);
      const payerTargets = allTargets.filter((t) => candidateUserIdSet.has(t.uid));
      if (!payerTargets.length) return null;

      // Mark reminderSentAt only when targets exist, to prevent duplicate sends if function retries
      await doc.ref.update({ reminderSentAt: admin.firestore.FieldValue.serverTimestamp() });

      await sendDirectTargetsNotification({
        targets: payerTargets,
        category: 'fees',
        title: `Reminder: ${title} is due soon`,
        body: `${amountLabel} is due in 3 days or less.`,
        teamId,
        batchId,
        recipientId,
      });
      return { teamId, payerUserIds: candidateUserIds, feeTitle: title };
    } catch (err) {
      console.error('sendFeeUnpaidDueReminders: failed to notify', { teamId, candidateUserIds: buildFeeReminderCandidateUserIds(data), error: err });
      return null;
    }
  });

  const results = await Promise.allSettled(promises);
  const sent = results.filter((r) => r.status === 'fulfilled' && r.value).length;
  console.log(`sendFeeUnpaidDueReminders: processed ${snap.docs.length} docs, sent ${sent} reminders`);
}

exports.sendFeeUnpaidDueReminders = functions.pubsub
  .schedule('every 24 hours')
  .onRun(() => sendFeeUnpaidDueReminders());

function formatMoneyFromCents(amountCents, currency = 'USD') {
  const cents = Math.max(0, Math.round(Number(amountCents || 0)));
  const normalizedCurrency = String(currency || 'USD').trim().toUpperCase() || 'USD';
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: normalizedCurrency
    }).format(cents / 100);
  } catch (error) {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function getFeePaymentAmountCents(before = {}, after = {}) {
  const explicitAmount = Number(
    after.stripePaymentAmountCents
    ?? after.manualPayment?.amountPaidCents
    ?? after.receiptMetadata?.amountPaidCents
    ?? after.adminBilling?.amountPaidCents
  );
  if (Number.isFinite(explicitAmount) && explicitAmount > 0) {
    return Math.round(explicitAmount);
  }

  const afterPaid = Number(after.paidAmountCents ?? after.amountPaidCents ?? after.totalPaidCents ?? 0);
  const beforePaid = Number(before.paidAmountCents ?? before.amountPaidCents ?? before.totalPaidCents ?? 0);
  if (Number.isFinite(afterPaid) && Number.isFinite(beforePaid) && afterPaid > beforePaid) {
    return Math.round(afterPaid - beforePaid);
  }

  return 0;
}

function getFeePayerIdentity(recipient = {}) {
  return [
    recipient.parentName,
    recipient.payerName,
    recipient.receiptMetadata?.receiptName,
    recipient.receiptMetadata?.receiptEmail,
    recipient.parentEmail,
    recipient.guardianName,
    recipient.guardianEmail,
    recipient.userDisplayName,
    recipient.userEmail,
    recipient.email
  ].map((value) => String(value || '').trim()).find(Boolean) || 'A parent';
}

function normalizeTeamChatConversationId(value) {
  const conversationId = String(value || '').trim();
  return conversationId || 'team';
}

function detectMentionedUids(text, members, options = {}) {
  if (!text) return [];
  const { allowReservedMentions = false } = options || {};
  const mentioned = new Set();
  const tokens = text.match(/@[\w.'"-]+/gi) || [];
  for (const token of tokens) {
    const name = token.slice(1).toLowerCase();
    if (name === 'all' || name === 'team') {
      if (!allowReservedMentions) continue;
      members.forEach((m) => mentioned.add(m.uid));
      break;
    }
    for (const member of members) {
      const memberName = String(member.displayName || member.name || '').toLowerCase();
      const memberNameCompact = memberName.replace(/\s+/g, '');
      const firstName = memberName.split(' ')[0];
      if (memberNameCompact === name || firstName === name) {
        mentioned.add(member.uid);
      }
    }
  }
  return [...mentioned];
}

async function buildTeamChatNotificationContext(teamId, options = {}) {
  const { includeMentions = true, conversationId = null } = options || {};
  const normalizedConversationId = normalizeTeamChatConversationId(conversationId);
  const teamSnap = await firestore.doc(`teams/${teamId}`).get();
  if (!teamSnap.exists) {
    return {
      members: [],
      mutedUids: [],
      targetsByCategory: {
        mentions: [],
        liveChat: []
      }
    };
  }

  const team = teamSnap.data() || {};
  const users = new Map();
  const addRole = (uid, role) => {
    const normalizedUid = String(uid || '').trim();
    if (!normalizedUid) return;
    const entry = users.get(normalizedUid) || { uid: normalizedUid, roles: new Set() };
    entry.roles.add(role);
    users.set(normalizedUid, entry);
  };

  addRole(team.ownerId, 'staff');

  const [parentSnap, indexedTargetSnap, adminUserIds] = await Promise.all([
    firestore.collection('users').where('parentTeamIds', 'array-contains', teamId).get(),
    firestore.collection(`teams/${teamId}/notificationTargets`).get(),
    getUserIdsByEmails(team.adminEmails || [])
  ]);

  parentSnap.forEach((docSnap) => addRole(docSnap.id, 'parent'));
  adminUserIds.forEach((uid) => addRole(uid, 'staff'));

  const members = Array.from(users.values()).map((entry) => ({
    uid: entry.uid,
    roles: Array.from(entry.roles)
  }));
  const userRecords = await getUserRecordsByIds(members.map((member) => member.uid));

  const categories = includeMentions ? ['mentions', 'liveChat'] : ['liveChat'];
  const eligibleUidsByCategory = categories.reduce((accumulator, category) => {
    accumulator[category] = new Set(
      members
        .filter((member) => notificationAudienceAllowsRoles(category, member.roles))
        .map((member) => member.uid)
    );
    return accumulator;
  }, {});

  const indexedTargetsByCategory = {
    mentions: [],
    liveChat: []
  };
  const indexedUserIdsByCategory = {
    mentions: new Set(),
    liveChat: new Set()
  };

  indexedTargetSnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const uid = String(data.uid || '').trim();
    const deviceId = String(data.deviceId || '').trim();
    const token = String(data.token || '').trim();
    if (!uid || !deviceId || !token) return;

    categories.forEach((category) => {
      if (data.categories?.[category] !== true) return;
      if (!eligibleUidsByCategory[category].has(uid)) return;
      indexedTargetsByCategory[category].push({ uid, deviceId, token, teamId });
      indexedUserIdsByCategory[category].add(uid);
    });
  });

  const fallbackTargetsByCategory = {
    mentions: [],
    liveChat: []
  };

  for (const category of categories) {
    const missingUsers = members.filter((member) => (
      eligibleUidsByCategory[category].has(member.uid)
      && !indexedUserIdsByCategory[category].has(member.uid)
    ));
    if (!missingUsers.length) continue;
    fallbackTargetsByCategory[category] = await getLegacyTargetsForCategory(teamId, category, missingUsers, null);
  }

  const hydratedMembers = members.map((member) => {
    const userRecord = userRecords.get(member.uid) || {};
    const chatMuted = userRecord.chatMuted;
    const mutedConversations = userRecord.teamChatState?.[teamId]?.mutedConversations;
    const conversationMuted = Boolean(
      mutedConversations
      && typeof mutedConversations === 'object'
      && mutedConversations[normalizedConversationId]
    );
    return {
      ...member,
      displayName: includeMentions
        ? String(userRecord.displayName || userRecord.fullName || userRecord.name || '').trim()
        : '',
      muted: conversationMuted || Boolean(normalizedConversationId === 'team' && chatMuted && chatMuted[teamId])
    };
  });

  return {
    members: hydratedMembers,
    mutedUids: hydratedMembers.filter((member) => member.muted).map((member) => member.uid),
    targetsByCategory: {
      mentions: [...indexedTargetsByCategory.mentions, ...fallbackTargetsByCategory.mentions],
      liveChat: [...indexedTargetsByCategory.liveChat, ...fallbackTargetsByCategory.liveChat]
    }
  };
}

function buildTeamChatNotificationPlan({ text, actorUid = null, recipientContext }) {
  const context = recipientContext || {
    members: [],
    mutedUids: [],
    targetsByCategory: { mentions: [], liveChat: [] }
  };
  const mentionTargets = Array.isArray(context.targetsByCategory?.mentions)
    ? context.targetsByCategory.mentions
    : [];
  const liveChatTargets = Array.isArray(context.targetsByCategory?.liveChat)
    ? context.targetsByCategory.liveChat
    : [];
  const mentionEligibleUids = new Set(mentionTargets.map((target) => target.uid));
  const mentionMembers = Array.isArray(context.members)
    ? context.members.filter((member) => mentionEligibleUids.has(member.uid))
    : [];
  const actorIsStaff = Boolean(
    actorUid
    && Array.isArray(context.members)
    && context.members.some((member) => member.uid === actorUid && Array.isArray(member.roles) && member.roles.includes('staff'))
  );
  const mentionedUids = text
    ? detectMentionedUids(text, mentionMembers, { allowReservedMentions: actorIsStaff }).filter((uid) => uid !== actorUid)
    : [];
  const mentionedSet = new Set(mentionedUids);
  const mutedSet = new Set(Array.isArray(context.mutedUids) ? context.mutedUids : []);

  return {
    mentionedUids,
    mentionTargets: mentionTargets.filter((target) => target.uid !== actorUid && mentionedSet.has(target.uid)),
    liveChatTargets: liveChatTargets.filter((target) => (
      target.uid !== actorUid
      && !mentionedSet.has(target.uid)
      && !mutedSet.has(target.uid)
    ))
  };
}

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
    const conversationId = normalizeTeamChatConversationId(data.conversationId);
    const senderName = String(data.senderName || 'Team').trim();
    const body = text
      ? (text.length > 120 ? `${text.slice(0, 117)}...` : text)
      : 'sent a photo';

    const shouldResolveMentions = Boolean(text);
    const recipientContext = await buildTeamChatNotificationContext(teamId, {
      includeMentions: shouldResolveMentions,
      conversationId
    });
    const notificationPlan = buildTeamChatNotificationPlan({
      text,
      actorUid,
      recipientContext
    });

    // Detect @mentions and send targeted mentions-category pushes
    const mentionedUids = notificationPlan.mentionedUids;

    const results = [];

    if (mentionedUids.length) {
      await snapshot.ref.update({ mentionedUids });
      // Send mentions push only to the mentioned users (those who have mentions enabled)
      if (notificationPlan.mentionTargets.length) {
        results.push(await sendDirectTargetsNotification({
          targets: notificationPlan.mentionTargets,
          category: 'mentions',
          title: `${senderName} mentioned you`,
          body,
          teamId,
          conversationId
        }));
      }
    }

    if (!notificationPlan.liveChatTargets.length) {
      return results.length ? results : null;
    }

    // liveChat push — skip users who already got a mentions push or muted this conversation
    results.push(await sendDirectTargetsNotification({
      targets: notificationPlan.liveChatTargets,
      category: 'liveChat',
      title: `${senderName}: Team Chat`,
      body,
      teamId,
      conversationId
    }));

    return results;
  });

exports.postSharedGameCancellationNotification = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in to notify the linked team chat.');
  }

  const teamId = normalizeText(data?.teamId, 160);
  const gameId = normalizeText(data?.gameId, 160);
  const counterpartTeamId = normalizeText(data?.counterpartTeamId, 160);
  const text = normalizeText(data?.text, 4000);
  const senderName = normalizeText(data?.senderName, 160) || 'Team Staff';
  const senderEmail = normalizeText(data?.senderEmail, 320) || null;

  if (!teamId || !gameId || !counterpartTeamId || !text) {
    throw new functions.https.HttpsError('invalid-argument', 'teamId, gameId, counterpartTeamId, and text are required.');
  }

  const callerEmail = String(context.auth.token?.email || '').trim().toLowerCase();
  const [sourceTeamSnap, counterpartTeamSnap, sourceGameSnap, userSnap] = await Promise.all([
    firestore.doc(`teams/${teamId}`).get(),
    firestore.doc(`teams/${counterpartTeamId}`).get(),
    firestore.doc(`teams/${teamId}/games/${gameId}`).get(),
    firestore.doc(`users/${context.auth.uid}`).get()
  ]);

  if (!sourceTeamSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Source team not found.');
  }
  if (!counterpartTeamSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Counterpart team not found.');
  }
  if (!sourceGameSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Source game not found.');
  }

  const sourceTeam = sourceTeamSnap.data() || {};
  const user = userSnap.exists ? userSnap.data() || {} : {};
  if (!hasTeamAdminAccess({ team: sourceTeam, user, uid: context.auth.uid, email: callerEmail })) {
    throw new functions.https.HttpsError('permission-denied', 'Only team coaches and admins can notify the linked team chat.');
  }

  const sourceGame = sourceGameSnap.data() || {};
  const linkedCounterpartTeamId = String(sourceGame.sharedScheduleOpponentTeamId || sourceGame.opponentTeamId || '').trim();
  if (!linkedCounterpartTeamId || linkedCounterpartTeamId !== counterpartTeamId) {
    throw new functions.https.HttpsError('failed-precondition', 'Game is not linked to the requested counterpart team.');
  }
  if (String(sourceGame.status || '').trim().toLowerCase() !== 'cancelled') {
    throw new functions.https.HttpsError('failed-precondition', 'Cancel the game before notifying the linked team chat.');
  }

  const messageRef = firestore.collection(`teams/${counterpartTeamId}/chatMessages`).doc();
  await messageRef.set({
    text,
    senderId: context.auth.uid,
    senderName,
    senderEmail,
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
      type: 'shared-game-cancelled',
      sourceTeamId: teamId,
      sourceGameId: gameId
    },
    targetType: 'full_team',
    recipientIds: [],
    targetRole: null,
    conversationId: null
  });

  return {
    posted: true,
    messageId: messageRef.id
  };
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

    const payload = buildScheduleUpdateNotificationPayload(before, after);

    return sendCategoryNotification({
      teamId,
      gameId,
      category,
      title: payload.title,
      body: payload.body,
      actorUid
    });
  });

const notifyGameCreated = functions.firestore
  .document('teams/{teamId}/games/{gameId}')
  .onCreate(async (snapshot, context) => {
    const game = snapshot.data() || {};
    const teamId = context.params.teamId;
    const gameId = context.params.gameId;
    const importBatch = normalizeScheduleImportBatch(game.importBatch);

    const status = String(game.status || '').trim().toLowerCase();
    if (status === 'draft') return null;
    if (importBatch && importBatch.totalCount > 3) {
      return registerScheduleImportBatchEvent({ teamId, gameId, game, batch: importBatch });
    }

    return sendCreatedScheduleEventNotification({ teamId, gameId, game });
  });

exports.notifyGameCreated = notifyGameCreated;
exports._internal.notifyGameCreated = notifyGameCreated;

const notifyScheduleImportBatchCompleted = functions.firestore
  .document('teams/{teamId}/scheduleImportNotificationBatches/{batchId}')
  .onWrite(async (change, context) => {
    const after = change.after.exists ? (change.after.data() || {}) : null;
    if (!after || !after.importCompletedAt || after.sentAt || after.notificationClaimedAt) {
      return null;
    }

    return sendScheduleImportBatchNotifications({
      teamId: context.params.teamId,
      batchId: context.params.batchId,
      batch: after
    });
  });

exports.notifyScheduleImportBatchCompleted = notifyScheduleImportBatchCompleted;
exports._internal.notifyScheduleImportBatchCompleted = notifyScheduleImportBatchCompleted;

exports.notifyFeeMarkedPaid = functions.firestore
  .document('teams/{teamId}/feeBatches/{batchId}/feeRecipients/{recipientId}')
  .onWrite(async (change, context) => {
    const before = change.before.exists ? change.before.data() : null;
    const after = change.after.exists ? change.after.data() : null;
    if (!after) return null;
    if (String(after.status || '').trim().toLowerCase() !== 'paid') return null;
    if (String(before?.status || '').trim().toLowerCase() === 'paid') return null;

    if (!NOTIFICATION_CATEGORIES.includes('fees')) {
      functions.logger.error('notifyFeeMarkedPaid requires the fees notification category.', {
        teamId: context.params?.teamId || null,
        availableCategories: NOTIFICATION_CATEGORIES
      });
      return null;
    }

    const { teamId, batchId, recipientId } = context.params;
    const title = String(after.feeTitle || after.title || 'Team fee').trim();
    const payerUserId = String(after.userId || after.parentUserId || '').trim() || null;
    const staffFeeDestination = buildStaffFeeNotificationDestination({ teamId, batchId, recipientId });
    const paymentAmountCents = getFeePaymentAmountCents(before, after);
    const paymentAmountDisplay = formatMoneyFromCents(
      paymentAmountCents,
      after.currency || after.receiptMetadata?.currency || 'USD'
    );
    const payerIdentity = getFeePayerIdentity(after);
    const wasPaymentRecorded = paymentAmountCents > 0;

    const [allFeeTargets, candidateUsers] = await Promise.all([
      getTargetsForCategory(teamId, 'fees', null),
      getCandidateUsersForTeam(teamId)
    ]);
    const staffUserIds = new Set(
      candidateUsers
        .filter((user) => Array.isArray(user?.roles) && user.roles.includes('staff'))
        .map((user) => user.uid)
    );

    const promises = [];
    if (payerUserId) {
      const payerTargets = allFeeTargets.filter((target) => target.uid === payerUserId);
      if (payerTargets.length) {
        promises.push(sendDirectTargetsNotification({
          targets: payerTargets,
          category: 'fees',
          title: wasPaymentRecorded ? `Payment received: ${title}` : `Fee paid: ${title}`,
          body: wasPaymentRecorded
            ? `We received your ${paymentAmountDisplay} payment. Thank you!`
            : 'Your fee balance is now marked as paid.',
          teamId
        }));
      }
    }

    const staffTargets = allFeeTargets.filter((target) => staffUserIds.has(target.uid) && target.uid !== payerUserId);
    if (staffTargets.length) {
      promises.push(sendDirectTargetsNotification({
        targets: staffTargets,
        category: 'fees',
        title: `Fee paid: ${title}`,
        body: wasPaymentRecorded
          ? `${payerIdentity} paid ${paymentAmountDisplay}.`
          : `${payerIdentity}'s fee balance is now marked as paid.`,
        teamId,
        batchId,
        recipientId,
        linkOverride: staffFeeDestination.link,
        appRouteOverride: staffFeeDestination.appRoute
      }));
    } else {
      functions.logger.warn('notifyFeeMarkedPaid found no staff notification targets.', {
        teamId,
        recipientId: context.params?.recipientId || null,
        payerUserId,
        totalFeeTargets: allFeeTargets.length
      });
    }

    await Promise.allSettled(promises);
    return null;
  });

exports.notifyPublishedCertificateAward = functions.firestore
  .document('teams/{teamId}/certificates/{certificateId}')
  .onWrite(async (change, context) => {
    const beforeData = change.before.exists ? (change.before.data() || null) : null;
    const afterData = change.after.exists ? (change.after.data() || null) : null;
    if (!afterData) return null;

    const wasPublished = String(beforeData?.status || '').trim() === 'published';
    const isPublished = String(afterData.status || '').trim() === 'published';
    if (!isPublished || wasPublished) return null;

    if (!NOTIFICATION_CATEGORIES.includes('awards')) {
      functions.logger.error('notifyPublishedCertificateAward requires the awards notification category.', {
        teamId: context.params?.teamId || null,
        availableCategories: NOTIFICATION_CATEGORIES
      });
      return null;
    }

    const eventId = String(context.eventId || '').trim();
    const claimed = await claimPublishedCertificateAwardNotification(change.after.ref, eventId);
    if (!claimed) return null;

    const { teamId, certificateId } = context.params || {};
    const parentUserIds = await resolvePublishedCertificateParentUserIds(teamId, afterData);
    if (!parentUserIds.length) {
      await markPublishedCertificateAwardNotificationProcessed(change.after.ref, eventId);
      return null;
    }

    const allAwardTargets = await getTargetsForCategory(
      teamId,
      'awards',
      null,
      {},
      parentUserIds.map((uid) => ({ uid, roles: ['parent'] }))
    );
    const parentUserIdSet = new Set(parentUserIds);
    const parentTargets = allAwardTargets.filter((target) => parentUserIdSet.has(target.uid));
    if (!parentTargets.length) {
      await markPublishedCertificateAwardNotificationProcessed(change.after.ref, eventId);
      return null;
    }

    const destination = buildAwardNotificationDestination({ teamId, certificateId });
    const playerName = String(afterData.recipientName || afterData.playerName || 'A player').trim() || 'A player';
    const awardTitle = String(afterData.awardTitle || afterData.title || 'Award').trim() || 'Award';

    await sendDirectTargetsNotification({
      targets: parentTargets,
      category: 'awards',
      title: `Award published for ${playerName}`,
      body: `${awardTitle} is ready to view in ParentTools.`,
      teamId,
      eventId: certificateId,
      linkOverride: destination.link,
      appRouteOverride: destination.appRoute
    });
    await markPublishedCertificateAwardNotificationProcessed(change.after.ref, eventId);
    return null;
  });

exports.notifyFeeAssigned = functions.firestore
  .document('teams/{teamId}/feeBatches/{batchId}/feeRecipients/{recipientId}')
  .onCreate(async (snapshot, context) => {
    const data = snapshot.data();
    if (!data) return null;

    if (!NOTIFICATION_CATEGORIES.includes('fees')) {
      functions.logger.error('notifyFeeAssigned requires the fees notification category.', {
        teamId: context.params?.teamId || null,
        availableCategories: NOTIFICATION_CATEGORIES
      });
      return null;
    }

    const { teamId } = context.params;
    const playerId = String(data.playerId || '').trim();
    const playerRef = playerId ? firestore.doc(`teams/${teamId}/players/${playerId}`) : null;
    const playerSnap = playerRef ? await playerRef.get() : null;
    const playerData = playerSnap?.exists ? { id: playerSnap.id, ...(playerSnap.data() || {}) } : {};
    let privateProfileData = {};
    if (playerRef) {
      const privateProfileSnap = await playerRef.collection('private').doc('profile').get();
      privateProfileData = privateProfileSnap.exists ? (privateProfileSnap.data() || {}) : {};
    }

    const payerUserIds = getTeamFeeRecipientTargetUserIds(data, playerData, privateProfileData);
    if (!payerUserIds.length) return null;

    const payerTargets = (await getTargetsForCategory(teamId, 'fees', null))
      .filter((target) => payerUserIds.includes(target.uid));
    if (!payerTargets.length) return null;

    const title = String(data.feeTitle || data.title || 'Team fee').trim();
    const amountCents = Number(data.amountCents || data.feeAmountCents || 0);
    const amountDisplay = amountCents > 0 ? ` (${formatMoneyFromCents(amountCents, data.currency || 'USD')})` : '';

    await sendDirectTargetsNotification({
      targets: payerTargets,
      category: 'fees',
      title: `New fee assigned: ${title}${amountDisplay}`,
      body: 'A new team fee has been assigned to your account.',
      teamId,
    });
    return null;
  });

exports.notifyPracticePacketCompleted = functions.firestore
  .document('teams/{teamId}/practiceSessions/{sessionId}/packetCompletions/{completionId}')
  .onCreate(async (snapshot, context) => {
    const data = snapshot.data();
    if (!data) return null;

    if (!NOTIFICATION_CATEGORIES.includes('practice')) {
      functions.logger.error('notifyPracticePacketCompleted requires the practice notification category.', {
        teamId: context.params?.teamId || null,
        availableCategories: NOTIFICATION_CATEGORIES
      });
      return null;
    }

    const { teamId, sessionId, completionId } = context.params;
    const parentUserId = String(data.parentUserId || '').trim() || null;
    const playerName = String(data.childName || 'A player').trim() || 'A player';

    const [allPracticeTargets, candidateUsers, sessionSnap] = await Promise.all([
      getTargetsForCategory(teamId, 'practice', null),
      getCandidateUsersForTeam(teamId),
      firestore.doc(`teams/${teamId}/practiceSessions/${sessionId}`).get()
    ]);
    const staffUserIds = new Set(
      candidateUsers
        .filter((user) => Array.isArray(user?.roles) && user.roles.includes('staff'))
        .map((user) => user.uid)
    );
    const staffTargets = allPracticeTargets.filter((target) => (
      staffUserIds.has(target.uid)
      && target.uid !== parentUserId
    ));

    if (!staffTargets.length) {
      functions.logger.warn('notifyPracticePacketCompleted found no staff notification targets.', {
        teamId,
        sessionId,
        completionId,
        parentUserId,
        totalPracticeTargets: allPracticeTargets.length
      });
      return null;
    }

    const session = sessionSnap.exists ? (sessionSnap.data() || {}) : {};
    const scheduleEventId = String(session.eventId || '').trim() || sessionId;
    const destination = buildPracticePacketNotificationDestination({ teamId, eventId: scheduleEventId, sessionId });

    await sendDirectTargetsNotification({
      targets: staffTargets,
      category: 'practice',
      title: `Home packet completed: ${playerName}`,
      body: `${playerName} completed the ${getPracticePacketNotificationLabel(session)}.`,
      teamId,
      eventId: sessionId,
      linkOverride: destination.link,
      appRouteOverride: destination.appRoute
    });
    return null;
  });

const PUBLIC_RSVP_TOKEN_TTL_DAYS = 14;
const PUBLIC_RSVP_EMAIL_BATCH_WRITE_LIMIT = 500;
const PUBLIC_RSVP_RESPONSES = new Set(['going', 'maybe', 'not_going']);

exports.notifyPracticePacketAssigned = functions.firestore
  .document('teams/{teamId}/practiceSessions/{sessionId}')
  .onWrite(async (change, context) => {
    const beforeData = change.before.exists ? (change.before.data() || null) : null;
    const afterData = change.after.exists ? (change.after.data() || null) : null;
    await practicePacketAssignedNotification(beforeData, afterData, context);
    return null;
  });

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
  const privateParents = Array.isArray(player?.privateProfileParents) ? player.privateProfileParents : [];
  const parents = privateParents.length > 0
    ? privateParents
    : (Array.isArray(player?.parents) ? player.parents : []);
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
  const batches = [];
  let batch = firestore.batch();
  let batchWriteCount = 0;
  let sentCount = 0;
  let linkCount = 0;

  const ensurePublicRsvpEmailBatchCapacity = () => {
    if (batchWriteCount + 2 <= PUBLIC_RSVP_EMAIL_BATCH_WRITE_LIMIT) return;
    batches.push(batch);
    batch = firestore.batch();
    batchWriteCount = 0;
  };

  const players = await Promise.all(playersSnap.docs.map(async (docSnap) => {
    const player = { id: docSnap.id, ...(docSnap.data() || {}) };
    if (player.active === false || respondedPlayerIds.has(player.id)) return player;
    const hasPublicContacts = (Array.isArray(player.parents) && player.parents.length > 0)
      || normalizePublicRsvpEmail(player.parentEmail || player.guardianEmail)
      || normalizePublicRsvpText(player.parentUserId || player.guardianUserId);
    if (hasPublicContacts) return player;
    const privateProfileSnap = await firestore.doc(`teams/${teamId}/players/${player.id}/private/profile`).get();
    const privateProfile = privateProfileSnap.exists ? (privateProfileSnap.data() || {}) : {};
    const privateParents = Array.isArray(privateProfile.parents) ? privateProfile.parents : [];
    return privateParents.length > 0
      ? { ...player, privateProfileParents: privateParents }
      : player;
  }));

  players.forEach((player) => {
    if (player.active === false || respondedPlayerIds.has(player.id)) return;
    getPublicRsvpParentContacts(player).forEach((contact) => {
      ensurePublicRsvpEmailBatchCapacity();
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
      batchWriteCount += 2;
      sentCount += 1;
      linkCount += 3;
    });
  });

  if (batchWriteCount > 0) {
    batches.push(batch);
  }
  for (const publicRsvpEmailBatch of batches) {
    await publicRsvpEmailBatch.commit();
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

const TEAM_EMAIL_ATTACHMENT_LIMIT_BYTES = 20 * 1024 * 1024;

function normalizeTeamEmailAttachmentRecord(attachment) {
  const name = String(attachment?.name || attachment?.fileName || '').trim();
  const storagePath = String(attachment?.storagePath || attachment?.path || '').trim();
  const contentType = String(attachment?.contentType || attachment?.type || 'application/octet-stream').trim();
  const size = Number(attachment?.size || attachment?.bytes || 0);
  if (!name || !storagePath || !Number.isFinite(size) || size <= 0) return null;
  return { name, storagePath, contentType, size };
}

function isTeamEmailAttachmentPathForTeam(teamId, storagePath) {
  const cleanTeamId = String(teamId || '').trim();
  const parts = String(storagePath || '').trim().split('/');
  return parts.length >= 5 &&
    parts[0] === 'team-email-attachments' &&
    parts[1] === cleanTeamId &&
    parts.slice(2).every(Boolean);
}

function normalizeTeamEmailAttachmentsForDelivery(teamId, attachments) {
  const rawAttachments = Array.isArray(attachments) ? attachments : [];
  const normalized = rawAttachments.map(normalizeTeamEmailAttachmentRecord).filter(Boolean);
  if (normalized.length !== rawAttachments.length ||
      normalized.some((attachment) => !isTeamEmailAttachmentPathForTeam(teamId, attachment.storagePath))) {
    throw new Error('Team email attachments must reference files for the same team.');
  }
  const totalBytes = normalized.reduce((sum, attachment) => sum + attachment.size, 0);
  if (totalBytes > TEAM_EMAIL_ATTACHMENT_LIMIT_BYTES) {
    throw new Error('Team email attachments exceed the 20 MB limit.');
  }
  return { attachments: normalized, totalBytes };
}

function buildTeamEmailMailDocId(teamId, sendId) {
  const safeTeamId = String(teamId || '').replace(/[^\w.-]+/g, '_').slice(0, 240);
  const safeSendId = String(sendId || '').replace(/[^\w.-]+/g, '_').slice(0, 240);
  return `teamEmail_${safeTeamId}_${safeSendId}`;
}

exports.queueTeamEmailDelivery = functions.firestore
  .document('teams/{teamId}/emailSends/{sendId}')
  .onCreate(async (snap, context) => {
    const { teamId, sendId } = context.params;
    const send = snap.data() || {};
    const recipients = Array.isArray(send.recipients)
      ? send.recipients.map((email) => String(email || '').trim()).filter(Boolean)
      : [];
    const subject = String(send.subject || '').trim();
    const body = String(send.body || '').trim();
    let attachmentSummary;
    try {
      attachmentSummary = normalizeTeamEmailAttachmentsForDelivery(teamId, send.attachments);
    } catch (error) {
      await snap.ref.set({
        status: 'failed',
        failureReason: error?.message || 'Invalid team email attachments.',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return;
    }
    const { attachments, totalBytes } = attachmentSummary;

    if (!recipients.length || !subject || !body) {
      await snap.ref.set({
        status: 'failed',
        failureReason: 'Missing recipients, subject, or body.',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return;
    }

    const mailRef = firestore.collection('mail').doc(buildTeamEmailMailDocId(teamId, sendId));
    await mailRef.set({
      to: recipients,
      message: {
        subject,
        text: body
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      metadata: {
        type: 'team_email',
        teamId,
        sendId,
        draftId: send.draftId || null,
        attachments,
        attachmentTotalBytes: totalBytes,
        createdBy: send.createdBy || null,
        createdByEmail: send.createdByEmail || null
      }
    });

    await snap.ref.set({
      status: 'queued',
      attachmentTotalBytes: totalBytes,
      mailJobId: mailRef.id,
      queuedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });
