'use strict';

const UID_MAX_LENGTH = 128;

function normalizeAuthenticatedUid(value) {
  if (typeof value !== 'string') return '';
  const uid = value.trim();
  if (!uid || uid.length > UID_MAX_LENGTH || uid.includes('/')) return '';
  return uid;
}

function createNativeWebAuthTokenHandler({ getAuth, HttpsError }) {
  if (typeof getAuth !== 'function' || typeof HttpsError !== 'function') {
    throw new TypeError('Native WebView auth token dependencies are invalid.');
  }

  return async (_data, context = {}) => {
    const uid = normalizeAuthenticatedUid(context.auth?.uid);
    if (!uid) {
      throw new HttpsError('unauthenticated', 'Sign in again to continue.');
    }

    const auth = getAuth();
    if (!auth || typeof auth.createCustomToken !== 'function') {
      throw new HttpsError('internal', 'Native WebView authentication is unavailable.');
    }

    let customToken;
    try {
      customToken = await auth.createCustomToken(uid);
    } catch {
      throw new HttpsError('unavailable', 'Native WebView authentication could not be refreshed.');
    }
    if (typeof customToken !== 'string' || !customToken.trim()) {
      throw new HttpsError('unavailable', 'Native WebView authentication could not be refreshed.');
    }

    return { customToken };
  };
}

module.exports = {
  createNativeWebAuthTokenHandler,
  normalizeAuthenticatedUid
};
