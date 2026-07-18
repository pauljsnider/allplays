const VERIFIED_EMAIL_POLICY_PATH = 'securityPolicies/verifiedEmail';
const DEFAULT_POLICY_CACHE_TTL_MS = 30_000;
const VALID_MODES = new Set(['disabled', 'observe', 'enforce']);

function normalizeMode(value, fallback = 'observe') {
  const normalized = String(value || '').trim().toLowerCase();
  return VALID_MODES.has(normalized) ? normalized : fallback;
}

function normalizePolicy(data = {}) {
  const exemptUserIds = Array.isArray(data.exemptUserIds)
    ? [...new Set(data.exemptUserIds
      .map((value) => String(value || '').trim())
      .filter((value) => value && !value.includes('/')))]
      .slice(0, 1000)
    : [];
  return {
    mode: normalizeMode(data.mode, 'observe'),
    exemptUserIds
  };
}

function getEffectiveMode(configuredMode, policyMode) {
  // A deploy-time enforce setting is a fail-closed backstop if the policy read
  // is unavailable. The Firestore policy can promote disabled/observe builds,
  // but cannot silently downgrade a build explicitly deployed in enforce mode.
  if (configuredMode === 'enforce' || policyMode === 'enforce') return 'enforce';
  if (configuredMode === 'observe' || policyMode === 'observe') return 'observe';
  return 'disabled';
}

function createVerifiedEmailSensitiveActionGuard({
  firestore,
  HttpsError,
  logger = console,
  configuredMode = process.env.VERIFIED_EMAIL_SENSITIVE_WRITES_MODE || 'observe',
  cacheTtlMs = DEFAULT_POLICY_CACHE_TTL_MS,
  now = () => Date.now()
} = {}) {
  if (!firestore || typeof firestore.doc !== 'function') {
    throw new TypeError('A Firestore instance is required');
  }
  if (typeof HttpsError !== 'function') {
    throw new TypeError('HttpsError is required');
  }

  const deploymentMode = normalizeMode(configuredMode, 'observe');
  const ttlMs = Number.isFinite(Number(cacheTtlMs)) && Number(cacheTtlMs) >= 0
    ? Number(cacheTtlMs)
    : DEFAULT_POLICY_CACHE_TTL_MS;
  let cachedPolicy = null;
  let cacheExpiresAt = 0;

  async function loadPolicy() {
    const currentTime = now();
    if (cachedPolicy && cacheExpiresAt > currentTime) return cachedPolicy;
    try {
      const snapshot = await firestore.doc(VERIFIED_EMAIL_POLICY_PATH).get();
      cachedPolicy = normalizePolicy(snapshot?.exists ? snapshot.data() || {} : {});
      cacheExpiresAt = currentTime + ttlMs;
      return cachedPolicy;
    } catch (error) {
      logger.error?.('verified_email_policy_read_failed', {
        error: error?.message || String(error),
        deploymentMode
      });
      // Preserve the last known policy across transient errors. On cold start,
      // the deploy-time mode remains authoritative and defaults to observation.
      return cachedPolicy || { mode: deploymentMode, exemptUserIds: [] };
    }
  }

  return async function assertSensitiveEmailVerified(context, operation = 'unknown') {
    const uid = String(context?.auth?.uid || '').trim();
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Sign in to continue.');
    }

    const token = context.auth.token || {};
    const email = String(token.email || '').trim();
    if (!email || token.email_verified === true || token.email_verification_exempt === true) {
      return {
        allowed: true,
        mode: deploymentMode,
        verified: !email || token.email_verified === true,
        exempt: token.email_verification_exempt === true,
        reason: !email ? 'no-email-auth' : (token.email_verification_exempt === true ? 'exempt' : 'verified')
      };
    }
    const policy = await loadPolicy();
    const mode = getEffectiveMode(deploymentMode, policy.mode);
    const exempt = policy.exemptUserIds.includes(uid);
    const verified = exempt;

    if (verified || mode === 'disabled') {
      return { allowed: true, mode, verified, exempt, reason: !email ? 'no-email-auth' : (exempt ? 'exempt' : 'verified') };
    }

    logger.warn?.('unverified_email_sensitive_action', {
      operation: String(operation || 'unknown').slice(0, 120),
      uid,
      mode
    });

    if (mode === 'enforce') {
      throw new HttpsError(
        'failed-precondition',
        'Verify your email before completing this action.',
        { reason: 'email-unverified', operation: String(operation || 'unknown').slice(0, 120) }
      );
    }
    return { allowed: true, mode, verified: false, exempt: false, reason: 'observed-unverified' };
  };
}

module.exports = {
  VERIFIED_EMAIL_POLICY_PATH,
  DEFAULT_POLICY_CACHE_TTL_MS,
  normalizeMode,
  normalizePolicy,
  getEffectiveMode,
  createVerifiedEmailSensitiveActionGuard
};
