const functions = require('firebase-functions');
const admin = require('firebase-admin');
const Stripe = require('stripe');
const { Resend } = require('resend');
const crypto = require('node:crypto');
const { isPrivateIpAddress, isBlockedHostname, assertPublicHost, normalizeTargetUrl, fetchWithTimeout } = require('./utils/security-utils');
const { createCalendarIcsCache, createCalendarIcsFetchHandler } = require('./calendar-ics-fetch-core.cjs');
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
const {
  getRegistrationPaidCheckoutGuardFailure,
  normalizeRegistrationCheckoutCurrency
} = require('./registration-payment-webhook-core.cjs');
const { createFirestoreFixedWindowRateLimiter, createInMemoryRateLimiter, getRequestIp } = require('./rate-limit.cjs');
const { buildPublicGamesIcs, canExposeEmptyPublicFeed, isPublicFanGame } = require('./public-calendar-core.cjs');
const { buildCalendarFeedGamesQuery } = require('./calendar-feed-window-core.cjs');
const {
  buildPublicRsvpSummaryProjection,
  buildPublicRsvpSummaryJobPlan,
  shouldPersistRecomputedPublicRsvpSummary,
  refreshPublicRsvpSummary
} = require('./public-rsvp-summary-core.cjs');
const {
  buildTeamCalendarIcs,
  normalizeCalendarRequest
} = require('./team-calendar-feed-core.cjs');
const {
  isFamilyShareTokenReadable,
  resolveFamilyShareChildrenFromOwnerProfile
} = require('./family-share-core.cjs');
const {
  buildHouseholdAccessRevocationPlan,
  isAcceptedHouseholdAccessCode
} = require('./household-access-core.cjs');
const {
  hashRsvpToken,
  createRawRsvpToken,
  normalizeRsvpTokenCreateInput,
  buildScopedRsvpDocId,
  validateRsvpTokenRedemption,
  buildRsvpTokenAuditPayload
} = require('./rsvp-token-core.cjs');
const { isAllowedPublicRsvpOrigin } = require('./public-rsvp-cors-core.cjs');
const { isAllowedTelemetryOrigin } = require('./telemetry-cors-core.cjs');
const {
  normalizeText,
  resolveTeamEmailRecipients,
  findUnknownTeamEmailRecipientIds,
  buildVerifiedTeamEmailAttachmentRecord,
  buildTeamEmailMailJob
} = require('./team-email-core.cjs');
const {
  buildParentInviteEmailMessage,
  isValidInviteRecipientEmail,
  normalizeInviteEmailType
} = require('./invite-email-core.cjs');
const {
  AUTH_EMAIL_TYPES,
  buildAuthEmailMailDocId,
  buildAuthEmailMailJob,
  buildAuthEmailRateLimitId,
  getAuthEmailActionSettings,
  getInviteContinueUrl,
  isValidAuthEmail,
  normalizeAuthEmail
} = require('./auth-email-core.cjs');
const { createAuthEmailCallableHandlers } = require('./auth-email-callables.cjs');
const { createAuthEmailDeliveryStore } = require('./auth-email-delivery-store.cjs');
const { createResendAuthEmailDelivery } = require('./resend-auth-email-delivery.cjs');
const { createPasswordResetEmailWorker } = require('./auth-email-password-reset-worker.cjs');
const { createPasswordResetEmailSweeper } = require('./auth-email-password-reset-sweeper.cjs');
const { findOwnedInviteCode: findOwnedAuthEmailInviteCode } = require('./auth-email-invite-store.cjs');
const {
  normalizeEmail,
  normalizeAccountMergePreviewInput,
  hashAccountMergeVerificationToken,
  requireAccountMergeVerificationToken,
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
const {
  buildGenericPreAuthAccessCodeValidationResult,
  isAccessCodeInactive,
  validateAccessCodeCandidates
} = require('./access-code-validation.cjs');
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
  buildBigMomentLiveEventNotification,
  buildLiveEventNotificationDedupKey,
  buildLiveScoreStateNotificationDedupKey,
  getLiveEventActorUid,
  isLiveEventNotificationFresh
} = require('./live-event-notification-core.cjs');
const {
  getStaleNotificationTokenCutoffMillis
} = require('./notification-token-sweep-core.cjs');
const {
  coerceDate,
  getEventTitle,
  formatScheduleUpdateDate
} = require('./schedule-notification-utils.cjs');
const {
  normalizeOpenOfficiatingSlotClaimInput,
  isEligibleOpenOfficiatingSlotParticipant,
  resolveOfficiatingGamePath,
  isTeamLinkedToSharedGame,
  buildOpenOfficiatingSlotClaimUpdate,
  buildOfficiatingSelfAssignmentNotificationRecord
} = require('./officiating-self-assignment-core.cjs');
const {
  assertSportsConnectSyncConfig,
  buildSportsConnectRegistrationSnapshot,
  buildSportsConnectSyncErrorUpdate,
  buildSportsConnectTeamUpdate,
  fetchSportsConnectRegistrationPayload,
  getRegistrationSource,
  getTeamSportsConnectConfig
} = require('./sports-connect-registration-sync.cjs');
const {
  cleanText: cleanOpportunityText,
  normalizeOpportunityFilters,
  normalizeOpportunityInput,
  getEffectiveOpportunityStatus,
  isOpportunityTeamDiscoverable,
  matchesOpportunityFilters,
  serializePublicOpportunity,
  buildOpportunityExpiry
} = require('./public-opportunities-core.cjs');
const {
  canMessageAcceptedFriendForTeam,
  createCheckAcceptedFriendMessageAccessHandler,
  hasCurrentTeamAccess
} = require('./friend-message-access-core.cjs');
const { hasTeamAdminAccess } = require('./team-admin-access-core.cjs');
const { createAutoAcceptParentInviteHandler } = require('./parent-invite-auto-link-callable.cjs');
const {
  normalizeParentInviteEmail,
  appendUniqueParentLink,
  appendUniqueValue,
  buildAutoAcceptedParentLink
} = require('./parent-invite-auto-link-core.cjs');

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const firestore = admin.firestore();
const INVITE_EMAIL_TYPES = new Set(['parent_invite', 'household_invite', 'coparent_invite']);
const EMAIL_LINK_INVITE_TYPES = new Set(['parent_invite', 'household_invite', 'coparent_invite', 'admin_invite']);
const AUTH_EMAIL_COOLDOWN_MS = 60 * 1000;
const FAILED_INVITE_SIGNUP_CLEANUP_WINDOW_MS = 30 * 60 * 1000;
const FAILED_INVITE_SIGNUP_CLEANUP_TYPES = new Set(['parent_invite', 'household_invite', 'coparent_invite']);
const TEAM_MEDIA_NOTIFICATION_BATCH_WINDOW_MS = 60 * 60 * 1000;
const TEAM_MEDIA_NOTIFICATION_DISPATCH_LIMIT = 50;
const FIRESTORE_BATCH_SAFE_WRITE_LIMIT = 450;
const NOTIFICATION_RECIPIENT_DEVICE_SYNC_CONCURRENCY = 5;
const checkStripeWebhookRateLimit = createInMemoryRateLimiter({
  windowMs: 60_000,
  maxRequests: 120,
  maxKeys: 2_000
});
let checkPublicRegistrationSubmissionRateLimit;
function getPublicRegistrationSubmissionRateLimit() {
  if (!checkPublicRegistrationSubmissionRateLimit) {
    checkPublicRegistrationSubmissionRateLimit = createFirestoreFixedWindowRateLimiter({
      firestore,
      collectionName: 'publicRegistrationRateLimits',
      windowMs: 10 * 60_000,
      maxRequests: 3
    });
  }
  return checkPublicRegistrationSubmissionRateLimit;
}
const checkPublicOpportunityBrowseRateLimit = createInMemoryRateLimiter({
  windowMs: 60_000,
  maxRequests: 120,
  maxKeys: 5_000
});
const checkPublicOpportunityWriteRateLimit = createInMemoryRateLimiter({
  windowMs: 10 * 60_000,
  maxRequests: 12,
  maxKeys: 5_000
});
const checkPublicOpportunityMessageRateLimit = createInMemoryRateLimiter({
  windowMs: 10 * 60_000,
  maxRequests: 20,
  maxKeys: 5_000
});
const checkPasswordResetEmailRateLimit = createInMemoryRateLimiter({
  windowMs: 10 * 60_000,
  maxRequests: 10,
  maxKeys: 10_000
});
const checkCalendarFetchRateLimit = createInMemoryRateLimiter({
  windowMs: 60_000,
  maxRequests: 120,
  maxKeys: 5_000
});
const checkCalendarForceRefreshRateLimit = createInMemoryRateLimiter({
  windowMs: 60_000,
  maxRequests: 10,
  maxKeys: 5_000
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
  if (input.paymentPlanId) {
    params.set('paymentPlanId', String(input.paymentPlanId));
  }
  const paidInstallmentCount = Math.max(0, Math.floor(Number(input.paidInstallmentCount) || 0));
  if (paidInstallmentCount > 0) {
    params.set('paidInstallmentCount', String(paidInstallmentCount));
  }
  const successParams = new URLSearchParams(params);
  if (input.retryPayment) {
    params.set('retryPayment', '1');
  } else if (input.publicCheckoutCapability) {
    params.set('retryPayment', '1');
  }
  return {
    successUrl: `${baseUrl}/registration.html?${successParams.toString()}&status=success`,
    cancelUrl: `${baseUrl}/registration.html?${params.toString()}&status=cancelled`
  };
}

function normalizePublicRegistrationInput(data = {}) {
  return {
    teamId: normalizeFirestoreId(data.teamId, 'teamId'),
    formId: normalizeFirestoreId(data.formId, 'formId'),
    participant: normalizePublicRegistrationFlatObject(data.participant),
    guardian: normalizePublicRegistrationFlatObject(data.guardian),
    waiverAccepted: data.waiverAccepted === true,
    selectedOptionId: String(data.selectedOptionId || data.selectedOption?.id || '').trim(),
    selectedPaymentPlanId: String(data.selectedPaymentPlanId || 'pay_full').trim() || 'pay_full',
    quantity: Math.max(1, Math.floor(Number(data.quantity || data.feeSnapshot?.quantity || 1) || 1)),
    checkoutAttemptToken: normalizeCheckoutAttemptToken(data.checkoutAttemptToken)
  };
}

function normalizePublicRegistrationFlatObject(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value).reduce((result, [key, rawValue]) => {
    const cleanKey = String(key || '').trim();
    if (!cleanKey || rawValue == null || typeof rawValue === 'object') return result;
    const cleanValue = String(rawValue).trim();
    result[cleanKey] = /email/i.test(cleanKey) ? cleanValue.toLowerCase() : cleanValue;
    return result;
  }, {});
}

function normalizePublicRegistrationForm(form = {}, context = {}) {
  const registrationOptionCounts = form.registrationOptionCounts || {};
  const feeAmountCents = Math.max(0, Math.round(Number(form.feeAmountCents || 0)));
  return {
    id: context.formId || form.id || '',
    teamId: context.teamId || form.teamId || '',
    programName: String(form.programName || form.title || form.name || '').trim(),
    description: String(form.description || form.programDescription || '').trim(),
    season: String(form.season || '').trim(),
    feeAmountCents,
    currency: String(form.currency || 'USD').trim() || 'USD',
    installmentPlan: normalizePublicRegistrationInstallmentPlan(form.installmentPlan),
    participantFields: normalizePublicRegistrationFields(form.participantFields || form.playerFields || []),
    guardianFields: normalizePublicRegistrationFields(form.guardianFields || []),
    waiverText: String(form.waiverText || form.waiver || '').trim(),
    status: String(form.status || '').trim(),
    published: form.published === true || form.status === 'published',
    paymentSettings: normalizeRegistrationPaymentSettings(form.paymentSettings),
    discountRules: normalizePublicRegistrationDiscountRules(form.discountRules || []),
    backgroundCheck: normalizePublicRegistrationBackgroundCheck(form.backgroundCheck),
    registrationOptions: normalizePublicRegistrationOptions(form.registrationOptions || form.options || []),
    registrationOptionCounts
  };
}

function normalizeRegistrationPaymentSettings(settings = {}) {
  return {
    offlinePaymentEnabled: settings?.offlinePaymentEnabled === true,
    onlineCheckoutEnabled: settings?.onlineCheckoutEnabled === true
  };
}

function normalizePublicRegistrationInstallmentPlan(plan = null) {
  if (!plan || plan.enabled !== true) return null;
  const installmentCount = Math.max(2, Math.min(12, Math.floor(Number(plan.installmentCount) || 0)));
  const intervalDays = Math.max(1, Math.min(365, Math.floor(Number(plan.intervalDays) || 30)));
  const firstDueDate = String(plan.firstDueDate || '').trim();
  if (!firstDueDate) return null;
  return {
    enabled: true,
    title: String(plan.title || 'Installment plan').trim() || 'Installment plan',
    installmentCount,
    firstDueDate,
    intervalDays
  };
}

function normalizePublicRegistrationFields(fields = []) {
  if (!Array.isArray(fields)) return [];
  return fields
    .map((field, index) => ({
      id: String(field?.id || field?.key || `field_${index + 1}`).trim(),
      label: String(field?.label || field?.name || field?.id || field?.key || `Field ${index + 1}`).trim(),
      required: field?.required === true
    }))
    .filter((field) => field.id && field.label);
}

function normalizePublicRegistrationBackgroundCheck(settings = {}) {
  const enabled = settings?.enabled === true || settings?.backgroundCheckEnabled === true;
  const status = String(settings?.initialScreeningStatus || 'pending').trim().toLowerCase().replace(/[ _]+/g, '-');
  const allowedStatuses = ['pending', 'submitted', 'cleared', 'flagged', 'expired', 'rejected'];
  return {
    enabled,
    initialScreeningStatus: enabled && allowedStatuses.includes(status) ? status : 'pending',
    providerName: String(settings?.providerName || '').trim()
  };
}

function normalizePublicRegistrationOptions(options = []) {
  if (!Array.isArray(options)) return [];
  return options
    .map((option, index) => {
      const id = String(option?.id || option?.key || `option_${index + 1}`).trim();
      const title = String(option?.title || option?.name || option?.label || `Option ${index + 1}`).trim();
      const capacityNumber = Number(option?.capacityLimit ?? option?.capacity ?? option?.maxRegistrations);
      const capacityLimit = Number.isFinite(capacityNumber) && capacityNumber > 0 ? Math.floor(capacityNumber) : null;
      return {
        id,
        countKey: buildPublicRegistrationOptionCountKey(id),
        title,
        description: String(option?.description || '').trim(),
        capacityLimit,
        waitlistEnabled: option?.waitlistEnabled === true || option?.waitlist === true,
        active: option?.active !== false && option?.status !== 'inactive' && option?.status !== 'archived',
        feeAmountCents: Number.isFinite(Number(option?.feeAmountCents)) ? Math.max(0, Math.round(Number(option.feeAmountCents))) : undefined
      };
    })
    .filter((option) => option.id && option.title);
}

function buildPublicRegistrationOptionCountKey(optionId = '') {
  const key = String(optionId || '').trim().replace(/[^A-Za-z0-9_-]/g, '_');
  return key || 'option';
}

function getActivePublicRegistrationOptions(form = {}, counts = {}) {
  return (form.registrationOptions || []).filter((option) => {
    if (!option.active) return false;
    const optionCounts = counts[option.countKey] || counts[option.id] || {};
    const enrolledCount = Number(optionCounts.enrolled || 0);
    if (!option.capacityLimit || enrolledCount < option.capacityLimit) return true;
    return option.waitlistEnabled === true;
  });
}

function hasConfiguredPublicRegistrationOptions(form = {}) {
  return (form.registrationOptions || []).some((option) => option.active === true);
}

function publicRegistrationRequiresOption(form = {}) {
  return getActivePublicRegistrationOptions(form, form.registrationOptionCounts || {}).length > 0;
}

function getConfiguredPublicRegistrationOptionById(form = {}, selectedOptionId = '') {
  return (form.registrationOptions || [])
    .filter((option) => option.active !== false)
    .find((option) => option.id === selectedOptionId) || null;
}

function decidePublicRegistrationPlacement({ form, selectedOptionId, counts = {} }) {
  const selectedOption = getConfiguredPublicRegistrationOptionById(form, selectedOptionId);
  if (!selectedOption) {
    return { status: 'blocked', reason: 'missing-option', message: 'Please select a registration option.' };
  }

  const optionCounts = counts[selectedOption.countKey] || counts[selectedOption.id] || {};
  const enrolledCount = Number(optionCounts.enrolled || 0);
  const waitlistedCount = Number(optionCounts.waitlisted || 0);
  const hasCapacity = !selectedOption.capacityLimit || enrolledCount < selectedOption.capacityLimit;

  if (hasCapacity) {
    return {
      status: 'pending',
      selectedOption,
      nextCounts: { enrolled: enrolledCount + 1, waitlisted: waitlistedCount }
    };
  }

  if (selectedOption.waitlistEnabled) {
    return {
      status: 'waitlisted',
      selectedOption,
      nextCounts: { enrolled: enrolledCount, waitlisted: waitlistedCount + 1 }
    };
  }

  return {
    status: 'blocked',
    reason: 'option-full',
    selectedOption,
    message: `${selectedOption.title} is full and is not accepting waitlist registrations.`
  };
}

function normalizePublicRegistrationDiscountRules(rules = []) {
  if (!Array.isArray(rules)) return [];
  return rules
    .map((rule, index) => {
      const type = String(rule?.type || '').toLowerCase();
      const amountType = rule?.amountType === 'percent' ? 'percent' : 'fixed';
      const amountValue = Math.max(0, Number(rule?.amountValue || 0));
      const earlyBirdDeadline = String(rule?.earlyBirdDeadline || '').trim();
      const minimumQuantity = Math.max(1, Math.floor(Number(rule?.minimumQuantity || 1)));
      if (!['early_bird', 'quantity'].includes(type) || amountValue <= 0) return null;
      return {
        id: String(rule?.id || `discount_${index + 1}`).trim(),
        type,
        label: String(rule?.label || (type === 'early_bird' ? 'Early bird discount' : 'Sibling/cart discount')).trim(),
        amountType,
        amountValue,
        earlyBirdDeadline,
        minimumQuantity,
        active: rule?.active !== false
      };
    })
    .filter(Boolean);
}

function calculatePublicRegistrationFeeSnapshot(form = {}, options = {}) {
  const currency = String(form.currency || 'USD').trim() || 'USD';
  const originalFeeAmountCents = Math.max(0, Math.round(Number(form.feeAmountCents || 0)));
  const quantity = Math.max(1, Math.floor(Number(options.quantity || 1)));
  const submittedAt = options.now instanceof Date ? options.now : new Date();
  const subtotalAmountCents = originalFeeAmountCents * quantity;
  let finalAmountDueCents = subtotalAmountCents;
  const appliedDiscounts = [];
  const discountRules = normalizePublicRegistrationDiscountRules(form.discountRules || []);

  discountRules.forEach((rule) => {
    if (!rule.active || !isPublicRegistrationDiscountEligible(rule, { quantity, now: submittedAt })) return;
    const discountAmountCents = rule.amountType === 'percent'
      ? Math.round(finalAmountDueCents * (rule.amountValue / 100))
      : Math.round(rule.amountValue);
    const appliedAmountCents = Math.min(finalAmountDueCents, Math.max(0, discountAmountCents));
    if (appliedAmountCents <= 0) return;
    finalAmountDueCents -= appliedAmountCents;
    appliedDiscounts.push({
      id: rule.id,
      type: rule.type,
      label: rule.label,
      amountType: rule.amountType,
      amountValue: rule.amountValue,
      earlyBirdDeadline: rule.earlyBirdDeadline,
      minimumQuantity: rule.minimumQuantity,
      amountCents: appliedAmountCents
    });
  });

  return {
    currency,
    quantity,
    originalFeeAmountCents,
    subtotalAmountCents,
    discountRules,
    appliedDiscounts,
    finalAmountDueCents
  };
}

function isPublicRegistrationDiscountEligible(rule, { quantity, now }) {
  if (rule.type === 'quantity') return quantity >= rule.minimumQuantity;
  if (rule.type === 'early_bird') {
    const deadline = Date.parse(`${rule.earlyBirdDeadline}T23:59:59.999`);
    return Number.isFinite(deadline) && now.getTime() <= deadline;
  }
  return false;
}

function buildPublicRegistrationPaymentPlanSnapshot(form = {}, selectedPaymentPlanId = 'pay_full') {
  const totalBalanceDueCents = Math.max(0, Math.round(Number(form.feeAmountCents) || 0));
  const useInstallments = selectedPaymentPlanId === 'installments' && form.installmentPlan?.enabled === true;
  const schedule = useInstallments
    ? buildPublicRegistrationInstallmentSchedule(totalBalanceDueCents, form.installmentPlan)
    : [{ label: 'Pay in full', dueDate: form.installmentPlan?.firstDueDate || '', amountCents: totalBalanceDueCents }];
  return {
    id: useInstallments ? 'installments' : 'pay_full',
    type: useInstallments ? 'installments' : 'pay_full',
    title: useInstallments ? form.installmentPlan.title : 'Pay in full',
    installmentCount: schedule.length,
    totalBalanceDueCents,
    schedule
  };
}

function buildPublicRegistrationInstallmentSchedule(totalBalanceDueCents = 0, plan = {}) {
  const count = Math.max(2, Math.min(12, Math.floor(Number(plan.installmentCount) || 2)));
  const baseAmount = Math.floor(totalBalanceDueCents / count);
  const remainder = totalBalanceDueCents - (baseAmount * count);
  const firstDate = parsePublicRegistrationLocalDate(plan.firstDueDate);
  const intervalDays = Math.max(1, Math.floor(Number(plan.intervalDays) || 30));
  return Array.from({ length: count }, (_, index) => {
    const dueDate = firstDate ? addPublicRegistrationDays(firstDate, intervalDays * index) : null;
    return {
      label: `Installment ${index + 1}`,
      dueDate: dueDate ? dueDate.toISOString().slice(0, 10) : String(plan.firstDueDate || ''),
      amountCents: baseAmount + (index === count - 1 ? remainder : 0)
    };
  });
}

