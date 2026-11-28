import { describe, expect, it } from 'vitest';
import { buildParentHomeModel } from './homeLogic';
import type { ParentScheduleEvent } from './scheduleLogic';

function buildEvent(index: number): ParentScheduleEvent {
  return {
    eventKey: `team-1::event-${index}::player-1::2100-06-0${index}T18:00:00.000Z::game`,
    id: `event-${index}`,
    teamId: 'team-1',
    teamName: 'Bears',
    type: 'game',
    date: new Date(`2100-06-0${index}T18:00:00.000Z`),
    location: 'Main Gym',
    childId: 'player-1',
    childName: 'Pat',
    isDbGame: true,
    isCancelled: false,
    assignments: [],
    openAssignmentCount: 0
  };
}

describe('buildParentHomeModel upcoming event count', () => {
  it('reports the total upcoming count beyond the 5-event display list (issue #5328)', () => {
    const model = buildParentHomeModel({
      children: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat' }],
      events: [1, 2, 3, 4, 5, 6].map(buildEvent),
      inboxTeams: [],
      fees: []
    });

    expect(model.upcomingEvents).toHaveLength(5);
    expect(model.upcomingEventCount).toBe(6);
  });

  it('matches the list length when no upcoming events are hidden', () => {
    const model = buildParentHomeModel({
      children: [{ teamId: 'team-1', teamName: 'Bears', playerId: 'player-1', playerName: 'Pat' }],
      events: [1, 2, 3].map(buildEvent),
      inboxTeams: [],
      fees: []
    });

    expect(model.upcomingEvents).toHaveLength(3);
    expect(model.upcomingEventCount).toBe(3);
  });
});
