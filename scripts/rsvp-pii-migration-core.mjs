export const RSVP_PII_FIELDS = Object.freeze(['parentEmail', 'email', 'guardianEmail']);

export function looksLikeEmail(value) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 3 && normalized.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized);
}

export function planRsvpPiiSanitization(data = {}) {
  const deleteFields = RSVP_PII_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(data, field));
  const displayName = typeof data.displayName === 'string' ? data.displayName.trim() : '';
  const knownEmails = RSVP_PII_FIELDS.map((field) => String(data[field] || '').trim().toLowerCase()).filter(Boolean);
  const deleteDisplayName = looksLikeEmail(displayName) || knownEmails.includes(displayName.toLowerCase());
  if (deleteDisplayName && Object.prototype.hasOwnProperty.call(data, 'displayName')) deleteFields.push('displayName');
  return {
    needsUpdate: deleteFields.length > 0,
    deleteFields: [...new Set(deleteFields)]
  };
}

export function parsePositiveBound(value, fallback, max) {
  const parsed = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}
