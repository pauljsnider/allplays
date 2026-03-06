import { describe, it, expect } from 'vitest';
import {
  resolveRsvpPlayerIdsForSubmission,
  resolveMyRsvpByChildForGame
} from '../../js/parent-dashboard-rsvp.js';

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

describe('parent dashboard RSVP hydration scope', () => {
  const allScheduleEvents = [
    { teamId: 'team-1', id: 'game-1', childId: 'child-a' },
    { teamId: 'team-1', id: 'game-1', childId: 'child-b' },
    { teamId: 'team-1', id: 'game-1', childId: 'child-c' }
  ];

  it('returns distinct responses per child for the same parent and game', () => {
    const result = resolveMyRsvpByChildForGame(
      allScheduleEvents,
      'team-1',
      'game-1',
      [
        { userId: 'parent-1', playerIds: ['child-a'], response: 'going', respondedAt: '2026-03-01T10:00:00Z' },
        { userId: 'parent-1', playerIds: ['child-b'], response: 'not_going', respondedAt: '2026-03-01T10:01:00Z' }
      ],
      'parent-1'
    );

    expect(result).toEqual({
      'child-a': 'going',
      'child-b': 'not_going'
    });
  });

  it('ignores RSVP docs from other users and keeps latest response per child', () => {
    const result = resolveMyRsvpByChildForGame(
      allScheduleEvents,
      'team-1',
      'game-1',
      [
        { userId: 'parent-2', playerIds: ['child-a'], response: 'maybe', respondedAt: '2026-03-01T10:02:00Z' },
        { userId: 'parent-1', playerIds: ['child-a'], response: 'going', respondedAt: '2026-03-01T10:00:00Z' },
        { userId: 'parent-1', playerIds: ['child-a'], response: 'not_going', respondedAt: '2026-03-01T10:03:00Z' }
      ],
      'parent-1'
    );

    expect(result).toEqual({
      'child-a': 'not_going'
    });
  });
});
