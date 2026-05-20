const OFFER_STATUS_OPEN = 'open';
const REQUEST_STATUS_PENDING = 'pending';
const REQUEST_STATUS_CONFIRMED = 'confirmed';

export function normalizeOffer(offer = {}) {
    const statusRaw = (offer.status || '').toString().toLowerCase();
    const status = statusRaw === 'closed' || statusRaw === 'cancelled' ? statusRaw : OFFER_STATUS_OPEN;
    const seatCapacity = Number.isFinite(Number(offer.seatCapacity)) ? Math.max(0, Number.parseInt(offer.seatCapacity, 10)) : 0;
    const seatCountConfirmed = Number.isFinite(Number(offer.seatCountConfirmed))
        ? Math.max(0, Number.parseInt(offer.seatCountConfirmed, 10))
        : 0;
    const requests = Array.isArray(offer.requests) ? offer.requests : [];
    return {
        ...offer,
        status,
        seatCapacity,
        seatCountConfirmed,
        requests
    };
}

export function getOfferSeatInfo(offer = {}) {
    const normalized = normalizeOffer(offer);
    const seatsLeft = Math.max(0, normalized.seatCapacity - normalized.seatCountConfirmed);
    const isFull = normalized.status !== OFFER_STATUS_OPEN || seatsLeft === 0;
    return {
        seatCapacity: normalized.seatCapacity,
        seatCountConfirmed: normalized.seatCountConfirmed,
        seatsLeft,
        isFull
    };
}

export function getRequestStatusCounts(offer = {}) {
    const normalized = normalizeOffer(offer);
    return normalized.requests.reduce((acc, request) => {
        const status = (request?.status || '').toString().toLowerCase();
        if (status === REQUEST_STATUS_CONFIRMED) acc.confirmed += 1;
        else if (status === 'waitlisted') acc.waitlisted += 1;
        else if (status === 'declined') acc.declined += 1;
        else acc.pending += 1;
        return acc;
    }, { pending: 0, confirmed: 0, waitlisted: 0, declined: 0 });
}

export function getEventRideshareSummary(offers = []) {
    const normalizedOffers = Array.isArray(offers) ? offers.map(normalizeOffer) : [];
    const openOffers = normalizedOffers.filter((offer) => offer.status === OFFER_STATUS_OPEN);
    const totals = openOffers.reduce((acc, offer) => {
        const seatInfo = getOfferSeatInfo(offer);
        const requestCounts = getRequestStatusCounts(offer);
        acc.seatsLeft += seatInfo.seatsLeft;
        acc.requests += offer.requests.length;
        acc.pending += requestCounts.pending;
        acc.confirmed += requestCounts.confirmed;
        return acc;
    }, { seatsLeft: 0, requests: 0, pending: 0, confirmed: 0 });

    return {
        offerCount: openOffers.length,
        seatsLeft: totals.seatsLeft,
        requests: totals.requests,
        pending: totals.pending,
        confirmed: totals.confirmed,
        isFull: openOffers.length > 0 && totals.seatsLeft === 0
    };
}

export function findRequestForChild(offer = {}, parentUserId, childId) {
    const normalized = normalizeOffer(offer);
    if (!parentUserId || !childId) return null;
    return normalized.requests.find((request) =>
        request?.parentUserId === parentUserId && request?.childId === childId
    ) || null;
}

export function canRequestRide(offer = {}, parentUserId, childId) {
    const normalized = normalizeOffer(offer);
    if (normalized.status !== OFFER_STATUS_OPEN) return false;
    if (!parentUserId || !childId) return false;
    if (normalized.driverUserId === parentUserId) return false;
    const seatInfo = getOfferSeatInfo(normalized);
    const existing = findRequestForChild(normalized, parentUserId, childId);
    if (existing?.status === REQUEST_STATUS_PENDING || existing?.status === REQUEST_STATUS_CONFIRMED) return false;
    return seatInfo.seatsLeft > 0;
}
