import { describe, expect, it } from 'vitest';
import type { ParentScheduleEvent } from './scheduleLogic';
import {
  applyBulkRsvpResponse,
  getBulkRsvpCandidates,
  getBulkRsvpResultMessage,
  getNeededBulkRsvpEventKeys,
  groupBulkRsvpEvents,
  maxBulkRsvpEvents
} from './bulkRsvp';

function event(index: number, overrides: Partial<ParentScheduleEvent> = {}): ParentScheduleEvent {
  const date = new Date('2100-06-01T18:00:00Z');
  date.setUTCDate(date.getUTCDate() + index - 1);
  return {
    eventKey: `team-1::game-${index}::player-${index}`,
    id: `game-${index}`,
    teamId: 'team-1',
    teamName: 'Bears',
    type: 'game',
    date,
    location: 'Main Gym',
    opponent: 'Rivals',
    title: null,
    childId: `player-${index}`,
    childName: `Player ${index}`,
    isDbGame: true,
    isCancelled: false,
    isLinkedParentChild: true,
    myRsvp: 'not_responded',
    assignments: [],
    openAssignmentCount: 0,
    ...overrides
  };
}

describe('bulk RSVP helpers', () => {
  it('keeps upcoming linked-child events in chronological order and excludes staff and locked rows', () => {
    const candidates = getBulkRsvpCandidates([
      event(3),
      event(1, { isLinkedParentChild: false }),
      event(2),
      event(4, { availabilityLocked: true }),
      event(5, { childId: 'staff-team-team-1' })
    ], new Date('2100-06-01T00:00:00Z'));

    expect(candidates.map((candidate) => candidate.id)).toEqual(['game-2', 'game-3']);
  });

  it('bounds the bulk workflow and identifies only missing responses by default', () => {
    const candidates = getBulkRsvpCandidates(
      Array.from({ length: maxBulkRsvpEvents + 5 }, (_, index) => event(index + 1)),
      new Date('2100-01-01T00:00:00Z')
    );
    const withResponse = candidates.map((candidate, index) => index === 0 ? { ...candidate, myRsvp: 'going' as const } : candidate);

    expect(candidates).toHaveLength(maxBulkRsvpEvents);
    expect(getNeededBulkRsvpEventKeys(withResponse)).toHaveLength(maxBulkRsvpEvents - 1);
  });

  it('groups child rows for the same event and updates only selected rows', () => {
    const first = event(1);
    const sibling = event(2, { eventKey: 'team-1::game-1::player-2', id: 'game-1' });
    const later = event(3);

    expect(groupBulkRsvpEvents([first, sibling, later]).map((group) => group.map((row) => row.eventKey))).toEqual([
      [first.eventKey, sibling.eventKey],
      [later.eventKey]
    ]);
    expect(applyBulkRsvpResponse([first, sibling, later], new Set([first.eventKey, later.eventKey]), 'maybe').map((row) => row.myRsvp)).toEqual([
      'maybe',
      'not_responded',
      'maybe'
    ]);
  });

  it('formats complete and partial result summaries', () => {
    expect(getBulkRsvpResultMessage(2, 0, 'going')).toBe('2 RSVPs saved as going.');
    expect(getBulkRsvpResultMessage(1, 2, 'not_going')).toBe('1 saved; 2 RSVPs need another try.');
  });
});
