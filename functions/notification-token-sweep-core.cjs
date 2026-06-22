const STALE_NOTIFICATION_DEVICE_TOKEN_DAYS = 90;
const STALE_NOTIFICATION_DEVICE_TOKEN_MS = STALE_NOTIFICATION_DEVICE_TOKEN_DAYS * 24 * 60 * 60 * 1000;

function getStaleNotificationTokenCutoffMillis(nowMillis = Date.now(), maxAgeMs = STALE_NOTIFICATION_DEVICE_TOKEN_MS) {
  const now = Number(nowMillis);
  const age = Number(maxAgeMs);
  return Math.max(0, (Number.isFinite(now) ? now : Date.now()) - (Number.isFinite(age) ? age : STALE_NOTIFICATION_DEVICE_TOKEN_MS));
}

function getNotificationDeviceUpdatedAtMillis(device = {}) {
  const value = device?.updatedAt || device?.createdAt || device?.lastSeenAt || null;
  if (!value) return 0;
  if (typeof value.toMillis === 'function') {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : 0;
  }
  if (typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && !Number.isNaN(date.getTime()) ? date.getTime() : 0;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 0 : value.getTime();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function isStaleNotificationDeviceRecord(device = {}, nowMillis = Date.now(), maxAgeMs = STALE_NOTIFICATION_DEVICE_TOKEN_MS) {
  const updatedAtMillis = getNotificationDeviceUpdatedAtMillis(device);
  if (!updatedAtMillis) return true;
  return updatedAtMillis < getStaleNotificationTokenCutoffMillis(nowMillis, maxAgeMs);
}

module.exports = {
  STALE_NOTIFICATION_DEVICE_TOKEN_DAYS,
  STALE_NOTIFICATION_DEVICE_TOKEN_MS,
  getNotificationDeviceUpdatedAtMillis,
  getStaleNotificationTokenCutoffMillis,
  isStaleNotificationDeviceRecord
};
