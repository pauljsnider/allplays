const FIREBASE_HOSTING_PROJECT_ID = 'game-flow-c6311';
const FIREBASE_HOSTING_ORIGIN_PATTERN = new RegExp(
  `^${FIREBASE_HOSTING_PROJECT_ID}(?:--[a-z0-9-]+)?\\.(?:web\\.app|firebaseapp\\.com)$`
);

function isAllPlaysFirebaseHostingOrigin(value) {
  const origin = String(value || '').trim().toLowerCase();
  if (!origin) return false;

  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'https:' &&
      parsed.origin === origin &&
      parsed.port === '' &&
      FIREBASE_HOSTING_ORIGIN_PATTERN.test(parsed.hostname);
  } catch (error) {
    return false;
  }
}

module.exports = {
  FIREBASE_HOSTING_PROJECT_ID,
  isAllPlaysFirebaseHostingOrigin
};