function parsePublicRegistrationLocalDate(value = '') {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function addPublicRegistrationDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function validatePublicRegistrationSubmission(form, input, feeSnapshot) {
  if (!form?.published) {
    throwPublicRegistrationError('failed-precondition', 'This registration form is not accepting submissions.');
  }
  validatePublicRegistrationRequiredFields(form.participantFields || [], input.participant || {}, 'Participant');
  validatePublicRegistrationRequiredFields(form.guardianFields || [], input.guardian || {}, 'Guardian');
  if (input.waiverAccepted !== true) {
    throwPublicRegistrationError('invalid-argument', 'Waiver acceptance is required.');
  }
  if (form.installmentPlan?.enabled === true && !['pay_full', 'installments'].includes(input.selectedPaymentPlanId)) {
    throwPublicRegistrationError('invalid-argument', 'Please select a payment plan.');
  }
  if (form.installmentPlan?.enabled !== true && input.selectedPaymentPlanId !== 'pay_full') {
    throwPublicRegistrationError('invalid-argument', 'Please select a payment plan.');
  }
  if (form.paymentSettings?.onlineCheckoutEnabled === true
      && Number(feeSnapshot?.finalAmountDueCents || 0) > 0
      && !input.checkoutAttemptToken) {
    throwPublicRegistrationError('invalid-argument', 'A checkout attempt token is required.');
  }
}

function validatePublicRegistrationRequiredFields(fields, values, groupLabel) {
  for (const field of fields) {
    if (field.required && !String(values[field.id] || '').trim()) {
      throwPublicRegistrationError('invalid-argument', `${groupLabel} ${field.label} is required.`);
    }
  }
}

function buildPublicPendingRegistrationRecord({ form, input, selectedOption = null, status = 'pending', feeSnapshot, now }) {
  const paymentPlanForm = {
    ...form,
    feeAmountCents: feeSnapshot.finalAmountDueCents ?? form.feeAmountCents
  };
  const record = {
    teamId: form.teamId,
    formId: form.id,
    programName: form.programName,
    feeAmountCents: form.feeAmountCents,
    currency: form.currency,
    paymentSettings: normalizeRegistrationPaymentSettings(form.paymentSettings),
    feeSnapshot,
    participant: input.participant,
    guardian: input.guardian,
    waiverAccepted: input.waiverAccepted === true,
    waiverText: form.waiverText,
    paymentPlan: buildPublicRegistrationPaymentPlanSnapshot(paymentPlanForm, input.selectedPaymentPlanId),
    status,
    submittedAt: now,
    source: 'public-registration'
  };

  if (input.checkoutAttemptToken) {
    record.checkoutAttemptToken = input.checkoutAttemptToken;
  }

  if (form.backgroundCheck?.enabled === true) {
    record.screeningRequired = true;
    record.screeningStatus = form.backgroundCheck.initialScreeningStatus;
    record.screeningProvider = form.backgroundCheck.providerName;
    record.screeningProviderReference = '';
  }

  if (selectedOption) {
    record.selectedOption = {
      id: selectedOption.id,
      countKey: selectedOption.countKey,
      title: selectedOption.title,
      feeAmountCents: selectedOption.feeAmountCents ?? form.feeAmountCents,
      capacityLimit: selectedOption.capacityLimit,
      waitlistEnabled: selectedOption.waitlistEnabled === true
    };
  }

  if (status === 'waitlisted') {
    record.waitlistedAt = now;
  }

  return record;
}

function getHeaderValue(headers = {}, name = '') {
  const direct = headers[name] || headers[name.toLowerCase()];
  return Array.isArray(direct) ? direct[0] : String(direct || '');
}

function buildPublicRegistrationRateLimitBoundary(input, context = {}) {
  const rawRequest = context.rawRequest || {};
  const requestIp = getRequestIp(rawRequest);
  const appCheck = String(context.app?.appId || getHeaderValue(rawRequest.headers, 'x-firebase-appcheck') || '').trim();
  const email = String(input.guardian?.email || input.guardian?.guardianEmail || '').trim().toLowerCase();
  return [
    input.teamId,
    input.formId,
    email || 'no-email',
    appCheck || requestIp || 'unknown'
  ].join('|');
}

async function assertPublicRegistrationRateLimit(input, context = {}) {
  const boundary = buildPublicRegistrationRateLimitBoundary(input, context);
  const rateLimit = await getPublicRegistrationSubmissionRateLimit()(boundary);
  if (!rateLimit.allowed) {
    throwPublicRegistrationError('resource-exhausted', 'Too many registration attempts. Please wait a few minutes and try again.', {
      reason: 'rate-limited',
      retryAfterSeconds: rateLimit.retryAfterSeconds
    });
  }
}

function throwPublicRegistrationError(code, message, details = {}) {
  throw new functions.https.HttpsError(code, message, details);
}

exports.submitPublicRegistration = functions.https.onCall(async (data, context = {}) => {
  let input;
  try {
    input = normalizePublicRegistrationInput(data || {});
  } catch (error) {
    throwPublicRegistrationError('invalid-argument', error.message || 'Invalid registration submission.');
  }

  const formRef = buildRegistrationFormRef(input);
  const initialFormSnap = await formRef.get();
  if (!initialFormSnap.exists) {
    throwPublicRegistrationError('not-found', 'Registration form not found.');
  }

  await assertPublicRegistrationRateLimit(input, context);

  const registrationRef = formRef.collection('registrations').doc();
  let result = null;

  await firestore.runTransaction(async (transaction) => {
    const formSnap = await transaction.get(formRef);
    if (!formSnap.exists) {
      throwPublicRegistrationError('not-found', 'Registration form not found.');
    }

    const formData = formSnap.data() || {};
    const latestForm = normalizePublicRegistrationForm(formData, input);
    const feeSnapshot = calculatePublicRegistrationFeeSnapshot(latestForm, { quantity: input.quantity, now: new Date() });
    validatePublicRegistrationSubmission(latestForm, input, feeSnapshot);

    if (hasConfiguredPublicRegistrationOptions(latestForm) && !publicRegistrationRequiresOption(latestForm)) {
      throwPublicRegistrationError('failed-precondition', 'Registration is currently unavailable. No registration options are available.', {
        reason: 'no-options-available'
      });
    }

    let status = 'pending';
    let selectedOption = null;
    if (publicRegistrationRequiresOption(latestForm)) {
      const placement = decidePublicRegistrationPlacement({
        form: latestForm,
        selectedOptionId: input.selectedOptionId,
        counts: formData.registrationOptionCounts || {}
      });
      if (placement.status === 'blocked') {
        throwPublicRegistrationError('failed-precondition', placement.message || 'Registration option is not available.', {
          reason: placement.reason || 'invalid-option'
        });
      }

      selectedOption = placement.selectedOption;
      const selectedCountKey = selectedOption.countKey;
      const optionCounts = formData.registrationOptionCounts || null;
      if (!optionCounts || typeof optionCounts !== 'object' || !optionCounts[selectedCountKey] || typeof optionCounts[selectedCountKey] !== 'object') {
        throwPublicRegistrationError('failed-precondition', 'Registration form capacity tracking is not properly configured.');
      }

      const countPath = `registrationOptionCounts.${selectedCountKey}`;
      transaction.update(formRef, {
        [`${countPath}.enrolled`]: placement.nextCounts.enrolled,
        [`${countPath}.waitlisted`]: placement.nextCounts.waitlisted,
        registrationCapacityUpdateId: registrationRef.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
      status = placement.status;
    }

    const registrationRecord = buildPublicPendingRegistrationRecord({
      form: latestForm,
      input,
      selectedOption,
      status,
      feeSnapshot,
      now: admin.firestore.FieldValue.serverTimestamp()
    });

    transaction.set(registrationRef, registrationRecord);
    result = {
      success: true,
      status,
      registrationId: registrationRef.id,
      feeSnapshot: registrationRecord.feeSnapshot
    };
  });

  return result;
});

function isServerDiscountRuleEligible(rule, { quantity = 1, now }) {
  if (rule.type === 'quantity') return quantity >= rule.minimumQuantity;
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
 * Recompute the expected checkout amount from the authoritative form document
 * and the server-captured registration quantity. This prevents clients from
 * submitting a tampered feeSnapshot amount while preserving the quantity rules
 * applied when the registration was submitted.
 */
function computeRegistrationFeeAmountCentsFromForm(form, now = new Date(), options = {}) {
  const originalFeeAmountCents = Math.max(0, Math.round(Number(form.feeAmountCents || 0)));
  const quantity = Math.max(1, Math.floor(Number(options.quantity || 1)));
  let remainingAmountCents = originalFeeAmountCents * quantity;
  const discountRulesSource = Array.isArray(options.discountRules) ? options.discountRules : form.discountRules || [];
  normalizeServerRegistrationDiscountRules(discountRulesSource).forEach((rule) => {
    if (!rule.active || !isServerDiscountRuleEligible(rule, { quantity, now })) return;
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

function buildRegistrationInstallmentScheduleFromAuthoritativeForm(form, totalBalanceDueCents) {
  if (form?.installmentPlan?.enabled !== true) return [];
  return buildPublicRegistrationInstallmentSchedule(totalBalanceDueCents, form.installmentPlan);
}

function getStoredRegistrationInstallmentSchedule(registration = {}) {
  return Array.isArray(registration.paymentPlan?.schedule)
    ? registration.paymentPlan.schedule.filter(Boolean)
    : [];
}

function getStoredRegistrationInstallmentTotalBalanceDueCents(registration = {}) {
  return Math.max(0, Math.round(Number(
    registration.paymentPlan?.totalBalanceDueCents
    ?? registration.feeSnapshot?.finalAmountDueCents
    ?? registration.feeAmountCents
    ?? 0
  ) || 0));
}

function getRegistrationPaymentPlanPaidInstallmentCount(registration = {}) {
  return Math.max(0, Math.floor(Number(registration.paymentPlan?.paidInstallmentCount || 0) || 0));
}

function shouldKeepRegistrationCapacityReserved(registration = {}) {
  return registration.paymentPlan?.id === 'installments' && getRegistrationPaymentPlanPaidInstallmentCount(registration) > 0;
}

function getRegistrationSubmittedAtDate(registration = {}, fallback = new Date()) {
  const submittedAt = registration.submittedAt;
  let resolved = null;
  if (submittedAt instanceof Date) {
    resolved = submittedAt;
  } else if (submittedAt && typeof submittedAt.toDate === 'function') {
    resolved = submittedAt.toDate();
  } else if (submittedAt && typeof submittedAt.toMillis === 'function') {
    resolved = new Date(submittedAt.toMillis());
  } else if (submittedAt !== null && submittedAt !== undefined && submittedAt !== '') {
    resolved = new Date(submittedAt);
  }
  return resolved instanceof Date && Number.isFinite(resolved.getTime()) ? resolved : fallback;
}

function getRegistrationCapturedDiscountRules(registration = {}) {
  if (Array.isArray(registration.feeSnapshot?.discountRules)) {
    return registration.feeSnapshot.discountRules;
  }
  // Legacy snapshots did not capture the authoritative rule scope. Keep that
  // state distinct from a captured empty list so callers can fail closed
  // instead of applying rules that may have been added after submission.
  return null;
}

function buildRegistrationInstallmentPaymentState(registration = {}, form = null, nextPaidInstallmentCount = getRegistrationPaymentPlanPaidInstallmentCount(registration)) {
  const storedSchedule = getStoredRegistrationInstallmentSchedule(registration);
  const authoritativeTotalBalanceDueCents = storedSchedule.length
    ? getStoredRegistrationInstallmentTotalBalanceDueCents(registration)
    : form
      ? computeRegistrationFeeAmountCentsFromForm(form)
      : getStoredRegistrationInstallmentTotalBalanceDueCents(registration);
  const authoritativeSchedule = storedSchedule.length
    ? storedSchedule
    : form
      ? buildRegistrationInstallmentScheduleFromAuthoritativeForm(form, authoritativeTotalBalanceDueCents)
      : [];
  if (!authoritativeSchedule.length) {
    return {
      totalBalanceDueCents: authoritativeTotalBalanceDueCents,
      schedule: authoritativeSchedule,
      paidInstallmentCount: 0,
      currentInstallment: null,
      remainingSchedule: [],
      remainingBalanceCents: authoritativeTotalBalanceDueCents,
      nextDueDate: ''
    };
  }

  const paidInstallmentCount = Math.min(authoritativeSchedule.length, Math.max(0, Math.floor(Number(nextPaidInstallmentCount) || 0)));
  const currentInstallment = authoritativeSchedule[paidInstallmentCount] || null;
  const remainingSchedule = authoritativeSchedule.slice(paidInstallmentCount);
  const remainingBalanceCents = remainingSchedule.reduce((sum, installment) => {
    return sum + Math.max(0, Math.round(Number(installment?.amountCents || 0) || 0));
  }, 0);
  return {
    totalBalanceDueCents: authoritativeTotalBalanceDueCents,
    schedule: authoritativeSchedule,
    paidInstallmentCount,
    currentInstallment,
    remainingSchedule,
    remainingBalanceCents,
    nextDueDate: String(remainingSchedule[0]?.dueDate || '')
  };
}

function getRegistrationCheckoutAmountCents(registration = {}, form = null) {
  if (form && registration.paymentPlan?.id === 'installments' && form.installmentPlan?.enabled === true) {
    const installmentState = buildRegistrationInstallmentPaymentState(registration, form);
    return Math.max(0, Math.round(Number(installmentState.currentInstallment?.amountCents || 0) || 0));
  }
  if (form) {
    const capturedDiscountRules = getRegistrationCapturedDiscountRules(registration);
    // Recompute from the authoritative form pricing rules using the quantity
    // plus the discount rules and submission time captured by the
    // server-created registration. Using the captured rule scope preserves
    // retry discounts without granting rules added after submission. Legacy
    // snapshots without a captured rule scope receive no retry discount;
    // stored appliedDiscounts remain non-authoritative for billing.
    return computeRegistrationFeeAmountCentsFromForm(form, getRegistrationSubmittedAtDate(registration), {
      quantity: registration.feeSnapshot?.quantity || 1,
      discountRules: capturedDiscountRules === null ? [] : capturedDiscountRules
    });
  }
  if (registration.paymentPlan?.id === 'installments') {
    const installmentState = buildRegistrationInstallmentPaymentState(registration, null);
    return Math.max(0, Math.round(Number(installmentState.currentInstallment?.amountCents || 0) || 0));
  }
  return Math.max(0, Math.round(Number(registration.feeSnapshot?.finalAmountDueCents ?? registration.feeAmountCents ?? 0)));
}

function getRegistrationCheckoutCurrency(registration = {}, form = null) {
  return normalizeRegistrationCheckoutCurrency(
    form?.currency
      || registration.feeSnapshot?.currency
      || registration.currency
      || 'usd'
  ) || 'usd';
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

const REGISTRATION_PAYMENT_REMINDER_QUERY_PAGE_SIZE = PRE_EVENT_REMINDER_QUERY_PAGE_SIZE;
const REGISTRATION_PAYMENT_REMINDER_MAX_PAGES_PER_RUN = PRE_EVENT_REMINDER_MAX_PAGES_PER_RUN;
const REGISTRATION_PAYMENT_REMINDER_MAX_RUNTIME_MS = PRE_EVENT_REMINDER_MAX_RUNTIME_MS;
const REGISTRATION_CHECKOUT_CREATION_RESERVATION_TIMEOUT_MS = 15 * 60 * 1000;

async function processDueRegistrationFailedPaymentReminder(docSnap, { now, nowIso, appUrl }) {
  const registrationRef = docSnap.ref;
  let result = null;
  await firestore.runTransaction(async (transaction) => {
    const freshSnap = await transaction.get(registrationRef);
    if (!freshSnap.exists) return;

    const registration = freshSnap.data() || {};
    const reminder = registration.paymentReminder || {};
    const nextReminderAt = String(reminder.nextReminderAt || '').trim();
    if (!nextReminderAt || nextReminderAt > nowIso) return;

    if (shouldStopRegistrationPaymentReminders(registration)) {
      const reason = registration.paymentStatus === 'paid' ? 'paid' : 'closed';
      transaction.update(registrationRef, buildRegistrationReminderStopUpdate({
        reason,
        nowIso
      }));
      result = { path: registrationRef.path, action: 'stopped', reason };
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
      result = { path: registrationRef.path, action: 'missing_email' };
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
    result = { path: registrationRef.path, action: 'queued', mailDocId };
  });

  return result;
}

async function queueDueRegistrationFailedPaymentReminders(now = new Date()) {
  const nowIso = now.toISOString();
  const { appUrl } = getStripeConfig();
  const drainSummary = await drainDueReminderPages({
    now,
    maxPages: REGISTRATION_PAYMENT_REMINDER_MAX_PAGES_PER_RUN,
    maxRuntimeMs: REGISTRATION_PAYMENT_REMINDER_MAX_RUNTIME_MS,
    loadPage: async ({ dueIso, cursor, limit }) => {
      let query = firestore.collectionGroup('registrations')
        .where('paymentReminder.nextReminderAt', '<=', dueIso)
        .orderBy('paymentReminder.nextReminderAt')
        .limit(limit || REGISTRATION_PAYMENT_REMINDER_QUERY_PAGE_SIZE);
      if (cursor) {
        query = query.startAfter(cursor);
      }
      const dueSnap = await query.get();
      return {
        docs: dueSnap.docs,
        nextCursor: dueSnap.docs[dueSnap.docs.length - 1] || null
      };
    },
    processReminder: (docSnap) => processDueRegistrationFailedPaymentReminder(docSnap, { now, nowIso, appUrl })
  });
  const processedResults = drainSummary.results.filter(Boolean);
  const queuedResults = processedResults.filter((result) => result.action === 'queued');
  const stoppedResults = processedResults.filter((result) => result.action === 'stopped');
  const missingEmailResults = processedResults.filter((result) => result.action === 'missing_email');

  return {
    ...drainSummary,
    results: processedResults,
    examinedCount: drainSummary.results.length,
    processedCount: processedResults.length,
    queuedCount: queuedResults.length,
    stoppedCount: stoppedResults.length,
    missingEmailCount: missingEmailResults.length,
    queuedPaths: queuedResults.map((result) => result.path)
  };
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

async function reserveRegistrationCheckoutCreation(input, options = {}) {
  const registrationRef = buildRegistrationRef(input);
  const checkoutCreationReservationId = String(options.checkoutCreationReservationId || '').trim();
  const amountCents = Math.max(0, Math.round(Number(options.amountCents || 0) || 0));
  const now = admin.firestore.FieldValue.serverTimestamp();

  return firestore.runTransaction(async (transaction) => {
    const registrationSnap = await transaction.get(registrationRef);
    if (!registrationSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Registration not found.');
    }

    const registration = registrationSnap.data() || {};
    if (registration.teamId !== input.teamId || registration.formId !== input.formId) {
      throw new functions.https.HttpsError('failed-precondition', 'Registration does not match the requested form.');
    }
    if (registration.status === 'waitlisted') {
      throw new functions.https.HttpsError('failed-precondition', 'Waitlisted registrations cannot be paid online yet.');
    }
    if (registration.status === 'rejected') {
      throw new functions.https.HttpsError('failed-precondition', 'Rejected registrations cannot be paid online.');
    }
    if (registration.paymentStatus === 'paid') {
      throw new functions.https.HttpsError('failed-precondition', 'This registration has already been paid.');
    }
    if (!registrationCheckoutAuthorityMatches(registration, input)) {
      throw new functions.https.HttpsError('failed-precondition', 'Current public checkout capability is required.');
    }
    if (canReuseRegistrationCheckoutSession(registration, amountCents, input)) {
      return {
        reserved: false,
        checkoutUrl: registration.checkoutUrl,
        sessionId: registration.stripeCheckoutSessionId
      };
    }
    const existingReservationId = String(registration.checkoutCreationReservationId || '').trim();
    const existingReservationStartedAtMillis = firestoreTimestampToMillis(registration.checkoutCreationStartedAt);
    const existingReservationIsActive = existingReservationId
      && Number.isFinite(existingReservationStartedAtMillis)
      && Date.now() - existingReservationStartedAtMillis < REGISTRATION_CHECKOUT_CREATION_RESERVATION_TIMEOUT_MS;
    if (existingReservationIsActive) {
      throw new functions.https.HttpsError('failed-precondition', 'Registration checkout creation is already in progress.');
    }

    transaction.set(registrationRef, {
      checkoutCreationReservationId,
      checkoutCreationStartedAt: now,
      updatedAt: now
    }, { merge: true });
    return {
      reserved: true,
      retryCapacityReservationId: String(registration.retryCapacityReservationId || '').trim() || null
    };
  });
}

async function clearRegistrationCheckoutCreationReservation(input, checkoutCreationReservationId) {
  const registrationRef = buildRegistrationRef(input);
  const now = admin.firestore.FieldValue.serverTimestamp();

  return firestore.runTransaction(async (transaction) => {
    const registrationSnap = await transaction.get(registrationRef);
    if (!registrationSnap.exists) return false;
    const registration = registrationSnap.data() || {};
    if (String(registration.checkoutCreationReservationId || '') !== checkoutCreationReservationId) return false;
    transaction.set(registrationRef, {
      checkoutCreationReservationId: admin.firestore.FieldValue.delete(),
      checkoutCreationStartedAt: admin.firestore.FieldValue.delete(),
      updatedAt: now
    }, { merge: true });
    return true;
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
    const checkoutCreationReservationId = String(options.checkoutCreationReservationId || '').trim();
    const activeCheckoutCreationReservationId = String(registration.checkoutCreationReservationId || '').trim();
    if (
      hasMatchingRetryCapacityReservation
      && activeCheckoutCreationReservationId
      && activeCheckoutCreationReservationId !== checkoutCreationReservationId
    ) {
      return { released: false, reason: 'checkout-creation-owned-by-another-reservation' };
    }
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

    const capacityReleaseUpdate = {
      ...registrationUpdate,
      registrationCapacityReleased: true,
      capacityReleasedAt: now
    };
    let nextPublicCheckoutCapability = '';
    if (options.suppressPublicCheckoutCapabilityRotation !== true) {
      nextPublicCheckoutCapability = createRawPublicCheckoutCapability();
      capacityReleaseUpdate.publicCheckoutCapabilityHash = hashPublicCheckoutCapability(nextPublicCheckoutCapability);
    }

    transaction.set(registrationRef, capacityReleaseUpdate, { merge: true });

    return { released, nextPublicCheckoutCapability };
  });
}

async function getUserForEligibility(uid) {
  const userSnap = await firestore.doc(`users/${uid}`).get();
  return userSnap.exists ? userSnap.data() || {} : {};
}

function getSportsConnectFunctionsConfig() {
  const sportsConnectConfig = functions.config()?.sports_connect || {};
  return {
    endpointTemplate: process.env.SPORTS_CONNECT_REGISTRATION_SNAPSHOT_URL ||
      process.env.SPORTS_CONNECT_REGISTRATION_BASE_URL ||
      sportsConnectConfig.registration_snapshot_url ||
      sportsConnectConfig.registration_base_url,
    accessToken: process.env.SPORTS_CONNECT_API_TOKEN ||
      sportsConnectConfig.api_token ||
      sportsConnectConfig.token
  };
}

function toHttpsError(error, fallbackCode = 'internal') {
  if (error instanceof functions.https.HttpsError) return error;
  const code = error?.code && typeof error.code === 'string' ? error.code : fallbackCode;
  return new functions.https.HttpsError(code, error?.message || 'Request failed.');
}

exports.syncRegistrationProvider = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in to sync registration data.');
  }

  const teamId = String(data?.teamId || '').trim();
  if (!teamId) {
    throw new functions.https.HttpsError('invalid-argument', 'Team ID is required.');
  }

  const teamRef = firestore.doc(`teams/${teamId}`);
  const [teamSnap, userSnap] = await Promise.all([
    teamRef.get(),
    firestore.doc(`users/${context.auth.uid}`).get()
  ]);
  if (!teamSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Team not found.');
  }

  const team = teamSnap.data() || {};
  const user = userSnap.exists ? userSnap.data() || {} : {};
  const callerEmail = String(context.auth.token?.email || '').trim().toLowerCase();
  if (!hasTeamAdminAccess({ team, user, uid: context.auth.uid, email: callerEmail })) {
    throw new functions.https.HttpsError('permission-denied', 'Only team owners and admins can sync registration data.');
  }

  const existingSource = getRegistrationSource(team);
  const syncConfig = getTeamSportsConnectConfig(team, getSportsConnectFunctionsConfig());
  try {
    assertSportsConnectSyncConfig(syncConfig);
    const payload = await fetchSportsConnectRegistrationPayload(syncConfig);
    const nowIso = new Date().toISOString();
    const snapshot = buildSportsConnectRegistrationSnapshot(payload, {
      externalTeamId: syncConfig.externalTeamId,
      fetchedAt: nowIso
    });
    const update = buildSportsConnectTeamUpdate({
      existingSource,
      snapshot,
      nowIso
    });
    update.registrationSource.teamId = teamId;
    update.registrationSource.lastSyncBy = context.auth.uid;
    update.registrationSource.lastSyncByEmail = callerEmail || null;
    await teamRef.set(update, { merge: true });
    return {
      success: true,
      teamId,
      provider: 'Sports Connect',
      externalTeamId: snapshot.externalTeamId,
      playerCount: snapshot.playerCount,
      fetchedAt: snapshot.fetchedAt
    };
  } catch (error) {
    const nowIso = new Date().toISOString();
    await teamRef.set(buildSportsConnectSyncErrorUpdate(existingSource, error?.message, nowIso), { merge: true }).catch((writeError) => {
      functions.logger.warn('Failed to record Sports Connect sync error state.', {
        teamId,
        error: writeError?.message || String(writeError)
      });
    });
    throw toHttpsError(error, 'unavailable');
  }
});

exports.claimOpenOfficiatingSlot = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before claiming an officiating slot.');
  }

  let input;
  try {
    input = normalizeOpenOfficiatingSlotClaimInput(data || {});
  } catch (error) {
    throw toHttpsError(error, 'invalid-argument');
  }

  const uid = context.auth.uid;
  const callerEmail = String(context.auth.token?.email || '').trim().toLowerCase();
  const displayName = String(context.auth.token?.name || data?.displayName || callerEmail || 'Official').trim();
  const [teamSnap, userSnap] = await Promise.all([
    firestore.doc(`teams/${input.teamId}`).get(),
    firestore.doc(`users/${uid}`).get()
  ]);
  if (!teamSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Team not found.');
  }

  const team = { id: input.teamId, ...(teamSnap.data() || {}) };
  const user = userSnap.exists ? userSnap.data() || {} : {};
  if (!isEligibleOpenOfficiatingSlotParticipant({ team, user, uid, email: callerEmail, teamId: input.teamId })) {
    throw new functions.https.HttpsError('permission-denied', 'Only team owners, admins, or parents can claim open officiating slots.');
  }

  const gameRef = firestore.doc(resolveOfficiatingGamePath(input.teamId, input.gameId));
  const notificationRef = firestore.collection(`teams/${input.teamId}/officiatingNotifications`).doc();
  const now = admin.firestore.FieldValue.serverTimestamp();

  try {
    const result = await firestore.runTransaction(async (transaction) => {
      const gameSnap = await transaction.get(gameRef);
      if (!gameSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'Game not found.');
      }

      const game = { id: input.gameId, ...(gameSnap.data() || {}) };
      if (!gameRef.path.startsWith(`teams/${input.teamId}/games/`) && !isTeamLinkedToSharedGame(game, input.teamId)) {
        throw new functions.https.HttpsError('permission-denied', 'Game is not available to this team.');
      }

      const { update, claimedSlot } = buildOpenOfficiatingSlotClaimUpdate({
        game,
        slotId: input.slotId,
        official: { uid, email: callerEmail, displayName },
        now
      });
      const notificationRecord = buildOfficiatingSelfAssignmentNotificationRecord({
        teamId: input.teamId,
        gameId: input.gameId,
        game,
        slot: claimedSlot,
        actor: { uid, email: callerEmail, displayName },
        timestamp: now
      });

      transaction.update(gameRef, update);
      transaction.set(notificationRef, {
        ...notificationRecord,
        createdAt: now
      });

      return {
        claimedSlot,
        notificationId: notificationRef.id
      };
    });

    return {
      success: true,
      teamId: input.teamId,
      gameId: input.gameId,
      slotId: input.slotId,
      ...result
    };
  } catch (error) {
    throw toHttpsError(error, error?.code || 'internal');
  }
});

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

function isParentInviteExpired(expiresAt) {
  if (!expiresAt) return false;
  const millis = typeof expiresAt.toMillis === 'function'
    ? expiresAt.toMillis()
    : new Date(expiresAt).getTime();
  return Number.isFinite(millis) && millis < Date.now();
}

let resendAuthEmailDelivery;
function getResendAuthEmailDelivery() {
  if (resendAuthEmailDelivery) return resendAuthEmailDelivery;
  const apiKey = String(process.env.RESEND_API_KEY || '').trim();
  if (!apiKey) throw new Error('RESEND_API_KEY is not configured.');
  resendAuthEmailDelivery = createResendAuthEmailDelivery({
    firestore,
    FieldValue: admin.firestore.FieldValue,
    logger: functions.logger,
    resend: new Resend(apiKey),
    webhookSecret: String(process.env.RESEND_WEBHOOK_SECRET || '').trim(),
    firebaseWebApiKey: String(process.env.FIREBASE_WEB_API_KEY || 'AIzaSyDoixIoKJuUVWdmImwjYRTthjKOv2mU0Jc').trim()
  });
  return resendAuthEmailDelivery;
}

const authEmailDeliveryStore = createAuthEmailDeliveryStore({
  firestore,
  Timestamp: admin.firestore.Timestamp,
  FieldValue: admin.firestore.FieldValue,
  logger: functions.logger,
  cooldownMs: AUTH_EMAIL_COOLDOWN_MS,
  buildRateLimitId: buildAuthEmailRateLimitId,
  buildMailDocId: buildAuthEmailMailDocId,
  buildMailJob: buildAuthEmailMailJob,
  sendDelivery: ({ deliveryId, job }) => getResendAuthEmailDelivery().send({ deliveryId, job }),
  normalizeEmail: normalizeAuthEmail,
  hashRecipient: (value) => crypto.createHash('sha256').update(value).digest('hex')
});
const reserveAuthEmailDelivery = authEmailDeliveryStore.reserve;
const releaseAuthEmailDelivery = authEmailDeliveryStore.release;
const queueAuthEmailDelivery = authEmailDeliveryStore.queue;
const enqueuePasswordResetRequest = authEmailDeliveryStore.enqueuePasswordResetRequest;

function buildInviteMailDocId(codeId) {
  const safeCodeId = String(codeId || '').replace(/[^\w.-]+/g, '_').slice(0, 240);
  return `invite_${safeCodeId}`;
}

function isAlreadyExistsError(error) {
  return error?.code === 6 || error?.code === '6' || error?.code === 'already-exists';
}

async function queueInviteEmailForCode(codeId, codeData = {}) {
  const type = String(codeData.type || '').trim().toLowerCase();
  const email = normalizeParentInviteEmail(codeData.email);
  const code = String(codeData.code || '').trim().toUpperCase();
  if (!INVITE_EMAIL_TYPES.has(type) || !normalizeInviteEmailType(type) || !isValidInviteRecipientEmail(email) || !code) {
    return { queued: false, reason: 'not_email_eligible' };
  }

  const message = buildParentInviteEmailMessage({ ...codeData, type, code });
  const mailRef = firestore.collection('mail').doc(buildInviteMailDocId(codeId));
  try {
    await mailRef.create({
      to: [email],
      message: {
        subject: message.subject,
        text: message.text,
        html: message.html
      },
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      metadata: {
        type: 'invite',
        inviteType: type,
        accessCodeId: String(codeId || '').trim(),
        teamId: String(codeData.teamId || '').trim() || null,
        playerId: String(codeData.playerId || '').trim() || null,
        generatedBy: String(codeData.generatedBy || '').trim() || null
      }
    });
    return { queued: true, deduplicated: false, signupUrl: message.signupUrl };
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      return { queued: true, deduplicated: true, signupUrl: message.signupUrl };
    }
    throw error;
  }
}

async function findOwnedInviteCode(code, uid, allowedTypes = INVITE_EMAIL_TYPES) {
  return findOwnedAuthEmailInviteCode({
    firestore,
    code,
    uid,
    allowedTypes
  });
}

const authEmailCallableHandlers = createAuthEmailCallableHandlers({
  auth: admin.auth(),
  HttpsError: functions.https.HttpsError,
  logger: functions.logger,
  types: AUTH_EMAIL_TYPES,
  normalizeEmail: normalizeAuthEmail,
  isValidEmail: isValidAuthEmail,
  checkPasswordResetRateLimit: checkPasswordResetEmailRateLimit,
  reserveDelivery: reserveAuthEmailDelivery,
  releaseDelivery: releaseAuthEmailDelivery,
  queueDelivery: queueAuthEmailDelivery,
  enqueuePasswordResetRequest,
  getActionSettings: getAuthEmailActionSettings,
  getInviteContinueUrl,
  findOwnedInviteCode,
  allowedInviteTypes: EMAIL_LINK_INVITE_TYPES,
  isInviteInactive: isAccessCodeInactive
});

exports.queuePasswordResetEmail = functions.https.onCall(authEmailCallableHandlers.queuePasswordResetEmail);
exports.queueEmailVerification = functions
  .runWith({ secrets: ['RESEND_API_KEY'] })
  .https.onCall(authEmailCallableHandlers.queueEmailVerification);
exports.queueInviteSignInEmail = functions
  .runWith({ secrets: ['RESEND_API_KEY'] })
  .https.onCall(authEmailCallableHandlers.queueInviteSignInEmail);

const passwordResetEmailWorker = createPasswordResetEmailWorker({
  auth: admin.auth(),
  logger: functions.logger,
  types: AUTH_EMAIL_TYPES,
  normalizeEmail: normalizeAuthEmail,
  isValidEmail: isValidAuthEmail,
  getActionSettings: getAuthEmailActionSettings,
  queueDelivery: queueAuthEmailDelivery,
  isAlreadyExistsError
});

exports.processPasswordResetEmailRequest = functions
  .runWith({ failurePolicy: true, secrets: ['RESEND_API_KEY'] })
  .firestore
  .document('authEmailRequests/{requestId}')
  .onCreate((snapshot, context) => passwordResetEmailWorker.processPasswordResetRequest(
    snapshot.data(),
    {
      requestId: context.params.requestId,
      deleteRequest: () => snapshot.ref.delete()
    }
  ));

const passwordResetEmailSweeper = createPasswordResetEmailSweeper({
  async listRequests() {
    const snapshot = await firestore.collection('authEmailRequests')
      .orderBy('createdAt')
      .limit(100)
      .get();
    return snapshot.docs;
  },
  processRequest: (requestDoc) =>
    passwordResetEmailWorker.processPasswordResetRequest(requestDoc.data(), {
      requestId: requestDoc.id,
      deleteRequest: () => requestDoc.ref.delete()
    }),
  logger: functions.logger,
  concurrency: 5
});

exports.sweepPendingPasswordResetEmailRequests = functions
  .runWith({ secrets: ['RESEND_API_KEY'] })
  .pubsub
  .schedule('every 5 minutes')
  .onRun(() => passwordResetEmailSweeper.sweep());

exports.resendEmailWebhook = functions
  .runWith({ secrets: ['RESEND_API_KEY', 'RESEND_WEBHOOK_SECRET'] })
  .https.onRequest((req, res) => getResendAuthEmailDelivery().handleWebhook(req, res));

exports.queueInviteEmail = functions.https.onCall(async (data, context) => {
  const uid = String(context.auth?.uid || '').trim();
  if (!uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before sending an invite email.');
  }
  const code = String(data?.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(code)) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid eight-character invite code is required.');
  }

  const invite = await findOwnedInviteCode(code, uid);
  if (!invite) {
    throw new functions.https.HttpsError('not-found', 'Invite could not be found.');
  }
  if (!isValidInviteRecipientEmail(invite.data.email)) {
    throw new functions.https.HttpsError('failed-precondition', 'Invite does not have a valid recipient email.');
  }

  const result = await queueInviteEmailForCode(invite.id, invite.data);
  if (!result.queued) {
    throw new functions.https.HttpsError('failed-precondition', 'Invite is not eligible for email delivery.');
  }
  return result;
});

exports.queueParentInviteEmail = functions.firestore
  .document('accessCodes/{codeId}')
  .onCreate(async (snap, context) => {
    const codeData = snap.data() || {};
    if (!INVITE_EMAIL_TYPES.has(String(codeData.type || '').trim().toLowerCase()) ||
        !isValidInviteRecipientEmail(codeData.email)) {
      return null;
    }
    await queueInviteEmailForCode(context.params.codeId, codeData);
    return null;
  });

exports.cleanupFailedInviteSignup = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before cleaning up a failed invite signup.');
  }

  const userId = normalizeFirestoreId(data?.userId || context.auth.uid, 'userId');
  if (userId !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'You can only clean up your own failed signup.');
  }

  const code = String(data?.code || '').trim().toUpperCase();
  return cleanupFailedInviteSignupForUser(userId, { code });
});

exports.cleanupInviteSignupOnAuthDelete = functions.auth.user().onDelete(async (user) => {
  const userId = String(user?.uid || '').trim();
  if (!userId) return null;
  await cleanupFailedInviteSignupForUser(userId, { authUserRecord: user });
  return null;
});

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

function uniqueNonEmptyStrings(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function compactPublicProfileString(value) {
  return String(value || '').trim();
}

function derivePublicProfileTeamIds(userData = {}) {
  const parentOfTeamIds = Array.isArray(userData.parentOf)
    ? userData.parentOf.map((link) => link?.teamId)
    : [];
  const parentTeamIds = Array.isArray(userData.parentTeamIds)
    ? userData.parentTeamIds
    : [];
  return uniqueNonEmptyStrings([...parentOfTeamIds, ...parentTeamIds]);
}

function hashPublicProfileEmail(email) {
  const normalized = compactPublicProfileString(email).toLowerCase();
  return normalized ? crypto.createHash('sha256').update(normalized).digest('hex') : null;
}

function buildTrustedPublicUserProfileProjectionPayload(userData = {}, options = {}) {
  const fullName = compactPublicProfileString(userData.fullName || userData.displayName || userData.name);
  const displayName = compactPublicProfileString(userData.displayName || userData.fullName || userData.name);
  const trustedEmail = options.trustedEmail ?? userData.email;
  return {
    displayName: displayName || null,
    fullName: fullName || null,
    photoUrl: compactPublicProfileString(userData.photoUrl) || null,
    discoveryTeamIds: derivePublicProfileTeamIds(userData),
    emailHash: hashPublicProfileEmail(trustedEmail),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

function buildApprovedParentMembershipUserUpdate({ userData = {}, requestData = {}, team = {}, player = {} }) {
  const parentLink = {
    teamId: String(team.id || requestData.teamId || '').trim(),
    playerId: String(player.id || requestData.playerId || '').trim(),
    teamName: team?.name || requestData.teamName || null,
    playerName: player?.name || requestData.playerName || null,
    playerNumber: player?.number ?? requestData.playerNumber ?? null,
    playerPhotoUrl: player?.photoUrl || requestData.playerPhotoUrl || null,
    relation: requestData.relation || null
  };
  const parentOf = appendUniqueParentLink(userData.parentOf, parentLink);
  const parentTeamIds = uniqueNonEmptyStrings(parentOf.map((link) => link?.teamId));
  const parentPlayerKeys = uniqueNonEmptyStrings(parentOf.map((link) => (
    link?.teamId && link?.playerId ? `${link.teamId}::${link.playerId}` : ''
  )));
  const roles = appendUniqueValue(userData.roles, 'parent');

  return {
    parentOf,
    parentTeamIds,
    parentPlayerKeys,
    roles
  };
}

function doesHouseholdInviteFamilyMembershipMatch(codeData = {}, membershipData = {}) {
  const organizerUserId = String(codeData?.organizerUserId || '').trim();
  const familyMembershipId = String(codeData?.familyMembershipId || '').trim();
  if (!organizerUserId || !familyMembershipId) {
    return false;
  }

  const membershipOrganizerUserId = String(membershipData?.organizerUserId || '').trim();
  const membershipStatus = String(membershipData?.status || '').trim().toLowerCase();
  return membershipOrganizerUserId === organizerUserId
    && ['pending', 'active'].includes(membershipStatus)
    && normalizeParentInviteEmail(membershipData?.email) === normalizeParentInviteEmail(codeData?.email)
    && String(membershipData?.teamId || '').trim() === String(codeData?.teamId || '').trim()
    && String(membershipData?.playerId || '').trim() === String(codeData?.playerId || '').trim();
}

function firestoreTimestampToMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date ? date.getTime() : null;
  }
  if (typeof value.seconds === 'number') return value.seconds * 1000;
  if (value instanceof Date) return value.getTime();
  const millis = Number(value);
  return Number.isFinite(millis) ? millis : null;
}

function getInviteCleanupPlayerKey(codeData = {}) {
  const teamId = String(codeData.teamId || '').trim();
  const playerId = String(codeData.playerId || '').trim();
  return teamId && playerId ? `${teamId}::${playerId}` : '';
}

function isRecentFailedSignupInviteRedemption(codeData = {}, userId, nowMillis = Date.now()) {
  const type = String(codeData.type || '').trim();
  if (!FAILED_INVITE_SIGNUP_CLEANUP_TYPES.has(type)) return false;
  if (codeData.used !== true || String(codeData.usedBy || '').trim() !== userId) return false;
  if (codeData.revoked === true || codeData.autoAccepted === true) return false;
  if (!getInviteCleanupPlayerKey(codeData)) return false;
  const usedAtMillis = firestoreTimestampToMillis(codeData.usedAt);
  return Number.isFinite(usedAtMillis) &&
    nowMillis - usedAtMillis >= 0 &&
    nowMillis - usedAtMillis <= FAILED_INVITE_SIGNUP_CLEANUP_WINDOW_MS;
}

function isRecentFailedSignupAuthDate(value, nowMillis = Date.now()) {
  const millis = Date.parse(String(value || ''));
  return Number.isFinite(millis) &&
    nowMillis - millis >= 0 &&
    nowMillis - millis <= FAILED_INVITE_SIGNUP_CLEANUP_WINDOW_MS;
}

function isRecentFailedSignupAuthUserRecord(userRecord, nowMillis = Date.now()) {
  return isRecentFailedSignupAuthDate(userRecord?.metadata?.creationTime, nowMillis) ||
    isRecentFailedSignupAuthDate(userRecord?.metadata?.createdAt, nowMillis);
}

function filterInviteCleanupParentLinks(parentOf, cleanupPlayerKeys) {
  return (Array.isArray(parentOf) ? parentOf : []).filter((link) => {
    const key = link?.teamId && link?.playerId ? `${link.teamId}::${link.playerId}` : '';
    return !cleanupPlayerKeys.has(key);
  });
}

function shouldDeleteFailedSignupUserProfile(userData = {}, cleanupPlayerKeys, cleanupTeamIds) {
  const roles = Array.isArray(userData.roles) ? userData.roles.map((role) => String(role || '').trim()).filter(Boolean) : [];
  if (roles.some((role) => role !== 'parent')) return false;
  if (Array.isArray(userData.coachOf) && userData.coachOf.length > 0) return false;
  if (userData.isAdmin === true || userData.isPlatformAdmin === true || userData.platformAdmin === true) return false;

  const parentOf = Array.isArray(userData.parentOf) ? userData.parentOf : [];
  const parentPlayerKeys = Array.isArray(userData.parentPlayerKeys) ? userData.parentPlayerKeys : [];
  const parentTeamIds = Array.isArray(userData.parentTeamIds) ? userData.parentTeamIds : [];
  const parentOfOnlyCleanupLinks = parentOf.every((link) => {
    const key = link?.teamId && link?.playerId ? `${link.teamId}::${link.playerId}` : '';
    return key && cleanupPlayerKeys.has(key);
  });
  const parentPlayerKeysOnlyCleanupLinks = parentPlayerKeys.every((key) => cleanupPlayerKeys.has(String(key || '').trim()));
  const parentTeamIdsOnlyCleanupLinks = parentTeamIds.every((teamId) => cleanupTeamIds.has(String(teamId || '').trim()));
  return parentOfOnlyCleanupLinks && parentPlayerKeysOnlyCleanupLinks && parentTeamIdsOnlyCleanupLinks;
}

async function cleanupFailedInviteSignupForUser(userId, options = {}) {
  const normalizedUserId = String(userId || '').trim();
  if (!normalizedUserId) {
    throw new functions.https.HttpsError('invalid-argument', 'A user id is required for invite signup cleanup.');
  }

  const normalizedCode = String(options.code || '').trim().toUpperCase();
  const codeQuery = normalizedCode
    ? firestore.collection('accessCodes').where('code', '==', normalizedCode)
    : firestore.collection('accessCodes').where('usedBy', '==', normalizedUserId);
  const initialCodeSnap = await codeQuery.limit(10).get();
  if (initialCodeSnap.empty) {
    return { recovered: false, inviteCount: 0, userDeleted: false };
  }

  const cleanupRequestedAtMs = Date.now();
  let authUserRecentlyCreated = isRecentFailedSignupAuthUserRecord(options.authUserRecord, cleanupRequestedAtMs);
  if (!authUserRecentlyCreated && !options.authUserRecord) {
    try {
      const authUserRecord = await admin.auth().getUser(normalizedUserId);
      authUserRecentlyCreated = isRecentFailedSignupAuthUserRecord(authUserRecord, cleanupRequestedAtMs);
    } catch (error) {
      functions.logger.warn('Unable to verify recent auth user for failed invite cleanup.', {
        userId: normalizedUserId,
        error
      });
    }
  }
  if (!authUserRecentlyCreated) {
    return { recovered: false, inviteCount: 0, userDeleted: false };
  }

  let result = { recovered: false, inviteCount: 0, userDeleted: false };
  await firestore.runTransaction(async (transaction) => {
    const nowMillis = Date.now();
    const now = admin.firestore.Timestamp.fromMillis(nowMillis);
    const codeSnaps = await Promise.all(initialCodeSnap.docs.map((codeDoc) => transaction.get(codeDoc.ref)));
    const eligibleCodes = codeSnaps
      .filter((codeSnap) => codeSnap.exists)
      .map((codeSnap) => ({ snap: codeSnap, data: codeSnap.data() || {} }))
      .filter(({ data }) => isRecentFailedSignupInviteRedemption(data, normalizedUserId, nowMillis));

    if (!eligibleCodes.length) {
      result = { recovered: false, inviteCount: 0, userDeleted: false };
      return;
    }

    const userRef = firestore.doc(`users/${normalizedUserId}`);
    const publicProfileRef = firestore.doc(`publicUserProfiles/${normalizedUserId}`);
    const cleanupPlayerKeys = new Set(eligibleCodes.map(({ data }) => getInviteCleanupPlayerKey(data)).filter(Boolean));
    const cleanupTeamIds = new Set(eligibleCodes.map(({ data }) => String(data.teamId || '').trim()).filter(Boolean));
    const privateProfileRefs = [...cleanupPlayerKeys].map((playerKey) => {
      const [teamId, playerId] = playerKey.split('::');
      return firestore.doc(`teams/${teamId}/players/${playerId}/private/profile`);
    });
    const membershipRefs = eligibleCodes
      .map(({ data }) => {
        const organizerUserId = String(data.organizerUserId || '').trim();
        const familyMembershipId = String(data.familyMembershipId || '').trim();
        return organizerUserId && familyMembershipId
          ? firestore.doc(`users/${organizerUserId}/familyMemberships/${familyMembershipId}`)
          : null;
      })
      .filter(Boolean);

    const [userSnap, ...relatedSnaps] = await Promise.all([
      transaction.get(userRef),
      ...privateProfileRefs.map((ref) => transaction.get(ref)),
      ...membershipRefs.map((ref) => transaction.get(ref))
    ]);
    const privateProfileSnaps = relatedSnaps.slice(0, privateProfileRefs.length);
    const membershipSnaps = relatedSnaps.slice(privateProfileRefs.length);
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const remainingParentOf = filterInviteCleanupParentLinks(userData.parentOf, cleanupPlayerKeys);
    const remainingParentPlayerKeys = uniqueNonEmptyStrings(remainingParentOf.map((link) => (
      link?.teamId && link?.playerId ? `${link.teamId}::${link.playerId}` : ''
    )));
    const remainingParentTeamIds = uniqueNonEmptyStrings(remainingParentOf.map((link) => link?.teamId));
    const userDeleted = userSnap.exists && shouldDeleteFailedSignupUserProfile(userData, cleanupPlayerKeys, cleanupTeamIds);

    eligibleCodes.forEach(({ snap }) => {
      transaction.update(snap.ref, {
        used: false,
        usedBy: null,
        usedAt: null,
        status: admin.firestore.FieldValue.delete(),
        failedSignupRecoveredAt: now,
        failedSignupRecoveredBy: normalizedUserId
      });
    });

    privateProfileSnaps.forEach((privateProfileSnap) => {
      if (!privateProfileSnap.exists) return;
      const privateProfile = privateProfileSnap.data() || {};
      const parents = Array.isArray(privateProfile.parents) ? privateProfile.parents : [];
      const filteredParents = parents.filter((parent) => String(parent?.userId || '').trim() !== normalizedUserId);
      transaction.set(privateProfileSnap.ref, {
        parents: filteredParents,
        updatedAt: now
      }, { merge: true });
    });

    membershipSnaps.forEach((membershipSnap) => {
      if (!membershipSnap.exists) return;
      const membership = membershipSnap.data() || {};
      if (String(membership.userId || '').trim() !== normalizedUserId) return;
      transaction.set(membershipSnap.ref, {
        status: 'pending',
        userId: admin.firestore.FieldValue.delete(),
        acceptedAt: admin.firestore.FieldValue.delete(),
        updatedAt: now
      }, { merge: true });
    });

    if (userDeleted) {
      transaction.delete(publicProfileRef);
      transaction.delete(userRef);
    } else if (userSnap.exists) {
      const remainingRoles = Array.isArray(userData.roles)
        ? userData.roles.filter((role) => role !== 'parent' || remainingParentOf.length > 0)
        : [];
      const nextUserData = {
        ...userData,
        parentOf: remainingParentOf,
        parentTeamIds: remainingParentTeamIds,
        parentPlayerKeys: remainingParentPlayerKeys,
        roles: remainingRoles
      };
      transaction.set(userRef, {
        parentOf: nextUserData.parentOf,
        parentTeamIds: nextUserData.parentTeamIds,
        parentPlayerKeys: nextUserData.parentPlayerKeys,
        roles: nextUserData.roles,
        updatedAt: now
      }, { merge: true });
      transaction.set(publicProfileRef, buildTrustedPublicUserProfileProjectionPayload(nextUserData, {
        trustedEmail: userData.email || null
      }), { merge: true });
    }

    result = { recovered: true, inviteCount: eligibleCodes.length, userDeleted };
  });

  return result;
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

exports.syncPublicUserProfileProjection = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before syncing a public profile.');
  }

  const userId = normalizeFirestoreId(data?.userId || context.auth.uid, 'userId');
  if (userId !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'You can only sync your own public profile.');
  }

  const userSnap = await firestore.doc(`users/${userId}`).get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User profile not found.');
  }

  await firestore.doc(`publicUserProfiles/${userId}`).set(
    buildTrustedPublicUserProfileProjectionPayload(userSnap.data() || {}, {
      trustedEmail: context.auth.token?.email || null
    }),
    { merge: true }
  );

  return { success: true };
});

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

exports.autoAcceptParentInviteForExistingUser = functions.https.onCall(createAutoAcceptParentInviteHandler({
  firestore,
  Timestamp: admin.firestore.Timestamp,
  HttpsError: functions.https.HttpsError,
  normalizeFirestoreId,
  validateCode: validateAutoAcceptParentInviteCode
}));


exports.redeemParentInvite = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before accepting a parent invite.');
  }

  const userId = normalizeFirestoreId(data?.userId || context.auth.uid, 'userId');
  if (userId !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'You can only accept an invite for your own account.');
  }

  const code = String(data?.code || '').trim().toUpperCase();
  if (!code) {
    throw new functions.https.HttpsError('invalid-argument', 'Access code is required.');
  }

  const codeQuerySnap = await firestore.collection('accessCodes').where('code', '==', code).limit(1).get();
  if (codeQuerySnap.empty) {
    throw new functions.https.HttpsError('not-found', 'Parent invite could not be found.');
  }

  const codeRef = codeQuerySnap.docs[0].ref;
  let responsePayload = null;

  await firestore.runTransaction(async (transaction) => {
    const latestCodeSnap = await transaction.get(codeRef);
    if (!latestCodeSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Parent invite could not be found.');
    }

    const codeData = latestCodeSnap.data() || {};
    if (codeData.type !== 'parent_invite') {
      throw new functions.https.HttpsError('failed-precondition', 'Not a parent invite code.');
    }
    if (codeData.used || codeData.revoked === true || codeData.status === 'removed') {
      throw new functions.https.HttpsError('failed-precondition', 'Parent invite is no longer available.');
    }
    if (isParentInviteExpired(codeData.expiresAt)) {
      throw new functions.https.HttpsError('failed-precondition', 'Parent invite has expired.');
    }

    const invitedEmail = normalizeParentInviteEmail(codeData.email);
    const signedInEmail = normalizeParentInviteEmail(context.auth.token?.email || data?.authEmail);
    if (invitedEmail && (!signedInEmail || invitedEmail !== signedInEmail)) {
      throw new functions.https.HttpsError('permission-denied', `This invite was sent to ${invitedEmail}. Sign in with that email to accept it.`);
    }

    const teamId = normalizeFirestoreId(codeData.teamId, 'teamId');
    const playerId = normalizeFirestoreId(codeData.playerId, 'playerId');
    const userRef = firestore.doc(`users/${userId}`);
    const teamRef = firestore.doc(`teams/${teamId}`);
    const playerRef = firestore.doc(`teams/${teamId}/players/${playerId}`);
    const privateProfileRef = firestore.doc(`teams/${teamId}/players/${playerId}/private/profile`);
    const publicProfileRef = firestore.doc(`publicUserProfiles/${userId}`);

    const [teamSnap, playerSnap, userSnap] = await Promise.all([
      transaction.get(teamRef),
      transaction.get(playerRef),
      transaction.get(userRef)
    ]);

    if (!teamSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Team not found.');
    }
    if (!playerSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Player not found.');
    }

    const team = { id: teamSnap.id, ...(teamSnap.data() || {}) };
    const player = { id: playerSnap.id, ...(playerSnap.data() || {}) };
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const parentLink = buildAutoAcceptedParentLink({ codeData: { ...codeData, teamId, playerId }, team, player });
    const playerKey = `${teamId}::${playerId}`;
    const now = admin.firestore.Timestamp.now();
    const nextUserData = {
      ...userData,
      parentOf: appendUniqueParentLink(userData.parentOf, parentLink),
      parentTeamIds: appendUniqueValue(userData.parentTeamIds, teamId),
      parentPlayerKeys: appendUniqueValue(userData.parentPlayerKeys, playerKey),
      roles: appendUniqueValue(userData.roles, 'parent')
    };

    transaction.set(userRef, {
      parentOf: nextUserData.parentOf,
      parentTeamIds: nextUserData.parentTeamIds,
      parentPlayerKeys: nextUserData.parentPlayerKeys,
      roles: nextUserData.roles
    }, { merge: true });

    transaction.set(publicProfileRef, buildTrustedPublicUserProfileProjectionPayload(nextUserData, {
      trustedEmail: context.auth.token?.email || userData.email || null
    }), { merge: true });

    transaction.set(privateProfileRef, {
      parents: admin.firestore.FieldValue.arrayUnion({
        userId,
        email: codeData.email || signedInEmail || 'pending',
        relation: codeData.relation || null,
        addedAt: now
      })
    }, { merge: true });

    transaction.update(codeRef, {
      used: true,
      usedBy: userId,
      usedAt: now,
      status: 'accepted'
    });

    responsePayload = {
      success: true,
      codeId: latestCodeSnap.id,
      teamId,
      teamName: parentLink.teamName,
      playerId,
      playerName: parentLink.playerName,
      playerNum: parentLink.playerNumber
    };
  });

  return responsePayload;
});

