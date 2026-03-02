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

  it('filters explicit childIds down to players in the selected game scope', () => {
    const result = resolveRsvpPlayerIdsForSubmission(allScheduleEvents, 'team-1', 'game-1', {
      childIds: 'child-a,child-c,child-z,child-a'
    });

    expect(result).toEqual(['child-a']);
  });

  it('prioritizes selected child filter over broad childIds payload', () => {
    const result = resolveRsvpPlayerIdsForSubmission(allScheduleEvents, 'team-1', 'game-1', {
      selectedChildId: 'child-a',
      childIds: 'child-a,child-b'
    });

    expect(result).toEqual(['child-a']);
  });

  it('rejects explicit childId values outside the selected game scope', () => {
    expect(() => resolveRsvpPlayerIdsForSubmission(allScheduleEvents, 'team-1', 'game-1', {
      childId: 'child-z'
    })).toThrow('Select a child in this game before submitting RSVP.');
  });

  it('throws when fallback is ambiguous across multiple children', () => {
    expect(() => resolveRsvpPlayerIdsForSubmission(allScheduleEvents, 'team-1', 'game-1', {}))
      .toThrow('Select a child in this game before submitting RSVP.');
  });

  it('falls back to the only child when a game scope has exactly one child', () => {
    const result = resolveRsvpPlayerIdsForSubmission(allScheduleEvents, 'team-1', 'game-2', {});

    expect(result).toEqual(['child-c']);
  });
});
