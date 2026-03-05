import { describe, it, expect } from 'vitest';
import {
  canRequestRide,
  findRequestForChild,
  getEventRideshareSummary,
  getOfferSeatInfo,
  getRequestStatusCounts,
  normalizeOffer
} from '../../js/rideshare-helpers.js';

describe('rideshare helpers', () => {
  it('normalizes seat counts and status', () => {
    const normalized = normalizeOffer({
      status: 'OPEN',
      seatCapacity: '3',
      seatCountConfirmed: '1',
      requests: null
    });
    expect(normalized.status).toBe('open');
    expect(normalized.seatCapacity).toBe(3);
    expect(normalized.seatCountConfirmed).toBe(1);
    expect(normalized.requests).toEqual([]);
  });

  it('computes seat info and full state', () => {
    expect(getOfferSeatInfo({ seatCapacity: 4, seatCountConfirmed: 2, status: 'open' })).toEqual({
      seatCapacity: 4,
      seatCountConfirmed: 2,
      seatsLeft: 2,
      isFull: false
    });

    expect(getOfferSeatInfo({ seatCapacity: 2, seatCountConfirmed: 2, status: 'open' }).isFull).toBe(true);
  });

  it('counts request statuses', () => {
    const counts = getRequestStatusCounts({
      requests: [
        { status: 'pending' },
        { status: 'confirmed' },
        { status: 'waitlisted' },
        { status: 'declined' },
        { status: 'anything' }
      ]
    });
    expect(counts).toEqual({
      pending: 2,
      confirmed: 1,
      waitlisted: 1,
      declined: 1
    });
  });

  it('aggregates event-level rideshare summary from open offers', () => {
    const summary = getEventRideshareSummary([
      {
        status: 'open',
        seatCapacity: 3,
        seatCountConfirmed: 1,
        requests: [{ status: 'pending' }, { status: 'confirmed' }]
      },
      {
        status: 'closed',
        seatCapacity: 4,
        seatCountConfirmed: 0,
        requests: [{ status: 'pending' }]
      }
    ]);

    expect(summary.offerCount).toBe(1);
    expect(summary.seatsLeft).toBe(2);
    expect(summary.requests).toBe(2);
    expect(summary.pending).toBe(1);
    expect(summary.confirmed).toBe(1);
  });

  it('finds request for a specific parent + child', () => {
    const offer = {
      requests: [
        { parentUserId: 'u1', childId: 'c1', status: 'pending' },
        { parentUserId: 'u2', childId: 'c2', status: 'confirmed' }
      ]
    };
    expect(findRequestForChild(offer, 'u2', 'c2')?.status).toBe('confirmed');
    expect(findRequestForChild(offer, 'u3', 'c9')).toBeNull();
  });

  it('allows request only when rider is not driver and seat is available', () => {
    const offer = {
      status: 'open',
      driverUserId: 'driver-1',
      seatCapacity: 2,
      seatCountConfirmed: 1,
      requests: [{ parentUserId: 'parent-2', childId: 'child-2', status: 'confirmed' }]
    };
    expect(canRequestRide(offer, 'parent-3', 'child-3')).toBe(true);
    expect(canRequestRide(offer, 'driver-1', 'child-4')).toBe(false);
    expect(canRequestRide(offer, 'parent-2', 'child-2')).toBe(false);
  });
});
