import { describe, it, expect } from 'vitest';
import {
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
} from '../../js/db-query-payload-helpers.js';

describe('db query/payload helpers', () => {
    it('normalizes RSVP responses to allowed values', () => {
        expect(normalizeRsvpResponse('going')).toBe('going');
        expect(normalizeRsvpResponse('maybe')).toBe('maybe');
        expect(normalizeRsvpResponse('not_going')).toBe('not_going');
    });

    it('falls back RSVP response to not_responded for unknown values', () => {
        expect(normalizeRsvpResponse('yes')).toBe('not_responded');
        expect(normalizeRsvpResponse(null)).toBe('not_responded');
    });

    it('keeps only unique non-empty string IDs', () => {
        expect(uniqueNonEmptyIds(['p1', 'p1', ' ', '', null, 'p2'])).toEqual(['p1', 'p2']);
    });

    it('extracts direct RSVP player IDs from playerIds first', () => {
        const ids = extractDirectRsvpPlayerIds({ playerIds: ['p1', 'p2', 'p1'] });
        expect(ids).toEqual(['p1', 'p2']);
    });

    it('extracts legacy RSVP player IDs when playerIds is absent', () => {
        const ids = extractDirectRsvpPlayerIds({ playerId: 'p3', childId: ' p4 ' });
        expect(ids).toEqual(['p3', 'p4']);
    });

    it('resolves RSVP player IDs from fallback map when direct IDs are missing', () => {
        const ids = resolveRsvpPlayerIds({ userId: 'u1' }, new Map([['u1', ['p7', 'p8', 'p7']]]));
        expect(ids).toEqual(['p7', 'p8']);
    });

    it('normalizes ride offer status and defaults to open', () => {
        expect(normalizeRideOfferStatus('CLOSED')).toBe(RIDE_OFFER_STATUS.CLOSED);
        expect(normalizeRideOfferStatus('cancelled')).toBe(RIDE_OFFER_STATUS.CANCELLED);
        expect(normalizeRideOfferStatus('anything')).toBe(RIDE_OFFER_STATUS.OPEN);
    });

    it('normalizes ride request status and defaults to pending', () => {
        expect(normalizeRideRequestStatus('CONFIRMED')).toBe(RIDE_REQUEST_STATUS.CONFIRMED);
        expect(normalizeRideRequestStatus('waitlisted')).toBe(RIDE_REQUEST_STATUS.WAITLISTED);
        expect(normalizeRideRequestStatus('declined')).toBe(RIDE_REQUEST_STATUS.DECLINED);
        expect(normalizeRideRequestStatus('unknown')).toBe(RIDE_REQUEST_STATUS.PENDING);
    });

    it('detects decision statuses correctly', () => {
        expect(isDecisionStatus('confirmed')).toBe(true);
        expect(isDecisionStatus('waitlisted')).toBe(true);
        expect(isDecisionStatus('declined')).toBe(true);
        expect(isDecisionStatus('pending')).toBe(false);
    });

    it('parses non-negative integers with fallback for invalid values', () => {
        expect(toNonNegativeInteger('12', 0)).toBe(12);
        expect(toNonNegativeInteger(-1, 5)).toBe(5);
        expect(toNonNegativeInteger('x', 9)).toBe(9);
    });

    it('updates confirmed seat count when status transitions affect confirmed state', () => {
        expect(nextConfirmedSeatCount(2, 'pending', 'confirmed')).toBe(3);
        expect(nextConfirmedSeatCount(2, 'confirmed', 'declined')).toBe(1);
    });

    it('normalizes list query limits with positive fallback rules', () => {
        expect(normalizeListLimit('20', 50)).toBe(20);
        expect(normalizeListLimit(0, 50)).toBe(50);
        expect(normalizeListLimit(-2, 50)).toBe(50);
    });
});
