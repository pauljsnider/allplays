import { describe, expect, it } from 'vitest';
import { buildParentHomeModel } from './homeLogic';
import type { ParentScheduleEvent } from './scheduleLogic';

function buildEvent(overrides: Partial<ParentScheduleEvent> = {}): ParentScheduleEvent {
  return {
    eventKey: 'team-1::event-1::player-1::2100-06-01T18:00:00.000Z::game',
    id: 'event-1',
    teamId: 'team-1',
    teamName: 'Bears',
    type: 'game',
    date: new Date('2100-06-01T18:00:00.000Z'),
    location: 'Main Gym',
    childId: 'player-1',
    childName: 'Pat',
    isDbGame: true,
    isCancelled: false,
    myRsvp: 'not_responded',
    myRsvpNoteHydrated: true,
    assignments: [],
    openAssignmentCount: 0,
    ...overrides
  };
}

const child = { teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat' };

describe('buildParentHomeModel RSVP counting (issue #5308)', () => {
  it('counts a hydrated missing response as RSVP needed', () => {
    const model = buildParentHomeModel({
      children: [child],
      events: [buildEvent()],
      inboxTeams: [],
      fees: []
    });

    expect(model.metrics.rsvpNeeded).toBe(1);
    expect(model.actionItems.some((item) => item.kind === 'rsvp')).toBe(true);
  });

  it('does not count an unhydrated or unknown response as RSVP needed', () => {
    const model = buildParentHomeModel({
      children: [child],
      events: [
        buildEvent({ myRsvpNoteHydrated: false }),
        buildEvent({
          eventKey: 'team-1::event-2::player-1::2100-06-02T18:00:00.000Z::game',
          id: 'event-2',
          date: new Date('2100-06-02T18:00:00.000Z'),
          myRsvpNoteHydrated: undefined
        })
      ],
      inboxTeams: [],
      fees: []
    });

    expect(model.metrics.rsvpNeeded).toBe(0);
    expect(model.actionItems.some((item) => item.kind === 'rsvp')).toBe(false);
  });

  it('does not count a hydrated saved response as RSVP needed', () => {
    const model = buildParentHomeModel({
      children: [child],
      events: [buildEvent({ myRsvp: 'going' })],
      inboxTeams: [],
      fees: []
    });

    expect(model.metrics.rsvpNeeded).toBe(0);
  });
});
