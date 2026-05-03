import { describe, expect, it } from 'vitest';
import {
  claimOfficiatingSlot,
  computeOfficiatingCoverageStatus,
  getAssignedOfficiatingSlots,
  getOpenOfficiatingSlots,
  normalizeOfficiatingSlots,
  updateOfficiatingSlotResponse
} from '../../js/officiating-utils.js';

describe('officiating assignment helpers', () => {
  it('normalizes official slots and coverage status for admin schedule visibility', () => {
    const slots = normalizeOfficiatingSlots([
      { position: 'Referee', officialEmail: 'Ref@Example.com' },
      { position: 'AR1' }
    ]);

    expect(slots).toMatchObject([
      { position: 'Referee', officialEmail: 'ref@example.com', status: 'pending' },
      { position: 'AR1', status: 'open' }
    ]);
    expect(computeOfficiatingCoverageStatus(slots)).toBe('needs_attention');
  });

  it('lets an assigned official accept and then mark cannot make it', () => {
    const accepted = updateOfficiatingSlotResponse([
      { id: 'slot-1', position: 'Referee', officialEmail: 'ref@example.com', status: 'pending' }
    ], 'slot-1', 'accepted');

    expect(accepted[0].status).toBe('accepted');
    expect(computeOfficiatingCoverageStatus(accepted)).toBe('covered');

    const unavailable = updateOfficiatingSlotResponse(accepted, 'slot-1', 'cant_make');
    expect(unavailable[0].status).toBe('cant_make');
    expect(computeOfficiatingCoverageStatus(unavailable)).toBe('needs_attention');
  });

  it('lists assigned games by uid or normalized email', () => {
    const game = {
      officiatingSlots: [
        { id: 'slot-1', position: 'Referee', officialEmail: 'REF@example.com', status: 'pending' },
        { id: 'slot-2', position: 'AR1', officialUserId: 'other', status: 'pending' }
      ]
    };

    expect(getAssignedOfficiatingSlots(game, { email: 'ref@example.com' })).toHaveLength(1);
    expect(getAssignedOfficiatingSlots(game, { uid: 'other' })[0].position).toBe('AR1');
  });

  it('only exposes and claims open slots when self-assignment is enabled', () => {
    const game = {
      officiatingSelfAssignmentEnabled: true,
      officiatingSlots: [
        { id: 'slot-1', position: 'Referee', status: 'open' },
        { id: 'slot-2', position: 'AR1', officialEmail: 'taken@example.com', status: 'pending' }
      ]
    };

    expect(getOpenOfficiatingSlots(game)).toHaveLength(1);

    const claimed = claimOfficiatingSlot(game.officiatingSlots, 'slot-1', {
      uid: 'user-1',
      email: 'Official@Example.com',
      displayName: 'Jordan Ref'
    });

    expect(claimed[0]).toMatchObject({
      officialUserId: 'user-1',
      officialEmail: 'official@example.com',
      officialName: 'Jordan Ref',
      status: 'accepted',
      selfAssigned: true
    });
  });

  it('prevents claiming a filled slot', () => {
    expect(() => claimOfficiatingSlot([
      { id: 'slot-1', position: 'Referee', officialEmail: 'taken@example.com', status: 'pending' }
    ], 'slot-1', { uid: 'user-1' })).toThrow('already filled');
  });
});
