import { describe, expect, it } from 'vitest';
import { isUpcomingHomeEvent } from './homeLogic';
import type { ParentScheduleEvent } from './scheduleLogic';

function buildEvent(overrides: Partial<ParentScheduleEvent> = {}): ParentScheduleEvent {
  return {
    eventKey: 'team-1::event-1::player-1::2026-11-23T18:00:00.000Z::practice',
    id: 'event-1',
    teamId: 'team-1',
    teamName: 'Bears',
    type: 'practice',
    date: new Date('2026-11-23T18:00:00.000Z'),
    endDate: new Date('2026-11-23T19:00:00.000Z'),
    location: 'Main Gym',
    childId: 'player-1',
    childName: 'Pat',
    isDbGame: true,
    isCancelled: false,
    assignments: [],
    openAssignmentCount: 0,
    ...overrides
  };
}

describe('isUpcomingHomeEvent', () => {
  it('does not treat an event that ended hours ago as upcoming (issue #5310)', () => {
    // Repro: 6:00 PM practice, checked at 10:38 PM the same day.
    const now = new Date('2026-11-23T22:38:00.000Z');
    expect(isUpcomingHomeEvent(buildEvent(), now)).toBe(false);
  });

  it('still counts an in-progress event as upcoming', () => {
    const now = new Date('2026-11-23T18:30:00.000Z');
    expect(isUpcomingHomeEvent(buildEvent(), now)).toBe(true);
  });

  it('keeps an event upcoming inside the grace window after it ends', () => {
    const now = new Date('2026-11-23T20:30:00.000Z');
    expect(isUpcomingHomeEvent(buildEvent(), now)).toBe(true);
  });

  it('counts a future event as upcoming', () => {
    const now = new Date('2026-11-23T12:00:00.000Z');
    expect(isUpcomingHomeEvent(buildEvent(), now)).toBe(true);
  });

  it('never counts a cancelled event as upcoming', () => {
    const now = new Date('2026-11-23T12:00:00.000Z');
    expect(isUpcomingHomeEvent(buildEvent({ isCancelled: true }), now)).toBe(false);
  });

  it('falls back to the grace window after start when there is no end time', () => {
    const noEnd = buildEvent({ endDate: null });
    expect(isUpcomingHomeEvent(noEnd, new Date('2026-11-23T19:30:00.000Z'))).toBe(true);
    expect(isUpcomingHomeEvent(noEnd, new Date('2026-11-23T22:38:00.000Z'))).toBe(false);
  });
});
