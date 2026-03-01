import { describe, it, expect } from 'vitest';
import { resolveRsvpPlayerIdsForSubmission } from '../../js/parent-dashboard-rsvp.js';

describe('parent dashboard RSVP player scope', () => {
  const allScheduleEvents = [
    { teamId: 'team-1', id: 'game-1', childId: 'child-a' },
    { teamId: 'team-1', id: 'game-1', childId: 'child-b' },
    { teamId: 'team-1', id: 'game-2', childId: 'child-c' },
    { teamId: 'team-2', id: 'game-1', childId: 'child-z' }
  ];

  it('uses explicit clicked child only when childId is provided', () => {
    const result = resolveRsvpPlayerIdsForSubmission(allScheduleEvents, 'team-1', 'game-1', {
      childId: 'child-a'
    });

    expect(result).toEqual(['child-a']);
  });

  it('falls back to the clicked game scope instead of all team events', () => {
    const result = resolveRsvpPlayerIdsForSubmission(allScheduleEvents, 'team-1', 'game-1', {});

    expect(result).toEqual(['child-a', 'child-b']);
  });
});