exports.redeemHouseholdInvite = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before accepting a household invite.');
  }

  const userId = normalizeFirestoreId(data?.userId || context.auth.uid, 'userId');
  if (userId !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'You can only accept an invite for your own account.');
  }

  const code = String(data?.code || '').trim().toUpperCase();
  if (!code) {
    throw new functions.https.HttpsError('invalid-argument', 'Access code is required.');
  }

  const codeQuerySnap = await firestore.collection('accessCodes').where('code', '==', code).limit(1).get();
  if (codeQuerySnap.empty) {
    throw new functions.https.HttpsError('not-found', 'Household invite could not be found.');
  }

  const codeRef = codeQuerySnap.docs[0].ref;
  let responsePayload = null;

  await firestore.runTransaction(async (transaction) => {
    const latestCodeSnap = await transaction.get(codeRef);
    if (!latestCodeSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Household invite could not be found.');
    }

    const codeData = latestCodeSnap.data() || {};
    if (codeData.type !== 'household_invite') {
      throw new functions.https.HttpsError('failed-precondition', 'Not a household invite code.');
    }
    if (codeData.used || codeData.revoked === true || codeData.status === 'removed') {
      throw new functions.https.HttpsError('failed-precondition', 'Household invite is no longer available.');
    }
    if (isParentInviteExpired(codeData.expiresAt)) {
      throw new functions.https.HttpsError('failed-precondition', 'Household invite has expired.');
    }

    const invitedEmail = normalizeParentInviteEmail(codeData.email);
    const signedInEmail = normalizeParentInviteEmail(context.auth.token?.email || data?.authEmail);
    if (invitedEmail && (!signedInEmail || invitedEmail !== signedInEmail)) {
      throw new functions.https.HttpsError('permission-denied', `This invite was sent to ${invitedEmail}. Sign in with that email to accept it.`);
    }

    const teamId = normalizeFirestoreId(codeData.teamId, 'teamId');
    const playerId = normalizeFirestoreId(codeData.playerId, 'playerId');
    const userRef = firestore.doc(`users/${userId}`);
    const teamRef = firestore.doc(`teams/${teamId}`);
    const playerRef = firestore.doc(`teams/${teamId}/players/${playerId}`);
    const privateProfileRef = firestore.doc(`teams/${teamId}/players/${playerId}/private/profile`);
    const publicProfileRef = firestore.doc(`publicUserProfiles/${userId}`);
    const membershipRef = codeData.organizerUserId && codeData.familyMembershipId
      ? firestore.doc(`users/${codeData.organizerUserId}/familyMemberships/${codeData.familyMembershipId}`)
      : null;

    const [teamSnap, playerSnap, userSnap, membershipSnap] = await Promise.all([
      transaction.get(teamRef),
      transaction.get(playerRef),
      transaction.get(userRef),
      membershipRef ? transaction.get(membershipRef) : Promise.resolve(null)
    ]);

    if (!teamSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Team not found.');
    }
    if (!playerSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Player not found.');
    }
    if (membershipRef && (!membershipSnap.exists || !doesHouseholdInviteFamilyMembershipMatch(codeData, membershipSnap.data() || {}))) {
      throw new functions.https.HttpsError('failed-precondition', 'This household invite is no longer valid for that player and email. Ask the organizer to send a new invite.');
    }

    const team = { id: teamSnap.id, ...(teamSnap.data() || {}) };
    const player = { id: playerSnap.id, ...(playerSnap.data() || {}) };
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const parentLink = {
      teamId,
      playerId,
      teamName: team.name || codeData.teamName || null,
      playerName: player.name || codeData.playerName || null,
      playerNumber: player.number ?? codeData.playerNum ?? null,
      playerPhotoUrl: player.photoUrl || null,
      relation: codeData.relation || 'Household contact'
    };
    const playerKey = `${teamId}::${playerId}`;
    const now = admin.firestore.Timestamp.now();
    const nextUserData = {
      ...userData,
      parentOf: appendUniqueParentLink(userData.parentOf, parentLink),
      parentTeamIds: appendUniqueValue(userData.parentTeamIds, teamId),
      parentPlayerKeys: appendUniqueValue(userData.parentPlayerKeys, playerKey),
      roles: appendUniqueValue(userData.roles, 'parent')
    };

    transaction.set(userRef, {
      parentOf: nextUserData.parentOf,
      parentTeamIds: nextUserData.parentTeamIds,
      parentPlayerKeys: nextUserData.parentPlayerKeys,
      roles: nextUserData.roles
    }, { merge: true });

    transaction.set(publicProfileRef, buildTrustedPublicUserProfileProjectionPayload(nextUserData, {
      trustedEmail: context.auth.token?.email || userData.email || null
    }), { merge: true });

    transaction.set(privateProfileRef, {
      parents: admin.firestore.FieldValue.arrayUnion({
        userId,
        email: codeData.email || signedInEmail || 'pending',
        relation: parentLink.relation,
        status: 'accepted',
        acceptedAt: now,
        addedAt: now
      })
    }, { merge: true });

    if (membershipRef) {
      transaction.update(membershipRef, {
        status: 'active',
        userId,
        acceptedAt: now,
        updatedAt: now
      });
    }

    transaction.update(codeRef, {
      used: true,
      usedBy: userId,
      usedAt: now,
      status: 'accepted'
    });

    responsePayload = {
      success: true,
      codeId: latestCodeSnap.id,
      teamId,
      teamName: parentLink.teamName,
      playerId,
      playerName: parentLink.playerName,
      playerNum: parentLink.playerNumber
    };
  });

  return responsePayload;
});

exports.revokeHouseholdMemberAccess = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before revoking household access.');
  }

  let membershipId;
  try {
    membershipId = normalizeFirestoreId(data?.membershipId, 'membershipId');
  } catch (_error) {
    throw new functions.https.HttpsError('invalid-argument', 'Household membership is required.');
  }

  const organizerUserId = context.auth.uid;
  const membershipRef = firestore.doc(`users/${organizerUserId}/familyMemberships/${membershipId}`);
  const codeQuery = firestore.collection('accessCodes')
    .where('familyMembershipId', '==', membershipId);
  let responsePayload = null;

  await firestore.runTransaction(async (transaction) => {
    const membershipSnap = await transaction.get(membershipRef);
    if (!membershipSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Household membership could not be found.');
    }

    const membership = membershipSnap.data() || {};
    if (String(membership.organizerUserId || '').trim() !== organizerUserId) {
      throw new functions.https.HttpsError('permission-denied', 'Only the household organizer can revoke this access.');
    }

    const codeQuerySnap = await transaction.get(codeQuery);
    const accessCodes = codeQuerySnap.docs.map((codeSnap) => ({
      id: codeSnap.id,
      ...(codeSnap.data() || {})
    }));
    const membershipUserId = String(membership.userId || '').trim();
    const acceptedMatchingCode = accessCodes.find((codeData) => (
      codeData.type === 'household_invite' &&
      String(codeData.organizerUserId || '').trim() === organizerUserId &&
      String(codeData.familyMembershipId || '').trim() === membershipId &&
      isAcceptedHouseholdAccessCode(codeData) &&
      (!membershipUserId || String(codeData.usedBy || '').trim() === membershipUserId)
    ));
    const membershipTeamId = String(membership.teamId || '').trim();
    const membershipPlayerId = String(membership.playerId || '').trim();
    const teamId = membershipTeamId ? normalizeFirestoreId(membershipTeamId, 'teamId') : '';
    const playerId = membershipPlayerId ? normalizeFirestoreId(membershipPlayerId, 'playerId') : '';
    const invitedUserIdValue = acceptedMatchingCode?.usedBy || '';
    const invitedUserId = invitedUserIdValue
      ? normalizeFirestoreId(invitedUserIdValue, 'invitedUserId')
      : '';
    const userRef = invitedUserId ? firestore.doc(`users/${invitedUserId}`) : null;
    const playerRef = invitedUserId && teamId && playerId
      ? firestore.doc(`teams/${teamId}/players/${playerId}`)
      : null;
    const privateProfileRef = invitedUserId && teamId && playerId
      ? firestore.doc(`teams/${teamId}/players/${playerId}/private/profile`)
      : null;
    const acceptedGrantQuery = invitedUserId
      ? firestore.collection('accessCodes')
        .where('usedBy', '==', invitedUserId)
        .where('teamId', '==', teamId)
        .where('playerId', '==', playerId)
      : null;

    const [userSnap, playerSnap, privateProfileSnap, acceptedGrantSnap] = await Promise.all([
      userRef ? transaction.get(userRef) : Promise.resolve(null),
      playerRef ? transaction.get(playerRef) : Promise.resolve(null),
      privateProfileRef ? transaction.get(privateProfileRef) : Promise.resolve(null),
      acceptedGrantQuery ? transaction.get(acceptedGrantQuery) : Promise.resolve(null)
    ]);
    const userData = userSnap?.exists ? userSnap.data() || {} : {};
    const player = playerSnap?.exists ? playerSnap.data() || {} : {};
    const privateProfile = privateProfileSnap?.exists ? privateProfileSnap.data() || {} : {};
    const acceptedGrantCodes = acceptedGrantSnap?.docs?.map((codeSnap) => ({
      id: codeSnap.id,
      ...(codeSnap.data() || {})
    })) || [];
    const allAccessCodes = [...new Map(
      [...accessCodes, ...acceptedGrantCodes].map((codeData) => [codeData.id, codeData])
    ).values()];
    const now = admin.firestore.Timestamp.now();
    let plan;
    try {
      plan = buildHouseholdAccessRevocationPlan({
        organizerUserId,
        membershipId,
        membership,
        accessCodes: allAccessCodes,
        userData,
        player,
        privateProfile,
        timestamp: now
      });
    } catch (error) {
      throw new functions.https.HttpsError('failed-precondition', error?.message || 'Household membership cannot be revoked.');
    }

    transaction.set(membershipRef, plan.membershipUpdate, { merge: true });
    plan.accessCodeUpdates.forEach(({ id, update }) => {
      transaction.set(firestore.doc(`accessCodes/${id}`), update, { merge: true });
    });

    if (plan.invitedUserId && userRef && userSnap?.exists && plan.userUpdate) {
      const nextUserData = { ...userData, ...plan.userUpdate };
      transaction.set(userRef, {
        ...plan.userUpdate,
        updatedAt: now
      }, { merge: true });
      transaction.set(
        firestore.doc(`publicUserProfiles/${plan.invitedUserId}`),
        buildTrustedPublicUserProfileProjectionPayload(nextUserData, {
          trustedEmail: userData.email || null
        }),
        { merge: true }
      );
    }

    if (plan.invitedUserId && privateProfileRef && privateProfileSnap?.exists && plan.privateProfileUpdate) {
      transaction.set(privateProfileRef, {
        ...plan.privateProfileUpdate,
        updatedAt: now
      }, { merge: true });
    }

    responsePayload = {
      success: true,
      membershipId,
      teamId: plan.teamId,
      playerId: plan.playerId,
      revokedUserId: plan.invitedUserId || null,
      preservedPlayerAccess: plan.preservedPlayerAccess
    };
  });

  functions.logger.info('Revoked household member access', {
    organizerUserId,
    membershipId,
    teamId: responsePayload?.teamId,
    playerId: responsePayload?.playerId,
    revokedUserId: responsePayload?.revokedUserId,
    preservedPlayerAccess: responsePayload?.preservedPlayerAccess
  });
  return responsePayload;
});

exports.redeemCoParentInvite = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before accepting a co-parent invite.');
  }

  const userId = normalizeFirestoreId(data?.userId || context.auth.uid, 'userId');
  if (userId !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'You can only accept an invite for your own account.');
  }

  const code = String(data?.code || '').trim().toUpperCase();
  if (!code) {
    throw new functions.https.HttpsError('invalid-argument', 'Access code is required.');
  }

  const codeQuerySnap = await firestore.collection('accessCodes').where('code', '==', code).limit(1).get();
  if (codeQuerySnap.empty) {
    throw new functions.https.HttpsError('not-found', 'Co-parent invite could not be found.');
  }

  const codeRef = codeQuerySnap.docs[0].ref;
  let responsePayload = null;

  await firestore.runTransaction(async (transaction) => {
    const latestCodeSnap = await transaction.get(codeRef);
    if (!latestCodeSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Co-parent invite could not be found.');
    }

    const codeData = latestCodeSnap.data() || {};
    if (codeData.type !== 'coparent_invite') {
      throw new functions.https.HttpsError('failed-precondition', 'Not a co-parent invite code.');
    }
    if (codeData.used || codeData.revoked === true || codeData.status === 'removed') {
      throw new functions.https.HttpsError('failed-precondition', 'Co-parent invite is no longer available.');
    }
    if (isParentInviteExpired(codeData.expiresAt)) {
      throw new functions.https.HttpsError('failed-precondition', 'Co-parent invite has expired.');
    }

    const invitedEmail = normalizeParentInviteEmail(codeData.email);
    const signedInEmail = normalizeParentInviteEmail(context.auth.token?.email || data?.authEmail);
    if (invitedEmail && (!signedInEmail || invitedEmail !== signedInEmail)) {
      throw new functions.https.HttpsError('permission-denied', `This invite was sent to ${invitedEmail}. Sign in with that email to accept it.`);
    }

    const teamId = normalizeFirestoreId(codeData.teamId, 'teamId');
    const playerId = normalizeFirestoreId(codeData.playerId, 'playerId');
    const userRef = firestore.doc(`users/${userId}`);
    const teamRef = firestore.doc(`teams/${teamId}`);
    const playerRef = firestore.doc(`teams/${teamId}/players/${playerId}`);
    const privateProfileRef = firestore.doc(`teams/${teamId}/players/${playerId}/private/profile`);

    const [teamSnap, playerSnap, userSnap] = await Promise.all([
      transaction.get(teamRef),
      transaction.get(playerRef),
      transaction.get(userRef)
    ]);

    if (!teamSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Team not found.');
    }
    if (!playerSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Player not found.');
    }

    const team = { id: teamSnap.id, ...(teamSnap.data() || {}) };
    const player = { id: playerSnap.id, ...(playerSnap.data() || {}) };
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const relation = codeData.relation || 'Co-parent';
    const parentLink = {
      teamId,
      playerId,
      teamName: team.name || codeData.teamName || null,
      playerName: player.name || codeData.playerName || null,
      playerNumber: player.number ?? codeData.playerNum ?? null,
      playerPhotoUrl: player.photoUrl || null,
      relation
    };
    const playerKey = `${teamId}::${playerId}`;
    const now = admin.firestore.Timestamp.now();

    transaction.set(userRef, {
      parentOf: appendUniqueParentLink(userData.parentOf, parentLink),
      parentTeamIds: appendUniqueValue(userData.parentTeamIds, teamId),
      parentPlayerKeys: appendUniqueValue(userData.parentPlayerKeys, playerKey),
      roles: appendUniqueValue(userData.roles, 'parent')
    }, { merge: true });

    transaction.set(privateProfileRef, {
      parents: admin.firestore.FieldValue.arrayUnion({
        userId,
        email: codeData.email || signedInEmail || 'pending',
        relation,
        status: 'accepted',
        acceptedAt: now,
        addedAt: now
      })
    }, { merge: true });

    transaction.update(codeRef, {
      used: true,
      usedBy: userId,
      usedAt: now,
      status: 'accepted'
    });

    responsePayload = {
      success: true,
      codeId: latestCodeSnap.id,
      teamId,
      teamName: parentLink.teamName,
      playerId,
      playerName: parentLink.playerName,
      playerNum: parentLink.playerNumber
    };
  });

  return responsePayload;
});

exports.redeemAdminInvite = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in before accepting an admin invite.');
  }

  const userId = normalizeFirestoreId(data?.userId || context.auth.uid, 'userId');
  if (userId !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'You can only accept an invite for your own account.');
  }

  const codeId = normalizeFirestoreId(data?.codeId, 'codeId');
  const codeRef = firestore.doc(`accessCodes/${codeId}`);
  let responsePayload = null;

  await firestore.runTransaction(async (transaction) => {
    const codeSnap = await transaction.get(codeRef);
    if (!codeSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Admin invite could not be found.');
    }

    const codeData = codeSnap.data() || {};
    if (codeData.type !== 'admin_invite') {
      throw new functions.https.HttpsError('failed-precondition', 'Not an admin invite code.');
    }
    if (codeData.used || codeData.revoked === true || codeData.active === false || ['removed', 'cancelled', 'revoked'].includes(codeData.status)) {
      throw new functions.https.HttpsError('failed-precondition', 'Admin invite is no longer available.');
    }
    if (isParentInviteExpired(codeData.expiresAt)) {
      throw new functions.https.HttpsError('failed-precondition', 'Admin invite has expired.');
    }

    const invitedEmail = normalizeParentInviteEmail(codeData.email);
    if (!invitedEmail) {
      throw new functions.https.HttpsError('failed-precondition', 'Admin invite is missing an invited email.');
    }

    const teamId = normalizeFirestoreId(codeData.teamId, 'teamId');
    const teamRef = firestore.doc(`teams/${teamId}`);
    const userRef = firestore.doc(`users/${userId}`);
    const [teamSnap, userSnap] = await Promise.all([
      transaction.get(teamRef),
      transaction.get(userRef)
    ]);

    if (!teamSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Team not found.');
    }

    const teamData = teamSnap.data() || {};
    const userData = userSnap.exists ? userSnap.data() || {} : {};
    const signedInEmail = normalizeParentInviteEmail(context.auth.token?.email || userData.email);
    if (!signedInEmail || invitedEmail !== signedInEmail) {
      throw new functions.https.HttpsError('permission-denied', `This invite was sent to ${invitedEmail}. Sign in with that email to accept it.`);
    }

    const now = admin.firestore.Timestamp.now();

    transaction.set(teamRef, {
      adminEmails: appendUniqueValue(teamData.adminEmails, invitedEmail),
      updatedAt: now
    }, { merge: true });
    transaction.set(userRef, {
      coachOf: appendUniqueValue(userData.coachOf, teamId),
      roles: appendUniqueValue(userData.roles, 'coach'),
      updatedAt: now
    }, { merge: true });
    transaction.update(codeRef, {
      used: true,
      usedBy: userId,
      usedAt: now
    });

    responsePayload = {
      success: true,
      codeId,
      teamId,
      teamName: teamData.name || codeData.teamName || null
    };
  });

  return responsePayload;
});

