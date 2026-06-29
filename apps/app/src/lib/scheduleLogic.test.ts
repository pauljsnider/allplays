import { describe, expect, it } from 'vitest';
import { countOpenScheduleAssignments, getCalendarScheduleEntries, type ParentScheduleEvent } from './scheduleLogic';

function buildParentScheduleEvent(overrides: Partial<ParentScheduleEvent> = {}): ParentScheduleEvent {
  const assignments = Array.isArray(overrides.assignments) ? overrides.assignments : [];
  return {
    eventKey: 'team-1::event-1::player-1::2100-06-01T18:00:00.000Z::game',
    id: 'event-1',
    teamId: 'team-1',
    teamName: 'Bears',
    type: 'game',
    date: new Date('2100-06-01T18:00:00.000Z'),
    location: 'Main Gym',
    opponent: 'Rivals',
    childId: 'player-1',
    childName: 'Pat',
    isDbGame: true,
    isCancelled: false,
    assignments,
    openAssignmentCount: countOpenScheduleAssignments(assignments),
    ...overrides
  };
}

describe('schedule open assignment counts', () => {
  it('counts only claimable assignments that are still unclaimed and unfilled', () => {
    expect(countOpenScheduleAssignments([
      { role: 'Snack bar', claimable: true, value: '' },
      { role: 'Bench help', claimable: true, claim: { claimedByUserId: 'parent-2' } },
      { role: 'Water', claimable: true, value: 'Filled' },
      { role: 'Setup', claimable: false, value: '' },
      { role: '', claimable: true, value: '' }
    ])).toBe(1);
  });

  it('preserves cached open assignment counts on grouped calendar entries', () => {
    const sharedAssignments = [
      { role: 'Snack bar', claimable: true, value: '' },
      { role: 'Bench help', claimable: true, claim: { claimedByUserId: 'parent-2' } }
    ];

    const entries = getCalendarScheduleEntries([
      buildParentScheduleEvent({
        assignments: sharedAssignments,
        openAssignmentCount: 1
      }),
      buildParentScheduleEvent({
        eventKey: 'team-1::event-1::player-2::2100-06-01T18:00:00.000Z::game',
        childId: 'player-2',
        childName: 'Sam',
        assignments: sharedAssignments,
        openAssignmentCount: 1,
        myRsvp: 'going'
      })
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.openAssignmentCount).toBe(1);
    expect(entries[0]?.childIds).toEqual(['player-1', 'player-2']);
  });
});
