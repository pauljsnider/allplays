import { describe, expect, it } from 'vitest';
import type { ParentScheduleEvent } from './scheduleLogic';
import {
  applyBulkRsvpResponse,
  getBulkRsvpCandidates,
  getBulkRsvpNoteReadyCandidates,
  getBulkRsvpResultMessage,
  getNeededBulkRsvpEventKeys,
  getScheduleRsvpHydrationTargets,
  groupBulkRsvpEvents,
  groupBulkRsvpSubmissions,
  maxBulkRsvpEvents,
  maxGroupedRsvpPlayerIds
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
    myRsvpNoteHydrated: true,
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

  it('selects visible RSVP groups, keeps sibling rows together, and returns the next delta', () => {
    const first = event(1);
    const firstSibling = event(1, {
      eventKey: 'team-1::game-1::player-2',
      childId: 'player-2',
      childName: 'Player 2'
    });
    const second = event(2);
    const third = event(3);
    const events = [first, firstSibling, second, third];

    expect(getScheduleRsvpHydrationTargets(events, [first, second, third], 1).map((row) => row.eventKey)).toEqual([
      first.eventKey,
      firstSibling.eventKey
    ]);
    expect(getScheduleRsvpHydrationTargets(
      events,
      [first, second, third],
      2,
      new Set([first.eventKey])
    ).map((row) => row.eventKey)).toEqual([firstSibling.eventKey, second.eventKey]);
  });

  it('tracks hydrated sibling rows independently within one event group', () => {
    const first = event(1);
    const sibling = event(1, {
      eventKey: 'team-1::game-1::player-2',
      childId: 'player-2',
      childName: 'Player 2'
    });

    expect(getScheduleRsvpHydrationTargets(
      [first, sibling],
      [sibling],
      1,
      new Set([first.eventKey])
    ).map((row) => row.eventKey)).toEqual([sibling.eventKey]);
  });

  it('selects visible past RSVP rows for hydration without expanding the bulk RSVP window', () => {
    const pastEvent = event(1, {
      date: new Date('2000-06-01T18:00:00Z')
    });

    expect(getBulkRsvpCandidates([pastEvent], new Date('2100-01-01T00:00:00Z'))).toEqual([]);
    expect(getScheduleRsvpHydrationTargets([pastEvent], [pastEvent], 1)).toEqual([pastEvent]);
  });

  it('selects visible groups before applying the hydration row bound', () => {
    const crowdedEvents = Array.from({ length: maxBulkRsvpEvents }, (_, index) => event(index + 1));
    const visiblePractice = event(maxBulkRsvpEvents + 1, {
      id: 'visible-practice',
      eventKey: 'team-1::visible-practice::player-1',
      type: 'practice',
      opponent: null,
      title: 'Visible practice'
    });

    expect(getScheduleRsvpHydrationTargets(
      [...crowdedEvents, visiblePractice],
      [visiblePractice],
      1
    )).toEqual([visiblePractice]);
  });

  it('hydrates every sibling row when a visible group crosses the global candidate boundary', () => {
    const earlierEvents = Array.from({ length: maxBulkRsvpEvents - 1 }, (_, index) => event(index + 1));
    const firstSibling = event(maxBulkRsvpEvents, {
      id: 'boundary-game',
      eventKey: 'team-1::boundary-game::player-1'
    });
    const secondSibling = event(maxBulkRsvpEvents, {
      id: 'boundary-game',
      eventKey: 'team-1::boundary-game::player-2',
      childId: 'player-2',
      childName: 'Player 2'
    });

    expect(getScheduleRsvpHydrationTargets(
      [...earlierEvents, firstSibling, secondSibling],
      [firstSibling],
      1
    ).map((row) => row.eventKey)).toEqual([firstSibling.eventKey, secondSibling.eventKey]);
  });

  it('excludes rows whose private RSVP note did not finish hydrating', () => {
    const knownEmptyNote = event(1, { myRsvpNote: null, myRsvpNoteHydrated: true });
    const unknownNote = event(2, { myRsvpNote: null, myRsvpNoteHydrated: false });
    const missingHydrationMarker = event(3, { myRsvpNoteHydrated: undefined });

    expect(getBulkRsvpNoteReadyCandidates([
      knownEmptyNote,
      unknownNote,
      missingHydrationMarker
    ])).toEqual([knownEmptyNote]);
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

  it('keeps complete sibling selections atomic only when their saved notes match', () => {
    const first = event(1);
    const sibling = event(2, { eventKey: 'team-1::game-1::player-2', id: 'game-1' });
    const siblingOutsideBulkScope = event(3, { eventKey: 'team-1::game-1::player-3', id: 'game-1' });
    const siblingWithDifferentNote = { ...sibling, myRsvpNote: 'Needs a ride' };

    expect(groupBulkRsvpSubmissions([first, sibling], [first, sibling])).toEqual([[first, sibling]]);
    expect(groupBulkRsvpSubmissions([first], [first, sibling])).toEqual([[first]]);
    expect(groupBulkRsvpSubmissions([first, sibling], [first, sibling, siblingOutsideBulkScope])).toEqual([[first], [sibling]]);
    expect(groupBulkRsvpSubmissions(
      [first, siblingWithDifferentNote],
      [first, siblingWithDifferentNote]
    )).toEqual([[first], [siblingWithDifferentNote]]);
  });

  it('uses per-child writes when a complete sibling group exceeds the rules limit', () => {
    const siblings = Array.from({ length: maxGroupedRsvpPlayerIds + 1 }, (_, index) => event(index + 1, {
      eventKey: `team-1::game-large-family::player-${index + 1}`,
      id: 'game-large-family'
    }));

    expect(groupBulkRsvpSubmissions(siblings, siblings)).toEqual(
      siblings.map((sibling) => [sibling])
    );
  });

  it('formats complete and partial result summaries', () => {
    expect(getBulkRsvpResultMessage(2, 0, 'going')).toBe('2 RSVPs saved as going.');
    expect(getBulkRsvpResultMessage(1, 2, 'not_going')).toBe('1 saved; 2 RSVPs need another try.');
  });
});
