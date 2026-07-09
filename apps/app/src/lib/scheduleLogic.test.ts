import { describe, expect, it } from 'vitest';
import {
  countOpenScheduleAssignments,
  getCalendarScheduleEntries,
  getWindowedCalendarScheduleEntries,
  getWindowedPracticePacketRows,
  type ParentScheduleEvent
} from './scheduleLogic';

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

describe('windowed schedule derivation', () => {
  it('returns the first grouped schedule entries with total count and hasMore metadata', () => {
    const events = [
      buildParentScheduleEvent({
        eventKey: 'team-1::event-3::player-1::2100-06-03T18:00:00.000Z::game',
        id: 'event-3',
        date: new Date('2100-06-03T18:00:00.000Z'),
        opponent: 'Third'
      }),
      buildParentScheduleEvent({
        eventKey: 'team-1::event-1::player-1::2100-06-01T18:00:00.000Z::game',
        id: 'event-1',
        date: new Date('2100-06-01T18:00:00.000Z'),
        opponent: 'First'
      }),
      buildParentScheduleEvent({
        eventKey: 'team-1::event-1::player-2::2100-06-01T18:00:00.000Z::game',
        id: 'event-1',
        date: new Date('2100-06-01T18:00:00.000Z'),
        childId: 'player-2',
        childName: 'Sam',
        opponent: 'First'
      }),
      buildParentScheduleEvent({
        eventKey: 'team-1::practice-2::player-1::2100-06-02T18:00:00.000Z::practice',
        id: 'practice-2',
        type: 'practice',
        date: new Date('2100-06-02T18:00:00.000Z'),
        title: 'Practice'
      })
    ];

    const result = getWindowedCalendarScheduleEntries(events, 2);

    expect(result.totalCount).toBe(3);
    expect(result.gameCount).toBe(2);
    expect(result.practiceCount).toBe(1);
    expect(result.hasMore).toBe(true);
    expect(result.entries.map((event) => event.id)).toEqual(['event-1', 'practice-2']);
    expect(result.entries[0]?.childIds).toEqual(['player-1', 'player-2']);
  });

  it('orders windowed practice packet rows and reports total, ready, and hasMore metadata', () => {
    const now = new Date('2100-06-10T12:00:00.000Z');
    const ready = buildParentScheduleEvent({
      eventKey: 'team-1::ready::player-1::2100-06-11T18:00:00.000Z::practice',
      id: 'ready',
      type: 'practice',
      date: new Date('2100-06-11T18:00:00.000Z'),
      title: 'Ready packet',
      practiceHomePacketSummary: '3 drills'
    });
    const completed = buildParentScheduleEvent({
      eventKey: 'team-1::completed::player-1::2100-06-12T18:00:00.000Z::practice',
      id: 'completed',
      type: 'practice',
      date: new Date('2100-06-12T18:00:00.000Z'),
      title: 'Completed packet',
      practiceHomePacketSummary: '2 drills',
      practicePacketCompletions: [{ childId: 'player-1', status: 'completed' }]
    });
    const past = buildParentScheduleEvent({
      eventKey: 'team-1::past::player-1::2100-06-09T06:00:00.000Z::practice',
      id: 'past',
      type: 'practice',
      date: new Date('2100-06-09T06:00:00.000Z'),
      title: 'Past packet',
      practiceHomePacketSummary: '1 drill'
    });

    const result = getWindowedPracticePacketRows([past, completed, ready], 2, now);

    expect(result.totalCount).toBe(3);
    expect(result.readyCount).toBe(1);
    expect(result.hasMore).toBe(true);
    expect(result.rows.map((row) => row.event.id)).toEqual(['ready', 'completed']);
    expect(result.rows.map((row) => row.status)).toEqual(['ready', 'completed']);
  });
});
