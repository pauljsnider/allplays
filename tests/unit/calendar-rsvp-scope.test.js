import { describe, expect, it } from 'vitest';
import {
  resolveCalendarRsvpPlayerIdsForSubmission,
  resolveRsvpPlayerIdsForSubmission
} from '../../js/parent-dashboard-rsvp.js';

describe('calendar RSVP player scope', () => {
  const calendarEvents = [
    { teamId: 'team-1', id: 'game-1', childIds: ['child-a'] },
    { teamId: 'team-1', id: 'game-2', childIds: ['child-b', 'child-c'] },
    { teamId: 'team-2', id: 'game-1', childIds: ['child-z'] }
  ];

  it('falls back to the event childIds instead of unrelated linked team players', () => {
    const result = resolveRsvpPlayerIdsForSubmission(calendarEvents, 'team-1', 'game-1', {});

    expect(result).toEqual(['child-a']);
  });

  it('filters explicit childIds to the selected aggregated event scope', () => {
    const result = resolveRsvpPlayerIdsForSubmission(calendarEvents, 'team-1', 'game-2', {
      childIds: 'child-a,child-b,child-z,child-c'
    });

    expect(result).toEqual(['child-b', 'child-c']);
  });

  it('falls back to legacy calendar player ids when the event has no child scope metadata', () => {
    const result = resolveCalendarRsvpPlayerIdsForSubmission(
      [{ teamId: 'team-1', id: 'game-3' }],
      'team-1',
      'game-3',
      {},
      ['child-a', 'child-b', 'child-a']
    );

    expect(result).toEqual(['child-a', 'child-b']);
  });

  it('allows coach calendar submissions when the event has no child scope metadata', () => {
    const result = resolveCalendarRsvpPlayerIdsForSubmission(
      [{ teamId: 'team-1', id: 'game-4' }],
      'team-1',
      'game-4',
      {},
      []
    );

    expect(result).toEqual([]);
  });
});
