const RIDE_OFFER_STATUS = {
    OPEN: 'open',
    CLOSED: 'closed',
    CANCELLED: 'cancelled'
};

const RIDE_REQUEST_STATUS = {
    PENDING: 'pending',
    CONFIRMED: 'confirmed',
    WAITLISTED: 'waitlisted',
    DECLINED: 'declined'
};

function normalizeRsvpResponse(response) {
    if (response === 'going' || response === 'maybe' || response === 'not_going') {
        return response;
    }
    return 'not_responded';
}

function uniqueNonEmptyIds(ids) {
    if (!Array.isArray(ids)) return [];
    return Array.from(new Set(ids.filter((id) => typeof id === 'string' && id.trim())));
}

function extractDirectRsvpPlayerIds(rsvp) {
    const direct = uniqueNonEmptyIds(rsvp?.playerIds);
    if (direct.length) return direct;
    const legacy = [];
    if (typeof rsvp?.playerId === 'string' && rsvp.playerId.trim()) legacy.push(rsvp.playerId.trim());
    if (typeof rsvp?.childId === 'string' && rsvp.childId.trim()) legacy.push(rsvp.childId.trim());
    return uniqueNonEmptyIds(legacy);
}

function resolveRsvpPlayerIds(rsvp, fallbackByUser) {
    const direct = extractDirectRsvpPlayerIds(rsvp);
    if (direct.length) return direct;
    const uid = rsvp?.userId || rsvp?.id;
    return uid ? uniqueNonEmptyIds(fallbackByUser.get(uid) || []) : [];
}

function normalizeRideOfferStatus(status) {
    const value = (status || '').toString().toLowerCase();
    if (value === RIDE_OFFER_STATUS.CLOSED || value === RIDE_OFFER_STATUS.CANCELLED) return value;
    return RIDE_OFFER_STATUS.OPEN;
}

function normalizeRideRequestStatus(status) {
    const value = (status || '').toString().toLowerCase();
    if (value === RIDE_REQUEST_STATUS.CONFIRMED) return RIDE_REQUEST_STATUS.CONFIRMED;
    if (value === RIDE_REQUEST_STATUS.WAITLISTED) return RIDE_REQUEST_STATUS.WAITLISTED;
    if (value === RIDE_REQUEST_STATUS.DECLINED) return RIDE_REQUEST_STATUS.DECLINED;
    return RIDE_REQUEST_STATUS.PENDING;
}

function isDecisionStatus(status) {
    const normalized = normalizeRideRequestStatus(status);
    return normalized === RIDE_REQUEST_STATUS.CONFIRMED ||
        normalized === RIDE_REQUEST_STATUS.WAITLISTED ||
        normalized === RIDE_REQUEST_STATUS.DECLINED;
}

function toNonNegativeInteger(value, fallback = 0) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) return fallback;
    return parsed;
}

function nextConfirmedSeatCount(currentSeatCountConfirmed, previousRequestStatus, nextRequestStatus) {
    const current = toNonNegativeInteger(currentSeatCountConfirmed, 0);
    const wasConfirmed = normalizeRideRequestStatus(previousRequestStatus) === RIDE_REQUEST_STATUS.CONFIRMED;
    const willBeConfirmed = normalizeRideRequestStatus(nextRequestStatus) === RIDE_REQUEST_STATUS.CONFIRMED;
    if (wasConfirmed === willBeConfirmed) return current;
    if (wasConfirmed && !willBeConfirmed) return Math.max(0, current - 1);
    return current + 1;
}

function normalizeListLimit(value, fallback) {
    const normalized = toNonNegativeInteger(value, fallback);
    return normalized > 0 ? normalized : fallback;
}

export {
    RIDE_OFFER_STATUS,
    RIDE_REQUEST_STATUS,
    normalizeRsvpResponse,
    uniqueNonEmptyIds,
    extractDirectRsvpPlayerIds,
    resolveRsvpPlayerIds,
    normalizeRideOfferStatus,
    normalizeRideRequestStatus,
    isDecisionStatus,
    toNonNegativeInteger,
    nextConfirmedSeatCount,
    normalizeListLimit
};
