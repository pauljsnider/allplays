const PUBLIC_RSVP_RESPONSES = new Set(['going', 'maybe', 'not_going']);

function normalizePublicRsvpResponse(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return PUBLIC_RSVP_RESPONSES.has(normalized) ? normalized : '';
}

function isPublicRsvpReplay(lastResponse, nextResponse) {
  const normalizedNextResponse = normalizePublicRsvpResponse(nextResponse);
  return Boolean(normalizedNextResponse) &&
    normalizePublicRsvpResponse(lastResponse) === normalizedNextResponse;
}

module.exports = {
  isPublicRsvpReplay,
  normalizePublicRsvpResponse
};
