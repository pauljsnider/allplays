const crypto = require('node:crypto');

const PUBLIC_REGISTRATION_SECURITY_MODES = new Set(['disabled', 'observe', 'enforce']);
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;
const MAX_PUBLIC_REGISTRATION_FIELDS = 20;
const MAX_PUBLIC_REGISTRATION_FIELD_KEY_LENGTH = 128;
const MAX_PUBLIC_REGISTRATION_FIELD_VALUE_LENGTH = 10_000;
const MAX_PUBLIC_REGISTRATION_FIELD_GROUP_BYTES = 64 * 1024;
const MAX_PUBLIC_REGISTRATION_QUANTITY = 20;
const RESERVED_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function normalizePublicRegistrationSecurityMode(value, fallback = 'observe') {
  const normalizedFallback = PUBLIC_REGISTRATION_SECURITY_MODES.has(String(fallback || '').trim().toLowerCase())
    ? String(fallback).trim().toLowerCase()
    : 'observe';
  const normalized = String(value || '').trim().toLowerCase();
  return PUBLIC_REGISTRATION_SECURITY_MODES.has(normalized) ? normalized : normalizedFallback;
}

function getVerifiedAppCheckAppId(context = {}) {
  return typeof context?.app?.appId === 'string' ? context.app.appId.trim() : '';
}

function evaluatePublicRegistrationAppCheck(context = {}, mode = 'observe') {
  const normalizedMode = normalizePublicRegistrationSecurityMode(mode);
  const appId = getVerifiedAppCheckAppId(context);
  return {
    mode: normalizedMode,
    appId,
    verified: Boolean(appId),
    allowed: normalizedMode !== 'enforce' || Boolean(appId)
  };
}

function normalizePublicRegistrationIdempotencyKey(value, label = 'submissionIdempotencyKey') {
  const key = String(value || '').trim();
  if (!key) return '';
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new Error(`${label} is invalid.`);
  }
  return key;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((result, key) => {
    result[key] = canonicalize(value[key]);
    return result;
  }, {});
}

function buildPublicRegistrationSubmissionFingerprint(input = {}) {
  const fingerprintPayload = {
    teamId: String(input.teamId || ''),
    formId: String(input.formId || ''),
    participant: input.participant || {},
    guardian: input.guardian || {},
    waiverAccepted: input.waiverAccepted === true,
    selectedOptionId: String(input.selectedOptionId || ''),
    selectedPaymentPlanId: String(input.selectedPaymentPlanId || ''),
    quantity: Number(input.quantity || 0),
    checkoutAttemptToken: String(input.checkoutAttemptToken || '')
  };
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalize(fingerprintPayload)), 'utf8')
    .digest('hex');
}

function buildPublicRegistrationDocumentId({ teamId, formId, submissionIdempotencyKey } = {}) {
  const key = normalizePublicRegistrationIdempotencyKey(submissionIdempotencyKey);
  if (!key) return '';
  const digest = crypto.createHash('sha256')
    .update([String(teamId || ''), String(formId || ''), key].join('|'), 'utf8')
    .digest('hex');
  return `submission_${digest}`;
}

function normalizeBoundaryPart(value, fallback) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized || fallback;
}

function buildPublicRegistrationRateLimitBoundaries(input = {}, context = {}, options = {}) {
  const operation = normalizeBoundaryPart(options.operation, 'submit');
  const requestIp = normalizeBoundaryPart(options.requestIp, 'unknown');
  const guardianEmail = normalizeBoundaryPart(input.guardian?.email || input.guardian?.guardianEmail, 'no-email');
  const checkoutSubject = normalizeBoundaryPart(
    input.publicCheckoutCapability || input.checkoutAttemptToken || input.submissionIdempotencyKey || input.registrationId,
    'no-subject'
  );
  const subject = operation === 'submit' ? guardianEmail : checkoutSubject;
  const teamId = normalizeBoundaryPart(input.teamId, 'no-team');
  const formId = normalizeBoundaryPart(input.formId, 'no-form');
  const appCheckState = getVerifiedAppCheckAppId(context) ? 'verified-app' : 'unverified-app';

  return {
    subject: ['public-registration', operation, 'subject', teamId, formId, subject, requestIp].join('|'),
    network: ['public-registration', operation, 'network', teamId, formId, requestIp].join('|'),
    form: ['public-registration', operation, 'form', teamId, formId, appCheckState].join('|')
  };
}

function assertPublicRegistrationFieldGroup(values, label) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error(`${label} details are invalid.`);
  }
  const entries = Object.entries(values);
  if (entries.length > MAX_PUBLIC_REGISTRATION_FIELDS) {
    throw new Error(`${label} details contain too many fields.`);
  }

  let totalBytes = 0;
  for (const [key, value] of entries) {
    if (RESERVED_OBJECT_KEYS.has(key) || !key || key.length > MAX_PUBLIC_REGISTRATION_FIELD_KEY_LENGTH) {
      throw new Error(`${label} details contain an invalid field.`);
    }
    if (typeof value !== 'string' || value.length > MAX_PUBLIC_REGISTRATION_FIELD_VALUE_LENGTH) {
      throw new Error(`${label} details contain an invalid value.`);
    }
    totalBytes += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(value, 'utf8');
  }
  if (totalBytes > MAX_PUBLIC_REGISTRATION_FIELD_GROUP_BYTES) {
    throw new Error(`${label} details are too large.`);
  }
}

function assertPublicRegistrationInputLimits(input = {}) {
  assertPublicRegistrationFieldGroup(input.participant || {}, 'Participant');
  assertPublicRegistrationFieldGroup(input.guardian || {}, 'Guardian');
  const quantity = Number(input.quantity);
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_PUBLIC_REGISTRATION_QUANTITY) {
    throw new Error(`Registration quantity must be between 1 and ${MAX_PUBLIC_REGISTRATION_QUANTITY}.`);
  }
  if (String(input.selectedOptionId || '').length > 128) {
    throw new Error('selectedOptionId is invalid.');
  }
}

module.exports = {
  MAX_PUBLIC_REGISTRATION_FIELDS,
  MAX_PUBLIC_REGISTRATION_FIELD_GROUP_BYTES,
  MAX_PUBLIC_REGISTRATION_FIELD_KEY_LENGTH,
  MAX_PUBLIC_REGISTRATION_FIELD_VALUE_LENGTH,
  MAX_PUBLIC_REGISTRATION_QUANTITY,
  assertPublicRegistrationInputLimits,
  buildPublicRegistrationDocumentId,
  buildPublicRegistrationRateLimitBoundaries,
  buildPublicRegistrationSubmissionFingerprint,
  evaluatePublicRegistrationAppCheck,
  getVerifiedAppCheckAppId,
  normalizePublicRegistrationIdempotencyKey,
  normalizePublicRegistrationSecurityMode
};
