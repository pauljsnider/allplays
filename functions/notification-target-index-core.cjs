const NOTIFICATION_CATEGORIES = Object.freeze([
  'liveChat',
  'mentions',
  'liveScore',
  'gameDay',
  'schedule',
  'rsvp',
  'fees',
  'practice',
  'access',
  'rideshare',
  'media',
  'awards',
  'officiating'
]);

const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  liveChat: false,
  mentions: true,
  liveScore: false,
  gameDay: false,
  schedule: true,
  rsvp: true,
  fees: true,
  practice: false,
  access: true,
  rideshare: true,
  media: false,
  awards: false,
  officiating: false
});

const NOTIFICATION_CATEGORY_AUDIENCES = Object.freeze({
  liveChat: Object.freeze(['parent', 'staff']),
  mentions: Object.freeze(['parent', 'staff']),
  liveScore: Object.freeze(['parent', 'staff']),
  gameDay: Object.freeze(['parent', 'staff']),
  schedule: Object.freeze(['parent', 'staff']),
  rsvp: Object.freeze(['parent', 'staff']),
  fees: Object.freeze(['parent', 'staff']),
  practice: Object.freeze(['parent', 'staff']),
  access: Object.freeze(['parent', 'staff']),
  rideshare: Object.freeze(['parent', 'staff']),
  media: Object.freeze(['parent', 'staff']),
  awards: Object.freeze(['parent', 'staff']),
  officiating: Object.freeze(['parent', 'staff'])
});

function sanitizeNotificationTargetSegment(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeNotificationTargetCategories(rawPreferences = {}) {
  const source = rawPreferences && typeof rawPreferences === 'object' ? rawPreferences : {};
  return NOTIFICATION_CATEGORIES.reduce((categories, category) => {
    categories[category] = Object.prototype.hasOwnProperty.call(source, category)
      ? source?.[category] === true
      : DEFAULT_NOTIFICATION_PREFERENCES[category] === true;
    return categories;
  }, {});
}

function getNotificationAudienceRoles(category) {
  if (!NOTIFICATION_CATEGORIES.includes(category)) return [];
  return NOTIFICATION_CATEGORY_AUDIENCES[category] || ['parent', 'staff'];
}

function notificationAudienceAllowsRoles(category, roles = []) {
  const allowedRoles = getNotificationAudienceRoles(category);
  const roleSet = new Set(Array.isArray(roles) ? roles : []);
  return allowedRoles.some((role) => roleSet.has(role));
}

function hasEnabledNotificationCategory(rawPreferences = {}) {
  return NOTIFICATION_CATEGORIES.some((category) => rawPreferences?.[category] === true);
}

function buildNotificationTargetDocId({ uid, deviceId }) {
  const safeUid = sanitizeNotificationTargetSegment(uid);
  const safeDeviceId = sanitizeNotificationTargetSegment(deviceId);
  if (!safeUid || !safeDeviceId) return '';
  return `${safeUid}__${safeDeviceId}`.slice(0, 240);
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
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_CATEGORY_AUDIENCES,
  normalizeNotificationTargetCategories,
  getNotificationAudienceRoles,
  notificationAudienceAllowsRoles,
  hasEnabledNotificationCategory,
  buildNotificationTargetDocId,
  buildNotificationTargetPayload
};