exports.validateAccessCodeForAcceptance = functions.https.onCall(async (data, context) => {
  const code = String(data?.code || '').trim().toUpperCase();
  if (!code) {
    throw new functions.https.HttpsError('invalid-argument', 'Access code is required.');
  }
  const nativeAuthToken = String(data?.nativeAuthToken || '').trim();
  const nativeAuthUser = nativeAuthToken
    ? await admin.auth().verifyIdToken(nativeAuthToken).catch(() => null)
    : null;
  const acceptingUserId = String(context?.auth?.uid || nativeAuthUser?.uid || nativeAuthUser?.sub || '').trim();
  if (!acceptingUserId) {
    return buildGenericPreAuthAccessCodeValidationResult();
  }

  const snapshot = await firestore.collection('accessCodes').where('code', '==', code).get();
  return validateAccessCodeCandidates(snapshot.docs.map((docSnap) => ({
    id: docSnap.id,
    data: docSnap.data() || {}
  })), Date.now(), acceptingUserId);
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

async function resolveAccountMergeSource(input, destinationUid) {
  const tokenHash = hashAccountMergeVerificationToken(input.verificationToken);
  const tokenSnap = await firestore.doc(`accountMergeVerificationTokens/${tokenHash}`).get();
  if (!tokenSnap.exists) {
    throw new functions.https.HttpsError('failed-precondition', 'Account merge verification token is invalid.');
  }
  const verification = {
    ...(tokenSnap.data() || {}),
    id: tokenSnap.id
  };
  let sourceUid;
  try {
    sourceUid = validateAccountMergeVerificationRecord({
      record: verification,
      destinationUid,
      sourceUid: input.sourceUid
    });
  } catch (error) {
    throw new functions.https.HttpsError('failed-precondition', error.message || 'Account merge verification token is invalid.');
  }

  const sourceSnap = await firestore.doc(`users/${sourceUid}`).get();
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
    requireAccountMergeVerificationToken(input);
  } catch (error) {
    const message = error.message || 'Verify ownership of the source account before previewing an account merge.';
    await writeAccountMergePreviewAudit({
      destinationUid,
      destinationEmail,
      sourceUid: input.sourceUid || '',
      sourceEmail: input.sourceEmail || '',
      status: 'rejected',
      errorCode: 'failed-precondition',
      errorMessage: message
    });
    throw new functions.https.HttpsError('failed-precondition', message);
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
  if (registration.status === 'rejected') {
    throw new functions.https.HttpsError('failed-precondition', 'Rejected registrations cannot be paid online.');
  }
  if (registration.paymentStatus === 'paid') {
    throw new functions.https.HttpsError('failed-precondition', 'This registration has already been paid.');
  }

  // Recompute from the authoritative form at the server-captured submission
  // time. This prevents a tampered feeSnapshot from lowering the charge while
  // preserving time-sensitive discounts when checkout is retried later.
  const expectedAmountCents = getRegistrationCheckoutAmountCents(registration, form);
  const amountCents = expectedAmountCents;
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new functions.https.HttpsError('failed-precondition', 'This registration does not have a payment due.');
  }
  const currency = getRegistrationCheckoutCurrency(registration, form);
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

  const checkoutCreationReservationId = crypto.randomUUID();
  let checkoutCreationReservation;
  try {
    checkoutCreationReservation = await reserveRegistrationCheckoutCreation(resolvedInput, {
      checkoutCreationReservationId,
      amountCents
    });
  } catch (error) {
    if (retryCapacityReservation.reserved) {
      await releaseRegistrationCheckoutCapacity(resolvedInput, {}, {
        retryCapacityReservationId: retryCapacityReservation.retryCapacityReservationId,
        checkoutCreationReservationId,
        suppressPublicCheckoutCapabilityRotation: true
      }).catch(() => {});
    }
    throw error;
  }
  if (!checkoutCreationReservation.reserved) {
    return {
      checkoutUrl: checkoutCreationReservation.checkoutUrl,
      sessionId: checkoutCreationReservation.sessionId
    };
  }
  if (!retryCapacityReservation.reserved && checkoutCreationReservation.retryCapacityReservationId) {
    retryCapacityReservation = {
      reserved: true,
      retryCapacityReservationId: checkoutCreationReservation.retryCapacityReservationId
    };
  }

  const stripe = createStripeClient();
  const { appUrl } = getStripeConfig();
  const issuedPublicCheckoutCapability = createRawPublicCheckoutCapability();
  const checkoutUrlInput = {
    ...resolvedInput,
    publicCheckoutCapability: issuedPublicCheckoutCapability,
    paymentPlanId: String(registration.paymentPlan?.id || 'pay_full').trim() || 'pay_full',
    paidInstallmentCount: registration.paymentPlan?.id === 'installments'
      ? getRegistrationPaymentPlanPaidInstallmentCount(registration) + 1
      : 0
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
    await clearRegistrationCheckoutCreationReservation(resolvedInput, checkoutCreationReservationId).catch((clearError) => {
      functions.logger.error('Failed to clear registration checkout creation reservation.', {
        teamId: resolvedInput.teamId,
        formId: resolvedInput.formId,
        registrationId: resolvedInput.registrationId,
        clearError: clearError?.message || clearError
      });
    });
    if (retryCapacityReservation.reserved) {
      try {
        await releaseRegistrationCheckoutCapacity({
          ...resolvedInput,
          publicCheckoutCapability: resolvedInput.publicCheckoutCapability || issuedPublicCheckoutCapability
        }, {}, {
          retryCapacityReservationId: retryCapacityReservation.retryCapacityReservationId,
          checkoutCreationReservationId,
          suppressPublicCheckoutCapabilityRotation: true
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
  await firestore.runTransaction(async (transaction) => {
    const latestSnap = await transaction.get(resolvedInput.registrationRef);
    if (!latestSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Registration not found.');
    }
    const latestRegistration = latestSnap.data() || {};
    if (String(latestRegistration.checkoutCreationReservationId || '') !== checkoutCreationReservationId) {
      throw new functions.https.HttpsError('aborted', 'Registration checkout creation reservation was lost.');
    }
    if (latestRegistration.status === 'rejected') {
      throw new functions.https.HttpsError('failed-precondition', 'Rejected registrations cannot be paid online.');
    }
    transaction.set(resolvedInput.registrationRef, {
      checkoutUrl: session.url,
      paymentLink: session.url,
      checkoutStatus: 'open',
      paymentProvider: 'stripe',
      paymentStatus: 'checkout_open',
      stripeCheckoutSessionId: session.id,
      stripePaymentStatus: session.payment_status || 'unpaid',
      checkoutAmountCents: amountCents,
      checkoutCurrency: currency,
      checkoutAttemptToken: input.checkoutAttemptToken || null,
      publicCheckoutCapabilityHash: hashPublicCheckoutCapability(issuedPublicCheckoutCapability),
      checkoutCreatedAt: now,
      checkoutCreationReservationId: admin.firestore.FieldValue.delete(),
      checkoutCreationStartedAt: admin.firestore.FieldValue.delete(),
      retryCapacityReservationId: admin.firestore.FieldValue.delete(),
      updatedAt: now
    }, { merge: true });
  });

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

        const form = formSnap.data() || {};
        const registration = registrationSnap.data() || {};
        if (shouldMarkRegistrationPaidFromEvent(event)) {
          const paidCheckoutGuardFailure = getRegistrationPaidCheckoutGuardFailure({
            registration,
            session,
            authorityMatches: registrationCheckoutAuthorityMatches(registration, registrationInput),
            expectedCurrency: getRegistrationCheckoutCurrency(registration, form)
          });
          if (paidCheckoutGuardFailure) {
            transaction.set(eventRef, {
              provider: 'stripe',
              product: 'registration',
              type: event.type,
              checkoutSessionId: session.id || null,
              registrationPath: registrationRef.path,
              ignored: true,
              ignoredReason: paidCheckoutGuardFailure,
              receivedAt
            });
            return;
          }

          if (registration.paymentPlan?.id === 'installments' && form.installmentPlan?.enabled === true) {
            const nextPaidInstallmentCount = getRegistrationPaymentPlanPaidInstallmentCount(registration) + 1;
            const installmentState = buildRegistrationInstallmentPaymentState(registration, form, nextPaidInstallmentCount);
            const hasRemainingInstallments = installmentState.remainingBalanceCents > 0 && installmentState.remainingSchedule.length > 0;
            transaction.set(registrationRef, {
              checkoutStatus: 'complete',
              paymentStatus: hasRemainingInstallments ? 'installment_in_progress' : 'paid',
              paidAt: receivedAt,
              balanceDueCents: installmentState.remainingBalanceCents,
              nextPaymentDueDate: installmentState.nextDueDate || null,
              stripeCheckoutSessionId: session.id || null,
              stripePaymentIntentId: session.payment_intent || null,
              stripePaymentStatus: session.payment_status || 'paid',
              stripeEventId: event.id,
              lastPaidStripeCheckoutSessionId: session.id,
              paymentPlan: {
                ...registration.paymentPlan,
                totalBalanceDueCents: installmentState.totalBalanceDueCents,
                schedule: installmentState.schedule,
                paidInstallmentCount: installmentState.paidInstallmentCount,
                remainingBalanceCents: installmentState.remainingBalanceCents,
                nextDueDate: installmentState.nextDueDate || null,
                lastPaidInstallmentAmountCents: Math.max(0, Math.round(Number(session.amount_total || 0) || 0)),
                lastPaidInstallmentAt: receivedAt
              },
              updatedAt: receivedAt
            }, { merge: true });
            transaction.update(registrationRef, buildRegistrationReminderStopUpdate({ reason: hasRemainingInstallments ? 'installment_in_progress' : 'paid', nowIso: queuedAtIso }));
          } else {
            transaction.set(registrationRef, {
              checkoutStatus: 'complete',
              paymentStatus: 'paid',
              paidAt: receivedAt,
              balanceDueCents: 0,
              nextPaymentDueDate: null,
              stripeCheckoutSessionId: session.id || null,
              stripePaymentIntentId: session.payment_intent || null,
              stripePaymentStatus: session.payment_status || 'paid',
              stripeEventId: event.id,
              lastPaidStripeCheckoutSessionId: session.id,
              updatedAt: receivedAt
            }, { merge: true });
            transaction.update(registrationRef, buildRegistrationReminderStopUpdate({ reason: 'paid', nowIso: queuedAtIso }));
          }
        } else {
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
          const shouldRetainCapacity = shouldKeepRegistrationCapacityReserved(registration);
          const shouldReleaseCapacity = !shouldRetainCapacity && registration.registrationCapacityReleased !== true && registration.paymentStatus !== 'paid' && countKey;
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
            ...(shouldReleaseCapacity ? {
              registrationCapacityReleased: true,
              capacityReleasedAt: receivedAt
            } : {}),
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

function writeCorsHeaders(req, res, methods = 'GET,OPTIONS') {
  const origin = req.headers.origin;
  if (origin && allowedOriginSet.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', methods);
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Firebase-AppCheck');
  res.set('Cache-Control', 'no-store');
}

function writeTelemetryCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (isAllowedTelemetryOrigin(origin, allowedOriginSet)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', 'POST,OPTIONS');
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
  return normalizeTelemetryOptionalPath(value) || '/';
}

function normalizeTelemetryOptionalPath(value) {
  const path = normalizeTelemetryString(value || '', 220);
  if (!path || path[0] !== '/') return '';
  return path.split('?')[0].split('#')[0] || '/';
}

function normalizeTelemetryKeyArray(value, limit = 20) {
  return Array.isArray(value)
    ? value.slice(0, limit).map((key) => normalizeTelemetryKey(key, 60)).filter(Boolean)
    : [];
}

function getTelemetryAppRoute(rawEvent, properties) {
  const candidates = [
    rawEvent?.appRoute,
    properties?.completedRoute,
    properties?.targetRoute,
    properties?.route,
    properties?.appRoute,
    rawEvent?.pagePath
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const route = normalizeTelemetryOptionalPath(candidate);
    if (route) return route;
  }

  return '/';
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
  const properties = normalizeTelemetryObject(rawEvent.properties);
  const pagePath = normalizeTelemetryPath(rawEvent.pagePath);
  const appRoute = getTelemetryAppRoute(rawEvent, properties);

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
    pagePath,
    appRoute,
    pageTitle: normalizeTelemetryString(rawEvent.pageTitle, 140),
    queryKeys: normalizeTelemetryKeyArray(rawEvent.queryKeys),
    appRouteQueryKeys: normalizeTelemetryKeyArray(rawEvent.appRouteQueryKeys),
    referrer: normalizeTelemetryString(rawEvent.referrer, 160),
    viewport: normalizeTelemetryObject(rawEvent.viewport),
    screen: normalizeTelemetryObject(rawEvent.screen),
    timezone: normalizeTelemetryString(rawEvent.timezone, 80),
    language: normalizeTelemetryString(rawEvent.language, 32),
    userAgent: normalizeTelemetryString(rawEvent.userAgent, 260),
    properties
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

  const routeDocId = `${dateKey}_${telemetryDocId(event.appRoute || event.pagePath)}`;
  batch.set(db.collection('telemetryRoutesDaily').doc(routeDocId), {
    date: dateKey,
    appRoute: event.appRoute || event.pagePath,
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
    lastRoute: event.appRoute || event.pagePath,
    lastEventName: event.name,
    eventCount: increment(1),
    pageViews: increment(isPageView ? 1 : 0),
    interactions: increment(isInteraction ? 1 : 0),
    errors: increment(isError ? 1 : 0),
    updatedAt: serverTimestamp()
  };

  if (isPageView && !options.sessionExists) {
    sessionUpdate.entryPage = event.pagePath;
    sessionUpdate.entryRoute = event.appRoute || event.pagePath;
  }

  batch.set(db.collection('telemetrySessions').doc(event.sessionId), sessionUpdate, { merge: true });
}

const MAX_TELEMETRY_EVENTS_PER_REQUEST = 25;
const TELEMETRY_WRITES_PER_EVENT = 6;
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

function getCalendarFeedGamesQuery(teamId) {
  return buildCalendarFeedGamesQuery(firestore.collection(`teams/${teamId}/games`));
}

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
      const gamesSnap = await getCalendarFeedGamesQuery(teamId).get();
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

    const eventsSnap = await getCalendarFeedGamesQuery(teamId).get();
    const events = eventsSnap.docs.map((docSnap) => {
      const game = { id: docSnap.id, ...(docSnap.data() || {}) };
      game.officiating = Array.isArray(game.officiating) ? game.officiating : (Array.isArray(game.officials) ? game.officials : []);
      return game;
    });
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

const FAMILY_SHARE_GAME_PROJECTION_FIELDS = [
  'type',
  'date',
  'end',
  'endDate',
  'startTime',
  'endTime',
  'endDayOffset',
  'instanceDate',
  'masterId',
  'occurrenceId',
  'isSeriesMaster',
  'recurrence',
  'exDates',
  'overrides',
  'title',
  'opponent',
  'location',
  'status',
  'calendarEventUid',
  'homeScore',
  'awayScore',
  'sharedGameId',
  'sharedGamePath',
  'teamId',
  'opponentTeamId',
  'opponentTeamName',
  'opponentTeamPhoto',
  'isHome',
  'isSharedGame',
  'competitionType',
  'countsTowardSeasonRecord'
];

function normalizeFamilyShareText(value) {
  return value == null ? '' : String(value).trim();
}

function requireFamilyShareTokenId(data) {
  const tokenId = normalizeFamilyShareText(data?.tokenId);
  if (!/^[a-f0-9]{40}$/i.test(tokenId)) {
    throw new functions.https.HttpsError('invalid-argument', 'A valid family share token is required.');
  }
  return tokenId;
}

function normalizeFamilyShareCallableChildren(children = []) {
  const seen = new Set();
  return (Array.isArray(children) ? children : [])
    .map((child = {}) => {
      const teamId = normalizeFamilyShareText(child.teamId);
      const playerId = normalizeFamilyShareText(child.playerId || child.childId);
      return {
        teamId,
        teamName: normalizeFamilyShareText(child.teamName || child.team),
        playerId,
        playerName: normalizeFamilyShareText(child.playerName || child.childName || child.name) || 'Player',
        playerNumber: normalizeFamilyShareText(child.playerNumber ?? child.number),
        playerPhotoUrl: normalizeFamilyShareText(child.playerPhotoUrl || child.photoUrl) || null
      };
    })
    .filter((child) => {
      if (!child.teamId || !child.playerId) return false;
      const key = `${child.teamId}::${child.playerId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

async function loadReadableFamilyShareToken(tokenId) {
  const tokenSnap = await firestore.doc(`familyShareTokens/${tokenId}`).get();
  if (!tokenSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Family share token not found.');
  }

  const token = tokenSnap.data() || {};
  if (!isFamilyShareTokenReadable(token)) {
    throw new functions.https.HttpsError('permission-denied', 'Family share token is no longer active.');
  }
  return token;
}

async function resolveReadableFamilyShareChildren(token) {
  const storedChildren = normalizeFamilyShareCallableChildren(token.children);
  const ownerUserId = normalizeFamilyShareText(token.ownerUserId);
  if (!ownerUserId) return [];

  const ownerSnap = await firestore.doc(`users/${ownerUserId}`).get();
  if (!ownerSnap.exists) return [];

  const ownerChildren = normalizeFamilyShareCallableChildren(await resolveFamilyShareChildrenFromOwnerProfile(ownerSnap.data() || {}, {
    loadTeam: async (teamId) => {
      const teamSnap = await firestore.doc(`teams/${teamId}`).get();
      return teamSnap.exists ? { id: teamSnap.id, ...(teamSnap.data() || {}) } : null;
    },
    loadPlayer: async (teamId, playerId) => {
      const playerSnap = await firestore.doc(`teams/${teamId}/players/${playerId}`).get();
      return playerSnap.exists ? { id: playerSnap.id, ...(playerSnap.data() || {}) } : null;
    }
  }));

  // Token documents are written by clients, so their child/team IDs are only a
  // requested subset. Never use them as proof that the token owner can read a
  // private schedule; intersect them with the owner's live parent scope.
  if (!storedChildren.length) return ownerChildren;
  const storedKeys = new Set(storedChildren.map((child) => `${child.teamId}::${child.playerId}`));
  return ownerChildren.filter((child) => storedKeys.has(`${child.teamId}::${child.playerId}`));
}

function isFamilyShareTeamActive(team = {}) {
  const status = normalizeFamilyShareText(team.status).toLowerCase();
  return team.active !== false &&
    team.archived !== true &&
    !['archived', 'inactive', 'disabled'].includes(status);
}

function serializeFamilyShareValue(value) {
  if (!value) return value ?? null;
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return Number.isNaN(date?.getTime?.()) ? null : date.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (Array.isArray(value)) return value.map(serializeFamilyShareValue);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializeFamilyShareValue(entry)])
    );
  }
  return value;
}

function serializeFamilyShareRecurrence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const recurrence = {};
  const freq = normalizeFamilyShareText(value.freq).toLowerCase();
  if (['daily', 'weekly'].includes(freq)) recurrence.freq = freq;
  const interval = Math.floor(Number(value.interval));
  if (Number.isFinite(interval) && interval > 0) recurrence.interval = Math.min(interval, 3660);
  const count = Math.floor(Number(value.count));
  if (Number.isFinite(count) && count > 0) recurrence.count = Math.min(count, 3660);
  if (Array.isArray(value.byDays)) {
    recurrence.byDays = [...new Set(value.byDays
      .map((day) => normalizeFamilyShareText(day).toUpperCase())
      .filter((day) => ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].includes(day)))]
      .slice(0, 7);
  }
  if (value.until) recurrence.until = serializeFamilyShareValue(value.until);
  return recurrence;
}

function serializeFamilyShareOverrides(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value)
    .filter(([dateKey, override]) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey) && override && typeof override === 'object' && !Array.isArray(override))
    .slice(0, 1000)
    .map(([dateKey, override]) => {
      const safeOverride = {};
      ['title', 'location', 'startTime', 'endTime'].forEach((field) => {
        if (Object.hasOwn(override, field)) safeOverride[field] = normalizeFamilyShareText(override[field]);
      });
      return [dateKey, safeOverride];
    }));
}

function serializeFamilyShareGame(docSnap) {
  const data = docSnap.data() || {};
  const game = {
    id: docSnap.id,
    gameId: docSnap.id
  };
  FAMILY_SHARE_GAME_PROJECTION_FIELDS.forEach((field) => {
    if (Object.hasOwn(data, field)) {
      if (field === 'recurrence') {
        game[field] = serializeFamilyShareRecurrence(data[field]);
      } else if (field === 'overrides') {
        game[field] = serializeFamilyShareOverrides(data[field]);
      } else if (field === 'exDates') {
        game[field] = (Array.isArray(data[field]) ? data[field] : [])
          .map(normalizeFamilyShareText)
          .filter((dateKey) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey))
          .slice(0, 1000);
      } else {
        game[field] = serializeFamilyShareValue(data[field]);
      }
    }
  });
  return game;
}

function getFamilyShareSharedGamePath(docSnap) {
  return normalizeFamilyShareText(docSnap?.ref?.path) || `sharedGames/${normalizeFamilyShareText(docSnap?.id)}`;
}

function buildFamilyShareSharedGameSyntheticId(sharedGamePath) {
  return `shared_${encodeURIComponent(sharedGamePath)}`;
}

function getFamilyShareDisplayTeamName(teamName, placeholderName) {
  return normalizeFamilyShareText(teamName) || normalizeFamilyShareText(placeholderName) || 'TBD';
}

function projectFamilyShareSharedGameForTeam(docSnap, teamId) {
  const data = docSnap.data() || {};
  const isHome = normalizeFamilyShareText(data.homeTeamId) === teamId;
  const isAway = normalizeFamilyShareText(data.awayTeamId) === teamId;
  if (!isHome && !isAway) return null;

  const sharedGamePath = getFamilyShareSharedGamePath(docSnap);
  const opponentTeamId = isHome
    ? normalizeFamilyShareText(data.awayTeamId) || null
    : normalizeFamilyShareText(data.homeTeamId) || null;
  const opponentTeamName = isHome
    ? getFamilyShareDisplayTeamName(data.awayTeamName, data.awayPlaceholderName)
    : getFamilyShareDisplayTeamName(data.homeTeamName, data.homePlaceholderName);
  const opponentTeamPhoto = isHome
    ? normalizeFamilyShareText(data.awayTeamPhoto) || null
    : normalizeFamilyShareText(data.homeTeamPhoto) || null;

  return {
    ...data,
    type: data.type || 'game',
    sharedGameId: normalizeFamilyShareText(docSnap.id) || null,
    sharedGamePath,
    teamId,
    opponent: opponentTeamName,
    opponentTeamId,
    opponentTeamName,
    opponentTeamPhoto,
    isHome,
    isSharedGame: true,
    competitionType: data.competitionType || 'tournament',
    countsTowardSeasonRecord: data.countsTowardSeasonRecord !== false
  };
}

async function loadFamilyShareSharedGamesForTeam(teamId) {
  if (typeof firestore.collectionGroup !== 'function') return [];
  const sharedGamesRef = firestore.collectionGroup('sharedGames');
  const queries = [
    sharedGamesRef.where('homeTeamId', '==', teamId),
    sharedGamesRef.where('awayTeamId', '==', teamId),
    sharedGamesRef.where('teamIds', 'array-contains', teamId)
  ];
  const snapshots = await Promise.allSettled(queries.map((query) => query.get()));
  snapshots
    .filter((result) => result.status === 'rejected')
    .forEach((result) => {
      functions.logger.warn('Failed to load shared family share games for team', {
        teamId,
        error: result.reason?.message || String(result.reason)
      });
    });

  const docsByPath = new Map();
  snapshots.forEach((result) => {
    if (result.status !== 'fulfilled') return;
    result.value.docs.forEach((docSnap) => {
      docsByPath.set(getFamilyShareSharedGamePath(docSnap), docSnap);
    });
  });

  return [...docsByPath.values()]
    .map((docSnap) => {
      const projected = projectFamilyShareSharedGameForTeam(docSnap, teamId);
      if (!projected) return null;
      const sharedGamePath = projected.sharedGamePath || getFamilyShareSharedGamePath(docSnap);
      return serializeFamilyShareGame({
        id: buildFamilyShareSharedGameSyntheticId(sharedGamePath),
        data: () => projected
      });
    })
    .filter(Boolean);
}

async function loadFamilyShareScheduleTeams(children) {
  const teamIds = [...new Set(children.map((child) => child.teamId).filter(Boolean))];
  const teams = await Promise.all(teamIds.map(async (teamId) => {
    const teamSnap = await firestore.doc(`teams/${teamId}`).get();
    if (!teamSnap.exists) return null;
    const team = teamSnap.data() || {};
    if (!isFamilyShareTeamActive(team)) return null;

    const [gamesSnap, sharedGames] = await Promise.all([
      firestore.collection(`teams/${teamId}/games`).get(),
      loadFamilyShareSharedGamesForTeam(teamId)
    ]);
    return {
      teamId,
      teamName: normalizeFamilyShareText(team.name) || children.find((child) => child.teamId === teamId)?.teamName || 'Team',
      calendarUrls: team.isPublic === true
        ? (Array.isArray(team.calendarUrls) ? team.calendarUrls : [])
          .map(normalizeFamilyShareText)
          .filter(Boolean)
        : [],
      games: [
        ...gamesSnap.docs.map(serializeFamilyShareGame),
        ...sharedGames
      ]
    };
  }));
  return teams.filter(Boolean);
}

exports.resolveFamilyShareTokenChildren = functions.https.onCall(async (data) => {
  const token = await loadReadableFamilyShareToken(requireFamilyShareTokenId(data));
  return { children: await resolveReadableFamilyShareChildren(token) };
});

exports.getFamilyShareSchedule = functions.https.onCall(async (data) => {
  const token = await loadReadableFamilyShareToken(requireFamilyShareTokenId(data));
  const children = await resolveReadableFamilyShareChildren(token);
  const teams = await loadFamilyShareScheduleTeams(children);
  return { children, teams };
});

exports.fetchCalendarIcs = functions
  .runWith(fetchCalendarRuntime)
  .https
  .onRequest(createCalendarIcsFetchHandler({
    cache: calendarIcsCache,
    checkRateLimit: checkCalendarFetchRateLimit,
    checkForceRefreshRateLimit: checkCalendarForceRefreshRateLimit,
    isAllowedOrigin,
    writeCorsHeaders,
    normalizeTargetUrl,
    fetchWithTimeout,
    normalizeIcsText
  }));

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

function createBoundedFirestoreBatchWriter(limit = FIRESTORE_BATCH_SAFE_WRITE_LIMIT) {
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 500 ? limit : FIRESTORE_BATCH_SAFE_WRITE_LIMIT;
  let batch = firestore.batch();
  let operationCount = 0;
  const commits = [];

  const commitCurrentBatch = () => {
    if (operationCount <= 0) return;
    const batchToCommit = batch;
    commits.push(() => batchToCommit.commit());
    batch = firestore.batch();
    operationCount = 0;
  };

  const addOperation = (operation) => {
    if (operationCount >= safeLimit) {
      commitCurrentBatch();
    }
    operation(batch);
    operationCount += 1;
  };

  return {
    set(ref, value, options) {
      addOperation((currentBatch) => currentBatch.set(ref, value, options));
    },
    delete(ref) {
      addOperation((currentBatch) => currentBatch.delete(ref));
    },
    update(ref, value) {
      addOperation((currentBatch) => currentBatch.update(ref, value));
    },
    async commit() {
      commitCurrentBatch();
      for (const commit of commits) {
        await commit();
      }
    }
  };
}

async function runWithConcurrencyLimit(items, limit, worker) {
  const values = Array.from(items || []);
  const concurrency = Math.max(1, Math.min(Number.isInteger(limit) ? limit : 1, values.length || 1));
  let nextIndex = 0;
  const results = new Array(values.length);

  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(values[currentIndex], currentIndex);
    }
  }));

  return results;
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
  const batch = createBoundedFirestoreBatchWriter();
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
  const batch = createBoundedFirestoreBatchWriter();
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
    .get();
  return !(recipientSnap.docs || []).some((docSnap) => isAggregateNotificationRecipientDoc(docSnap));
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
  if (!hasEnabledNotificationCategory(preferences)) {
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
    await runWithConcurrencyLimit(
      teamIds,
      NOTIFICATION_RECIPIENT_DEVICE_SYNC_CONCURRENCY,
      (teamId) => syncNotificationRecipientForTeamUser(teamId, context.params.uid, { userData: user })
    );
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

function buildAccessNotificationDestination({ teamId }) {
  const encodedTeamId = encodeURIComponent(teamId);
  const query = teamId ? `?teamId=${encodedTeamId}` : '';
  return {
    appRoute: `/parent-tools/access${query}`,
    link: `https://allplays.ai/app/#/parent-tools/access${query}`
  };
}

function buildStaffAccessRequestNotificationDestination({ teamId }) {
  const encodedTeamId = encodeURIComponent(teamId);
  return {
    appRoute: `/parent-tools/access?teamId=${encodedTeamId}`,
    link: `https://allplays.ai/edit-roster.html?teamId=${encodedTeamId}`
  };
}

function buildRegistrationReviewNotificationDestination({ teamId, formId }) {
  const encodedTeamId = encodeURIComponent(teamId);
  const encodedFormId = encodeURIComponent(formId);
  return {
    appRoute: `/teams/${encodedTeamId}/registrations/${encodedFormId}`,
    link: `https://allplays.ai/edit-roster.html?teamId=${encodedTeamId}`
  };
}

function buildParentRegistrationNotificationDestination({ teamId, formId, registrationId = null }) {
  const encodedTeamId = encodeURIComponent(teamId);
  const encodedFormId = encodeURIComponent(formId);
  const params = new URLSearchParams();
  if (registrationId) {
    params.set('registrationId', registrationId);
  }
  const query = params.toString();
  const appRoute = `/parent-tools/registrations/${encodedTeamId}/${encodedFormId}${query ? `?${query}` : ''}`;
  return {
    appRoute,
    link: `https://allplays.ai/app/#${appRoute}`
  };
}

function buildTeamNotificationDestination({ teamId }) {
  const encodedTeamId = encodeURIComponent(teamId);
  return {
    appRoute: `/teams/${encodedTeamId}`,
    link: `https://allplays.ai/app/#/teams/${encodedTeamId}`
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
    timeZone: 'UTC',
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

function collectPracticePacketAssignedPlayerIds(packet = {}, session = {}) {
  const playerIds = new Set();
  const collectValue = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(collectValue);
      return;
    }
    if (typeof value === 'object') {
      collectValue(value.playerId || value.childId || value.id);
      return;
    }
    const normalized = String(value || '').trim();
    if (normalized) {
      playerIds.add(normalized);
    }
  };

  [
    packet.playerIds,
    packet.assignedPlayerIds,
    packet.targetPlayerIds,
    packet.childIds,
    packet.players,
    packet.assignedPlayers,
    session.playerIds,
    session.assignedPlayerIds,
    session.targetPlayerIds
  ].forEach(collectValue);

  return Array.from(playerIds);
}

async function resolvePracticePacketAssignedParentUserIds(teamId, packet = {}, session = {}) {
  const directParentUserIds = [
    packet.parentUserIds,
    packet.recipientUserIds,
    packet.assignedParentUserIds
  ].flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => String(value || '').trim())
    .filter(Boolean);
  const assignedPlayerIds = collectPracticePacketAssignedPlayerIds(packet, session);

  if (!directParentUserIds.length && !assignedPlayerIds.length) {
    return null;
  }

  const userIds = new Set(directParentUserIds);
  const parentLookups = await Promise.allSettled(
    assignedPlayerIds.map((playerId) => firestore.collection('users')
      .where('parentPlayerKeys', 'array-contains', `${teamId}::${playerId}`)
      .get())
  );
  parentLookups.forEach((result) => {
    if (result.status !== 'fulfilled') return;
    (result.value.docs || []).forEach((docSnap) => {
      const uid = String(docSnap.id || '').trim();
      if (uid) userIds.add(uid);
    });
  });

  return Array.from(userIds);
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
  const [allPracticeTargets, candidateUsers, assignedParentUserIds] = await Promise.all([
    getTargetsForCategory(teamId, 'practice', null),
    getCandidateUsersForTeam(teamId),
    resolvePracticePacketAssignedParentUserIds(teamId, afterPacket, afterData)
  ]);
  const parentUserIds = new Set(
    candidateUsers
      .filter((user) => Array.isArray(user?.roles) && user.roles.includes('parent'))
      .map((user) => user.uid)
  );
  const assignedParentUserIdSet = Array.isArray(assignedParentUserIds) ? new Set(assignedParentUserIds) : null;
  const parentTargets = allPracticeTargets.filter((target) => (
    parentUserIds.has(target.uid)
    && (!assignedParentUserIdSet || assignedParentUserIdSet.has(target.uid))
  ));

  if (!parentTargets.length) {
    functions.logger.warn('notifyPracticePacketAssigned found no practice-enabled parent targets.', {
      teamId,
      sessionId,
      totalPracticeTargets: allPracticeTargets.length,
      parentUserCount: parentUserIds.size,
      assignedParentUserCount: assignedParentUserIdSet ? assignedParentUserIdSet.size : null
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

function buildScheduleSectionQuery(section, childId = null) {
  const params = new URLSearchParams();
  if (childId) {
    params.set('childId', childId);
  }
  if (section) {
    params.set('section', section);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

function buildNotificationLink({ category, teamId, gameId, eventId = null, batchId = null, recipientId = null, conversationId = null, childId = null }) {
  if (category === 'officiating') {
    return teamId
      ? `https://allplays.ai/officials.html?teamId=${encodeURIComponent(teamId)}`
      : 'https://allplays.ai/officials.html';
  }
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
  if (category === 'rsvp') {
    if (teamId && gameId) {
      return `https://allplays.ai/app/#/schedule/${encodeURIComponent(teamId)}/${encodeURIComponent(gameId)}${buildScheduleSectionQuery('availability', childId)}`;
    }
    if (teamId) {
      return `https://allplays.ai/app/#/schedule?teamId=${encodeURIComponent(teamId)}`;
    }
    return 'https://allplays.ai/app/#/schedule';
  }
  if (category === 'rideshare') {
    const scheduleEventId = eventId || gameId;
    if (teamId && scheduleEventId) {
      return `https://allplays.ai/app/#/schedule/${encodeURIComponent(teamId)}/${encodeURIComponent(scheduleEventId)}${buildScheduleSectionQuery('rideshare', childId)}`;
    }
    if (teamId) {
      return `https://allplays.ai/app/#/schedule?teamId=${encodeURIComponent(teamId)}&section=rideshare`;
    }
    return 'https://allplays.ai/app/#/schedule?section=rideshare';
  }
  if (category === 'media') {
    if (teamId) {
      return `https://allplays.ai/app/#/teams/${encodeURIComponent(teamId)}/media`;
    }
    return 'https://allplays.ai/app/#/teams';
  }
  if (category === 'access') {
    return buildAccessNotificationDestination({ teamId }).link;
  }
  return `https://allplays.ai/team.html?teamId=${encodeURIComponent(teamId)}`;
}

function buildNotificationAppRoute({ category, teamId, gameId, eventId, batchId = null, recipientId = null, conversationId = null, childId = null }) {
  if (category === 'officiating') {
    return teamId ? `/officials?teamId=${encodeURIComponent(teamId)}` : '/officials';
  }
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
  if (category === 'mentions' && teamId) {
    const route = `/messages/${encodeURIComponent(teamId)}`;
    if (!conversationId) {
      return route;
    }
    return `${route}?conversation=${encodeURIComponent(conversationId)}`;
  }
  if (category === 'liveChat' && teamId) {
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
  if (category === 'rsvp') {
    const scheduleEventId = eventId || gameId;
    if (teamId && scheduleEventId) {
      return `/schedule/${encodeURIComponent(teamId)}/${encodeURIComponent(scheduleEventId)}${buildScheduleSectionQuery('availability', childId)}`;
    }
    if (teamId) {
      return `/schedule?teamId=${encodeURIComponent(teamId)}`;
    }
    return '/schedule';
  }
  if (category === 'rideshare') {
    const scheduleEventId = eventId || gameId;
    if (teamId && scheduleEventId) {
      return `/schedule/${encodeURIComponent(teamId)}/${encodeURIComponent(scheduleEventId)}${buildScheduleSectionQuery('rideshare', childId)}`;
    }
    if (teamId) {
      return `/schedule?teamId=${encodeURIComponent(teamId)}&section=rideshare`;
    }
    return '/schedule?section=rideshare';
  }
  if (category === 'media') {
    if (teamId) {
      return `/teams/${encodeURIComponent(teamId)}/media`;
    }
    return '/teams';
  }
  if (category === 'access') {
    return buildAccessNotificationDestination({ teamId }).appRoute;
  }
  if (category === 'practice') {
    return buildPracticePacketNotificationDestination({ teamId, eventId }).appRoute;
  }
  return '/home';
}

function normalizeAccessNotificationStatus(status) {
  const normalized = String(status || '').trim().toLowerCase().replace(/[ _]+/g, '-');
  if (['approved', 'accepted', 'enrolled', 'roster-approved'].includes(normalized)) return 'approved';
  if (['rejected', 'denied', 'declined'].includes(normalized)) return 'denied';
  if (['submitted', 'new', 'in-review'].includes(normalized)) return 'pending';
  if (['waitlisted', 'offer-extended', 'offer-accepted', 'released', 'pending'].includes(normalized)) return normalized;
  return normalized || 'pending';
}

function getRegistrationParticipantName(registration = {}) {
  const participant = registration.participant && typeof registration.participant === 'object' ? registration.participant : {};
  return [
    participant.name,
    participant.fullName,
    participant.playerName,
    participant.athleteName,
    registration.participantName,
    registration.playerName,
    registration.recipientName
  ].map((value) => String(value || '').trim()).find(Boolean) || 'A player';
}

function getRegistrationProgramName(registration = {}) {
  return [registration.programName, registration.formName, registration.title]
    .map((value) => String(value || '').trim())
    .find(Boolean) || 'Registration';
}

function getRegistrationGuardianEmails(registration = {}) {
  const emailSet = new Set();
  const addEmail = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized) {
      emailSet.add(normalized);
    }
  };
  const addGuardian = (guardian = {}) => {
    addEmail(guardian.email);
    addEmail(guardian.parentEmail);
    addEmail(guardian.guardianEmail);
  };

  addGuardian(registration.guardian || {});
  (Array.isArray(registration.guardians) ? registration.guardians : []).forEach(addGuardian);
  (Array.isArray(registration.guardianLinks) ? registration.guardianLinks : []).forEach(addGuardian);

  return Array.from(emailSet);
}

async function resolveRegistrationNotificationUserIds(registration = {}) {
  const userIds = new Set(
    (Array.isArray(registration.guardianLinks) ? registration.guardianLinks : [])
      .map((guardian) => String(guardian?.userId || '').trim())
      .filter(Boolean)
  );

  const emailUserIds = await getUserIdsByEmails(getRegistrationGuardianEmails(registration));
  emailUserIds.forEach((uid) => userIds.add(uid));
  return Array.from(userIds);
}

async function getStaffTargetsForAccess(teamId, actorUid = null) {
  const [allAccessTargets, candidateUsers] = await Promise.all([
    getTargetsForCategory(teamId, 'access', actorUid),
    getCandidateUsersForTeam(teamId)
  ]);
  const staffUserIds = new Set(
    candidateUsers
      .filter((user) => Array.isArray(user?.roles) && user.roles.includes('staff'))
      .map((user) => user.uid)
  );
  return allAccessTargets.filter((target) => staffUserIds.has(target.uid));
}

async function sendRegistrationStatusNotification({ teamId, formId, registrationId, registration, title, body }) {
  const guardianUserIds = await resolveRegistrationNotificationUserIds(registration);
  if (!guardianUserIds.length) return null;

  const guardianTargets = await getTargetsForCategoryUserIds(teamId, 'access', guardianUserIds);
  if (!guardianTargets.length) return null;

  const destination = buildParentRegistrationNotificationDestination({ teamId, formId, registrationId });
  return sendDirectTargetsNotification({
    targets: guardianTargets,
    category: 'access',
    title,
    body,
    teamId,
    eventId: registrationId,
    linkOverride: destination.link,
    appRouteOverride: destination.appRoute
  });
}

function normalizeTeamMediaNotificationText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeTeamMediaNotificationVisibility(value) {
  return normalizeNotificationAlbumVisibility(value);
}

function buildTeamMediaNotificationAudienceContext(folder = {}) {
  const albumVisibility = normalizeTeamMediaNotificationVisibility(folder.visibility);
  const allowedUserIds = normalizeNotificationAudienceUserIds(
    folder.allowedUserIds || folder.audienceUserIds || folder.visibleToUserIds || folder.userIds
  );
  const allowedRoles = normalizeNotificationAudienceRoles(
    folder.allowedRoles || folder.audienceRoles || folder.visibleToRoles || folder.roles
  );
  return {
    albumVisibility,
    ...(allowedUserIds.length ? { allowedUserIds } : {}),
    ...(allowedRoles.length ? { allowedRoles } : {})
  };
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

  const audienceContext = buildTeamMediaNotificationAudienceContext(folder);
  const albumVisibility = audienceContext.albumVisibility;

  const createdAt = coerceDate(item.createdAt) || (now instanceof Date ? now : new Date(now));
  const windowStartAt = getTeamMediaNotificationWindowStart(createdAt);
  const dueAt = new Date(windowStartAt.getTime() + TEAM_MEDIA_NOTIFICATION_BATCH_WINDOW_MS);
  return {
    batchId: buildTeamMediaNotificationBatchId(normalizedTeamId, folderId, windowStartAt),
    teamId: normalizedTeamId,
    folderId,
    albumName: normalizeTeamMediaNotificationText(folder.name) || 'Team media',
    albumVisibility,
    audienceContext,
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
    audienceContext: metadata.audienceContext || { albumVisibility: metadata.albumVisibility },
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
      const audienceContext = buildTeamMediaNotificationAudienceContext({
        ...folder,
        visibility: folder.visibility || batch.albumVisibility || batch.audienceContext?.albumVisibility
      });
      const albumVisibility = audienceContext.albumVisibility;

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
        audienceContext
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

function normalizeNotificationAudienceList(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value instanceof Set) {
    return Array.from(value);
  }
  if (typeof value === 'string') {
    return value.split(',');
  }
  return [];
}

function normalizeNotificationAudienceUserIds(value) {
  return Array.from(new Set(
    normalizeNotificationAudienceList(value)
      .map((entry) => String(entry || '').trim())
      .filter(Boolean)
  ));
}

function normalizeNotificationAudienceRoles(value) {
  return Array.from(new Set(
    normalizeNotificationAudienceList(value)
      .map((entry) => String(entry || '').trim().toLowerCase().replace(/[\s_]+/g, '-'))
      .map((role) => (['admin', 'coach', 'manager', 'owner'].includes(role) ? 'staff' : role))
      .filter((role) => ['parent', 'staff'].includes(role))
  ));
}

function mediaAudienceAllowsUser(user, audienceContext = {}) {
  const allowedUserIds = normalizeNotificationAudienceUserIds(audienceContext.allowedUserIds);
  const allowedRoles = normalizeNotificationAudienceRoles(audienceContext.allowedRoles);
  if (!allowedUserIds.length && !allowedRoles.length) return true;

  const uid = String(user?.uid || '').trim();
  const roles = normalizeNotificationAudienceRoles(user?.roles || []);
  if (allowedUserIds.includes(uid)) return true;
  return roles.some((role) => allowedRoles.includes(role));
}

function hasMediaAudienceConstraints(audienceContext = {}) {
  return normalizeNotificationAudienceUserIds(audienceContext.allowedUserIds).length > 0
    || normalizeNotificationAudienceRoles(audienceContext.allowedRoles).length > 0;
}

function canReceiveCategoryNotification(category, user, audienceContext = {}) {
  if (!user?.uid || !notificationAudienceAllowsRoles(category, user.roles)) return false;
  if (category !== 'media') return true;
  const albumVisibility = audienceContext?.staffOnly === true
    ? 'private'
    : normalizeNotificationAlbumVisibility(audienceContext.albumVisibility);
  if (albumVisibility === 'private') {
    const isStaffUser = Array.isArray(user.roles) && user.roles.includes('staff');
    if (!isStaffUser) return false;
    if (hasMediaAudienceConstraints(audienceContext)) {
      return mediaAudienceAllowsUser(user, audienceContext);
    }
    return true;
  }
  return mediaAudienceAllowsUser(user, audienceContext);
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
      const targets = devicesSnap.docs
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
      return targets.length ? targets : [{ uid, teamId }];
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

function mergeNotificationResolutionUser(usersByUid, user) {
  const uid = String(user?.uid || '').trim();
  if (!uid) return;
  const entry = usersByUid.get(uid) || { uid, roles: new Set() };
  (Array.isArray(user?.roles) ? user.roles : []).forEach((role) => {
    const normalizedRole = String(role || '').trim();
    if (normalizedRole) {
      entry.roles.add(normalizedRole);
    }
  });
  usersByUid.set(uid, entry);
}

function getNotificationRecipientDocUid(docSnap) {
  const data = docSnap?.data?.() || {};
  return String(data.uid || docSnap?.id || '').trim();
}

function getNotificationRecipientUserFromDoc(docSnap) {
  const data = docSnap?.data?.() || {};
  const uid = getNotificationRecipientDocUid(docSnap);
  if (!uid) return null;
  return {
    uid,
    roles: Array.isArray(data.roles)
      ? data.roles.map((role) => String(role || '').trim()).filter(Boolean)
      : []
  };
}

function isAggregateNotificationRecipientDoc(docSnap) {
  const data = docSnap?.data?.() || {};
  return Array.isArray(data.roles) || Array.isArray(data.tokens);
}

function isLegacyTargetNotificationRecipientDoc(docSnap) {
  const data = docSnap?.data?.() || {};
  return !isAggregateNotificationRecipientDoc(docSnap)
    && !String(data.teamId || '').trim()
    && String(data.uid || '').trim()
    && String(data.deviceId || '').trim()
    && String(data.token || '').trim();
}

function buildIndexedEligibleUsers(recipientDocs, category, audienceContext = {}, additionalUsers = []) {
  const usersByUid = new Map();
  (recipientDocs || []).forEach((docSnap) => {
    mergeNotificationResolutionUser(usersByUid, getNotificationRecipientUserFromDoc(docSnap));
  });
  (Array.isArray(additionalUsers) ? additionalUsers : []).forEach((user) => {
    mergeNotificationResolutionUser(usersByUid, user);
  });

  return new Map(Array.from(usersByUid.values())
    .map((entry) => ({ uid: entry.uid, roles: Array.from(entry.roles) }))
    .filter((user) => canReceiveCategoryNotification(category, user, audienceContext))
    .map((user) => [user.uid, user]));
}

function appendTokenlessNotificationTargets(targets, eligibleUsers, teamId, actorUid = null) {
  const resolvedTargets = Array.isArray(targets) ? targets : [];
  const targetedUserIds = new Set(resolvedTargets.map((target) => String(target?.uid || '').trim()).filter(Boolean));
  const tokenlessTargets = Array.from(eligibleUsers?.keys?.() || [])
    .filter((uid) => uid && uid !== actorUid && !targetedUserIds.has(uid))
    .map((uid) => ({ uid, teamId }));
  return [...resolvedTargets, ...tokenlessTargets];
}

async function resolveMixedNotificationRecipientIndex({
  teamId,
  category,
  actorUid = null,
  audienceContext = {},
  recipientDocs = [],
  additionalUsers = []
}) {
  const candidateUsers = await getCandidateUsersForTeam(teamId);
  const eligibleUsers = buildIndexedEligibleUsers(
    recipientDocs,
    category,
    audienceContext,
    [...candidateUsers, ...(Array.isArray(additionalUsers) ? additionalUsers : [])]
  );
  const knownUserIds = new Set((recipientDocs || [])
    .map((docSnap) => getNotificationRecipientDocUid(docSnap))
    .filter(Boolean));
  const coverageUserIds = Array.from(eligibleUsers.keys())
    .filter((uid) => uid && uid !== actorUid && !knownUserIds.has(uid));
  const existingUserIds = new Set(knownUserIds);
  const batchSize = 250;
  for (let index = 0; index < coverageUserIds.length; index += batchSize) {
    const userIdChunk = coverageUserIds.slice(index, index + batchSize);
    const recipientRefs = userIdChunk
      .map((uid) => buildTeamNotificationRecipientRef(teamId, uid))
      .filter(Boolean);
    const recipientSnaps = recipientRefs.length ? await firestore.getAll(...recipientRefs) : [];
    recipientSnaps.forEach((docSnap, snapIndex) => {
      if (docSnap.exists) existingUserIds.add(userIdChunk[snapIndex]);
    });
  }

  const missingUsers = Array.from(eligibleUsers.values()).filter((user) => (
    user?.uid
    && user.uid !== actorUid
    && !existingUserIds.has(user.uid)
  ));
  const fallbackTargets = missingUsers.length
    ? await getLegacyTargetsForCategory(teamId, category, missingUsers, actorUid, audienceContext)
    : [];

  if (missingUsers.length && typeof backfillNotificationRecipientsForTeam === 'function') {
    try {
      await backfillNotificationRecipientsForTeam(teamId, missingUsers, { skipLegacyCleanup: true });
    } catch (error) {
      const logger = typeof functions !== 'undefined' ? functions.logger : null;
      logger?.warn?.('Failed to backfill missing notification recipient index entries', {
        teamId,
        category,
        missingUserCount: missingUsers.length,
        error: error?.message || String(error || 'Unknown error')
      });
    }
  }

  return { eligibleUsers, fallbackTargets };
}

function dedupeNotificationTargets(targets) {
  const seenTargetIds = new Set();
  return (Array.isArray(targets) ? targets : []).filter((target) => {
    const uid = String(target?.uid || '').trim();
    if (!uid) return false;
    const key = `${uid}:${target?.deviceId || ''}:${target?.token || ''}`;
    if (seenTargetIds.has(key)) return false;
    seenTargetIds.add(key);
    return true;
  });
}

async function getTargetsForCategory(teamId, category, actorUid = null, audienceContext = {}, additionalUsers = []) {
  if (!NOTIFICATION_CATEGORIES.includes(category)) return [];

  const targetSnap = await firestore.collection(`teams/${teamId}/notificationRecipients`)
    .where(`categories.${category}`, '==', true)
    .get();
  const categoryRecipientDocs = targetSnap.docs || [];
  const indexedRecipientDocs = categoryRecipientDocs.filter(isAggregateNotificationRecipientDoc);
  if (indexedRecipientDocs.length) {
    const { eligibleUsers, fallbackTargets } = await resolveMixedNotificationRecipientIndex({
      teamId,
      category,
      actorUid,
      audienceContext,
      recipientDocs: categoryRecipientDocs,
      additionalUsers
    });
    const explicitlyEligibleLegacyRecipientDocs = categoryRecipientDocs.filter((docSnap) => (
      isLegacyTargetNotificationRecipientDoc(docSnap)
      && eligibleUsers.has(getNotificationRecipientDocUid(docSnap))
    ));
    const targets = [...indexedRecipientDocs, ...explicitlyEligibleLegacyRecipientDocs]
      .flatMap((docSnap) => buildTargetsFromNotificationRecipientDoc(docSnap, { teamId, category, actorUid, eligibleUsers }))
      .filter(Boolean);
    const indexedEligibleUsers = new Map(indexedRecipientDocs
      .map((docSnap) => getNotificationRecipientDocUid(docSnap))
      .filter((uid) => eligibleUsers.has(uid))
      .map((uid) => [uid, eligibleUsers.get(uid)]));
    return dedupeNotificationTargets([
      ...appendTokenlessNotificationTargets(targets, indexedEligibleUsers, teamId, actorUid),
      ...fallbackTargets
    ]);
  }

  const legacyTargetRecipientDocs = categoryRecipientDocs.filter(isLegacyTargetNotificationRecipientDoc);
  if (legacyTargetRecipientDocs.length) {
    const { eligibleUsers, fallbackTargets } = await resolveMixedNotificationRecipientIndex({
      teamId,
      category,
      actorUid,
      audienceContext,
      recipientDocs: categoryRecipientDocs,
      additionalUsers
    });
    const legacyTargets = legacyTargetRecipientDocs
      .filter((docSnap) => eligibleUsers.has(getNotificationRecipientDocUid(docSnap)))
      .flatMap((docSnap) => buildTargetsFromNotificationRecipientDoc(docSnap, { teamId, category, actorUid, eligibleUsers }))
      .filter(Boolean);
    return dedupeNotificationTargets([...legacyTargets, ...fallbackTargets]);
  }

  const indexIsEmpty = typeof teamNotificationRecipientIndexIsEmpty === 'function'
    ? await teamNotificationRecipientIndexIsEmpty(teamId)
    : true;
  if (!indexIsEmpty) {
    const { eligibleUsers, fallbackTargets } = await resolveMixedNotificationRecipientIndex({
      teamId,
      category,
      actorUid,
      audienceContext,
      recipientDocs: categoryRecipientDocs,
      additionalUsers
    });
    const explicitlyEligibleLegacyRecipientDocs = categoryRecipientDocs.filter((docSnap) => (
      !isAggregateNotificationRecipientDoc(docSnap)
      && eligibleUsers.has(getNotificationRecipientDocUid(docSnap))
    ));
    const legacyTargets = explicitlyEligibleLegacyRecipientDocs
      .flatMap((docSnap) => buildTargetsFromNotificationRecipientDoc(docSnap, { teamId, category, actorUid, eligibleUsers }))
      .filter(Boolean);
    return dedupeNotificationTargets([...legacyTargets, ...fallbackTargets]);
  }

  const candidateUsers = await getCandidateUsersForTeam(teamId);
  const mergedUsers = new Map();
  candidateUsers.forEach((user) => mergeNotificationResolutionUser(mergedUsers, user));
  (Array.isArray(additionalUsers) ? additionalUsers : []).forEach((user) => mergeNotificationResolutionUser(mergedUsers, user));

  const users = Array.from(mergedUsers.values()).map((entry) => ({
    uid: entry.uid,
    roles: Array.from(entry.roles)
  }));

  if (typeof backfillNotificationRecipientsForTeam === 'function') {
    try {
      await backfillNotificationRecipientsForTeam(teamId, users, { skipLegacyCleanup: true });
    } catch (error) {
      const logger = typeof functions !== 'undefined' ? functions.logger : null;
      logger?.warn?.('Failed to backfill notification recipient index after empty lookup', {
        teamId,
        category,
        error: error?.message || String(error || 'Unknown error')
      });
    }
  }

  const fallbackTargets = await getLegacyTargetsForCategory(teamId, category, users, actorUid, audienceContext);
  return fallbackTargets;
}

async function getTargetsForCategoryUserIds(teamId, category, userIds = [], actorUid = null, audienceContext = {}) {
  if (!NOTIFICATION_CATEGORIES.includes(category)) return [];
  const recipientUserIds = new Set(
    (Array.isArray(userIds) ? userIds : [])
      .map((uid) => String(uid || '').trim())
      .filter(Boolean)
  );
  if (!recipientUserIds.size) return [];

  const users = Array.from(recipientUserIds).map((uid) => ({ uid, roles: ['parent'] }));
  const eligibleUsers = new Map(users
    .filter((user) => user.uid !== actorUid && canReceiveCategoryNotification(category, user, audienceContext))
    .map((user) => [user.uid, user]));
  if (!eligibleUsers.size) return [];

  const recipientRefs = Array.from(eligibleUsers.keys())
    .map((uid) => buildTeamNotificationRecipientRef(teamId, uid))
    .filter(Boolean);
  const recipientSnaps = recipientRefs.length ? await firestore.getAll(...recipientRefs) : [];
  const indexedTargets = recipientSnaps
    .filter((docSnap) => docSnap.exists)
    .flatMap((docSnap) => buildTargetsFromNotificationRecipientDoc(docSnap, { teamId, category, actorUid, eligibleUsers }));
  const indexedUserIds = new Set(indexedTargets.map((target) => target.uid));
  const existingIndexedUserIds = new Set(recipientSnaps
    .filter((docSnap) => docSnap.exists)
    .map((docSnap) => getNotificationRecipientDocUid(docSnap))
    .filter(Boolean));
  const tokenlessIndexedTargets = recipientSnaps
    .filter((docSnap) => {
      if (!docSnap.exists) return false;
      const data = docSnap.data() || {};
      const uid = getNotificationRecipientDocUid(docSnap);
      return uid
        && uid !== actorUid
        && eligibleUsers.has(uid)
        && data.categories?.[category] === true
        && !indexedUserIds.has(uid);
    })
    .map((docSnap) => ({ uid: getNotificationRecipientDocUid(docSnap), teamId }));
  const missingUsers = users.filter((user) => (
    user?.uid
    && user.uid !== actorUid
    && !existingIndexedUserIds.has(user.uid)
    && eligibleUsers.has(user.uid)
  ));
  const fallbackTargets = missingUsers.length
    ? await getLegacyTargetsForCategory(teamId, category, missingUsers, actorUid, audienceContext)
    : [];
  const seenTargetIds = new Set();
  return [...indexedTargets, ...tokenlessIndexedTargets, ...fallbackTargets].filter((target) => {
    const uid = String(target?.uid || '').trim();
    if (!recipientUserIds.has(uid)) return false;
    const key = `${uid}:${target?.deviceId || ''}:${target?.token || ''}`;
    if (seenTargetIds.has(key)) return false;
    seenTargetIds.add(key);
    return true;
  });
}

async function getParentNotificationTargetsForTeam(teamId, category, userIds = [], actorUid = null) {
  const recipientUserIds = Array.from(new Set(
    (Array.isArray(userIds) ? userIds : [])
      .map((uid) => String(uid || '').trim())
      .filter(Boolean)
  ));
  if (!recipientUserIds.length) return [];
  const targets = await getTargetsForCategoryUserIds(teamId, category, recipientUserIds, actorUid);
  const allowedUserIds = new Set(recipientUserIds);
  return targets.filter((target) => allowedUserIds.has(String(target?.uid || '').trim()));
}

async function getTeamParentUserIds(teamId) {
  const parentSnap = await firestore.collection('users').where('parentTeamIds', 'array-contains', teamId).get();
  return Array.from(new Set(parentSnap.docs.map((docSnap) => String(docSnap.id || '').trim()).filter(Boolean)));
}

function getRideshareSeatsRemaining(offer = {}, claimedDelta = 0) {
  const seatCapacity = Math.max(0, Number.parseInt(String(offer?.seatCapacity ?? 0), 10) || 0);
  const seatCountConfirmed = Math.max(0, Number.parseInt(String(offer?.seatCountConfirmed ?? 0), 10) || 0);
  return Math.max(0, seatCapacity - seatCountConfirmed - Math.max(0, Number.parseInt(String(claimedDelta || 0), 10) || 0));
}

function normalizeRideOfferNotificationStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'cancelled' || normalized === 'canceled') return 'cancelled';
  if (normalized === 'closed') return 'closed';
  return 'open';
}

function normalizeRideRequestNotificationStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (['confirmed', 'waitlisted', 'declined', 'cancelled', 'canceled'].includes(normalized)) {
    return normalized === 'canceled' ? 'cancelled' : normalized;
  }
  return 'pending';
}

function normalizeRideshareTimestampKey(value) {
  if (!value) return '';
  if (typeof value.toMillis === 'function') return String(value.toMillis());
  if (value instanceof Date) return String(value.getTime());
  if (typeof value === 'object') {
    const seconds = Number(value.seconds ?? value._seconds);
    if (Number.isFinite(seconds)) {
      const nanos = Number(value.nanoseconds ?? value._nanoseconds ?? 0);
      return `${seconds}:${Number.isFinite(nanos) ? nanos : 0}`;
    }
  }
  return String(value);
}

function shouldNotifyRideClaimUpdate(before = {}, after = {}) {
  const beforeStatus = normalizeRideRequestNotificationStatus(before.status);
  const afterStatus = normalizeRideRequestNotificationStatus(after.status);
  if (afterStatus !== 'pending') return false;
  if (beforeStatus !== 'pending') return true;
  return Boolean(after.requestedAt) && normalizeRideshareTimestampKey(before.requestedAt) !== normalizeRideshareTimestampKey(after.requestedAt);
}

function formatRideshareSeatLabel(seatCount) {
  const safeSeatCount = Math.max(0, Number.parseInt(String(seatCount || 0), 10) || 0);
  return `${safeSeatCount} ${safeSeatCount === 1 ? 'seat' : 'seats'}`;
}

function abbreviateRideshareChildName(value) {
  const name = String(value || '').replace(/\s+/g, ' ').trim();
  if (!name) return 'A rider';
  const parts = name.split(' ').filter(Boolean);
  if (parts.length < 2) return parts[0];
  const [firstName, ...rest] = parts;
  const lastInitial = String(rest[rest.length - 1] || '').trim().charAt(0).toUpperCase();
  return lastInitial ? `${firstName} ${lastInitial}.` : firstName;
}

function getRideshareEventLabel(game = {}) {
  return getEventTitle(game) || 'this event';
}

function isRideshareTimeSensitive(game = {}, nowMillis = Date.now()) {
  const eventDate = coerceDate(game?.date);
  if (!eventDate) return false;
  const eventMillis = eventDate.getTime();
  return eventMillis >= nowMillis && (eventMillis - nowMillis) < (2 * 60 * 60 * 1000);
}

function buildRideOfferNotificationPayload(game = {}, offer = {}) {
  const eventLabel = getRideshareEventLabel(game);
  const seatCapacity = Math.max(0, Number.parseInt(String(offer?.seatCapacity ?? 0), 10) || 0);
  return {
    title: `Ride offered to ${eventLabel} — ${formatRideshareSeatLabel(seatCapacity)}`,
    body: 'Open rideshare to claim a seat.'
  };
}

function buildRideClaimNotificationPayload(game = {}, offer = {}, request = {}) {
  const claimantLabel = abbreviateRideshareChildName(request?.childName);
  const seatsLeft = getRideshareSeatsRemaining(offer, 1);
  return {
    title: `${claimantLabel} claimed a seat — ${formatRideshareSeatLabel(seatsLeft)} left`,
    body: `Ride claim for ${getRideshareEventLabel(game)}.`
  };
}

function buildRideOfferCancelledNotificationPayload(game = {}) {
  return {
    title: `Ride canceled for ${getRideshareEventLabel(game)}`,
    body: 'Your rideshare claim is no longer available.'
  };
}

async function sendRideClaimNotification(request = {}, context = {}) {
  if (!NOTIFICATION_CATEGORIES.includes('rideshare')) return null;

  const teamId = String(context.params?.teamId || '').trim();
  const gameId = String(context.params?.gameId || '').trim();
  const offerId = String(context.params?.offerId || '').trim();
  const actorUid = String(request.parentUserId || '').trim() || null;
  if (!teamId || !gameId || !offerId) return null;

  const [offerSnap, gameSnap] = await Promise.all([
    firestore.doc(`teams/${teamId}/games/${gameId}/rideOffers/${offerId}`).get(),
    firestore.doc(`teams/${teamId}/games/${gameId}`).get()
  ]);
  if (!offerSnap.exists) return null;

  const offer = offerSnap.data() || {};
  const driverUserId = String(offer.driverUserId || '').trim();
  if (!driverUserId || driverUserId === actorUid) return null;

  const targets = await getTargetsForCategoryUserIds(teamId, 'rideshare', [driverUserId], actorUid);
  if (!targets.length) return null;

  const game = gameSnap.exists ? (gameSnap.data() || {}) : {};
  const payload = buildRideClaimNotificationPayload(game, offer, request);
  return sendDirectTargetsNotification({
    targets,
    category: 'rideshare',
    title: payload.title,
    body: payload.body,
    teamId,
    gameId,
    eventId: gameId,
    timeSensitive: isRideshareTimeSensitive(game)
  });
}

function buildTargetsFromNotificationRecipientDoc(docSnap, { teamId, category, actorUid = null, eligibleUsers = new Map() } = {}) {
  const data = docSnap?.data?.() || {};
  const uid = String(data.uid || docSnap?.id || '').trim();
  if (!uid || uid === actorUid || !eligibleUsers.has(uid)) return [];
  if (data.categories && data.categories[category] !== true) return [];

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
}

async function pruneInvalidNotificationRecipientTokens(targets) {
  const targetsByRecipient = new Map();
  (Array.isArray(targets) ? targets : []).forEach((target) => {
    const teamId = String(target?.teamId || '').trim();
    const uid = String(target?.uid || '').trim();
    if (!teamId || !uid) return;
    const key = `${teamId}::${uid}`;
    const entry = targetsByRecipient.get(key) || {
      teamId,
      uid,
      invalidDeviceIds: new Set(),
      invalidTokens: new Set()
    };
    const deviceId = String(target?.deviceId || '').trim();
    const token = String(target?.token || '').trim();
    if (deviceId) entry.invalidDeviceIds.add(deviceId);
    if (token) entry.invalidTokens.add(token);
    targetsByRecipient.set(key, entry);
  });

  if (!targetsByRecipient.size) return;

  await Promise.allSettled(Array.from(targetsByRecipient.values()).map(async (entry) => {
    const recipientRef = buildTeamNotificationRecipientRef(entry.teamId, entry.uid);
    if (!recipientRef) return;

    const recipientSnap = await recipientRef.get();
    if (!recipientSnap.exists) return;

    const data = recipientSnap.data() || {};
    const tokens = Array.isArray(data.tokens) ? data.tokens : [];
    const nextTokens = tokens.filter((tokenEntry) => {
      const deviceId = String(tokenEntry?.deviceId || '').trim();
      const token = String(tokenEntry?.token || '').trim();
      return !(entry.invalidDeviceIds.has(deviceId) || entry.invalidTokens.has(token));
    });

    if (nextTokens.length === tokens.length) return;
    if (!nextTokens.length) {
      await recipientRef.delete();
      return;
    }

    await recipientRef.update({
      tokens: nextTokens,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  }));
}

async function pruneInvalidTokens(sendResult, targets) {
  if (!sendResult || !Array.isArray(sendResult.responses)) return;
  const removableCodes = new Set([
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered'
  ]);

  const removals = [];
  const invalidTargets = [];
  sendResult.responses.forEach((response, index) => {
    if (response.success) return;
    const code = response.error?.code;
    if (!removableCodes.has(code)) return;
    const target = targets[index];
    if (!target?.uid || !target?.deviceId) return;
    invalidTargets.push(target);
    removals.push(
      firestore.doc(`users/${target.uid}/notificationDevices/${target.deviceId}`).delete()
    );
    const targetRef = buildTeamNotificationTargetRef(target.teamId, target.uid, target.deviceId);
    if (targetRef) {
      removals.push(targetRef.delete());
    }
  });

  if (invalidTargets.length) {
    removals.push(pruneInvalidNotificationRecipientTokens(invalidTargets));
  }

  if (removals.length) {
    await Promise.allSettled(removals);
  }
}

async function sweepStaleNotificationDeviceTokens(nowMillis = Date.now()) {
  const cutoff = admin.firestore.Timestamp.fromMillis(getStaleNotificationTokenCutoffMillis(nowMillis));
  const pageSize = 400;
  let deletedCount = 0;
  let pageCount = 0;

  while (pageCount < 20) {
    pageCount += 1;
    const snapshot = await firestore.collectionGroup('notificationDevices')
      .where('updatedAt', '<', cutoff)
      .limit(pageSize)
      .get();
    if (snapshot.empty) break;

    const batch = firestore.batch();
    snapshot.docs.forEach((docSnap) => {
      batch.delete(docSnap.ref);
      deletedCount += 1;
    });
    await batch.commit();

    if (snapshot.docs.length < pageSize) break;
  }

  functions.logger.info('Swept stale notification device tokens.', {
    deletedCount,
    pageCount,
    cutoffMillis: cutoff.toMillis?.() || null
  });
  return { deletedCount, pageCount };
}

async function cleanupNotificationInbox(inboxRef) {
  const retainedItemsSnap = await inboxRef
    .orderBy('createdAt', 'desc')
    .limit(NOTIFICATION_INBOX_MAX_ITEMS + 1)
    .get();

  if (retainedItemsSnap.docs.length <= NOTIFICATION_INBOX_MAX_ITEMS) return 0;

  const oldestRetainedDoc = retainedItemsSnap.docs[NOTIFICATION_INBOX_MAX_ITEMS - 1];
  let overflowDocs = retainedItemsSnap.docs.slice(NOTIFICATION_INBOX_MAX_ITEMS);
  let cleanupCount = 0;

  while (overflowDocs.length) {
    const batch = firestore.batch();
    for (const doc of overflowDocs) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    cleanupCount += overflowDocs.length;

    const overflowSnap = await inboxRef
      .orderBy('createdAt', 'desc')
      .startAfter(oldestRetainedDoc)
      .limit(500)
      .get();
    overflowDocs = overflowSnap.docs;
  }

  return cleanupCount;
}

async function writeNotificationInboxRecords({
  targets,
  category,
  title,
  body,
  appRoute,
  teamId,
  gameId = null,
  eventId = null,
  conversationId = null
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
      conversationId,
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

function buildNotificationDedupIdentity(gameId, dedupKey = null) {
  const normalizedGameId = String(gameId || '').trim();
  const normalizedDedupKey = String(dedupKey || '').trim();
  if (normalizedGameId && normalizedDedupKey) {
    return `${normalizedGameId}::${normalizedDedupKey}`;
  }
  return normalizedDedupKey || normalizedGameId;
}

async function markNotificationDedupSent(teamId, category, gameId, dedupKey = null) {
  const dedupIdentity = buildNotificationDedupIdentity(gameId, dedupKey);
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
  const dedupIdentity = buildNotificationDedupIdentity(gameId, dedupKey);
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

async function checkAndSetNotificationDedupKeys(teamId, category, gameId, dedupKeys = []) {
  const normalizedDedupKeys = [...new Set((Array.isArray(dedupKeys) ? dedupKeys : [dedupKeys])
    .map((dedupKey) => String(dedupKey || '').trim())
    .filter(Boolean))];
  if (!normalizedDedupKeys.length) return false;

  const dedupEntries = normalizedDedupKeys.map((dedupKey) => ({
    dedupKey,
    ref: buildNotificationDedupRef(teamId, category, buildNotificationDedupIdentity(gameId, dedupKey))
  }));
  return firestore.runTransaction(async (txn) => {
    const snapshots = await Promise.all(dedupEntries.map(({ ref }) => txn.get(ref)));
    const hasFreshClaim = snapshots.some((snapshot) => {
      if (!snapshot.exists) return false;
      const sentAt = snapshot.data()?.sentAt?.toMillis?.() || 0;
      return Date.now() - sentAt < NOTIFICATION_DEDUP_WINDOW_MS;
    });
    if (hasFreshClaim) return false;

    dedupEntries.forEach(({ dedupKey, ref }) => {
      txn.set(ref, {
        teamId,
        category,
        gameId: gameId || null,
        dedupKey,
        sentAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });
    return true;
  });
}

async function hasRecentBigMomentLiveEventForScoreState(teamId, gameId, scoreStateDedupKey) {
  const normalizedTeamId = String(teamId || '').trim();
  const normalizedGameId = String(gameId || '').trim();
  const normalizedScoreStateDedupKey = String(scoreStateDedupKey || '').trim();
  if (!normalizedTeamId || !normalizedGameId || !normalizedScoreStateDedupKey) return false;

  const nowMillis = Date.now();
  try {
    const liveEventsSnap = await firestore.collection(`teams/${normalizedTeamId}/games/${normalizedGameId}/liveEvents`)
      .orderBy('createdAt', 'desc')
      .limit(25)
      .get();
    return liveEventsSnap.docs.some((docSnap) => {
      const event = docSnap.data() || {};
      if (!buildBigMomentLiveEventNotification(event)) return false;
      if (!isLiveEventNotificationFresh(event, nowMillis)) return false;
      return buildLiveScoreStateNotificationDedupKey(event) === normalizedScoreStateDedupKey;
    });
  } catch (error) {
    functions.logger.warn('Failed to check live events before live score notification', {
      teamId: normalizedTeamId,
      gameId: normalizedGameId,
      error: error?.message || String(error || 'Unknown error')
    });
    return false;
  }
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
  childId = null,
  category,
  title,
  body,
  actorUid = null,
  linkOverride = null,
  dedupKey = null,
  excludeUids = [],
  audienceContext = {},
  timeSensitive = false
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
  const inboxTargets = getUniqueNotificationInboxTargets(targets);
  const pushTargets = targets.filter((target) => String(target?.token || '').trim());
  if (!pushTargets.length && !inboxTargets.length) return null;

  const link = linkOverride || buildNotificationLink({ category, teamId, gameId, eventId: eventId || gameId, conversationId, childId });
  const appRoute = buildNotificationAppRoute({ category, teamId, gameId, eventId: eventId || gameId, conversationId, childId });
  const deliveryOptions = typeof buildNotificationDeliveryOptions === 'function'
    ? buildNotificationDeliveryOptions({ category, teamId, gameId, eventId: eventId || gameId, timeSensitive })
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

  for (let i = 0; i < pushTargets.length; i += maxMulticastTokens) {
    const targetChunk = pushTargets.slice(i, i + maxMulticastTokens);
    try {
      const sendResult = await admin.messaging().sendEachForMulticast({
        tokens: targetChunk.map((target) => target.token),
        notification: { title, body },
        data: {
          teamId: String(teamId),
          gameId: String(gameId || ''),
          eventId: String(eventId || gameId || ''),
          conversationId: String(conversationId || ''),
          childId: String(childId || ''),
          rsvpId: String(childId || ''),
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
    } catch (error) {
      failureCount += targetChunk.length;
      allResponses.push(...targetChunk.map((target) => ({
        success: false,
        error: new Error(`Push delivery failed for ${target.uid || 'unknown-user'}: ${error?.message || String(error || 'Unknown error')}`)
      })));
      functions.logger.warn('Failed to send push notification chunk', {
        teamId,
        category,
        targetCount: targetChunk.length,
        error: error?.message || String(error || 'Unknown error')
      });
    }
  }

  const inboxResult = await writeNotificationInboxRecords({
    targets: inboxTargets,
    category,
    title,
    body,
    appRoute,
    teamId,
    gameId,
    eventId: eventId || gameId,
    conversationId
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

function normalizeScheduleImportTeamName(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

async function resolveScheduleImportTeamName(teamId, batch = {}) {
  const batchTeamName = normalizeScheduleImportTeamName(
    batch.teamName
    || batch.team?.name
    || batch.teamDisplayName
  );
  if (batchTeamName) return batchTeamName;

  try {
    const teamSnap = await firestore.doc(`teams/${teamId}`).get();
    if (!teamSnap.exists) return '';
    const team = teamSnap.data() || {};
    return normalizeScheduleImportTeamName(team.name || team.teamName || team.displayName);
  } catch (error) {
    functions.logger.warn('Failed to resolve schedule import team name for notification summary', {
      teamId,
      batchId: batch.batchId || null,
      error: error?.message || String(error || 'Unknown error')
    });
    return '';
  }
}

function buildScheduleImportSummaryPayload({ totalCount, gameCount, practiceCount, teamName = '' }) {
  const safeTotalCount = Math.max(0, Number(totalCount || 0));
  const safeGameCount = Math.max(0, Number(gameCount || 0));
  const safePracticeCount = Math.max(0, Number(practiceCount || 0));
  const teamLabel = normalizeScheduleImportTeamName(teamName);
  const parts = [];
  if (safeGameCount > 0) parts.push(`${safeGameCount} game${safeGameCount === 1 ? '' : 's'}`);
  if (safePracticeCount > 0) parts.push(`${safePracticeCount} practice${safePracticeCount === 1 ? '' : 's'}`);
  const teamDetail = teamLabel ? ` for ${teamLabel}` : '';
  const detail = parts.length ? ` (${parts.join(', ')})` : '';
  return {
    title: 'Schedule import complete',
    body: `Imported ${safeTotalCount} schedule events${teamDetail}${detail}.`
  };
}

function buildCreatedScheduleEventNotificationPayload(game = {}) {
  const isPractice = String(game.type || '').toLowerCase() === 'practice';
  const isPracticeSeries = isPractice && (game.isSeriesMaster === true || Boolean(game.recurrence));
  const eventTitle = getEventTitle(game);
  const opponent = isPractice ? '' : String(game.opponent || '').trim();
  const dateValue = coerceDate(game.date);
  const timeZone = String(game.timeZone || game.timezone || '').trim() || 'America/Chicago';
  const dateLabel = dateValue ? formatScheduleUpdateDate(dateValue, timeZone) : '';
  const details = [];

  if (opponent) {
    details.push(`Opponent: ${opponent}`);
  }
  if (dateLabel) {
    details.push(`Starts ${dateLabel}`);
  }

  return {
    title: isPracticeSeries
      ? `New practice series: ${eventTitle}`
      : (isPractice ? `New practice: ${eventTitle}` : `New game: ${eventTitle}`),
    body: details.join('. ') || (isPractice ? 'Practice scheduled' : 'Game scheduled')
  };
}

async function sendCreatedScheduleEventNotification({ teamId, gameId, game }) {
  if (game.source || game.sourceMetadata) return null;

  const payload = buildCreatedScheduleEventNotificationPayload(game);

  return sendCategoryNotification({
    teamId,
    gameId,
    category: 'schedule',
    title: payload.title,
    body: payload.body,
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
    const teamName = await resolveScheduleImportTeamName(teamId, batch);
    const payload = buildScheduleImportSummaryPayload({ totalCount, gameCount, practiceCount, teamName });
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
    const currentTotalCount = Math.max(0, Number(current.totalCount || 0));
    const totalCount = current.importCompletedAt && currentTotalCount > 0
      ? currentTotalCount
      : Math.max(batch.totalCount, currentTotalCount);
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
  inboxUids = null,
  category,
  title,
  body,
  teamId,
  gameId = null,
  eventId = null,
  batchId = null,
  recipientId = null,
  conversationId = null,
  childId = null,
  linkOverride = null,
  appRouteOverride = null,
  timeSensitive = false
}) {
  const logicalTargets = Array.isArray(targets) ? targets : [];
  const pushTargets = logicalTargets.filter((target) => String(target?.token || '').trim());
  const inboxTargets = getUniqueNotificationInboxTargets(
    Array.isArray(inboxUids)
      ? inboxUids.map((uid) => ({ uid }))
      : logicalTargets
  );
  if (!pushTargets.length && !inboxTargets.length) return null;

  const link = linkOverride || buildNotificationLink({ category, teamId, gameId, eventId: eventId || gameId, batchId, recipientId, conversationId, childId });
  const appRoute = appRouteOverride || buildNotificationAppRoute({ category, teamId, gameId, eventId: eventId || gameId, batchId, recipientId, conversationId, childId });
  const deliveryOptions = typeof buildNotificationDeliveryOptions === 'function'
    ? buildNotificationDeliveryOptions({ category, teamId, gameId, eventId: eventId || gameId, timeSensitive })
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
  const inboxPromise = writeNotificationInboxRecords({
    targets: inboxTargets,
    category,
    title,
    body,
    appRoute,
    teamId,
    gameId,
    eventId: eventId || gameId,
    conversationId
  });

  try {
    for (let i = 0; i < pushTargets.length; i += maxMulticastTokens) {
      const targetChunk = pushTargets.slice(i, i + maxMulticastTokens);
      const sendResult = await admin.messaging().sendEachForMulticast({
        tokens: targetChunk.map((target) => target.token),
        notification: { title, body },
        data: {
          teamId: String(teamId),
          gameId: String(gameId || ''),
          eventId: String(eventId || gameId || ''),
          conversationId: String(conversationId || ''),
          childId: String(childId || ''),
          rsvpId: String(childId || ''),
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
  } catch (error) {
    await inboxPromise;
    throw error;
  }

  const inboxResult = await inboxPromise;

  await writeNotificationAuditRecord({
    teamId,
    category,
    title,
    body,
    link,
    appRoute,
    targets: inboxTargets,
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

function getOfficiatingPositionLabel(record = {}) {
  return String(record.position || record.assignmentType || 'Officiating assignment').trim() || 'Officiating assignment';
}

function getOfficiatingGameLabel(game = {}) {
  return getEventTitle(game || {}) || 'the event';
}

function getOfficiatingDateLabel(game = {}) {
  const date = coerceDate(game.date || game.startAt || game.startTime);
  if (!date) return '';
  const timeZone = String(game.timeZone || game.timezone || '').trim() || 'America/Chicago';
  return formatScheduleUpdateDate(date, timeZone);
}

function getOfficiatingNotificationCopy(record = {}) {
  const position = getOfficiatingPositionLabel(record);
  const game = record.gameReference || {};
  const gameLabel = getOfficiatingGameLabel(game);
  const dateLabel = getOfficiatingDateLabel(game);
  const suffix = dateLabel ? ` on ${dateLabel}` : '';
  const event = String(record.event || '').trim().toLowerCase();

  if (event === 'rescheduled') {
    return {
      title: `Officiating assignment updated: ${position}`,
      body: `${gameLabel}${suffix} was rescheduled.`
    };
  }
  if (event === 'cancelled' || event === 'canceled') {
    return {
      title: `Officiating assignment cancelled: ${position}`,
      body: `${gameLabel}${suffix} was cancelled.`
    };
  }
  if (event === 'declined') {
    return {
      title: `Officiating assignment declined: ${position}`,
      body: `${gameLabel}${suffix} needs coverage.`
    };
  }
  return {
    title: `Officiating assignment: ${position}`,
    body: `${gameLabel}${suffix} is ready for your response.`
  };
}

async function getOfficiatingAssignerRecipientUserIds(teamId) {
  const normalizedTeamId = String(teamId || '').trim();
  if (!normalizedTeamId) return [];

  const teamSnap = await firestore.doc(`teams/${normalizedTeamId}`).get();
  if (!teamSnap.exists) return [];

  const team = teamSnap.data() || {};
  const userIds = new Set([String(team.ownerId || '').trim()].filter(Boolean));
  const adminUserIds = await getUserIdsByEmails(team.adminEmails || []);
  adminUserIds.forEach((uid) => userIds.add(uid));
  return Array.from(userIds);
}

async function resolveOfficiatingRecordRecipientUserIds(teamId, record = {}) {
  if (String(record.recipientType || '').trim().toLowerCase() === 'assigner') {
    return getOfficiatingAssignerRecipientUserIds(teamId);
  }

  const userIds = new Set([
    record.recipientOfficialUserId,
    record.officialUserId,
    record.userId
  ].map((value) => String(value || '').trim()).filter(Boolean));

  const email = String(record.recipientOfficialEmail || record.officialEmail || '').trim().toLowerCase();
  if (email) {
    const emailUserIds = await getUserIdsByEmails([email]);
    emailUserIds.forEach((uid) => userIds.add(uid));
  }
  return Array.from(userIds);
}

function buildOfficiatingDestination(teamId) {
  return {
    link: buildNotificationLink({ category: 'officiating', teamId }),
    appRoute: buildNotificationAppRoute({ category: 'officiating', teamId })
  };
}

async function sendOfficiatingTargetsNotification({ teamId, gameId = null, targets, title, body }) {
  if (!targets.length) return null;
  const destination = buildOfficiatingDestination(teamId);
  return sendDirectTargetsNotification({
    targets,
    category: 'officiating',
    title,
    body,
    teamId,
    gameId,
    eventId: gameId,
    linkOverride: destination.link,
    appRouteOverride: destination.appRoute
  });
}

function normalizeOfficiatingSlotForNotification(slot = {}) {
  const id = String(slot?.id || slot?.slotId || slot?.position || '').trim();
  const status = String(slot?.status || '').trim().toLowerCase() || 'open';
  return {
    id,
    position: String(slot?.position || slot?.role || 'Official').trim() || 'Official',
    status,
    officialUserId: String(slot?.officialUserId || '').trim(),
    officialEmail: String(slot?.officialEmail || slot?.email || '').trim().toLowerCase(),
    officialName: String(slot?.officialName || slot?.name || '').trim()
  };
}

function isOpenOfficiatingSlotForNotification(slot = {}) {
  const normalized = normalizeOfficiatingSlotForNotification(slot);
  return normalized.status === 'open'
    && !normalized.officialUserId
    && !normalized.officialEmail
    && !normalized.officialName;
}

function getNewOpenOfficiatingSlots(beforeGame = {}, afterGame = {}) {
  if (afterGame.officiatingSelfAssignmentEnabled !== true) return [];
  const beforeOpenIds = beforeGame.officiatingSelfAssignmentEnabled === true
    ? new Set(
      (Array.isArray(beforeGame.officiatingSlots) ? beforeGame.officiatingSlots : [])
        .filter(isOpenOfficiatingSlotForNotification)
        .map((slot) => normalizeOfficiatingSlotForNotification(slot).id)
        .filter(Boolean)
    )
    : new Set();
  return (Array.isArray(afterGame.officiatingSlots) ? afterGame.officiatingSlots : [])
    .map(normalizeOfficiatingSlotForNotification)
    .filter((slot) => slot.id && isOpenOfficiatingSlotForNotification(slot) && !beforeOpenIds.has(slot.id));
}

exports._internal = {
  getTargetsForCategoryUserIds,
  buildTeamMediaNotificationBatchId,
  buildTeamMediaNotificationBatchMetadata,
  buildTeamMediaNotificationBatchWrite,
  buildTeamMediaNotificationPayload,
  dispatchDueTeamMediaNotificationBatches,
  getTargetsForCategory,
  sendCategoryNotification,
  sweepStaleNotificationDeviceTokens,
  sendRsvpReminderPushNotifications,
  sendPracticePacketDueTomorrowReminders,
  sendFeeUnpaidDueReminders,
  getFeeReminderDueDateMillis,
  isFeeDueReminderCandidateEligible,
  buildFeeReminderNotificationBody,
  resolveEligibleFeeReminderRecipient,
  FIRESTORE_BATCH_SAFE_WRITE_LIMIT,
  NOTIFICATION_RECIPIENT_DEVICE_SYNC_CONCURRENCY,
  createBoundedFirestoreBatchWriter,
  runWithConcurrencyLimit,
  syncNotificationRecipientForTeamUser,
  syncNotificationRecipientsForUserChange,
  syncNotificationRecipientsForTeamChange
};

exports.sweepStaleNotificationDeviceTokens = functions.pubsub
  .schedule('every 24 hours')
  .onRun(() => sweepStaleNotificationDeviceTokens());

exports.notifyOfficiatingNotificationCreated = functions.firestore
  .document('teams/{teamId}/officiatingNotifications/{notificationId}')
  .onCreate(async (snapshot, context) => {
    const record = snapshot.data() || {};
    if (record.type && record.type !== 'officiating_assignment') return null;

    const { teamId } = context.params;
    const recipientUserIds = await resolveOfficiatingRecordRecipientUserIds(teamId, record);
    if (!recipientUserIds.length) return null;

    const actorUid = String(record.actorUserId || record.actor?.userId || '').trim() || null;
    const targets = await getTargetsForCategoryUserIds(teamId, 'officiating', recipientUserIds, actorUid);
    if (!targets.length) return null;

    const copy = getOfficiatingNotificationCopy(record);
    return sendOfficiatingTargetsNotification({
      teamId,
      gameId: record.gameId || record.gameReference?.gameId || null,
      targets,
      title: copy.title,
      body: copy.body
    });
  });

exports.notifyOpenOfficiatingSlots = functions.firestore
  .document('teams/{teamId}/games/{gameId}')
  .onWrite(async (change, context) => {
    if (!change.after?.exists) return null;

    const beforeGame = change.before?.exists ? (change.before.data() || {}) : {};
    const afterGame = change.after.data() || {};
    const openSlots = getNewOpenOfficiatingSlots(beforeGame, afterGame);
    if (!openSlots.length) return null;

    const { teamId, gameId } = context.params;
    const actorUid = String(afterGame.updatedBy || afterGame.createdBy || '').trim() || null;
    const targets = await getTargetsForCategory(teamId, 'officiating', actorUid);
    if (!targets.length) return null;

    const gameLabel = getOfficiatingGameLabel(afterGame);
    const dateLabel = getOfficiatingDateLabel(afterGame);
    const position = openSlots.length === 1
      ? openSlots[0].position
      : `${openSlots.length} open assignments`;

    return sendOfficiatingTargetsNotification({
      teamId,
      gameId,
      targets,
      title: `Open assignment: ${position}`,
      body: `${gameLabel}${dateLabel ? ` on ${dateLabel}` : ''} needs an official. Claim it before someone else does.`
    });
  });

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
    'scheduleNotifications.rsvpEmailCount': Number(sendResult?.rsvpEmailCount || 0),
    'scheduleNotifications.rsvpPushSuccessCount': Number(sendResult?.rsvpPushSuccessCount || 0),
    'scheduleNotifications.rsvpPushFailureCount': Number(sendResult?.rsvpPushFailureCount || 0),
    'scheduleNotifications.rsvpPushTargetCount': Number(sendResult?.rsvpPushTargetCount || 0),
    'scheduleNotifications.rsvpPushError': sendResult?.rsvpPushError
      ? sendResult.rsvpPushError
      : admin.firestore.FieldValue.delete()
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
        let rsvpPushResult = { successCount: 0, failureCount: 0, targetCount: 0 };
        let rsvpPushError = null;
        try {
          rsvpPushResult = await sendRsvpReminderPushNotifications({
            teamId,
            gameId,
            event: claimedEvent,
            recipientTargets: emailResult.recipientTargets,
            recipientUserIds: emailResult.recipientUserIds
          });
        } catch (pushError) {
          rsvpPushError = pushError;
          console.error('Failed to send RSVP reminder push notifications', { teamId, gameId, error: pushError });
        }
        await markReminderSent(eventRef, claimId, {
          ...sendResult,
          chatMessageId: chatResult.messageId,
          chatMessageCreated: chatResult.created,
          chatMessageError: chatMessageError?.message || null,
          rsvpEmailCount: emailResult.sentCount,
          rsvpPushSuccessCount: rsvpPushResult.successCount,
          rsvpPushFailureCount: rsvpPushResult.failureCount,
          rsvpPushTargetCount: rsvpPushResult.targetCount,
          rsvpPushError: rsvpPushError?.message || null
        });
        return {
          teamId,
          gameId,
          sent: Number(sendResult?.successCount || 0),
          chatMessageId: chatResult.messageId,
          chatMessageCreated: chatResult.created,
          rsvpEmailCount: emailResult.sentCount,
          rsvpPushSuccessCount: rsvpPushResult.successCount,
          rsvpPushFailureCount: rsvpPushResult.failureCount,
          rsvpPushTargetCount: rsvpPushResult.targetCount,
          rsvpPushError: rsvpPushError?.message || null
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

function getPracticePacketReminderDueDate(packet = {}, session = {}) {
  return coercePracticePacketDate(
    packet.dueAt
    || packet.dueDate
    || packet.deadline
    || packet.deadlineAt
    || packet.completeBy
    || packet.completeByAt
    || session.date
  );
}

function isPracticePacketDueTomorrow(packet = {}, session = {}, now = new Date()) {
  const dueDate = getPracticePacketReminderDueDate(packet, session);
  if (!dueDate) return false;
  const { start, end } = getTomorrowDateRange(now);
  return dueDate >= start && dueDate < end;
}

const PRACTICE_PACKET_REMINDER_PAGE_SIZE = 100;
const PRACTICE_PACKET_REMINDER_MIGRATION_STATE_PATH = 'systemMigrations/practicePacketReminderDueAt';

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

  const { start, end } = getTomorrowDateRange(now);
  const practiceTargetsByTeam = new Map();
  const results = [];
  let indexedQueryFailed = false;

  async function processCandidateSessionDocs(candidateSessionDocs) {
    for (const docSnap of candidateSessionDocs) {
      const session = docSnap.data() || {};
      const packet = session.homePacketContent || null;
      if (!hasPracticePacketContent(packet)) continue;

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
  }

  let lastSessionDoc = null;
  do {
    let sessionSnap;
    try {
      let sessionQuery = firestore.collectionGroup('practiceSessions')
        .where('homePacketGenerated', '==', true)
        .where('homePacketReminderDueAt', '>=', admin.firestore.Timestamp.fromDate(start))
        .where('homePacketReminderDueAt', '<', admin.firestore.Timestamp.fromDate(end))
        .orderBy('homePacketReminderDueAt')
        .limit(PRACTICE_PACKET_REMINDER_PAGE_SIZE);
      if (lastSessionDoc) {
        sessionQuery = sessionQuery.startAfter(lastSessionDoc);
      }
      sessionSnap = await sessionQuery.get();
    } catch (error) {
      indexedQueryFailed = true;
      functions.logger.error('Practice packet reminder indexed query unavailable; using migration compatibility scan.', {
        error: error?.message || error
      });
      break;
    }

    await processCandidateSessionDocs(sessionSnap.docs);
    lastSessionDoc = sessionSnap.docs.length === PRACTICE_PACKET_REMINDER_PAGE_SIZE
      ? sessionSnap.docs[sessionSnap.docs.length - 1]
      : null;
  } while (lastSessionDoc);

  const migrationStateSnap = await firestore.doc(PRACTICE_PACKET_REMINDER_MIGRATION_STATE_PATH).get();
  const migrationComplete = migrationStateSnap.exists && migrationStateSnap.data()?.completed === true;
  if (!migrationComplete || indexedQueryFailed) {
    // Compatibility path for packets created before homePacketReminderDueAt was materialized.
    // Keep every read bounded until the restart-safe migration records completion.
    let lastLegacySessionDoc = null;
    do {
      let legacySessionQuery = firestore.collectionGroup('practiceSessions')
        .where('homePacketGenerated', '==', true)
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(PRACTICE_PACKET_REMINDER_PAGE_SIZE);
      if (lastLegacySessionDoc) {
        legacySessionQuery = legacySessionQuery.startAfter(lastLegacySessionDoc);
      }
      const legacySessionSnap = await legacySessionQuery.get();

      const eligibleLegacySessionDocs = [];
      for (const docSnap of legacySessionSnap.docs) {
        const session = docSnap.data() || {};
        if (!indexedQueryFailed && session.homePacketReminderDueAt) continue;
        const packet = session.homePacketContent || null;
        if (!hasPracticePacketContent(packet) || !isPracticePacketDueTomorrow(packet, session, now)) continue;
        eligibleLegacySessionDocs.push(docSnap);
      }
      await processCandidateSessionDocs(eligibleLegacySessionDocs);

      lastLegacySessionDoc = legacySessionSnap.docs.length === PRACTICE_PACKET_REMINDER_PAGE_SIZE
        ? legacySessionSnap.docs[legacySessionSnap.docs.length - 1]
        : null;
    } while (lastLegacySessionDoc);
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
    recipient.parentUserId,
    ...playerOwnerIds
  ].map((value) => String(value || '').trim()).filter(Boolean)));
}

function resolveFeeReminderThresholdHours(team = {}) {
  const reminderHours = Number.parseInt(team?.scheduleNotifications?.reminderHours, 10);
  return [24, 48, 72].includes(reminderHours) ? reminderHours : 72;
}

function wasFeeReminderSentForThreshold(recipient = {}, reminderThresholdHours = 72) {
  if (!recipient?.reminderSentAt) return false;
  const sentThresholdHours = Number.parseInt(recipient?.reminderThresholdHours, 10);
  if ([24, 48, 72].includes(sentThresholdHours)) {
    return sentThresholdHours === reminderThresholdHours;
  }
  return reminderThresholdHours === 72;
}

function formatFeeReminderWindowLabel(reminderThresholdHours = 72) {
  const reminderThresholdDays = Math.max(1, Math.round(reminderThresholdHours / 24));
  return `${reminderThresholdDays} day${reminderThresholdDays === 1 ? '' : 's'} or less`;
}

function getFeeReminderDueDateMillis(recipient = {}) {
  const dueDateValue = recipient?.dueDate || recipient?.dueAt || recipient?.deadline;
  if (typeof dueDateValue?.toMillis === 'function') {
    return dueDateValue.toMillis();
  }
  return coerceDate(dueDateValue)?.getTime();
}

function isFeeDueReminderCandidateEligible(recipient = {}, {
  nowMillis = Date.now(),
  reminderThresholdHours = 72
} = {}) {
  const status = String(recipient?.status || '').trim().toLowerCase();
  if (!['unpaid', 'pending'].includes(status)) return false;
  if (getTeamFeeBalanceCents(recipient) <= 0) return false;

  const dueDateMillis = getFeeReminderDueDateMillis(recipient);
  if (!Number.isFinite(dueDateMillis)) return false;

  const effectiveNowMillis = Number(nowMillis);
  if (!Number.isFinite(effectiveNowMillis) || dueDateMillis < effectiveNowMillis) return false;

  const reminderThresholdMillis = Number(reminderThresholdHours) * 60 * 60 * 1000;
  if (!Number.isFinite(reminderThresholdMillis) || reminderThresholdMillis <= 0) return false;
  if (dueDateMillis > effectiveNowMillis + reminderThresholdMillis) return false;

  return !wasFeeReminderSentForThreshold(recipient, reminderThresholdHours);
}

function buildFeeReminderNotificationBody(recipient = {}, amountLabel = '', reminderThresholdHours = 72) {
  const dueDateDisplay = formatFeeAssignmentDueDate(recipient.dueDate || recipient.dueAt || recipient.deadline);
  const reminderWindowLabel = formatFeeReminderWindowLabel(reminderThresholdHours);
  if (dueDateDisplay) {
    return `${amountLabel} is due ${dueDateDisplay} (${reminderWindowLabel}).`;
  }
  return `${amountLabel} is due in ${reminderWindowLabel}.`;
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

async function resolveEligibleFeeReminderRecipient({
  teamId,
  batchId,
  recipientId,
  recipient,
  nowMillis,
  reminderThresholdHours
}) {
  if (!isFeeDueReminderCandidateEligible(recipient, { nowMillis, reminderThresholdHours })) {
    return null;
  }

  const candidateUserIds = await resolveFeeReminderCandidateUserIds(teamId, recipient);
  if (!candidateUserIds.length) return null;

  const allTargets = await getTargetsForCategory(teamId, 'fees', null);
  const candidateUserIdSet = new Set(candidateUserIds);
  const payerTargets = allTargets.filter((target) => candidateUserIdSet.has(target.uid));
  if (!payerTargets.length) return null;

  return {
    teamId,
    batchId,
    recipientId,
    candidateUserIds,
    payerTargets
  };
}

async function sendFeeUnpaidDueReminders() {
  const now = admin.firestore.Timestamp.now();
  const nowMillis = now.toMillis();
  const maxReminderThresholdLater = admin.firestore.Timestamp.fromMillis(now.toMillis() + 72 * 60 * 60 * 1000);
  const teamReminderThresholdHours = new Map();

  // Use 'in' filter instead of '!=' to avoid Firestore inequality-on-different-field restriction
  const snap = await firestore.collectionGroup('feeRecipients')
    .where('status', 'in', ['unpaid', 'pending'])
    .where('dueDate', '>=', now)
    .where('dueDate', '<=', maxReminderThresholdLater)
    .get();

  const promises = snap.docs.map(async (doc) => {
    const data = doc.data();
    const pathParts = doc.ref.path.split('/');
    // Path structure: teams/{teamId}/feeBatches/{batchId}/feeRecipients/{recipientId}
    const teamId = pathParts[1];
    const batchId = pathParts[3];
    const recipientId = pathParts[5];
    if (!teamId) return null;

    let reminderThresholdHours = teamReminderThresholdHours.get(teamId);
    if (!reminderThresholdHours) {
      const teamSnap = await firestore.collection('teams').doc(teamId).get();
      reminderThresholdHours = resolveFeeReminderThresholdHours(teamSnap.exists ? teamSnap.data() : {});
      teamReminderThresholdHours.set(teamId, reminderThresholdHours);
    }

    const title = data.feeTitle || data.title || 'Team fee due soon';
    const amountLabel = formatMoneyFromCents(getTeamFeeBalanceCents(data), data.currency || 'USD');
    const body = buildFeeReminderNotificationBody(data, amountLabel, reminderThresholdHours);

    try {
      const eligibleRecipient = await resolveEligibleFeeReminderRecipient({
        teamId,
        batchId,
        recipientId,
        recipient: data,
        nowMillis,
        reminderThresholdHours
      });
      if (!eligibleRecipient) return null;

      // Mark reminderSentAt only when targets exist, to prevent duplicate sends if function retries
      await doc.ref.update({
        reminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
        reminderThresholdHours
      });

      await sendDirectTargetsNotification({
        targets: eligibleRecipient.payerTargets,
        category: 'fees',
        title: `Reminder: ${title} is due soon`,
        body,
        teamId,
        batchId,
        recipientId,
      });
      return { teamId, payerUserIds: eligibleRecipient.candidateUserIds, feeTitle: title };
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

function resolveFeeRecipientPlayerId(teamId, recipient = {}) {
  const explicitPlayerId = String(recipient.playerId || recipient.childId || '').trim();
  if (explicitPlayerId) return explicitPlayerId;

  const playerKey = String(recipient.playerKey || '').trim();
  const prefix = `${String(teamId || recipient.teamId || '').trim()}::`;
  if (prefix.length > 2 && playerKey.startsWith(prefix)) {
    return playerKey.slice(prefix.length).trim();
  }
  return '';
}

function formatFeeAssignmentDueDate(value) {
  const dueDate = coerceDate(value);
  if (!dueDate) return '';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(dueDate);
}

function buildFeeAssignmentNotificationBody(recipient = {}, amountDisplay = '') {
  const dueDateDisplay = formatFeeAssignmentDueDate(recipient.dueDate || recipient.dueAt || recipient.deadline);
  const parts = [];
  if (amountDisplay) {
    parts.push(`${amountDisplay} has been assigned`);
  } else {
    parts.push('A new team fee has been assigned');
  }
  if (dueDateDisplay) {
    parts.push(`due ${dueDateDisplay}`);
  }
  return `${parts.join(', ')}.`;
}

function getFeeAssignmentRecipientName(recipient = {}) {
  return String(
    recipient.playerName ||
    recipient.childName ||
    recipient.participantName ||
    recipient.athleteName ||
    recipient.name ||
    ''
  ).trim();
}

function joinDisplayValues(values = []) {
  const uniqueValues = Array.from(new Set(
    values.map((value) => String(value || '').trim()).filter(Boolean)
  ));
  if (uniqueValues.length <= 1) return uniqueValues[0] || '';
  if (uniqueValues.length === 2) return `${uniqueValues[0]} and ${uniqueValues[1]}`;
  return `${uniqueValues.slice(0, -1).join(', ')}, and ${uniqueValues[uniqueValues.length - 1]}`;
}

function buildCombinedFeeAssignmentNotificationPayload(recipients = []) {
  const normalizedRecipients = (Array.isArray(recipients) ? recipients : [])
    .filter((recipient) => recipient && typeof recipient === 'object');
  if (normalizedRecipients.length <= 1) {
    const recipient = normalizedRecipients[0] || {};
    const title = String(recipient.feeTitle || recipient.title || 'Team fee').trim();
    const amountCents = getTeamFeeBalanceCents(recipient) || Number(recipient.amountCents || recipient.feeAmountCents || 0);
    const amountDisplay = amountCents > 0 ? ` (${formatMoneyFromCents(amountCents, recipient.currency || 'USD')})` : '';
    return {
      title: `New fee assigned: ${title}${amountDisplay}`,
      body: buildFeeAssignmentNotificationBody(recipient, amountDisplay ? amountDisplay.slice(2, -1) : '')
    };
  }

  const titles = Array.from(new Set(
    normalizedRecipients
      .map((recipient) => String(recipient.feeTitle || recipient.title || '').trim())
      .filter(Boolean)
  ));
  const title = titles.length === 1 ? titles[0] : `${normalizedRecipients.length} team fees`;
  const currency = normalizedRecipients.find((recipient) => recipient.currency)?.currency || 'USD';
  const totalAmountCents = normalizedRecipients.reduce((total, recipient) => {
    return total + (getTeamFeeBalanceCents(recipient) || Number(recipient.amountCents || recipient.feeAmountCents || 0));
  }, 0);
  const amountDisplay = totalAmountCents > 0 ? formatMoneyFromCents(totalAmountCents, currency) : '';
  const names = normalizedRecipients.map(getFeeAssignmentRecipientName).filter(Boolean);
  const dueDateDisplay = joinDisplayValues(
    normalizedRecipients.map((recipient) => formatFeeAssignmentDueDate(recipient.dueDate || recipient.dueAt || recipient.deadline))
  );
  const childDisplay = names.length ? joinDisplayValues(names) : `${normalizedRecipients.length} children`;
  const bodyParts = [
    amountDisplay
      ? `${amountDisplay} has been assigned for ${childDisplay}`
      : `${normalizedRecipients.length} fees have been assigned for ${childDisplay}`
  ];
  if (dueDateDisplay) {
    bodyParts.push(`due ${dueDateDisplay}`);
  }
  return {
    title: `New fees assigned: ${title}${amountDisplay ? ` (${amountDisplay} total)` : ''}`,
    body: `${bodyParts.join(', ')}.`
  };
}

function getFeeAssignmentRecipientPlayerKey(teamId, recipient = {}) {
  const playerId = resolveFeeRecipientPlayerId(teamId, recipient);
  return getFeeReminderPlayerKey({
    ...recipient,
    playerId: playerId || recipient.playerId || recipient.childId
  }, teamId);
}

async function loadFeeAssignmentUserParentPlayerKeys(uid) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) return new Set();
  try {
    const userSnap = await firestore.doc(`users/${normalizedUid}`).get();
    const user = userSnap.exists ? (userSnap.data() || {}) : {};
    return new Set(
      (Array.isArray(user.parentPlayerKeys) ? user.parentPlayerKeys : [])
        .map((key) => String(key || '').trim())
        .filter(Boolean)
    );
  } catch (error) {
    functions.logger.warn('Failed to read fee assignment payer parent keys; falling back to current recipient.', {
      uid: normalizedUid,
      error: error?.message || error
    });
    return new Set();
  }
}

async function resolveFeeAssignmentRecipientsForUser({
  teamId,
  batchId,
  uid,
  recipientId,
  fallbackRecipient
}) {
  const fallback = fallbackRecipient
    ? { id: recipientId || null, ...fallbackRecipient }
    : null;
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid || !teamId || !batchId) return fallback ? [fallback] : [];
  const parentPlayerKeys = await loadFeeAssignmentUserParentPlayerKeys(normalizedUid);
  if (!parentPlayerKeys.size) return fallback ? [fallback] : [];

  const teamPlayerKeyPrefix = `${teamId}::`;
  const fallbackPlayerKey = getFeeAssignmentRecipientPlayerKey(teamId, fallbackRecipient || {});
  const playerKeys = Array.from(parentPlayerKeys)
    .filter((playerKey) => playerKey.startsWith(teamPlayerKeyPrefix))
    .filter((playerKey) => playerKey !== fallbackPlayerKey)
    .filter((playerKey) => {
      const playerId = playerKey.slice(teamPlayerKeyPrefix.length);
      return playerId && !playerId.includes('/');
    });
  const uniquePlayerKeys = Array.from(new Set(playerKeys));
  const uniquePlayerIds = uniquePlayerKeys
    .map((playerKey) => playerKey.slice(teamPlayerKeyPrefix.length));
  if (!uniquePlayerIds.length) return fallback ? [fallback] : [];

  try {
    const recipientCollection = firestore.collection(`teams/${teamId}/feeBatches/${batchId}/feeRecipients`);
    const queryPromises = [];
    for (let index = 0; index < uniquePlayerIds.length; index += 30) {
      queryPromises.push(
        recipientCollection.where('playerKey', 'in', uniquePlayerKeys.slice(index, index + 30)).get(),
        recipientCollection.where('playerId', 'in', uniquePlayerIds.slice(index, index + 30)).get(),
        recipientCollection.where('childId', 'in', uniquePlayerIds.slice(index, index + 30)).get()
      );
    }
    const recipientSnaps = await Promise.all(queryPromises);
    const recipientsById = new Map();
    recipientSnaps.forEach((querySnap) => {
      querySnap.docs.forEach((docSnap) => {
        if (String(docSnap.id || '') === String(recipientId || '')) return;
        recipientsById.set(docSnap.id, { id: docSnap.id, ...(docSnap.data() || {}) });
      });
    });
    const recipients = Array.from(recipientsById.values());
    return fallback ? [fallback, ...recipients] : recipients;
  } catch (error) {
    functions.logger.warn('Failed to read payer-scoped fee assignment recipients; falling back to current recipient.', {
      teamId,
      batchId,
      recipientId,
      uid: normalizedUid,
      error: error?.message || error
    });
    return fallback ? [fallback] : [];
  }
}

function combineDirectNotificationResults(results = []) {
  const deliveredResults = (Array.isArray(results) ? results : []).filter(Boolean);
  if (!deliveredResults.length) return null;
  return deliveredResults.reduce((combined, result) => ({
    responses: [
      ...(combined.responses || []),
      ...(Array.isArray(result.responses) ? result.responses : [])
    ],
    successCount: Number(combined.successCount || 0) + Number(result.successCount || 0),
    failureCount: Number(combined.failureCount || 0) + Number(result.failureCount || 0),
    inboxWriteCount: Number(combined.inboxWriteCount || 0) + Number(result.inboxWriteCount || 0),
    inboxCleanupCount: Number(combined.inboxCleanupCount || 0) + Number(result.inboxCleanupCount || 0),
    inboxFailureCount: Number(combined.inboxFailureCount || 0) + Number(result.inboxFailureCount || 0)
  }), {
    responses: [],
    successCount: 0,
    failureCount: 0,
    inboxWriteCount: 0,
    inboxCleanupCount: 0,
    inboxFailureCount: 0
  });
}

async function resolveFeeAssignmentPayerUserIds(teamId, recipient = {}) {
  const playerId = resolveFeeRecipientPlayerId(teamId, recipient);
  const playerRef = playerId ? firestore.doc(`teams/${teamId}/players/${playerId}`) : null;
  const [playerSnap, privateProfileSnap] = playerRef
    ? await Promise.all([
      playerRef.get(),
      playerRef.collection('private').doc('profile').get()
    ])
    : [null, null];
  const playerData = playerSnap?.exists ? { id: playerSnap.id, ...(playerSnap.data() || {}) } : {};
  const privateProfileData = privateProfileSnap?.exists ? (privateProfileSnap.data() || {}) : {};
  const userIds = new Set(getTeamFeeRecipientTargetUserIds({
    ...recipient,
    playerId: playerId || recipient.playerId || recipient.childId
  }, playerData, privateProfileData));
  const playerKey = getFeeReminderPlayerKey({
    ...recipient,
    playerId: playerId || recipient.playerId || recipient.childId
  }, teamId);
  if (playerKey) {
    const parentSnap = await firestore.collection('users')
      .where('parentPlayerKeys', 'array-contains', playerKey)
      .get();
    parentSnap.docs
      .map((docSnap) => String(docSnap.id || '').trim())
      .filter(Boolean)
      .forEach((uid) => userIds.add(uid));
  }
  return Array.from(userIds);
}

function buildFeeAssignmentNotificationClaimRef({ teamId, batchId, uid }) {
  const normalizedUid = String(uid || '').trim();
  if (!teamId || !batchId || !normalizedUid) return null;
  return firestore.doc(`teams/${teamId}/feeBatches/${batchId}/assignmentNotificationClaims/${normalizedUid}`);
}

async function claimFeeAssignmentNotificationUser({ teamId, batchId, recipientId, uid }) {
  const normalizedUid = String(uid || '').trim();
  const claimRef = buildFeeAssignmentNotificationClaimRef({ teamId, batchId, uid: normalizedUid });
  if (!claimRef) return false;
  return firestore.runTransaction(async (transaction) => {
    const claimSnap = await transaction.get(claimRef);
    if (claimSnap.exists) return false;
    transaction.set(claimRef, {
      uid: normalizedUid,
      teamId,
      batchId,
      firstRecipientId: recipientId || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return true;
  });
}

async function releaseFeeAssignmentNotificationClaims({ teamId, batchId, userIds = [] }) {
  const uniqueUserIds = Array.from(new Set(
    (Array.isArray(userIds) ? userIds : [])
      .map((uid) => String(uid || '').trim())
      .filter(Boolean)
  ));
  if (!teamId || !batchId || !uniqueUserIds.length) return;
  const batch = firestore.batch();
  uniqueUserIds.forEach((uid) => {
    const claimRef = buildFeeAssignmentNotificationClaimRef({ teamId, batchId, uid });
    if (claimRef) batch.delete(claimRef);
  });
  await batch.commit();
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

function dedupeNotificationTargetsByUserDevice(targets = []) {
  const seen = new Set();
  const uniqueTargets = [];
  for (const target of Array.isArray(targets) ? targets : []) {
    const uid = String(target?.uid || '').trim();
    const deviceId = String(target?.deviceId || target?.token || '').trim();
    const token = String(target?.token || '').trim();
    if (!uid || !token) continue;
    const key = `${uid}::${deviceId || token}`;
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueTargets.push({ ...target, uid, token });
  }
  return uniqueTargets;
}

const teamChatMentionStartRegex = /(^|[\s([{"'])@/g;

function detectMentionedUids(text, members, options = {}) {
  if (!text) return [];
  const { allowReservedMentions = false } = options || {};
  const mentioned = new Set();
  const sourceText = String(text || '');
  const normalizedMembers = Array.isArray(members)
    ? members.flatMap((member) => {
      const names = [
        member?.displayName,
        member?.name,
        ...(Array.isArray(member?.mentionNames) ? member.mentionNames : [])
      ];
      return names.map((name) => {
        const memberName = String(name || '').toLowerCase().trim().replace(/\s+/g, ' ');
        return {
          uid: member?.uid,
          fullName: memberName,
          compactName: memberName.replace(/\s+/g, ''),
          firstName: memberName.split(' ')[0] || ''
        };
      }).filter((memberName) => memberName.uid && memberName.fullName);
    })
    : [];

  for (const match of sourceText.matchAll(teamChatMentionStartRegex)) {
    const startIndex = Number(match.index || 0) + String(match[1] || '').length + 1;
    const candidateMatch = sourceText.slice(startIndex).match(/^([A-Za-z0-9][A-Za-z0-9.'-]*)(?:\s+([A-Za-z0-9][A-Za-z0-9.'-]*))?(?:\s+([A-Za-z0-9][A-Za-z0-9.'-]*))?/);
    if (!candidateMatch) continue;
    const candidateWords = candidateMatch.slice(1).filter(Boolean).map((part) => String(part).toLowerCase());
    if (!candidateWords.length) continue;

    const candidateLabels = [];
    for (let wordCount = candidateWords.length; wordCount >= 1; wordCount -= 1) {
      const label = candidateWords.slice(0, wordCount).join(' ');
      candidateLabels.push({
        name: label,
        compactName: label.replace(/\s+/g, '')
      });
    }

    let matchedReservedMention = false;
    for (const candidate of candidateLabels) {
      if (candidate.name === 'all plays') {
        matchedReservedMention = true;
        break;
      }
      if (candidate.name !== 'all' && candidate.name !== 'team') continue;
      if (!allowReservedMentions) {
        matchedReservedMention = true;
        break;
      }
      normalizedMembers.forEach((member) => mentioned.add(member.uid));
      return [...mentioned];
    }
    if (matchedReservedMention) continue;

    for (const candidate of candidateLabels) {
      let matchedMember = false;
      for (const member of normalizedMembers) {
        if (member.fullName === candidate.name || member.compactName === candidate.compactName || member.firstName === candidate.name) {
          mentioned.add(member.uid);
          matchedMember = true;
        }
      }
      if (matchedMember) break;
    }
  }
  return [...mentioned];
}

function normalizeTeamChatMentionName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function getTeamChatMentionNames(source = {}, keys = []) {
  return Array.from(new Set(
    keys
      .map((key) => normalizeTeamChatMentionName(source?.[key]))
      .filter(Boolean)
  ));
}

function getTeamChatRosterPlayerMentionNames(player = {}) {
  return getTeamChatMentionNames(player, ['displayName', 'fullName', 'name', 'playerName', 'childName']);
}

function getTeamChatRosterContactMentionNames(contact = {}) {
  return getTeamChatMentionNames(contact, [
    'displayName',
    'fullName',
    'name',
    'parentName',
    'guardianName'
  ]);
}

function getTeamChatRosterContactUid(contact = {}) {
  return String(
    contact.userId
    || contact.uid
    || contact.parentUserId
    || contact.guardianUserId
    || ''
  ).trim();
}

function getTeamChatRosterContactEmail(contact = {}) {
  return String(
    contact.email
    || contact.parentEmail
    || contact.guardianEmail
    || ''
  ).trim().toLowerCase();
}

function getTeamChatRosterContacts(player = {}) {
  return [
    player,
    ...(Array.isArray(player.parents) ? player.parents : []),
    ...(Array.isArray(player.guardians) ? player.guardians : []),
    ...(Array.isArray(player.familyContacts) ? player.familyContacts : []),
    ...(Array.isArray(player.contacts) ? player.contacts : [])
  ];
}

function normalizeTeamChatParticipantSelector(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const separatorIndex = raw.indexOf(':');
  if (separatorIndex > 0) {
    const kind = raw.slice(0, separatorIndex).trim().toLowerCase();
    const id = raw.slice(separatorIndex + 1).trim();
    if (!id) return null;
    if (kind === 'email') return { kind: 'email', id: id.toLowerCase() };
    if (kind === 'player') return { kind: 'player', id };
    if (kind === 'user') return { kind: 'user', id };
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return { kind: 'email', id: raw.toLowerCase() };
  }
  return { kind: 'user', id: raw };
}

function addTeamChatMemberRole(users, uid, role, aliases = []) {
  const normalizedUid = String(uid || '').trim();
  if (!normalizedUid) return;
  const entry = users.get(normalizedUid) || {
    uid: normalizedUid,
    roles: new Set(),
    mentionNames: new Set()
  };
  entry.roles.add(role);
  (Array.isArray(aliases) ? aliases : []).forEach((alias) => {
    const normalizedAlias = normalizeTeamChatMentionName(alias);
    if (normalizedAlias) entry.mentionNames.add(normalizedAlias);
  });
  users.set(normalizedUid, entry);
}

async function buildTeamChatNotificationContext(teamId, options = {}) {
  const { includeMentions = true, conversationId = null } = options || {};
  const { targetType = 'full_team', recipientIds = [] } = options || {};
  const normalizedConversationId = normalizeTeamChatConversationId(conversationId);
  const allowedTargetTypes = new Set(['full_team', 'staff', 'individuals']);
  const normalizedTargetType = allowedTargetTypes.has(String(targetType || '').trim())
    ? String(targetType || '').trim()
    : 'full_team';
  const teamRef = firestore.doc(`teams/${teamId}`);
  const conversationRef = normalizedConversationId === 'team'
    ? null
    : firestore.doc(`teams/${teamId}/chatConversations/${normalizedConversationId}`);
  const [teamSnap, conversationSnap] = await Promise.all([
    teamRef.get(),
    conversationRef ? conversationRef.get() : Promise.resolve(null)
  ]);
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
  const conversation = conversationSnap?.exists ? (conversationSnap.data() || {}) : {};
  const participantRoles = new Set(
    (Array.isArray(conversation.participantRoles) ? conversation.participantRoles : [])
      .map((role) => String(role || '').trim().toLowerCase())
      .filter(Boolean)
  );
  const conversationParticipantIds = Array.from(new Set(
    (Array.isArray(conversation.participantIds) ? conversation.participantIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  ));
  const normalizedRecipientIds = Array.from(new Set(
    (Array.isArray(recipientIds) ? recipientIds : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean)
  ));
  const effectiveTargetType = normalizedConversationId === 'team'
    ? 'full_team'
    : (participantRoles.has('staff')
      ? 'staff'
      : (normalizedTargetType === 'individuals' || conversationParticipantIds.length > 0 || normalizedRecipientIds.length > 0
        ? 'individuals'
        : normalizedTargetType));
  const scopedParticipantIds = effectiveTargetType === 'individuals'
    ? Array.from(new Set([...conversationParticipantIds, ...normalizedRecipientIds]))
    : [];
  const scopedParticipantSelectors = scopedParticipantIds
    .map(normalizeTeamChatParticipantSelector)
    .filter(Boolean);
  const scopedParticipantUids = new Set(
    scopedParticipantSelectors
      .filter((selector) => selector.kind === 'user')
      .map((selector) => selector.id)
      .filter(Boolean)
  );
  const scopedParticipantEmails = Array.from(new Set(
    scopedParticipantSelectors
      .filter((selector) => selector.kind === 'email')
      .map((selector) => selector.id)
      .filter(Boolean)
  ));
  const scopedParticipantPlayerIds = new Set(
    scopedParticipantSelectors
      .filter((selector) => selector.kind === 'player')
      .map((selector) => selector.id)
      .filter(Boolean)
  );
  const users = new Map();
  const addRole = (uid, role, aliases = []) => addTeamChatMemberRole(users, uid, role, aliases);

  addRole(team.ownerId, 'staff');

  const [parentSnap, indexedTargetSnap, adminUserIds, participantEmailUserIds, playersSnap] = await Promise.all([
    firestore.collection('users').where('parentTeamIds', 'array-contains', teamId).get(),
    firestore.collection(`teams/${teamId}/notificationTargets`).get(),
    getUserIdsByEmails(team.adminEmails || []),
    scopedParticipantEmails.length > 0 ? getUserIdsByEmails(scopedParticipantEmails) : Promise.resolve([]),
    firestore.collection(`teams/${teamId}/players`).get()
  ]);

  parentSnap.forEach((docSnap) => addRole(docSnap.id, 'parent'));
  adminUserIds.forEach((uid) => addRole(uid, 'staff'));
  participantEmailUserIds.forEach((uid) => scopedParticipantUids.add(uid));

  const rosterContactAliasesByEmail = new Map();
  const scopedRosterContactEmails = new Set();
  const activePlayers = Array.isArray(playersSnap?.docs)
    ? playersSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
      .filter((player) => player.active !== false)
    : [];

  activePlayers.forEach((player) => {
    const playerAliases = getTeamChatRosterPlayerMentionNames(player);
    if (!playerAliases.length) return;
    const playerId = String(player.id || player.playerId || '').trim();
    const playerIsScoped = scopedParticipantPlayerIds.has(playerId);
    getTeamChatRosterContacts(player).forEach((contact) => {
      const contactAliases = Array.from(new Set([
        ...playerAliases,
        ...getTeamChatRosterContactMentionNames(contact)
      ]));
      const uid = getTeamChatRosterContactUid(contact);
      const email = getTeamChatRosterContactEmail(contact);
      if (uid) {
        addRole(uid, 'parent', contactAliases);
        if (playerIsScoped) scopedParticipantUids.add(uid);
      }
      if (email) {
        const existingAliases = rosterContactAliasesByEmail.get(email) || new Set();
        contactAliases.forEach((alias) => existingAliases.add(alias));
        rosterContactAliasesByEmail.set(email, existingAliases);
        if (playerIsScoped) scopedRosterContactEmails.add(email);
      }
    });
  });

  const rosterEmailUserIdEntries = await Promise.all(
    Array.from(rosterContactAliasesByEmail.entries()).map(async ([email, aliasSet]) => ({
      email,
      aliases: Array.from(aliasSet),
      uids: await getUserIdsByEmails([email])
    }))
  );
  rosterEmailUserIdEntries.forEach(({ email, aliases, uids }) => {
    (Array.isArray(uids) ? uids : []).forEach((uid) => {
      addRole(uid, 'parent', aliases);
      if (scopedRosterContactEmails.has(email)) scopedParticipantUids.add(uid);
    });
  });

  let members = Array.from(users.values()).map((entry) => ({
    uid: entry.uid,
    roles: Array.from(entry.roles),
    mentionNames: Array.from(entry.mentionNames || [])
  }));

  if (effectiveTargetType === 'staff') {
    members = members.filter((member) => Array.isArray(member.roles) && member.roles.includes('staff'));
  } else if (effectiveTargetType === 'individuals') {
    members = members.filter((member) => scopedParticipantUids.has(member.uid));
  }

  const [userRecords, memberPreferenceEntries] = await Promise.all([
    getUserRecordsByIds(members.map((member) => member.uid)),
    Promise.all(members.map(async (member) => {
      const preferenceSnap = await firestore.doc(`users/${member.uid}/notificationPreferences/${teamId}`).get();
      return {
        uid: member.uid,
        exists: preferenceSnap.exists,
        preferences: preferenceSnap.exists
          ? normalizeNotificationPreferences(preferenceSnap.data())
          : DEFAULT_NOTIFICATION_PREFERENCES
      };
    }))
  ]);
  const memberPreferencesByUid = new Map(
    memberPreferenceEntries.map((entry) => [entry.uid, entry])
  );

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
  const indexedUserIds = new Set();

  indexedTargetSnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const uid = String(data.uid || '').trim();
    const deviceId = String(data.deviceId || '').trim();
    const token = String(data.token || '').trim();
    if (!uid || !deviceId || !token) return;
    indexedUserIds.add(uid);

    categories.forEach((category) => {
      if (data.categories?.[category] !== true) return;
      if (!eligibleUidsByCategory[category].has(uid)) return;
      indexedTargetsByCategory[category].push({ uid, deviceId, token, teamId });
      indexedUserIdsByCategory[category].add(uid);
    });
  });

  const enabledUidsByCategory = categories.reduce((accumulator, category) => {
    accumulator[category] = members
      .filter((member) => eligibleUidsByCategory[category].has(member.uid))
      .filter((member) => {
        const preferenceEntry = memberPreferencesByUid.get(member.uid);
        if (preferenceEntry?.exists) return preferenceEntry.preferences[category] === true;
        if (category === 'liveChat') return true;
        if (indexedUserIds.has(member.uid)) return indexedUserIdsByCategory[category].has(member.uid);
        return DEFAULT_NOTIFICATION_PREFERENCES[category] === true;
      })
      .map((member) => member.uid);
    return accumulator;
  }, { mentions: [], liveChat: [] });

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
        ? String(userRecord.displayName || userRecord.fullName || userRecord.name || member.mentionNames?.[0] || '').trim()
        : '',
      mentionNames: includeMentions
        ? Array.from(new Set([
          String(userRecord.displayName || '').trim(),
          String(userRecord.fullName || '').trim(),
          String(userRecord.name || '').trim(),
          ...(Array.isArray(member.mentionNames) ? member.mentionNames : [])
        ].filter(Boolean)))
        : [],
      muted: conversationMuted || Boolean(normalizedConversationId === 'team' && chatMuted && chatMuted[teamId])
    };
  });

  return {
    members: hydratedMembers,
    mutedUids: hydratedMembers.filter((member) => member.muted).map((member) => member.uid),
    enabledUidsByCategory,
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
  const members = Array.isArray(context.members) ? context.members : [];
  const mentionTargets = dedupeNotificationTargetsByUserDevice(context.targetsByCategory?.mentions);
  const liveChatTargets = dedupeNotificationTargetsByUserDevice(context.targetsByCategory?.liveChat);
  const actorIsStaff = Boolean(
    actorUid
    && members.some((member) => member.uid === actorUid && Array.isArray(member.roles) && member.roles.includes('staff'))
  );
  const mentionedUids = text
    ? detectMentionedUids(text, members, { allowReservedMentions: actorIsStaff }).filter((uid) => uid !== actorUid)
    : [];
  const mutedSet = new Set(Array.isArray(context.mutedUids) ? context.mutedUids : []);
  const mentionEnabledSet = new Set(
    Array.isArray(context.enabledUidsByCategory?.mentions)
      ? context.enabledUidsByCategory.mentions
      : mentionTargets.map((target) => target.uid)
  );
  const liveChatEnabledSet = new Set(
    Array.isArray(context.enabledUidsByCategory?.liveChat)
      ? context.enabledUidsByCategory.liveChat
      : liveChatTargets.map((target) => target.uid)
  );
  const mentionDeliverySet = new Set(mentionedUids.filter((uid) => mentionEnabledSet.has(uid)));
  const liveChatInboxUids = members
    .map((member) => String(member?.uid || '').trim())
    .filter((uid) => uid && liveChatEnabledSet.has(uid) && uid !== actorUid && !mentionDeliverySet.has(uid) && !mutedSet.has(uid));

  return {
    mentionedUids,
    mentionInboxUids: mentionedUids.filter((uid) => mentionDeliverySet.has(uid) && !mutedSet.has(uid)),
    mentionTargets: mentionTargets.filter((target) => target.uid !== actorUid && mentionDeliverySet.has(target.uid)),
    liveChatInboxUids,
    liveChatTargets: liveChatTargets.filter((target) => (
      target.uid !== actorUid
      && liveChatEnabledSet.has(target.uid)
      && !mentionDeliverySet.has(target.uid)
      && !mutedSet.has(target.uid)
    ))
  };
}

async function resolveTeamChatSenderLabel(senderId, legacySenderName) {
  const normalizedSenderId = String(senderId || '').trim();
  if (normalizedSenderId) {
    try {
      const senderSnap = await firestore.doc(`users/${normalizedSenderId}`).get();
      if (senderSnap.exists) {
        const sender = senderSnap.data() || {};
        const canonicalLabel = String(
          sender.fullName || sender.displayName || sender.name || sender.email || ''
        ).trim();
        if (canonicalLabel) return canonicalLabel.slice(0, 120);
      }
    } catch (error) {
      console.warn('Unable to resolve team chat sender profile', normalizedSenderId, error);
    }
  }

  return String(legacySenderName || 'Team').trim().slice(0, 120) || 'Team';
}

async function handleTeamChatMessageCreated(snapshot, context) {
  const data = snapshot.data() || {};
  const text = String(data.text || '').trim();
  const imageUrl = String(data.imageUrl || '').trim();
  const attachments = Array.isArray(data.attachments) ? data.attachments.filter(Boolean) : [];
  if (!text && !imageUrl && attachments.length === 0) return null;
  if (isPreEventReminderChatMessage(data)) return null;

  const teamId = context.params.teamId;
  const actorUid = data.senderId || null;
  const conversationId = normalizeTeamChatConversationId(data.conversationId || context.params.conversationId);
  const senderName = await resolveTeamChatSenderLabel(actorUid, data.senderName);
  const hasImageAttachment = attachments.some((attachment) => {
    const type = String(attachment?.type || attachment?.mimeType || '').toLowerCase();
    return type === 'image' || type.startsWith('image/');
  });
  const hasVideoAttachment = attachments.some((attachment) => {
    const type = String(attachment?.type || attachment?.mimeType || '').toLowerCase();
    return type === 'video' || type.startsWith('video/');
  });
  const body = text
    ? (text.length > 120 ? `${text.slice(0, 117)}...` : text)
    : (imageUrl || hasImageAttachment ? 'sent a photo' : (hasVideoAttachment ? 'sent a video' : 'sent an attachment'));

  const shouldResolveMentions = Boolean(text);
  const recipientContext = await buildTeamChatNotificationContext(teamId, {
    includeMentions: shouldResolveMentions,
    conversationId,
    targetType: data.targetType,
    recipientIds: data.recipientIds
  });
  const notificationPlan = buildTeamChatNotificationPlan({
    text,
    actorUid,
    recipientContext
  });

  const mentionedUids = notificationPlan.mentionedUids;
  const results = [];

  if (shouldResolveMentions) {
    await snapshot.ref.update({ mentionedUids });
  }

  if (notificationPlan.mentionTargets.length || notificationPlan.mentionInboxUids?.length) {
    results.push(await sendDirectTargetsNotification({
      targets: notificationPlan.mentionTargets,
      inboxUids: notificationPlan.mentionInboxUids,
      category: 'mentions',
      title: `${senderName} mentioned you`,
      body,
      teamId,
      conversationId
    }));
  }

  if (!notificationPlan.liveChatTargets.length && !notificationPlan.liveChatInboxUids.length) {
    return results.length ? results : null;
  }

  results.push(await sendDirectTargetsNotification({
    targets: notificationPlan.liveChatTargets,
    inboxUids: notificationPlan.liveChatInboxUids,
    category: 'liveChat',
    title: `${senderName}: Team Chat`,
    body,
    teamId,
    conversationId
  }));

  return results;
}

exports.notifyTeamChatMessageCreated = functions.firestore
  .document('teams/{teamId}/chatMessages/{messageId}')
  .onCreate(handleTeamChatMessageCreated);

exports.notifyConversationChatMessageCreated = functions.firestore
  .document('teams/{teamId}/chatConversations/{conversationId}/chatMessages/{messageId}')
  .onCreate(handleTeamChatMessageCreated);

function formatSharedGameCancellationNoticeDate(game = {}) {
  const dateValue = coerceDate(game?.date);
  if (!dateValue) return '';

  const timeZone = String(game?.timeZone || '').trim();
  if (timeZone) {
    return formatScheduleUpdateDate(dateValue, timeZone);
  }

  return dateValue.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

function buildSharedGameCancellationCounterpartMessage({ sourceTeam = {}, sourceGame = {} } = {}) {
  const sourceTeamName = normalizeText(sourceTeam?.name, 160) || 'The other team';
  const eventTitle = getEventTitle(sourceGame || {}) || 'Game';
  const dateLabel = formatSharedGameCancellationNoticeDate(sourceGame);

  if (dateLabel) {
    return `⚠️ Shared game cancelled: ${sourceTeamName} cancelled ${eventTitle} on ${dateLabel}.`;
  }

  return `⚠️ Shared game cancelled: ${sourceTeamName} cancelled ${eventTitle}.`;
}

exports.postSharedGameCancellationNotification = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw new functions.https.HttpsError('unauthenticated', 'Sign in to notify the linked team chat.');
  }

  const teamId = normalizeText(data?.teamId, 160);
  const gameId = normalizeText(data?.gameId, 160);
  const counterpartTeamId = normalizeText(data?.counterpartTeamId, 160);

  if (!teamId || !gameId || !counterpartTeamId) {
    throw new functions.https.HttpsError('invalid-argument', 'teamId, gameId, and counterpartTeamId are required.');
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

  const counterpartTeam = counterpartTeamSnap.data() || {};
  const sourceGame = sourceGameSnap.data() || {};
  const linkedCounterpartTeamId = String(sourceGame.sharedScheduleOpponentTeamId || sourceGame.opponentTeamId || '').trim();
  if (!linkedCounterpartTeamId || linkedCounterpartTeamId !== counterpartTeamId) {
    throw new functions.https.HttpsError('failed-precondition', 'Game is not linked to the requested counterpart team.');
  }
  if (String(sourceGame.status || '').trim().toLowerCase() !== 'cancelled') {
    throw new functions.https.HttpsError('failed-precondition', 'Cancel the game before notifying the linked team chat.');
  }

  const text = buildSharedGameCancellationCounterpartMessage({
    sourceTeam,
    sourceGame
  });
  const messageRef = firestore.collection(`teams/${counterpartTeamId}/chatMessages`).doc();
  await messageRef.set({
    text,
    senderId: 'shared-game-cancellation-system',
    senderName: 'ALL PLAYS',
    senderEmail: null,
    senderType: 'system',
    systemGenerated: true,
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
      sourceGameId: gameId,
      sourceTeamName: sourceTeam.name || null,
      counterpartTeamId,
      counterpartTeamName: counterpartTeam.name || null,
      actorType: 'system'
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
  let rawSubject = String(data?.subject || '').trim();
  let rawBody = String(data?.body || '').trim();
  const hasRequestedTargetType = data?.targetType !== undefined && data?.targetType !== null && data?.targetType !== '';
  let targetType = data?.targetType || 'full_team';
  let recipientIds = Array.isArray(data?.recipientIds) ? data.recipientIds : [];
  let requestedAttachments = Array.isArray(data?.attachments) ? data.attachments : [];

  if (!teamId) {
    throw new functions.https.HttpsError('invalid-argument', 'Team is required.');
  }

  const { team, user } = await requireTeamEmailSender(teamId, context);
  if (draftId) {
    const draftSnap = await firestore.doc(`teams/${teamId}/emailDrafts/${draftId}`).get();
    if (!draftSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Email draft not found.');
    }
    const draft = draftSnap.data() || {};
    rawSubject = rawSubject || String(draft.subject || '').trim();
    rawBody = rawBody || String(draft.body || '').trim();
    const draftTargetType = ['full_team', 'staff', 'individuals'].includes(draft.targetType) ? draft.targetType : null;
    const draftRecipientIds = Array.isArray(draft.recipientIds) ? draft.recipientIds : [];
    targetType = draftTargetType || (!hasRequestedTargetType && draftRecipientIds.length > 0 ? 'individuals' : targetType);
    recipientIds = draftRecipientIds.length > 0 ? draftRecipientIds : recipientIds;
    requestedAttachments = Array.isArray(draft.attachments) ? draft.attachments : requestedAttachments;
  }

  if (!['full_team', 'staff', 'individuals'].includes(targetType)) {
    throw new functions.https.HttpsError('invalid-argument', 'Unknown team email audience.');
  }
  if (!rawSubject || !rawBody) {
    throw new functions.https.HttpsError('invalid-argument', 'Subject and message are required.');
  }
  if (rawSubject.length > 160 || rawBody.length > 20000) {
    throw new functions.https.HttpsError('invalid-argument', 'Subject or message exceeds the allowed length.');
  }
  const subject = normalizeText(rawSubject, 160);
  const body = normalizeText(rawBody, 20000);
  recipientIds = Array.from(new Set(recipientIds.map((id) => String(id || '').trim()).filter(Boolean)));
  if (targetType === 'individuals' && recipientIds.length === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Select at least one recipient.');
  }
  if (recipientIds.length > 400) {
    throw new functions.https.HttpsError('invalid-argument', 'Team email is limited to 400 selected recipients.');
  }

  let attachmentSummary;
  try {
    attachmentSummary = await normalizeTeamEmailAttachmentsForDelivery(teamId, requestedAttachments);
  } catch (error) {
    throw new functions.https.HttpsError('invalid-argument', error?.message || 'Invalid team email attachments.');
  }

  const [playersSnap, ownerSnap] = await Promise.all([
    firestore.collection(`teams/${teamId}/players`).get(),
    team.ownerId ? firestore.doc(`users/${team.ownerId}`).get() : Promise.resolve(null)
  ]);
  const players = playersSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
  const ownerUser = ownerSnap?.exists ? ownerSnap.data() || {} : null;
  if (targetType === 'individuals') {
    const unknownRecipientIds = findUnknownTeamEmailRecipientIds({ recipientIds, players });
    if (unknownRecipientIds.length > 0) {
      throw new functions.https.HttpsError('invalid-argument', 'One or more selected recipients are no longer eligible for this team. Refresh and try again.');
    }
  }
  const recipients = resolveTeamEmailRecipients({ targetType, recipientIds, players, team, ownerUser });
  if (recipients.length === 0) {
    throw new functions.https.HttpsError('failed-precondition', 'No email-enabled recipients were found for that audience.');
  }
  if (recipients.length > 400) {
    throw new functions.https.HttpsError('resource-exhausted', 'Team email is limited to 400 eligible recipients.');
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
      senderUid: context.auth.uid,
      attachments: attachmentSummary.attachments,
      attachmentTotalBytes: attachmentSummary.totalBytes
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
    attachments: attachmentSummary.attachments,
    attachmentTotalBytes: attachmentSummary.totalBytes,
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
    firstBatch.set(firestore.doc(`teams/${teamId}/emailDrafts/${draftId}`), {
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

  const directRecipientUids = recipients.flatMap((recipient) => (
    Array.isArray(recipient.userIds) ? recipient.userIds : []
  ));
  const emailRecipientUids = await getUserIdsByEmails(recipients.map((recipient) => recipient.email));
  const inboxRecipientUids = Array.from(new Set([...directRecipientUids, ...emailRecipientUids]
    .map((uid) => String(uid || '').trim())
    .filter((uid) => uid && uid !== context.auth.uid)));
  const inboxResult = await writeNotificationInboxRecords({
    targets: inboxRecipientUids.map((uid) => ({ uid })),
    category: 'team_email',
    title: `Team email: ${subject}`,
    body: truncateNotificationBody(body),
    appRoute: buildNotificationAppRoute({
      category: 'liveChat',
      teamId,
      conversationId: 'team'
    }),
    teamId,
    conversationId: 'team'
  });

  return {
    messageId: messageRef.id,
    status: 'sent',
    recipientCount: recipients.length,
    delivery: messagePayload.delivery,
    inboxWriteCount: inboxResult.writeCount,
    inboxFailureCount: inboxResult.failureCount
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
      const liveScoreDedupKey = `score:${toNumericScore(before.homeScore)}:${toNumericScore(before.awayScore)}->${toNumericScore(after.homeScore)}:${toNumericScore(after.awayScore)}`;
      const liveScoreStateDedupKey = buildLiveScoreStateNotificationDedupKey(after);
      if (await hasRecentBigMomentLiveEventForScoreState(teamId, gameId, liveScoreStateDedupKey)) {
        functions.logger.info('Notification dedup: skipping generic live score send for live event-backed score', {
          teamId,
          category,
          gameId,
          dedupKey: liveScoreDedupKey,
          scoreStateDedupKey: liveScoreStateDedupKey
        });
        return null;
      }
      const canSendLiveScore = await checkAndSetNotificationDedupKeys(teamId, category, gameId, [
        liveScoreDedupKey,
        liveScoreStateDedupKey
      ]);
      if (!canSendLiveScore) {
        functions.logger.info('Notification dedup: skipping duplicate live score send', {
          teamId,
          category,
          gameId,
          dedupKey: liveScoreDedupKey
        });
        return null;
      }

      return sendCategoryNotification({
        teamId,
        gameId,
        category,
        title: 'Live score update',
        body: `Score is now ${toNumericScore(after.homeScore)}-${toNumericScore(after.awayScore)}`,
        actorUid,
        dedupKey: liveScoreDedupKey
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

exports.notifyLiveEventCreated = functions.firestore
  .document('teams/{teamId}/games/{gameId}/liveEvents/{eventId}')
  .onCreate(async (snapshot, context) => {
    const event = snapshot.data() || {};
    const teamId = String(context.params?.teamId || '').trim();
    const gameId = String(context.params?.gameId || '').trim();
    const documentEventId = String(context.params?.eventId || snapshot.id || '').trim();
    if (!teamId || !gameId || !documentEventId) return null;

    const payload = buildBigMomentLiveEventNotification(event);
    if (!payload) return null;
    if (!isLiveEventNotificationFresh(event)) {
      functions.logger.info('Notification recency: skipping stale or undated live event', {
        teamId,
        gameId,
        eventId: documentEventId
      });
      return null;
    }

    const dedupKey = buildLiveEventNotificationDedupKey(event, documentEventId);
    if (!dedupKey) return null;
    const scoreStateDedupKey = buildLiveScoreStateNotificationDedupKey(event);
    const canSend = await checkAndSetNotificationDedupKeys(teamId, 'liveScore', gameId, [dedupKey, scoreStateDedupKey]);
    if (!canSend) {
      functions.logger.info('Notification dedup: skipping duplicate live event send', {
        teamId,
        gameId,
        eventId: documentEventId,
        dedupKey,
        scoreStateDedupKey
      });
      return null;
    }

    return sendCategoryNotification({
      teamId,
      gameId,
      eventId: documentEventId,
      category: 'liveScore',
      title: payload.title,
      body: payload.body,
      actorUid: getLiveEventActorUid(event),
      dedupKey
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

const notifyRideOfferCreated = functions.firestore
  .document('teams/{teamId}/games/{gameId}/rideOffers/{offerId}')
  .onCreate(async (snapshot, context) => {
    if (!NOTIFICATION_CATEGORIES.includes('rideshare')) return null;

    const offer = snapshot.data() || {};
    const teamId = String(context.params?.teamId || '').trim();
    const gameId = String(context.params?.gameId || '').trim();
    const actorUid = String(offer.driverUserId || '').trim() || null;
    if (!teamId || !gameId) return null;

    const [gameSnap, parentUserIds] = await Promise.all([
      firestore.doc(`teams/${teamId}/games/${gameId}`).get(),
      getTeamParentUserIds(teamId)
    ]);
    const recipientUserIds = parentUserIds.filter((uid) => uid && uid !== actorUid);
    if (!recipientUserIds.length) return null;

    const targets = await getParentNotificationTargetsForTeam(teamId, 'rideshare', recipientUserIds, actorUid);
    if (!targets.length) return null;

    const game = gameSnap.exists ? (gameSnap.data() || {}) : {};
    const payload = buildRideOfferNotificationPayload(game, offer);
    return sendDirectTargetsNotification({
      targets,
      category: 'rideshare',
      title: payload.title,
      body: payload.body,
      teamId,
      gameId,
      eventId: gameId,
      timeSensitive: isRideshareTimeSensitive(game)
    });
  });

exports.notifyRideOfferCreated = notifyRideOfferCreated;

const notifyRideClaimCreated = functions.firestore
  .document('teams/{teamId}/games/{gameId}/rideOffers/{offerId}/requests/{requestId}')
  .onCreate(async (snapshot, context) => {
    return sendRideClaimNotification(snapshot.data() || {}, context);
  });

exports.notifyRideClaimCreated = notifyRideClaimCreated;

const notifyRideClaimUpdated = functions.firestore
  .document('teams/{teamId}/games/{gameId}/rideOffers/{offerId}/requests/{requestId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    if (!shouldNotifyRideClaimUpdate(before, after)) return null;
    return sendRideClaimNotification(after, context);
  });

exports.notifyRideClaimUpdated = notifyRideClaimUpdated;

const notifyRideOfferCancelled = functions.firestore
  .document('teams/{teamId}/games/{gameId}/rideOffers/{offerId}')
  .onUpdate(async (change, context) => {
    if (!NOTIFICATION_CATEGORIES.includes('rideshare')) return null;

    const before = change.before.data() || {};
    const after = change.after.data() || {};
    const beforeStatus = normalizeRideOfferNotificationStatus(before.status);
    const afterStatus = normalizeRideOfferNotificationStatus(after.status);
    if (beforeStatus === 'cancelled' || afterStatus !== 'cancelled') return null;

    const teamId = String(context.params?.teamId || '').trim();
    const gameId = String(context.params?.gameId || '').trim();
    const offerId = String(context.params?.offerId || '').trim();
    if (!teamId || !gameId || !offerId) return null;

    const [requestsSnap, gameSnap] = await Promise.all([
      firestore.collection(`teams/${teamId}/games/${gameId}/rideOffers/${offerId}/requests`).get(),
      firestore.doc(`teams/${teamId}/games/${gameId}`).get()
    ]);
    const claimantUserIds = Array.from(new Set(requestsSnap.docs
      .map((docSnap) => docSnap.data() || {})
      .filter((request) => !['declined', 'cancelled'].includes(String(request.status || '').trim().toLowerCase()))
      .map((request) => String(request.parentUserId || '').trim())
      .filter(Boolean)));
    if (!claimantUserIds.length) return null;

    const actorUid = String(after.driverUserId || before.driverUserId || '').trim() || null;
    const targets = await getTargetsForCategoryUserIds(teamId, 'rideshare', claimantUserIds, actorUid);
    if (!targets.length) return null;

    const game = gameSnap.exists ? (gameSnap.data() || {}) : {};
    const payload = buildRideOfferCancelledNotificationPayload(game);
    return sendDirectTargetsNotification({
      targets,
      category: 'rideshare',
      title: payload.title,
      body: payload.body,
      teamId,
      gameId,
      eventId: gameId,
      timeSensitive: isRideshareTimeSensitive(game)
    });
  });

exports.notifyRideOfferCancelled = notifyRideOfferCancelled;

exports.syncApprovedParentMembershipRequestUserLink = functions.firestore
  .document('teams/{teamId}/membershipRequests/{requestId}')
  .onUpdate(async (change, context) => {
    const beforeData = change.before.data() || {};
    const afterData = change.after.data() || {};
    if (String(afterData.status || '').trim().toLowerCase() !== 'approved') return null;
    if (String(beforeData.status || '').trim().toLowerCase() === 'approved') return null;

    const teamId = String(context.params?.teamId || '').trim();
    const playerId = String(afterData.playerId || '').trim();
    const requesterUserId = String(afterData.requesterUserId || '').trim();
    if (!teamId || !playerId || !requesterUserId) return null;

    const teamRef = firestore.doc(`teams/${teamId}`);
    const playerRef = firestore.doc(`teams/${teamId}/players/${playerId}`);
    const userRef = firestore.doc(`users/${requesterUserId}`);
    const publicProfileRef = firestore.doc(`publicUserProfiles/${requesterUserId}`);
    let requesterAuthEmail = null;
    try {
      const requesterAuthRecord = await admin.auth().getUser(requesterUserId);
      requesterAuthEmail = requesterAuthRecord.email || null;
    } catch (error) {
      console.warn('Could not load requester auth email for public profile projection', {
        requesterUserId,
        message: error?.message || String(error)
      });
    }

    await firestore.runTransaction(async (transaction) => {
      const [teamSnap, playerSnap, userSnap] = await Promise.all([
        transaction.get(teamRef),
        transaction.get(playerRef),
        transaction.get(userRef)
      ]);
      if (!teamSnap.exists || !playerSnap.exists) {
        return;
      }

      const userData = userSnap.exists ? (userSnap.data() || {}) : {};
      const team = { id: teamSnap.id, ...(teamSnap.data() || {}) };
      const player = { id: playerSnap.id, ...(playerSnap.data() || {}) };
      const userUpdate = buildApprovedParentMembershipUserUpdate({
        userData,
        requestData: afterData,
        team,
        player
      });
      const nextUserData = { ...userData, ...userUpdate };

      transaction.set(userRef, {
        ...userUpdate,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      transaction.set(
        publicProfileRef,
        buildTrustedPublicUserProfileProjectionPayload(nextUserData, {
          trustedEmail: requesterAuthEmail
        }),
        { merge: true }
      );
    });

    return null;
  });

exports.notifyParentMembershipRequestCreated = functions.firestore
  .document('teams/{teamId}/membershipRequests/{requestId}')
  .onCreate(async (snapshot, context) => {
    const data = snapshot.data() || {};
    if (!NOTIFICATION_CATEGORIES.includes('access')) return null;

    const teamId = String(context.params?.teamId || '').trim();
    if (!teamId) return null;

    const staffTargets = await getStaffTargetsForAccess(teamId, String(data.requesterUserId || '').trim() || null);
    if (!staffTargets.length) return null;

    const destination = buildStaffAccessRequestNotificationDestination({ teamId });
    const requesterName = String(data.requesterName || data.requesterEmail || 'A parent').trim() || 'A parent';
    const playerName = String(data.playerName || 'a player').trim() || 'a player';

    await sendDirectTargetsNotification({
      targets: staffTargets,
      category: 'access',
      title: `Access request: ${requesterName} for ${playerName}`,
      body: `${requesterName} requested ${String(data.relation || 'parent').trim() || 'parent'} access for ${playerName}.`,
      teamId,
      eventId: String(context.params?.requestId || '').trim() || null,
      linkOverride: destination.link,
      appRouteOverride: destination.appRoute
    });
    return null;
  });

exports.notifyParentMembershipRequestUpdated = functions.firestore
  .document('teams/{teamId}/membershipRequests/{requestId}')
  .onUpdate(async (change, context) => {
    const beforeData = change.before.data() || {};
    const afterData = change.after.data() || {};
    if (!NOTIFICATION_CATEGORIES.includes('access')) return null;

    const teamId = String(context.params?.teamId || '').trim();
    const requesterUserId = String(afterData.requesterUserId || '').trim();
    const beforeStatus = normalizeAccessNotificationStatus(beforeData.status);
    const afterStatus = normalizeAccessNotificationStatus(afterData.status);
    if (!teamId || !requesterUserId || beforeStatus === afterStatus) return null;
    if (!['approved', 'denied'].includes(afterStatus)) return null;

    const requesterTargets = await getTargetsForCategoryUserIds(teamId, 'access', [requesterUserId]);
    if (!requesterTargets.length) return null;

    const teamSnap = await firestore.doc(`teams/${teamId}`).get();
    const teamName = String(teamSnap.exists ? (teamSnap.data()?.name || '') : '').trim() || 'your team';
    const destination = buildTeamNotificationDestination({ teamId });

    await sendDirectTargetsNotification({
      targets: requesterTargets,
      category: 'access',
      title: afterStatus === 'approved'
        ? `You now have access to ${teamName}`
        : `Access request declined for ${teamName}`,
      body: afterStatus === 'approved'
        ? `${String(afterData.playerName || 'Your player').trim() || 'Your player'} is now linked in your account.`
        : `Your request for ${String(afterData.playerName || 'this player').trim() || 'this player'} was declined.`,
      teamId,
      eventId: String(context.params?.requestId || '').trim() || null,
      linkOverride: destination.link,
      appRouteOverride: destination.appRoute
    });
    return null;
  });

exports.notifyRegistrationSubmitted = functions.firestore
  .document('teams/{teamId}/registrationForms/{formId}/registrations/{registrationId}')
  .onCreate(async (snapshot, context) => {
    const data = snapshot.data() || {};
    if (!NOTIFICATION_CATEGORIES.includes('access')) return null;

    const teamId = String(context.params?.teamId || '').trim();
    const formId = String(context.params?.formId || '').trim();
    if (!teamId || !formId) return null;

    const staffTargets = await getStaffTargetsForAccess(teamId, null);
    if (!staffTargets.length) return null;

    const participantName = getRegistrationParticipantName(data);
    const programName = getRegistrationProgramName(data);
    const destination = buildRegistrationReviewNotificationDestination({ teamId, formId });

    await sendDirectTargetsNotification({
      targets: staffTargets,
      category: 'access',
      title: `Registration submitted: ${participantName}`,
      body: `${participantName} submitted ${programName}.`,
      teamId,
      eventId: String(context.params?.registrationId || '').trim() || null,
      linkOverride: destination.link,
      appRouteOverride: destination.appRoute
    });
    return null;
  });

exports.notifyRegistrationStatusChanged = functions.firestore
  .document('teams/{teamId}/registrationForms/{formId}/registrations/{registrationId}')
  .onUpdate(async (change, context) => {
    const beforeData = change.before.data() || {};
    const afterData = change.after.data() || {};
    if (!NOTIFICATION_CATEGORIES.includes('access')) return null;

    const teamId = String(context.params?.teamId || '').trim();
    const formId = String(context.params?.formId || '').trim();
    const registrationId = String(context.params?.registrationId || '').trim();
    const beforeStatus = normalizeAccessNotificationStatus(beforeData.status);
    const afterStatus = normalizeAccessNotificationStatus(afterData.status);
    if (!teamId || !formId || !registrationId || beforeStatus === afterStatus) return null;

    const participantName = getRegistrationParticipantName(afterData);
    const programName = getRegistrationProgramName(afterData);

    if (afterStatus === 'approved') {
      return sendRegistrationStatusNotification({
        teamId,
        formId,
        registrationId,
        registration: afterData,
        title: `Registration approved: ${participantName}`,
        body: `${participantName} is approved for ${programName}.`
      });
    }

    if (afterStatus === 'denied') {
      return sendRegistrationStatusNotification({
        teamId,
        formId,
        registrationId,
        registration: afterData,
        title: `Registration declined: ${participantName}`,
        body: `${participantName}'s ${programName} application was declined.`
      });
    }

    if (beforeStatus === 'waitlisted' && afterStatus === 'offer-extended') {
      return sendRegistrationStatusNotification({
        teamId,
        formId,
        registrationId,
        registration: afterData,
        title: `Spot available: ${participantName}`,
        body: `${programName} has an available spot for ${participantName}.`
      });
    }

    return null;
  });

exports.notifyInviteRedeemed = functions.firestore
  .document('accessCodes/{codeId}')
  .onUpdate(async (change, context) => {
    const beforeData = change.before.data() || {};
    const afterData = change.after.data() || {};
    if (!NOTIFICATION_CATEGORIES.includes('access')) return null;

    if (beforeData.used === true || afterData.used !== true) return null;

    const inviteType = String(afterData.type || '').trim();
    if (!['parent_invite', 'admin_invite'].includes(inviteType)) return null;

    const teamId = String(afterData.teamId || '').trim();
    const inviterUid = String(afterData.generatedBy || '').trim();
    if (!teamId || !inviterUid) return null;

    const inviteTargets = (await getTargetsForCategory(teamId, 'access', null, {}, [{ uid: inviterUid, roles: ['staff'] }]))
      .filter((target) => target.uid === inviterUid);
    if (!inviteTargets.length) return null;

    const usedByUid = String(afterData.usedBy || '').trim();
    const usedBySnap = usedByUid ? await firestore.doc(`users/${usedByUid}`).get() : null;
    const usedByData = usedBySnap?.exists ? (usedBySnap.data() || {}) : {};
    const inviteeName = String(
      usedByData.displayName
      || usedByData.fullName
      || usedByData.name
      || usedByData.email
      || afterData.email
      || 'A user'
    ).trim() || 'A user';
    const destination = buildTeamNotificationDestination({ teamId });

    await sendDirectTargetsNotification({
      targets: inviteTargets,
      category: 'access',
      title: `${inviteeName} accepted your invite`,
      body: inviteType === 'admin_invite'
        ? `${inviteeName} now has staff access to the team.`
        : `${inviteeName} joined the team as a parent contact.`,
      teamId,
      eventId: String(context.params?.codeId || '').trim() || null,
      linkOverride: destination.link,
      appRouteOverride: destination.appRoute
    });
    return null;
  });

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
          teamId,
          batchId,
          recipientId
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

    const { teamId, batchId, recipientId } = context.params;
    const payerUserIds = await resolveFeeAssignmentPayerUserIds(teamId, data);
    if (!payerUserIds.length) return null;

    const payerTargets = await getTargetsForCategoryUserIds(teamId, 'fees', payerUserIds, null);
    if (!payerTargets.length) return null;

    const targetUserIds = Array.from(new Set(payerTargets.map((target) => String(target.uid || '').trim()).filter(Boolean)));
    const claimResults = await Promise.all(targetUserIds.map(async (uid) => ({
      uid,
      claimed: await claimFeeAssignmentNotificationUser({ teamId, batchId, recipientId, uid })
    })));
    const claimedUserIds = new Set(claimResults.filter((result) => result.claimed).map((result) => result.uid));
    if (!claimedUserIds.size) return null;
    const claimedPayerTargets = payerTargets.filter((target) => claimedUserIds.has(target.uid));
    try {
      const sendResults = [];
      for (const uid of claimedUserIds) {
        const claimedTargets = claimedPayerTargets;
        const targetsForUser = claimedTargets.filter((target) => String(target.uid || '').trim() === uid);
        if (!targetsForUser.length) continue;
        const recipientsForUser = await resolveFeeAssignmentRecipientsForUser({
          teamId,
          batchId,
          uid,
          recipientId,
          fallbackRecipient: data
        });
        if (recipientsForUser.length <= 1) {
          const data = recipientsForUser[0] || {};
          const title = String(data.feeTitle || data.title || 'Team fee').trim();
          const amountCents = getTeamFeeBalanceCents(data) || Number(data.amountCents || data.feeAmountCents || 0);
          const amountDisplay = amountCents > 0 ? ` (${formatMoneyFromCents(amountCents, data.currency || 'USD')})` : '';
          sendResults.push(await sendDirectTargetsNotification({
            targets: targetsForUser,
            category: 'fees',
            title: `New fee assigned: ${title}${amountDisplay}`,
            body: buildFeeAssignmentNotificationBody(data, amountDisplay ? amountDisplay.slice(2, -1) : ''),
            teamId,
            batchId
          }));
          continue;
        }
        const payload = buildCombinedFeeAssignmentNotificationPayload(recipientsForUser);
        sendResults.push(await sendDirectTargetsNotification({
          targets: targetsForUser,
          category: 'fees',
          title: payload.title,
          body: payload.body,
          teamId,
          batchId
        }));
      }
      return combineDirectNotificationResults(sendResults);
    } catch (error) {
      await releaseFeeAssignmentNotificationClaims({
        teamId,
        batchId,
        userIds: Array.from(claimedUserIds)
      });
      throw error;
    }
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
  const origin = req.headers.origin;
  if (isAllowedPublicRsvpOrigin(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Firebase-AppCheck');
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

function buildRsvpReminderPushPayload(event) {
  const eventTitle = getEventTitle(event || {});
  return {
    title: 'RSVP reminder',
    body: truncateNotificationBody(`${eventTitle} needs your availability. Tap to RSVP.`)
  };
}

function getScheduleNotificationChildId(event = {}) {
  return String(event.childId || event.playerId || event.recipientId || '').trim() || null;
}

async function sendRsvpReminderPushNotifications({ teamId, gameId, event = {}, recipientUserIds = [], recipientTargets = [] } = {}) {
  if (!teamId || !gameId) {
    return { successCount: 0, failureCount: 0, targetCount: 0 };
  }

  const payload = buildRsvpReminderPushPayload(event);
  const childIdByRecipientGroup = new Map();
  (Array.isArray(recipientTargets) ? recipientTargets : []).forEach((target) => {
    const userId = String(target?.userId || '').trim();
    const childId = String(target?.childId || '').trim();
    if (!userId || !childId) return;
    const groupUserIds = childIdByRecipientGroup.get(childId) || [];
    if (!groupUserIds.includes(userId)) {
      groupUserIds.push(userId);
      childIdByRecipientGroup.set(childId, groupUserIds);
    }
  });

  if (childIdByRecipientGroup.size > 0) {
    let successCount = 0;
    let failureCount = 0;
    let targetCount = 0;

    for (const [childId, userIds] of childIdByRecipientGroup.entries()) {
      const targets = await getTargetsForCategoryUserIds(teamId, 'rsvp', userIds);
      if (!targets.length) continue;
      const sendResult = await sendDirectTargetsNotification({
        targets,
        category: 'rsvp',
        title: payload.title,
        body: payload.body,
        teamId,
        gameId,
        eventId: gameId,
        childId
      });
      successCount += Number(sendResult?.successCount || 0);
      failureCount += Number(sendResult?.failureCount || 0);
      targetCount += targets.length;
    }

    return { successCount, failureCount, targetCount };
  }

  const targets = await getTargetsForCategoryUserIds(teamId, 'rsvp', recipientUserIds);
  if (!targets.length) {
    return { successCount: 0, failureCount: 0, targetCount: 0 };
  }

  const sendResult = await sendDirectTargetsNotification({
    targets,
    category: 'rsvp',
    title: payload.title,
    body: payload.body,
    teamId,
    gameId,
    eventId: gameId,
    childId: getScheduleNotificationChildId(event)
  });

  return {
    successCount: Number(sendResult?.successCount || 0),
    failureCount: Number(sendResult?.failureCount || 0),
    targetCount: targets.length
  };
}

function getPublicRsvpResponseSortMs(rsvp, docSnap) {
  const updateTime = coercePublicRsvpDate(docSnap?.updateTime);
  if (updateTime) return updateTime.getTime();
  const respondedAt = coercePublicRsvpDate(rsvp?.respondedAt || rsvp?.updatedAt || rsvp?.createdAt);
  return respondedAt ? respondedAt.getTime() : 0;
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
  summary.total = activePlayerIds.size;
  summary.notRespondedPlayerIds = Array.from(activePlayerIds)
    .filter((playerId) => !responsesByPlayerId.has(playerId));
  return summary;
}

function getPublicRsvpSummaryPlayerStateRef(teamId, gameId, playerId) {
  return firestore.doc(`teams/${teamId}/games/${gameId}/rsvpSummaryPlayers/${playerId}`);
}

function getPublicRsvpSummaryStateRef(teamId, gameId) {
  return firestore.doc(`publicRsvpSummaryStates/${teamId}__${gameId}`);
}

function getPublicRsvpSnapshotUpdateMillis(docSnap) {
  if (!docSnap?.exists) return null;
  if (typeof docSnap.updateTime?.toMillis === 'function') return docSnap.updateTime.toMillis();
  return null;
}

async function tryApplyPublicRsvpSummaryDelta({ jobId, teamId, gameId, playerId, response }) {
  const gameRef = firestore.doc(`teams/${teamId}/games/${gameId}`);
  const playerStateRef = getPublicRsvpSummaryPlayerStateRef(teamId, gameId, playerId);
  const summaryStateRef = getPublicRsvpSummaryStateRef(teamId, gameId);
  return firestore.runTransaction(async (transaction) => {
    const [gameSnap, playerStateSnap, summaryStateSnap] = await Promise.all([
      transaction.get(gameRef),
      transaction.get(playerStateRef),
      transaction.get(summaryStateRef)
    ]);
    const playerState = playerStateSnap.exists ? (playerStateSnap.data() || {}) : {};
    const summaryState = summaryStateSnap.exists ? (summaryStateSnap.data() || {}) : {};
    const plan = buildPublicRsvpSummaryJobPlan({
      jobId,
      response,
      playerState,
      summary: {
        ...(gameSnap.data()?.rsvpSummary || {}),
        notRespondedPlayerIds: summaryState.notRespondedPlayerIds
      },
      playerId
    });
    if (plan.mode === 'obsolete' || plan.mode === 'already_applied') return true;
    if (!gameSnap.exists) return false;
    if (plan.mode !== 'delta') return false;
    transaction.set(gameRef, {
      rsvpSummary: buildPublicRsvpSummaryProjection(plan.summary)
    }, { mergeFields: ['rsvpSummary'] });
    transaction.set(summaryStateRef, {
      notRespondedPlayerIds: plan.summary.notRespondedPlayerIds,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.set(playerStateRef, {
      appliedJobId: jobId,
      appliedResponse: response,
      appliedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return true;
  });
}

async function persistRecomputedPublicRsvpSummary(input, summary) {
  const gameRef = firestore.doc(`teams/${input.teamId}/games/${input.gameId}`);
  const playerStateRef = getPublicRsvpSummaryPlayerStateRef(input.teamId, input.gameId, input.playerId);
  const summaryStateRef = getPublicRsvpSummaryStateRef(input.teamId, input.gameId);
  return firestore.runTransaction(async (transaction) => {
    const [playerStateSnap, summaryStateSnap] = await Promise.all([
      transaction.get(playerStateRef),
      transaction.get(summaryStateRef)
    ]);
    const playerState = playerStateSnap.exists ? (playerStateSnap.data() || {}) : {};
    if (!shouldPersistRecomputedPublicRsvpSummary({
      jobId: input.jobId,
      playerState,
      baselineStateUpdateMillis: input.summaryStateUpdateMillis,
      currentStateUpdateMillis: getPublicRsvpSnapshotUpdateMillis(summaryStateSnap)
    })) return false;
    transaction.set(gameRef, {
      rsvpSummary: buildPublicRsvpSummaryProjection(summary)
    }, { mergeFields: ['rsvpSummary'] });
    transaction.set(summaryStateRef, {
      notRespondedPlayerIds: summary.notRespondedPlayerIds,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.set(playerStateRef, {
      appliedJobId: input.jobId,
      appliedResponse: input.response,
      appliedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    return true;
  });
}

async function processPublicRsvpSummaryRefresh(input) {
  const summaryStateRef = getPublicRsvpSummaryStateRef(input.teamId, input.gameId);
  return refreshPublicRsvpSummary({
    tryApplyDelta: () => tryApplyPublicRsvpSummaryDelta(input),
    recomputeSummary: async () => {
      const summaryStateSnap = await summaryStateRef.get();
      return {
        summaryStateUpdateMillis: getPublicRsvpSnapshotUpdateMillis(summaryStateSnap),
        summary: await buildPublicRsvpSummary(input.teamId, input.gameId)
      };
    },
    persistSummary: ({ summaryStateUpdateMillis, summary }) => persistRecomputedPublicRsvpSummary({
      ...input,
      summaryStateUpdateMillis
    }, summary)
  });
}

exports.processPublicRsvpSummaryRefreshJob = functions.firestore
  .document('publicRsvpSummaryRefreshJobs/{jobId}')
  .onCreate(async (jobSnap, context) => {
    const data = jobSnap.data() || {};
    const input = {
      jobId: context.params.jobId,
      teamId: normalizePublicRsvpText(data.teamId),
      gameId: normalizePublicRsvpText(data.gameId),
      playerId: normalizePublicRsvpText(data.playerId),
      response: normalizePublicRsvpResponse(data.response)
    };
    if (!input.teamId || !input.gameId || !input.playerId || !input.response) {
      console.error('Discarding invalid public RSVP summary refresh job:', context.params.jobId);
      await jobSnap.ref.delete();
      return null;
    }
    await processPublicRsvpSummaryRefresh(input);
    await jobSnap.ref.delete();
    return null;
  });

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
  const remindedPlayerIds = new Set();
  const recipientUserIds = new Set();
  const recipientTargets = [];

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
      remindedPlayerIds.add(String(player.id || '').trim());
      if (contact.userId) {
        recipientUserIds.add(contact.userId);
        recipientTargets.push({
          userId: contact.userId,
          childId: player.id
        });
      }
    });
  });

  if (batchWriteCount > 0) {
    batches.push(batch);
  }
  for (const publicRsvpEmailBatch of batches) {
    await publicRsvpEmailBatch.commit();
  }
  return {
    sentCount,
    linkCount,
    playerIds: Array.from(remindedPlayerIds).filter(Boolean),
    recipientUserIds: Array.from(recipientUserIds).filter(Boolean),
    recipientTargets,
    recipientCount: recipientUserIds.size
  };
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
    let rsvpPushResult = { successCount: 0, failureCount: 0, targetCount: 0 };
    let rsvpPushError = null;
    try {
      rsvpPushResult = await sendRsvpReminderPushNotifications({
        teamId,
        gameId,
        event: eventRecord.data,
        recipientTargets: result.recipientTargets,
        recipientUserIds: result.recipientUserIds
      });
    } catch (pushError) {
      rsvpPushError = pushError;
      console.error('Failed to send staff-triggered RSVP reminder push notifications', { teamId, gameId, error: pushError });
    }
    res.status(200).json({
      ok: true,
      ...result,
      rsvpPushSuccessCount: rsvpPushResult.successCount,
      rsvpPushFailureCount: rsvpPushResult.failureCount,
      rsvpPushTargetCount: rsvpPushResult.targetCount,
      rsvpPushError: rsvpPushError?.message || null
    });
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
    const jobRef = firestore.collection('publicRsvpSummaryRefreshJobs').doc();
    const playerStateRef = getPublicRsvpSummaryPlayerStateRef(tokenData.teamId, tokenData.gameId, tokenData.playerId);
    const summaryStateRef = getPublicRsvpSummaryStateRef(tokenData.teamId, tokenData.gameId);
    const batch = firestore.batch();
    batch.set(firestore.doc(`teams/${tokenData.teamId}/games/${tokenData.gameId}/rsvps/${docId}`), {
      userId: docId,
      displayName: tokenData.parentName || tokenData.parentEmail || 'Parent RSVP',
      playerIds: [tokenData.playerId],
      response,
      note: null,
      publicRsvp: true,
      parentEmail: tokenData.parentEmail || null,
      respondedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    batch.set(firestore.doc(`publicRsvpTokens/${tokenHash}`), {
      lastSubmittedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastResponse: response
    }, { merge: true });
    batch.set(playerStateRef, {
      latestJobId: jobRef.id,
      latestResponse: response,
      queuedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    batch.set(summaryStateRef, {
      latestQueuedJobId: jobRef.id,
      latestQueuedPlayerId: tokenData.playerId,
      queuedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    batch.set(jobRef, {
      teamId: tokenData.teamId,
      gameId: tokenData.gameId,
      playerId: tokenData.playerId,
      response,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await batch.commit();
    res.status(200).json({ ok: true, context: buildPublicRsvpContext(records), summary: null });
  } catch (error) {
    publicRsvpJsonError(res, 403, error?.message || 'Unable to submit RSVP.');
  }
});

exports.collectTelemetry = functions
  .runWith({ timeoutSeconds: 15, memory: '256MB' })
  .https
  .onRequest(async (req, res) => {
    writeTelemetryCorsHeaders(req, res);

    if (!isAllowedTelemetryOrigin(req.headers.origin, allowedOriginSet)) {
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
const TEAM_EMAIL_ATTACHMENT_LIMIT_COUNT = 10;

function normalizeTeamEmailAttachmentRecord(attachment) {
  const name = String(attachment?.name || attachment?.fileName || '').trim();
  const storagePath = String(attachment?.storagePath || attachment?.path || '').trim();
  if (!name || name.length > 240 || !storagePath || storagePath.length > 1024) return null;
  return { name, storagePath };
}

function isTeamEmailAttachmentPathForTeam(teamId, storagePath) {
  const cleanTeamId = String(teamId || '').trim();
  const parts = String(storagePath || '').trim().split('/');
  return parts.length >= 5 &&
    parts[0] === 'team-email-attachments' &&
    parts[1] === cleanTeamId &&
    parts.slice(2).every(Boolean);
}

async function normalizeTeamEmailAttachmentsForDelivery(teamId, attachments) {
  const rawAttachments = Array.isArray(attachments) ? attachments : [];
  if (rawAttachments.length > TEAM_EMAIL_ATTACHMENT_LIMIT_COUNT) {
    throw new Error('Team email is limited to 10 attachments.');
  }
  const normalized = rawAttachments.map(normalizeTeamEmailAttachmentRecord).filter(Boolean);
  if (normalized.length !== rawAttachments.length ||
      normalized.some((attachment) => !isTeamEmailAttachmentPathForTeam(teamId, attachment.storagePath))) {
    throw new Error('Team email attachments must reference files for the same team.');
  }
  const bucket = admin.storage().bucket();
  const verified = await Promise.all(normalized.map(async (attachment) => {
    const [objectMetadata] = await bucket.file(attachment.storagePath).getMetadata();
    return buildVerifiedTeamEmailAttachmentRecord(attachment, objectMetadata);
  }));
  const totalBytes = verified.reduce((sum, attachment) => sum + attachment.size, 0);
  if (totalBytes > TEAM_EMAIL_ATTACHMENT_LIMIT_BYTES) {
    throw new Error('Team email attachments exceed the 20 MB limit.');
  }
  return { attachments: verified, totalBytes };
}

// Public sports opportunity board. Public responses are serialized through an
// explicit allow-list; Firestore rules deny direct client access to the source
// documents because they also contain author and recipient identifiers.
function throwOpportunityError(code, message, details = {}) {
  throw new functions.https.HttpsError(code, message, details);
}

function assertOpportunityRateLimit(checker, context, key = '') {
  const requestIp = getRequestIp(context?.rawRequest || {});
  const rateLimit = checker({ ip: `${key || 'public'}|${requestIp}` });
  if (!rateLimit.allowed) {
    throwOpportunityError('resource-exhausted', 'Too many requests. Please wait a few minutes and try again.', {
      retryAfterSeconds: rateLimit.retryAfterSeconds
    });
  }
}

function requireOpportunityAuth(context, { verified = false } = {}) {
  if (!context.auth?.uid) {
    throwOpportunityError('unauthenticated', 'Sign in to continue.');
  }
  if (verified && context.auth.token?.email_verified !== true) {
    throwOpportunityError('failed-precondition', 'Verify your email before publishing a public opportunity.');
  }
  return context.auth.uid;
}

async function getOpportunityCaller(context, options = {}) {
  const uid = requireOpportunityAuth(context, options);
  const userSnap = await firestore.doc(`users/${uid}`).get();
  return {
    uid,
    email: String(context.auth.token?.email || userSnap.data()?.email || '').trim().toLowerCase(),
    user: userSnap.exists ? userSnap.data() || {} : {}
  };
}

function isOpportunityPlatformAdmin(caller) {
  return caller?.user?.isAdmin === true;
}

exports.checkAcceptedFriendMessageAccess = functions.https.onCall(
  createCheckAcceptedFriendMessageAccessHandler({
    firestore,
    HttpsError: functions.https.HttpsError
  })
);

function normalizeDirectChatId(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized.includes('/') || normalized.length > 200) {
    throwOpportunityError('invalid-argument', `Invalid ${label}.`);
  }
  return normalized;
}

function normalizeDirectChatUserId(value) {
  const normalized = String(value || '').trim();
  const userId = normalized.toLowerCase().startsWith('user:') ? normalized.slice(5).trim() : normalized;
  return /^[A-Za-z0-9_-]{1,160}$/.test(userId) ? userId : '';
}

function getDirectChatUserIds(conversation) {
  const participantIds = Array.isArray(conversation?.participantIds) ? conversation.participantIds : [];
  const directUserIds = Array.from(new Set(participantIds.map(normalizeDirectChatUserId).filter(Boolean))).sort();
  const storedDirectUserIds = Array.from(new Set((Array.isArray(conversation?.directUserIds) ? conversation.directUserIds : [])
    .map(normalizeDirectChatUserId)
    .filter(Boolean)))
    .sort();
  if (conversation?.type !== 'direct' || participantIds.length !== 2 || directUserIds.length !== 2 ||
      storedDirectUserIds.length !== 2 || directUserIds.join('|') !== storedDirectUserIds.join('|')) {
    throwOpportunityError('failed-precondition', 'This direct conversation is not authorized for messaging.');
  }
  return directUserIds;
}

function normalizeAuthorizedDirectAttachment(rawAttachment, { teamId, conversationId, uid, now }) {
  const attachment = rawAttachment && typeof rawAttachment === 'object' ? rawAttachment : {};
  const rawType = String(attachment.type || '').trim().toLowerCase();
  const rawMimeType = String(attachment.mimeType || '').trim().toLowerCase();
  const mediaMimeType = rawMimeType || (rawType.includes('/') ? rawType : '');
  const type = rawType === 'video' || rawType.startsWith('video/') || rawMimeType.startsWith('video/')
    ? 'video'
    : rawType === 'image' || rawType.startsWith('image/') || rawMimeType.startsWith('image/')
      ? 'image'
      : '';
  const url = String(attachment.url || '').trim();
  const path = String(attachment.path || '').trim();
  const name = cleanOpportunityText(attachment.name, 240) || null;
  const mimeType = cleanOpportunityText(mediaMimeType, 160) || null;
  const size = Number(attachment.size);
  let allowedUrl = false;
  try {
    const parsedUrl = new URL(url);
    allowedUrl = parsedUrl.protocol === 'https:' && [
      'firebasestorage.googleapis.com',
      'storage.googleapis.com'
    ].includes(parsedUrl.hostname);
  } catch {
    allowedUrl = false;
  }
  const scopedFallbackPrefix = `stat-sheets/team-chat/${teamId}/${conversationId}/${uid}/`;
  const allowedPath = path.startsWith(scopedFallbackPrefix) || (
    /^(team-photos|team-videos)\//.test(path) &&
    path.includes(`_chat_${teamId}_`) &&
    path.includes(`_${uid}_`)
  );
  if (!type || !allowedUrl || !allowedPath || !Number.isFinite(size) || size <= 0 || size > 5 * 1024 * 1024) {
    throwOpportunityError('invalid-argument', 'Direct-message attachments must be valid team chat uploads of 5 MB or less.');
  }
  return {
    type,
    url,
    path,
    // Thumbnails are generated client-side and are not needed by the current
    // chat renderer. Do not persist an independently supplied URL here.
    thumbnailUrl: null,
    name,
    mimeType,
    size,
    uploadedAt: now
  };
}

exports.sendAuthorizedDirectMessage = functions.https.onCall(async (data, context = {}) => {
  const caller = await getOpportunityCaller(context);
  assertOpportunityRateLimit(checkPublicOpportunityMessageRateLimit, context, `direct-message:${caller.uid}`);
  const teamId = normalizeDirectChatId(data?.teamId, 'team');
  const conversationId = normalizeDirectChatId(data?.conversationId, 'conversation');
  const conversationRef = firestore.doc(`teams/${teamId}/chatConversations/${conversationId}`);
  const [teamSnap, conversationSnap] = await Promise.all([
    firestore.doc(`teams/${teamId}`).get(),
    conversationRef.get()
  ]);
  if (!teamSnap.exists || !conversationSnap.exists) {
    throwOpportunityError('not-found', 'Direct conversation not found.');
  }
  const team = teamSnap.data() || {};
  const conversation = conversationSnap.data() || {};
  const directUserIds = getDirectChatUserIds(conversation);
  if (!directUserIds.includes(caller.uid)) {
    throwOpportunityError('permission-denied', 'You are not a participant in this direct conversation.');
  }
  const recipientId = directUserIds.find((userId) => userId !== caller.uid);
  const recipientSnap = await firestore.doc(`users/${recipientId}`).get();
  const recipient = recipientSnap.exists ? recipientSnap.data() || {} : {};
  let recipientEmail = String(recipient.email || recipient.profileEmail || '').trim().toLowerCase();
  if (!recipientEmail) {
    try {
      const recipientAuthRecord = await admin.auth().getUser(recipientId);
      recipientEmail = String(recipientAuthRecord?.email || '').trim().toLowerCase();
    } catch (error) {
      console.warn('Unable to resolve direct-message recipient auth email', recipientId, error);
    }
  }
  const teamWithId = { ...team, id: teamId };
  const callerHasAccess = hasCurrentTeamAccess({
    team: teamWithId,
    user: caller.user,
    userId: caller.uid,
    email: caller.email
  });
  const recipientHasAccess = hasCurrentTeamAccess({
    team: teamWithId,
    user: recipient,
    userId: recipientId,
    email: recipientEmail
  });
  if (!callerHasAccess || !recipientHasAccess) {
    throwOpportunityError('permission-denied', 'Both participants must still have access to this team.');
  }
  if (conversation.directAccess === 'accepted_friend') {
    const friendshipId = directUserIds.join('__');
    if (conversation.friendshipId !== friendshipId) {
      throwOpportunityError('permission-denied', 'This friend conversation is no longer authorized.');
    }
    const friendshipSnap = await firestore.doc(`friendships/${friendshipId}`).get();
    if (!friendshipSnap.exists || !canMessageAcceptedFriendForTeam({
      friendship: friendshipSnap.data() || {},
      team,
      sender: caller.user,
      recipient,
      senderId: caller.uid,
      recipientId,
      teamId,
      senderEmail: caller.email
    })) {
      throwOpportunityError('permission-denied', 'This friend connection is no longer authorized for direct messages.');
    }
  } else if (conversation.directAccess === 'team_admin') {
    const initiatorId = String(conversation.initiatedBy || '');
    const initiator = initiatorId === caller.uid ? caller.user : initiatorId === recipientId ? recipient : null;
    const initiatorEmail = initiatorId === caller.uid
      ? caller.email
      : recipientEmail;
    if (!initiator || !hasTeamAdminAccess({
      team,
      user: initiator,
      uid: initiatorId,
      email: initiatorEmail
    })) {
      throwOpportunityError('permission-denied', 'The team administrator who started this conversation no longer has access.');
    }
  } else {
    throwOpportunityError('permission-denied', 'This direct conversation is not authorized.');
  }

  const rawText = String(data?.text || '');
  if (rawText.length > 10000) {
    throwOpportunityError('invalid-argument', 'Direct messages must be 10,000 characters or fewer.');
  }
  const text = rawText.trim();
  const rawAttachments = Array.isArray(data?.attachments) ? data.attachments : [];
  if (rawAttachments.length > 10 || (!text && rawAttachments.length === 0)) {
    throwOpportunityError('invalid-argument', 'Write a message or attach up to 10 photos or videos.');
  }
  const now = admin.firestore.Timestamp.now();
  const attachments = rawAttachments.map((attachment) => normalizeAuthorizedDirectAttachment(attachment, {
    teamId,
    conversationId,
    uid: caller.uid,
    now
  }));
  const requestedClientMessageId = String(data?.clientMessageId || '').trim();
  const clientMessageId = requestedClientMessageId
    ? requestedClientMessageId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120)
    : '';
  if (requestedClientMessageId && requestedClientMessageId !== clientMessageId) {
    throwOpportunityError('invalid-argument', 'Invalid direct-message request ID.');
  }
  const messageRef = clientMessageId
    // Namespace idempotency keys by sender so one participant cannot replace
    // the other participant's message by guessing a client request ID.
    ? conversationRef.collection('chatMessages').doc(`${caller.uid}__${clientMessageId}`)
    : conversationRef.collection('chatMessages').doc();
  const senderName = cleanOpportunityText(
    caller.user?.fullName || caller.user?.displayName || context.auth?.token?.name,
    160
  ) || null;
  const recipientParticipantIds = conversation.participantIds.filter(
    (participantId) => normalizeDirectChatUserId(participantId) !== caller.uid
  );
  const message = {
    clientMessageId: clientMessageId || null,
    text,
    senderId: caller.uid,
    senderName,
    senderEmail: caller.email || null,
    senderPhotoUrl: cleanOpportunityText(caller.user?.photoUrl, 1000) || null,
    attachments,
    imageUrl: null,
    imagePath: null,
    imageName: null,
    imageType: null,
    imageSize: null,
    createdAt: now,
    editedAt: null,
    deleted: false,
    ai: false,
    aiName: null,
    aiQuestion: null,
    aiMeta: null,
    targetType: 'individuals',
    recipientIds: recipientParticipantIds,
    targetRole: null,
    conversationId
  };
  const batch = firestore.batch();
  // A caller-provided request ID is an idempotency key, not an edit handle.
  // `create` keeps retries from overwriting or undeleting the original message
  // through this Admin SDK path, while the batch preserves the conversation
  // metadata update atomically for the first successful send.
  batch.create(messageRef, message);
  batch.update(conversationRef, { lastMessageAt: now, updatedAt: now });
  try {
    await batch.commit();
  } catch (error) {
    if (!clientMessageId || !isAlreadyExistsError(error)) throw error;
    const existingSnap = await messageRef.get();
    const existingMessage = existingSnap.exists ? existingSnap.data() || {} : {};
    if (
      !existingSnap.exists ||
      existingMessage.senderId !== caller.uid ||
      existingMessage.clientMessageId !== clientMessageId ||
      existingMessage.conversationId !== conversationId
    ) {
      throw error;
    }
    const existingCreatedAt = existingMessage.createdAt?.toDate?.();
    return {
      id: messageRef.id,
      createdAt: existingCreatedAt instanceof Date && Number.isFinite(existingCreatedAt.getTime())
        ? existingCreatedAt.toISOString()
        : null
    };
  }
  return { id: messageRef.id, createdAt: now.toDate().toISOString() };
});

function encodeOpportunityCursor(docSnap) {
  if (!docSnap) return null;
  return Buffer.from(JSON.stringify({
    expiresAt: docSnap.data()?.expiresAt?.toMillis?.() || 0,
    createdAt: docSnap.data()?.createdAt?.toMillis?.() || 0,
    id: docSnap.id
  }), 'utf8').toString('base64url');
}

function decodeOpportunityCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!parsed.id || !Number.isFinite(Number(parsed.expiresAt)) || !Number.isFinite(Number(parsed.createdAt))) return null;
    return {
      id: String(parsed.id),
      expiresAt: admin.firestore.Timestamp.fromMillis(Number(parsed.expiresAt)),
      createdAt: admin.firestore.Timestamp.fromMillis(Number(parsed.createdAt))
    };
  } catch {
    return null;
  }
}

function encodeOpportunityInquiryCursor(docSnap) {
  if (!docSnap) return null;
  return Buffer.from(JSON.stringify({
    updatedAt: docSnap.data()?.updatedAt?.toMillis?.() || 0,
    id: docSnap.id
  }), 'utf8').toString('base64url');
}

function decodeOpportunityInquiryCursor(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8'));
    if (!parsed.id || !Number.isFinite(Number(parsed.updatedAt))) return null;
    return {
      id: String(parsed.id),
      updatedAt: admin.firestore.Timestamp.fromMillis(Number(parsed.updatedAt))
    };
  } catch {
    return null;
  }
}

function serializeOpportunityMessage(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    authorId: String(data.authorId || ''),
    authorName: cleanOpportunityText(data.authorName, 100) || 'ALL PLAYS member',
    body: cleanOpportunityText(data.body, 1500),
    createdAt: data.createdAt?.toDate?.().toISOString?.() || null
  };
}

function serializeOpportunityInquiry(docSnap, messages = []) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    listingId: String(data.listingId || ''),
    listingTitle: cleanOpportunityText(data.listingTitle, 100),
    listingKind: String(data.listingKind || ''),
    teamId: String(data.teamId || '') || null,
    participantIds: Array.isArray(data.participantIds) ? data.participantIds.map(String) : [],
    status: data.status === 'closed' ? 'closed' : 'open',
    createdAt: data.createdAt?.toDate?.().toISOString?.() || null,
    updatedAt: data.updatedAt?.toDate?.().toISOString?.() || null,
    lastMessagePreview: cleanOpportunityText(data.lastMessagePreview, 180),
    lastMessageAuthorName: cleanOpportunityText(data.lastMessageAuthorName, 100),
    messages
  };
}

async function requireOpportunityListing(listingId) {
  let normalizedId;
  try {
    normalizedId = normalizeFirestoreId(listingId, 'listingId');
  } catch (error) {
    throwOpportunityError('invalid-argument', error.message);
  }
  const listingRef = firestore.doc(`publicOpportunities/${normalizedId}`);
  const listingSnap = await listingRef.get();
  if (!listingSnap.exists) throwOpportunityError('not-found', 'Opportunity not found.');
  return { listingRef, listingSnap, listing: listingSnap.data() || {} };
}

function normalizeOpportunityTeamId(teamId) {
  try {
    return normalizeFirestoreId(teamId, 'teamId');
  } catch (error) {
    throwOpportunityError('invalid-argument', error.message);
  }
}

async function canManageOpportunity(caller, listing) {
  if (isOpportunityPlatformAdmin(caller) || listing.authorId === caller.uid) return true;
  if (!listing.teamId) return false;
  const teamSnap = await firestore.doc(`teams/${normalizeOpportunityTeamId(listing.teamId)}`).get();
  return teamSnap.exists && hasTeamAdminAccess({
    team: teamSnap.data() || {},
    user: caller.user,
    uid: caller.uid,
    email: caller.email
  });
}

async function resolveOpportunityTeam(input, caller) {
  if (input.kind === 'player_seeking_team') return null;
  const teamSnap = await firestore.doc(`teams/${normalizeOpportunityTeamId(input.teamId)}`).get();
  if (!teamSnap.exists) throwOpportunityError('not-found', 'Team not found.');
  const team = teamSnap.data() || {};
  if (!isOpportunityTeamDiscoverable(team)) {
    throwOpportunityError('failed-precondition', 'Only active public teams can publish public opportunities.');
  }
  if (!hasTeamAdminAccess({ team, user: caller.user, uid: caller.uid, email: caller.email })) {
    throwOpportunityError('permission-denied', 'Only a team owner or admin can publish for this team.');
  }
  return { id: teamSnap.id, ...team };
}

async function listOpportunityManagedTeamDocuments(caller) {
  const queries = [firestore.collection('teams').where('ownerId', '==', caller.uid).get()];
  if (caller.email) queries.push(firestore.collection('teams').where('adminEmails', 'array-contains', caller.email).get());
  const snapshots = await Promise.all(queries);
  const teams = new Map();
  snapshots.forEach((snapshot) => snapshot.docs.forEach((docSnap) => teams.set(docSnap.id, docSnap)));
  return teams;
}

exports.listPublicOpportunities = functions.https.onCall(async (data, context = {}) => {
  assertOpportunityRateLimit(checkPublicOpportunityBrowseRateLimit, context, 'list');
  const filters = normalizeOpportunityFilters(data?.filters || {});
  const requestedPageSize = Number(data?.pageSize || 24);
  const pageSize = Math.min(40, Math.max(1, Number.isFinite(requestedPageSize) ? requestedPageSize : 24));
  const cursor = decodeOpportunityCursor(data?.cursor);
  const now = admin.firestore.Timestamp.now();
  let baseQuery = firestore.collection('publicOpportunities')
    .where('status', '==', 'active')
    .where('expiresAt', '>', now)
    .orderBy('expiresAt', 'desc')
    .orderBy('createdAt', 'desc')
    .orderBy(admin.firestore.FieldPath.documentId(), 'desc');
  if (cursor) baseQuery = baseQuery.startAfter(cursor.expiresAt, cursor.createdAt, cursor.id);

  const items = [];
  const maxScanDocuments = 500;
  const scanBatchSize = 100;
  let scannedDocuments = 0;
  let lastScanned = null;
  let exhausted = false;
  let stoppedBeforeEndOfScan = false;
  while (items.length < pageSize && !exhausted && scannedDocuments < maxScanDocuments) {
    const currentBatchSize = Math.min(scanBatchSize, maxScanDocuments - scannedDocuments);
    let scanQuery = baseQuery.limit(currentBatchSize);
    if (lastScanned) {
      scanQuery = firestore.collection('publicOpportunities')
        .where('status', '==', 'active')
        .where('expiresAt', '>', now)
        .orderBy('expiresAt', 'desc')
        .orderBy('createdAt', 'desc')
        .orderBy(admin.firestore.FieldPath.documentId(), 'desc')
        .startAfter(lastScanned.data().expiresAt, lastScanned.data().createdAt, lastScanned.id)
        .limit(currentBatchSize);
    }
    const scan = await scanQuery.get();
    scannedDocuments += scan.size;
    exhausted = scan.size < currentBatchSize;
    for (let index = 0; index < scan.docs.length; index += 1) {
      const docSnap = scan.docs[index];
      lastScanned = docSnap;
      const listing = docSnap.data() || {};
      if (matchesOpportunityFilters(listing, filters)) {
        items.push(serializePublicOpportunity(docSnap.id, listing));
        if (items.length >= pageSize) {
          stoppedBeforeEndOfScan = index < scan.docs.length - 1;
          break;
        }
      }
    }
  }

  return {
    items,
    nextCursor: (stoppedBeforeEndOfScan || !exhausted) && lastScanned ? encodeOpportunityCursor(lastScanned) : null
  };
});

exports.getPublicOpportunity = functions.https.onCall(async (data, context = {}) => {
  assertOpportunityRateLimit(checkPublicOpportunityBrowseRateLimit, context, 'get');
  const { listingSnap, listing } = await requireOpportunityListing(data?.listingId);
  if (getEffectiveOpportunityStatus(listing) !== 'active') {
    if (!context.auth?.uid) throwOpportunityError('not-found', 'Opportunity not found.');
    const caller = await getOpportunityCaller(context);
    if (!(await canManageOpportunity(caller, listing))) {
      throwOpportunityError('not-found', 'Opportunity not found.');
    }
  }
  return { item: serializePublicOpportunity(listingSnap.id, listing) };
});

exports.createPublicOpportunity = functions.https.onCall(async (data, context = {}) => {
  const uid = requireOpportunityAuth(context, { verified: true });
  assertOpportunityRateLimit(checkPublicOpportunityWriteRateLimit, context, `create:${uid}`);
  let input;
  try {
    input = normalizeOpportunityInput(data || {});
  } catch (error) {
    throwOpportunityError('invalid-argument', error.message || 'Invalid opportunity.');
  }
  const caller = await getOpportunityCaller(context);
  const team = await resolveOpportunityTeam(input, caller);
  const now = admin.firestore.Timestamp.now();
  const listingRef = firestore.collection('publicOpportunities').doc();
  const record = {
    ...input,
    guardianAttested: input.kind === 'player_seeking_team' ? true : false,
    teamId: team?.id || null,
    teamName: team ? cleanOpportunityText(team.name, 100) : null,
    teamPhotoUrl: team ? cleanOpportunityText(team.photoUrl, 1000) || null : null,
    authorId: uid,
    recipientUserIds: [uid],
    status: 'active',
    createdAt: now,
    updatedAt: now,
    expiresAt: admin.firestore.Timestamp.fromDate(buildOpportunityExpiry(now.toMillis()))
  };
  await listingRef.set(record);
  return { item: serializePublicOpportunity(listingRef.id, record) };
});

exports.updatePublicOpportunity = functions.https.onCall(async (data, context = {}) => {
  const uid = requireOpportunityAuth(context, { verified: true });
  assertOpportunityRateLimit(checkPublicOpportunityWriteRateLimit, context, `update:${uid}`);
  const caller = await getOpportunityCaller(context);
  const { listingRef, listingSnap, listing } = await requireOpportunityListing(data?.listingId);
  if (!(await canManageOpportunity(caller, listing))) throwOpportunityError('permission-denied', 'You cannot edit this opportunity.');
  let input;
  try {
    input = normalizeOpportunityInput({ ...(data?.input || {}), kind: listing.kind, teamId: listing.teamId, guardianAttested: listing.guardianAttested });
  } catch (error) {
    throwOpportunityError('invalid-argument', error.message || 'Invalid opportunity.');
  }
  const team = await resolveOpportunityTeam(input, caller);
  const update = {
    ...input,
    teamName: team ? cleanOpportunityText(team.name, 100) : null,
    teamPhotoUrl: team ? cleanOpportunityText(team.photoUrl, 1000) || null : null,
    updatedAt: admin.firestore.Timestamp.now()
  };
  await listingRef.update(update);
  return { item: serializePublicOpportunity(listingSnap.id, { ...listing, ...update }) };
});

async function setOpportunityLifecycleStatus(data, context, mode) {
  const uid = requireOpportunityAuth(context, { verified: true });
  assertOpportunityRateLimit(checkPublicOpportunityWriteRateLimit, context, `${mode}:${uid}`);
  const caller = await getOpportunityCaller(context);
  const { listingRef, listingSnap, listing } = await requireOpportunityListing(data?.listingId);
  if (!(await canManageOpportunity(caller, listing))) throwOpportunityError('permission-denied', 'You cannot manage this opportunity.');
  if (listing.status === 'removed') {
    throwOpportunityError('failed-precondition', 'A moderated listing can only be restored by a platform admin.');
  }
  if (mode === 'renew' && listing.kind !== 'player_seeking_team') {
    await resolveOpportunityTeam({ kind: listing.kind, teamId: listing.teamId }, caller);
  }
  const now = admin.firestore.Timestamp.now();
  const update = mode === 'renew'
    ? { status: 'active', expiresAt: admin.firestore.Timestamp.fromDate(buildOpportunityExpiry(now.toMillis())), updatedAt: now }
    : { status: 'closed', closedAt: now, updatedAt: now };
  await listingRef.update(update);
  return { item: serializePublicOpportunity(listingSnap.id, { ...listing, ...update }) };
}

exports.closePublicOpportunity = functions.https.onCall((data, context) => setOpportunityLifecycleStatus(data, context, 'close'));
exports.renewPublicOpportunity = functions.https.onCall((data, context) => setOpportunityLifecycleStatus(data, context, 'renew'));

exports.listMyPublicOpportunities = functions.https.onCall(async (data, context = {}) => {
  const caller = await getOpportunityCaller(context);
  const [authoredSnap, managedTeams] = await Promise.all([
    firestore.collection('publicOpportunities')
      .where('authorId', '==', caller.uid)
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get(),
    listOpportunityManagedTeamDocuments(caller)
  ]);
  const managedTeamIds = Array.from(managedTeams.keys());
  const managedListingQueries = [];
  for (let index = 0; index < managedTeamIds.length; index += 30) {
    managedListingQueries.push(firestore.collection('publicOpportunities')
      .where('teamId', 'in', managedTeamIds.slice(index, index + 30))
    .orderBy('createdAt', 'desc')
      .limit(100)
      .get());
  }
  const managedListingSnaps = await Promise.all(managedListingQueries);
  const listings = new Map();
  authoredSnap.docs.forEach((docSnap) => listings.set(docSnap.id, docSnap));
  managedListingSnaps.forEach((snap) => snap.docs.forEach((docSnap) => listings.set(docSnap.id, docSnap)));
  const docs = Array.from(listings.values())
    .sort((left, right) => (right.data()?.createdAt?.toMillis?.() || 0) - (left.data()?.createdAt?.toMillis?.() || 0))
    .slice(0, 100);
  return { items: docs.map((docSnap) => serializePublicOpportunity(docSnap.id, docSnap.data() || {})) };
});

exports.listManagedPublicOpportunityTeams = functions.https.onCall(async (_data, context = {}) => {
  const caller = await getOpportunityCaller(context);
  const managedTeams = await listOpportunityManagedTeamDocuments(caller);
  const teams = new Map();
  managedTeams.forEach((docSnap) => {
    const team = docSnap.data() || {};
    if (!isOpportunityTeamDiscoverable(team)) return;
    teams.set(docSnap.id, {
      id: docSnap.id,
      name: cleanOpportunityText(team.name, 100),
      sport: cleanOpportunityText(team.sport, 60),
      city: cleanOpportunityText(team.city, 80),
      state: cleanOpportunityText(team.state, 40),
      zip: cleanOpportunityText(team.zip, 10),
      ageGroup: cleanOpportunityText(team.ageGroup || team.age || team.teamAgeGroup, 40),
      competitiveLevel: cleanOpportunityText(team.competitiveLevel || team.level, 60),
      division: cleanOpportunityText(team.division || team.divisionName, 60),
      availability: cleanOpportunityText(team.opportunityAvailability || team.availability, 240)
    });
  });
  return { items: Array.from(teams.values()).sort((a, b) => a.name.localeCompare(b.name)) };
});

exports.getPublicTeamProfile = functions.https.onCall(async (data, context = {}) => {
  assertOpportunityRateLimit(checkPublicOpportunityBrowseRateLimit, context, 'team-profile');
  let teamId;
  try {
    teamId = normalizeFirestoreId(data?.teamId, 'teamId');
  } catch (error) {
    throwOpportunityError('invalid-argument', error.message);
  }
  const teamSnap = await firestore.doc(`teams/${teamId}`).get();
  const team = teamSnap.data() || {};
  if (!teamSnap.exists || !isOpportunityTeamDiscoverable(team)) {
    throwOpportunityError('not-found', 'Public team not found.');
  }
  return {
    item: {
      id: teamSnap.id,
      name: cleanOpportunityText(team.name, 100),
      sport: cleanOpportunityText(team.sport, 60) || null,
      description: cleanOpportunityText(team.description, 1000) || null,
      photoUrl: cleanOpportunityText(team.photoUrl, 1000) || null,
      city: cleanOpportunityText(team.city, 80) || null,
      state: cleanOpportunityText(team.state, 40) || null,
      zip: cleanOpportunityText(team.zip, 10) || null
    }
  };
});

exports.reportPublicOpportunity = functions.https.onCall(async (data, context = {}) => {
  const uid = requireOpportunityAuth(context);
  assertOpportunityRateLimit(checkPublicOpportunityWriteRateLimit, context, `report:${uid}`);
  const { listingSnap, listing } = await requireOpportunityListing(data?.listingId);
  if (listing.status === 'removed') throwOpportunityError('not-found', 'Opportunity not found.');
  const reason = cleanOpportunityText(data?.reason, 500);
  if (!reason) throwOpportunityError('invalid-argument', 'Choose or enter a report reason.');
  await firestore.doc(`publicOpportunityReports/${listingSnap.id}_${uid}`).set({
    listingId: listingSnap.id,
    listingTitle: cleanOpportunityText(listing.title, 100),
    reporterId: uid,
    reason,
    status: 'open',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  return { success: true };
});

async function resolveOpportunityRecipients(listing) {
  const recipients = new Set();
  if (listing.teamId) {
    const teamSnap = await firestore.doc(`teams/${normalizeOpportunityTeamId(listing.teamId)}`).get();
    if (teamSnap.exists) {
      const team = teamSnap.data() || {};
      if (team.ownerId) recipients.add(String(team.ownerId));
      (await getUserIdsByEmails(team.adminEmails || [])).forEach((uid) => recipients.add(uid));
    }
  } else if (listing.authorId) {
    recipients.add(String(listing.authorId));
  }
  return Array.from(recipients).filter(Boolean);
}

exports.createOpportunityInquiry = functions.https.onCall(async (data, context = {}) => {
  const uid = requireOpportunityAuth(context, { verified: true });
  assertOpportunityRateLimit(checkPublicOpportunityMessageRateLimit, context, `inquiry:${uid}`);
  const body = cleanOpportunityText(data?.message, 1500);
  if (!body) throwOpportunityError('invalid-argument', 'Write a message first.');
  const { listingSnap, listing } = await requireOpportunityListing(data?.listingId);
  if (getEffectiveOpportunityStatus(listing) !== 'active') throwOpportunityError('failed-precondition', 'This opportunity is no longer accepting inquiries.');
  if (listing.authorId === uid) throwOpportunityError('failed-precondition', 'You cannot inquire about your own listing.');
  const recipients = (await resolveOpportunityRecipients(listing)).filter((recipientId) => recipientId !== uid);
  if (!recipients.length) throwOpportunityError('failed-precondition', 'This listing does not have an available recipient.');
  const callerName = cleanOpportunityText(context.auth.token?.name || context.auth.token?.email, 100) || 'ALL PLAYS member';
  const inquiryRef = firestore.collection('opportunityInquiries').doc();
  const messageRef = inquiryRef.collection('messages').doc();
  const now = admin.firestore.Timestamp.now();
  const participantIds = Array.from(new Set([uid, ...recipients]));
  const inquiry = {
    listingId: listingSnap.id,
    listingTitle: cleanOpportunityText(listing.title, 100),
    listingKind: listing.kind,
    teamId: listing.teamId || null,
    senderId: uid,
    recipientUserIds: recipients,
    participantIds,
    status: 'open',
    lastMessagePreview: body,
    lastMessageAuthorName: callerName,
    createdAt: now,
    updatedAt: now
  };
  const batch = firestore.batch();
  batch.set(inquiryRef, inquiry);
  batch.set(messageRef, { authorId: uid, authorName: callerName, body, createdAt: now });
  await batch.commit();
  await writeNotificationInboxRecords({
    targets: recipients.map((recipientId) => ({ uid: recipientId })),
    category: 'opportunities',
    title: 'New opportunity inquiry',
    body: `${callerName} asked about ${inquiry.listingTitle}.`,
    appRoute: `/messages?inquiry=${encodeURIComponent(inquiryRef.id)}`,
    teamId: listing.teamId || null,
    conversationId: inquiryRef.id
  });
  return { inquiry: serializeOpportunityInquiry({ id: inquiryRef.id, data: () => inquiry }, [
    { id: messageRef.id, authorId: uid, authorName: callerName, body, createdAt: now.toDate().toISOString() }
  ]) };
});

async function canAccessOpportunityInquiry(caller, inquiry) {
  if (isOpportunityPlatformAdmin(caller) || inquiry.senderId === caller.uid) return true;
  if (!inquiry.teamId) {
    return Array.isArray(inquiry.participantIds) && inquiry.participantIds.includes(caller.uid);
  }
  const teamSnap = await firestore.doc(`teams/${normalizeOpportunityTeamId(inquiry.teamId)}`).get();
  return teamSnap.exists && hasTeamAdminAccess({
    team: teamSnap.data() || {},
    user: caller.user,
    uid: caller.uid,
    email: caller.email
  });
}

async function requireOpportunityInquiry(inquiryId, caller) {
  let normalizedId;
  try {
    normalizedId = normalizeFirestoreId(inquiryId, 'inquiryId');
  } catch (error) {
    throwOpportunityError('invalid-argument', error.message);
  }
  const ref = firestore.doc(`opportunityInquiries/${normalizedId}`);
  const snap = await ref.get();
  if (!snap.exists) throwOpportunityError('not-found', 'Inquiry not found.');
  const inquiry = snap.data() || {};
  if (!await canAccessOpportunityInquiry(caller, inquiry)) {
    throwOpportunityError('permission-denied', 'You cannot access this inquiry.');
  }
  return { ref, snap, inquiry };
}

exports.listOpportunityInquiries = functions.https.onCall(async (data, context = {}) => {
  const caller = await getOpportunityCaller(context);
  const cursor = decodeOpportunityInquiryCursor(data?.cursor);
  const maxScanDocuments = 500;
  const collectionRef = firestore.collection('opportunityInquiries');
  const managedTeams = isOpportunityPlatformAdmin(caller)
    ? new Map()
    : await listOpportunityManagedTeamDocuments(caller);
  const queryBuilders = [];
  if (isOpportunityPlatformAdmin(caller)) {
    queryBuilders.push(() => collectionRef);
  } else {
    queryBuilders.push(() => collectionRef.where('participantIds', 'array-contains', caller.uid));
    const managedTeamIds = Array.from(managedTeams.keys());
    for (let index = 0; index < managedTeamIds.length; index += 30) {
      const teamIds = managedTeamIds.slice(index, index + 30);
      queryBuilders.push(() => collectionRef.where('teamId', 'in', teamIds));
    }
  }
  const snapshots = await Promise.all(queryBuilders.map(async (buildQuery) => {
    let query = buildQuery()
      .orderBy('updatedAt', 'desc')
      .orderBy(admin.firestore.FieldPath.documentId(), 'desc');
    if (cursor) query = query.startAfter(cursor.updatedAt, cursor.id);
    return query.limit(maxScanDocuments).get();
  }));
  const docsById = new Map();
  snapshots.forEach((snapshot) => snapshot.docs.forEach((docSnap) => docsById.set(docSnap.id, docSnap)));
  const candidates = Array.from(docsById.values()).sort((left, right) => {
    const timeDifference = (right.data()?.updatedAt?.toMillis?.() || 0) - (left.data()?.updatedAt?.toMillis?.() || 0);
    return timeDifference || right.id.localeCompare(left.id);
  });
  const scanned = candidates.slice(0, maxScanDocuments);
  const access = await Promise.all(scanned.map((docSnap) => canAccessOpportunityInquiry(caller, docSnap.data() || {})));
  const items = [];
  let lastScanned = null;
  for (let index = 0; index < scanned.length; index += 1) {
    lastScanned = scanned[index];
    if (access[index]) items.push(serializeOpportunityInquiry(scanned[index]));
    if (items.length >= 50) break;
  }
  const lastScannedIndex = lastScanned ? scanned.findIndex((docSnap) => docSnap.id === lastScanned.id) : -1;
  const sourceMayHaveMore = snapshots.some((snapshot) => snapshot.size >= maxScanDocuments);
  const hasMore = lastScanned && (
    lastScannedIndex < candidates.length - 1 ||
    sourceMayHaveMore
  );
  return {
    items,
    nextCursor: hasMore ? encodeOpportunityInquiryCursor(lastScanned) : null
  };
});

exports.getOpportunityInquiry = functions.https.onCall(async (data, context = {}) => {
  const caller = await getOpportunityCaller(context);
  const { snap } = await requireOpportunityInquiry(data?.inquiryId, caller);
  const messagesSnap = await snap.ref.collection('messages').orderBy('createdAt', 'asc').limit(200).get();
  return { inquiry: serializeOpportunityInquiry(snap, messagesSnap.docs.map(serializeOpportunityMessage)) };
});

exports.replyToOpportunityInquiry = functions.https.onCall(async (data, context = {}) => {
  const caller = await getOpportunityCaller(context, { verified: true });
  const { uid } = caller;
  assertOpportunityRateLimit(checkPublicOpportunityMessageRateLimit, context, `reply:${uid}`);
  const body = cleanOpportunityText(data?.message, 1500);
  if (!body) throwOpportunityError('invalid-argument', 'Write a message first.');
  const { ref, inquiry } = await requireOpportunityInquiry(data?.inquiryId, caller);
  if (inquiry.status === 'closed') throwOpportunityError('failed-precondition', 'This inquiry is closed.');
  const authorName = cleanOpportunityText(context.auth.token?.name || context.auth.token?.email, 100) || 'ALL PLAYS member';
  const messageRef = ref.collection('messages').doc();
  const now = admin.firestore.Timestamp.now();
  const batch = firestore.batch();
  batch.set(messageRef, { authorId: uid, authorName, body, createdAt: now });
  batch.update(ref, { updatedAt: now, lastMessagePreview: body, lastMessageAuthorName: authorName });
  await batch.commit();
  const currentTeamRecipients = inquiry.teamId
    ? new Set(await resolveOpportunityRecipients(inquiry))
    : null;
  const recipients = (inquiry.participantIds || []).filter((participantId) =>
    participantId !== uid &&
    (!currentTeamRecipients || participantId === inquiry.senderId || currentTeamRecipients.has(participantId))
  );
  await writeNotificationInboxRecords({
    targets: recipients.map((recipientId) => ({ uid: recipientId })),
    category: 'opportunities',
    title: 'Opportunity inquiry reply',
    body: `${authorName} replied about ${inquiry.listingTitle || 'an opportunity'}.`,
    appRoute: `/messages?inquiry=${encodeURIComponent(ref.id)}`,
    teamId: inquiry.teamId || null,
    conversationId: ref.id
  });
  return { success: true };
});

exports.listPublicOpportunityReports = functions.https.onCall(async (_data, context = {}) => {
  const caller = await getOpportunityCaller(context);
  if (!isOpportunityPlatformAdmin(caller)) throwOpportunityError('permission-denied', 'Platform admin access is required.');
  const snap = await firestore.collection('publicOpportunityReports').where('status', '==', 'open').limit(100).get();
  return {
    items: snap.docs.map((docSnap) => {
      const report = docSnap.data() || {};
      return {
        id: docSnap.id,
        listingId: String(report.listingId || ''),
        listingTitle: cleanOpportunityText(report.listingTitle, 100),
        reason: cleanOpportunityText(report.reason, 500),
        createdAt: report.createdAt?.toDate?.().toISOString?.() || null
      };
    })
  };
});

exports.moderatePublicOpportunity = functions.https.onCall(async (data, context = {}) => {
  const caller = await getOpportunityCaller(context);
  if (!isOpportunityPlatformAdmin(caller)) throwOpportunityError('permission-denied', 'Platform admin access is required.');
  const action = data?.action === 'restore' ? 'restore' : data?.action === 'remove' ? 'remove' : '';
  if (!action) throwOpportunityError('invalid-argument', 'Choose remove or restore.');
  const { listingRef, listing } = await requireOpportunityListing(data?.listingId);
  const restoringRemovedListing = action === 'restore' && listing.status === 'removed';
  if (restoringRemovedListing && listing.kind !== 'player_seeking_team') {
    const teamSnap = await firestore.doc(`teams/${normalizeOpportunityTeamId(listing.teamId)}`).get();
    const team = teamSnap.data() || {};
    if (!teamSnap.exists || !isOpportunityTeamDiscoverable(team)) {
      throwOpportunityError('failed-precondition', 'The linked team must be active and public before this listing can be restored.');
    }
  }
  const now = admin.firestore.Timestamp.now();
  const update = action === 'remove'
    ? { status: 'removed', moderatedBy: caller.uid, moderatedAt: now, updatedAt: now }
    : restoringRemovedListing
      ? { status: 'active', expiresAt: admin.firestore.Timestamp.fromDate(buildOpportunityExpiry(now.toMillis())), moderatedBy: caller.uid, moderatedAt: now, updatedAt: now }
      : { moderatedBy: caller.uid, moderatedAt: now, updatedAt: now };
  await listingRef.update(update);
  const reportsSnap = await firestore.collection('publicOpportunityReports').where('listingId', '==', listingRef.id).limit(100).get();
  const batch = firestore.batch();
  reportsSnap.docs.forEach((reportSnap) => batch.update(reportSnap.ref, { status: 'resolved', resolution: action, updatedAt: now }));
  if (!reportsSnap.empty) await batch.commit();
  return { success: true };
});

exports.closePublicOpportunitiesForPrivateTeam = functions.firestore
  .document('teams/{teamId}')
  .onWrite(async (change, context) => {
    const before = change.before.exists ? change.before.data() || {} : null;
    const after = change.after.exists ? change.after.data() || {} : null;
    const wasDiscoverable = isOpportunityTeamDiscoverable(before);
    const isDiscoverable = isOpportunityTeamDiscoverable(after);
    if (!wasDiscoverable || isDiscoverable) return null;

    const now = admin.firestore.Timestamp.now();
    while (true) {
      const activeListings = await firestore.collection('publicOpportunities')
        .where('teamId', '==', context.params.teamId)
        .where('status', '==', 'active')
        .limit(400)
        .get();
      if (activeListings.empty) break;
      const batch = firestore.batch();
      activeListings.docs.forEach((docSnap) => batch.update(docSnap.ref, {
        status: 'closed',
        closedReason: 'team_not_public',
        closedAt: now,
        updatedAt: now
      }));
      await batch.commit();
    }
    return null;
  });
