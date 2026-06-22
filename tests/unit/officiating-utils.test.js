import { describe, expect, it } from 'vitest';
import {
  claimOfficiatingSlot,
  computeOfficiatingCoverageStatus,
  flagRescheduledOfficiatingSlots,
  getAssignedOfficiatingSlots,
  getOfficiatingAssignmentConflictWarnings,
  getOpenOfficiatingSlots,
  hasSubmittedOfficiatingResult,
  normalizeOfficiatingSlots,
  updateOfficiatingSlotResult,
  validateOfficiatingResultSubmission,
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



  it('flags staffed assignments as needing review when date, time, or location changes', () => {
    const previousGame = {
      date: new Date('2026-05-04T10:00:00Z'),
      location: 'Field 1',
      officiatingSlots: [
        { id: 'slot-1', position: 'Referee', officialEmail: 'ref@example.com', status: 'accepted' },
        { id: 'slot-2', position: 'AR1', status: 'open' }
      ]
    };

    const slots = flagRescheduledOfficiatingSlots(previousGame, {
      date: new Date('2026-05-04T10:00:00Z'),
      location: 'Field 2',
      officiatingSlots: previousGame.officiatingSlots
    }, { markedAt: '2026-05-01T12:00:00.000Z' });

    expect(slots[0]).toMatchObject({
      status: 'needs_review',
      scheduleReviewRequired: true,
      scheduleReviewReason: 'Game schedule changed',
      scheduleReviewMarkedAt: '2026-05-01T12:00:00.000Z'
    });
    expect(slots[1]).toMatchObject({ status: 'open', scheduleReviewRequired: false });
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
    expect(claimed[1]).toMatchObject({
      id: 'slot-2',
      officialEmail: 'taken@example.com',
      status: 'pending',
      selfAssigned: false
    });
    expect(claimed.filter((slot) => slot.selfAssigned === true)).toHaveLength(1);
  });

  it('keeps self-assignment updates scoped to one claimant-owned open slot', () => {
    const claimed = claimOfficiatingSlot([
      { id: 'slot-1', position: 'Referee', status: 'open' },
      { id: 'slot-2', position: 'AR1', officialUserId: 'official-2', officialEmail: 'taken@example.com', officialName: 'Taken Official', status: 'accepted' },
      { id: 'slot-3', position: 'AR2', status: 'open' }
    ], 'slot-3', {
      uid: 'claimant-1',
      email: 'Claimant@Example.com',
      displayName: 'Casey Claimant'
    });

    expect(claimed[0]).toMatchObject({ id: 'slot-1', position: 'Referee', status: 'open', selfAssigned: false });
    expect(claimed[1]).toMatchObject({
      id: 'slot-2',
      position: 'AR1',
      officialUserId: 'official-2',
      officialEmail: 'taken@example.com',
      officialName: 'Taken Official',
      status: 'accepted',
      selfAssigned: false
    });
    expect(claimed[2]).toMatchObject({
      id: 'slot-3',
      officialUserId: 'claimant-1',
      officialEmail: 'claimant@example.com',
      officialName: 'Casey Claimant',
      status: 'accepted',
      selfAssigned: true
    });
  });

  it('prevents claiming a filled slot', () => {
    expect(() => claimOfficiatingSlot([
      { id: 'slot-1', position: 'Referee', officialEmail: 'taken@example.com', status: 'pending' }
    ], 'slot-1', { uid: 'user-1' })).toThrow('already filled');
  });

  it('validates and stores submitted officiating results for accepted assignments', () => {
    expect(validateOfficiatingResultSubmission({ homeScore: '', awayScore: '2' })).toMatchObject({
      valid: false,
      errors: ['Enter a home score.']
    });

    const updated = updateOfficiatingSlotResult([
      { id: 'slot-1', position: 'Referee', officialEmail: 'ref@example.com', status: 'accepted' }
    ], 'slot-1', {
      homeScore: '3',
      awayScore: '1',
      notes: 'Match ended after regulation.'
    }, {
      uid: 'official-1',
      email: 'Ref@Example.com',
      displayName: 'Jordan Ref'
    }, {
      submittedAt: '2026-06-02T08:50:00.000Z'
    });

    expect(updated[0].submittedResult).toMatchObject({
      homeScore: 3,
      awayScore: 1,
      notes: 'Match ended after regulation.',
      submittedAt: '2026-06-02T08:50:00.000Z',
      submittedByUserId: 'official-1',
      submittedByEmail: 'ref@example.com',
      submittedByName: 'Jordan Ref'
    });
    expect(hasSubmittedOfficiatingResult(updated[0])).toBe(true);
  });

  it('rejects result submission for unaccepted assignments', () => {
    expect(() => updateOfficiatingSlotResult([
      { id: 'slot-1', position: 'Referee', officialEmail: 'ref@example.com', status: 'pending' }
    ], 'slot-1', {
      homeScore: 1,
      awayScore: 0
    })).toThrow('Only accepted assignments can submit final results.');
  });

  it('rejects result submission when the caller does not match the accepted slot', () => {
    expect(() => updateOfficiatingSlotResult([
      { id: 'slot-1', position: 'Referee', officialEmail: 'ref@example.com', officialUserId: 'official-1', status: 'accepted' }
    ], 'slot-1', {
      homeScore: 1,
      awayScore: 0
    }, {
      uid: 'official-2',
      email: 'other@example.com'
    })).toThrow('You can only submit a result for your own accepted assignment.');
  });

  it('warns when the same official has overlapping or back-to-back assignments', () => {
    const warnings = getOfficiatingAssignmentConflictWarnings({
      id: 'game-new',
      date: new Date('2026-05-04T10:00:00Z'),
      opponent: 'Lions',
      location: 'Field 1',
      officiatingSlots: [
        { position: 'Referee', officialEmail: 'Ref@Example.com', officialName: 'Jordan Ref', status: 'pending' }
      ]
    }, [
      {
        id: 'game-overlap',
        date: new Date('2026-05-04T11:00:00Z'),
        opponent: 'Tigers',
        location: 'Field 2',
        officiatingSlots: [
          { position: 'Referee', officialEmail: 'ref@example.com', officialName: 'Jordan Ref', status: 'accepted' }
        ]
      },
      {
        id: 'game-back-to-back',
        date: new Date('2026-05-04T12:00:00Z'),
        opponent: 'Bears',
        location: 'Field 3',
        officiatingSlots: [
          { position: 'Referee', officialEmail: 'ref@example.com', officialName: 'Jordan Ref', status: 'pending' }
        ]
      }
    ]);

    expect(warnings).toMatchObject([
      {
        officialName: 'Jordan Ref',
        conflictType: 'overlap',
        conflictingGameId: 'game-overlap',
        conflictingGameLabel: 'vs. Tigers at Field 2'
      },
      {
        officialName: 'Jordan Ref',
        conflictType: 'back-to-back',
        conflictingGameId: 'game-back-to-back',
        conflictingGameLabel: 'vs. Bears at Field 3'
      }
    ]);
  });

  it('does not warn for different officials, ignored statuses, cancelled games, or the game being edited', () => {
    const warnings = getOfficiatingAssignmentConflictWarnings({
      id: 'game-1',
      date: new Date('2026-05-04T10:00:00Z'),
      opponent: 'Lions',
      officiatingSlots: [
        { position: 'Referee', officialEmail: 'ref@example.com', status: 'pending' }
      ]
    }, [
      {
        id: 'game-1',
        date: new Date('2026-05-04T10:30:00Z'),
        opponent: 'Same game',
        officiatingSlots: [
          { position: 'Referee', officialEmail: 'ref@example.com', status: 'pending' }
        ]
      },
      {
        id: 'game-2',
        date: new Date('2026-05-04T10:30:00Z'),
        opponent: 'Different official',
        officiatingSlots: [
          { position: 'Referee', officialEmail: 'other@example.com', status: 'pending' }
        ]
      },
      {
        id: 'game-3',
        date: new Date('2026-05-04T10:30:00Z'),
        opponent: 'Declined slot',
        officiatingSlots: [
          { position: 'Referee', officialEmail: 'ref@example.com', status: 'declined' }
        ]
      },
      {
        id: 'game-4',
        date: new Date('2026-05-04T10:30:00Z'),
        opponent: 'Cancelled game',
        status: 'cancelled',
        officiatingSlots: [
          { position: 'Referee', officialEmail: 'ref@example.com', status: 'accepted' }
        ]
      }
    ], { editingGameId: 'game-1' });

    expect(warnings).toEqual([]);
  });

  it('does not warn when the candidate game is cancelled', () => {
    const warnings = getOfficiatingAssignmentConflictWarnings({
      id: 'game-cancelled',
      date: new Date('2026-05-04T10:00:00Z'),
      opponent: 'Lions',
      status: 'cancelled',
      officiatingSlots: [
        { position: 'Referee', officialEmail: 'ref@example.com', status: 'pending' }
      ]
    }, [
      {
        id: 'game-active',
        date: new Date('2026-05-04T10:30:00Z'),
        opponent: 'Tigers',
        officiatingSlots: [
          { position: 'Referee', officialEmail: 'ref@example.com', status: 'accepted' }
        ]
      }
    ]);

    expect(warnings).toEqual([]);
  });
});
