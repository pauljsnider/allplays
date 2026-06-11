const NOTIFICATION_CATEGORIES = Object.freeze(['liveChat', 'liveScore', 'schedule']);

function normalizeNotificationTargetCategories(rawPreferences = {}) {
  return NOTIFICATION_CATEGORIES.reduce((categories, category) => {
    categories[category] = rawPreferences?.[category] === true;
    return categories;
  }, {});
}

function hasEnabledNotificationCategory(rawPreferences = {}) {
  return NOTIFICATION_CATEGORIES.some((category) => rawPreferences?.[category] === true);
}

function buildNotificationTargetDocId({ uid, deviceId }) {
  const safeUid = String(uid || '').trim().replace(/[^A-Za-z0-9_-]/g, '_');
  const safeDeviceId = String(deviceId || '').trim().replace(/[^A-Za-z0-9_-]/g, '_');
  return `${safeUid}__${safeDeviceId}`.replace(/^_+|_+$/g, '').slice(0, 240);
}

function buildNotificationTargetPayload({ uid, teamId, deviceId, token, platform = 'web', userAgent = '', preferences = {} }) {
  const categories = normalizeNotificationTargetCategories(preferences);
  return {
    uid: String(uid || '').trim(),
    teamId: String(teamId || '').trim(),
    deviceId: String(deviceId || '').trim(),
    token: String(token || '').trim(),
    platform: String(platform || 'web').trim() || 'web',
    userAgent: String(userAgent || '').trim(),
    categories
  };
}

module.exports = {
  NOTIFICATION_CATEGORIES,
  normalizeNotificationTargetCategories,
  hasEnabledNotificationCategory,
  buildNotificationTargetDocId,
  buildNotificationTargetPayload
};
