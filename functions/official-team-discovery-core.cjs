'use strict';

const DEFAULT_MAX_OFFICIAL_LINK_DOCUMENTS = 200;

function normalizeBoundedId(value) {
  if (typeof value !== 'string') return '';
  const normalized = value.trim();
  return normalized && normalized.length <= 128 && !normalized.includes('/') ? normalized : '';
}

function normalizeOfficialEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase().slice(0, 320) : '';
}

function normalizeOfficialPhone(value) {
  const digits = typeof value === 'string' ? value.replace(/\D/g, '') : '';
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value))];
}

function buildOfficialEmailCandidates(authUser = {}) {
  const rawEmail = typeof authUser.email === 'string' ? authUser.email.trim() : '';
  return uniqueStrings([rawEmail, normalizeOfficialEmail(rawEmail)]).slice(0, 10);
}

function buildOfficialPhoneCandidates(authUser = {}) {
  const rawPhone = typeof authUser.phoneNumber === 'string' ? authUser.phoneNumber.trim() : '';
  const digits = normalizeOfficialPhone(rawPhone);
  if (!digits) return [];

  const candidates = [rawPhone, digits];
  if (digits.length === 10) {
    const area = digits.slice(0, 3);
    const prefix = digits.slice(3, 6);
    const line = digits.slice(6);
    candidates.push(
      `+1${digits}`,
      `${area}-${prefix}-${line}`,
      `${area}.${prefix}.${line}`,
      `${area} ${prefix} ${line}`,
      `(${area}) ${prefix}-${line}`
    );
  }
  return uniqueStrings(candidates).slice(0, 10);
}

function extractOfficialTeamId(docSnapshot) {
  const parts = String(docSnapshot?.ref?.path || '').split('/').filter(Boolean);
  if (parts.length !== 4 || parts[0] !== 'teams' || parts[2] !== 'officials') return '';
  return normalizeBoundedId(parts[1]);
}

function isAuthUserMissing(error) {
  return ['auth/user-not-found', 'user-not-found'].includes(String(error?.code || ''));
}

function createOfficialTeamDiscoveryHandler({
  firestore,
  auth,
  HttpsError,
  maxDocumentsPerQuery = DEFAULT_MAX_OFFICIAL_LINK_DOCUMENTS
}) {
  if (!firestore || !auth || typeof HttpsError !== 'function') {
    throw new Error('Official team discovery dependencies are required.');
  }

  const boundedLimit = Math.max(1, Math.min(Number(maxDocumentsPerQuery) || DEFAULT_MAX_OFFICIAL_LINK_DOCUMENTS, 500));

  async function loadOfficialDocuments(field, values) {
    if (!values.length) return [];
    try {
      let officialsQuery = firestore.collectionGroup('officials');
      officialsQuery = values.length === 1
        ? officialsQuery.where(field, '==', values[0])
        : officialsQuery.where(field, 'in', values);
      const snapshot = await officialsQuery.limit(boundedLimit + 1).get();
      if ((snapshot.size ?? snapshot.docs?.length ?? 0) > boundedLimit) {
        throw new HttpsError(
          'resource-exhausted',
          'Official team discovery is too large to verify completely. Contact support.'
        );
      }
      return Array.isArray(snapshot.docs) ? snapshot.docs : [];
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      throw new HttpsError('unavailable', 'Official team access could not be verified. Try again.');
    }
  }

  return async function listOfficialLinkedTeamIds(_data, context = {}) {
    const uid = normalizeBoundedId(context.auth?.uid);
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to view official assignments.');

    let authUser;
    try {
      authUser = await auth.getUser(uid);
    } catch (error) {
      if (isAuthUserMissing(error)) {
        throw new HttpsError('permission-denied', 'This account is not available.');
      }
      throw new HttpsError('unavailable', 'Account access could not be verified. Try again.');
    }
    if (!authUser || authUser.uid !== uid || authUser.disabled === true) {
      throw new HttpsError('permission-denied', 'This account is not available.');
    }

    const emailCandidates = buildOfficialEmailCandidates(authUser);
    const normalizedEmail = normalizeOfficialEmail(authUser.email);
    const phoneCandidates = buildOfficialPhoneCandidates(authUser);
    const normalizedPhone = normalizeOfficialPhone(authUser.phoneNumber);
    const queryPlans = [
      ['email', emailCandidates],
      ['emailLower', normalizedEmail ? [normalizedEmail] : []],
      ['phone', phoneCandidates],
      ['phoneDigits', normalizedPhone ? [normalizedPhone] : []]
    ].filter(([, values]) => values.length > 0);

    if (!queryPlans.length) {
      return { teamIds: [], teamCount: 0, isPartial: false };
    }

    const snapshots = await Promise.all(
      queryPlans.map(([field, values]) => loadOfficialDocuments(field, values))
    );
    const teamIds = [...new Set(
      snapshots.flat().map(extractOfficialTeamId).filter(Boolean)
    )].sort();

    return {
      teamIds,
      teamCount: teamIds.length,
      isPartial: false
    };
  };
}

module.exports = {
  DEFAULT_MAX_OFFICIAL_LINK_DOCUMENTS,
  buildOfficialEmailCandidates,
  buildOfficialPhoneCandidates,
  createOfficialTeamDiscoveryHandler,
  extractOfficialTeamId,
  normalizeOfficialEmail,
  normalizeOfficialPhone
};
