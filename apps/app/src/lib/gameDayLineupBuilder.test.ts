import { describe, expect, it } from 'vitest';

import {
  assignLineupPlayer,
  buildRoundRobinLineup,
  getLineupSlotKey,
  getOrderedLineupPeriods,
  moveLineupPlayer,
  parseAiLineupPlan
} from './gameDayLineupBuilder';
import { LINEUP_FORMATIONS } from './gameDayLineupPublish';

describe('gameDayLineupBuilder', () => {
  it('keeps one player per period when reassigning a slot', () => {
    expect(assignLineupPlayer({
      'Q1-pg': 'p1',
      'Q1-sg': 'p2'
    }, 'Q1-sg', 'p1')).toEqual({
      'Q1-sg': 'p1'
    });
  });

  it('dedupes same-half soccer assignments for hyphenated position ids', () => {
    expect(assignLineupPlayer({
      'H1-right-defense': 'p1',
      'H1-left-defense': 'p2'
    }, 'H1-left-defense', 'p1')).toEqual({
      'H1-left-defense': 'p1'
    });
  });

  it('swaps slot occupants when dragging between assignments', () => {
    expect(moveLineupPlayer({
      'Q1-pg': 'p1',
      'Q1-sg': 'p2'
    }, 'Q1-pg', 'Q1-sg')).toEqual({
      'Q1-pg': 'p2',
      'Q1-sg': 'p1'
    });
  });

  it('sorts interval-style periods from shared web drafts', () => {
    expect(getOrderedLineupPeriods('basketball-5v5', {
      numPeriods: 4,
      lineups: {
        'Q2 5\'-pg': 'p1',
        'Q1-pg': 'p2',
        'Q2-pg': 'p3'
      }
    })).toEqual(['Q1', 'Q2', 'Q2 5\'', 'Q3', 'Q4']);
  });

  it('maps AI player names back to lineup slot ids', () => {
    const positions = LINEUP_FORMATIONS['basketball-5v5'].positions;
    const plan = parseAiLineupPlan(
      JSON.stringify({ Q1: { pg: 'Avery Smith', sg: 'Blake Jones' } }),
      ['Q1'],
      positions,
      [
        { id: 'p1', name: 'Avery Smith', number: '1' },
        { id: 'p2', name: 'Blake Jones', number: '2' }
      ]
    );

    expect(plan).toEqual({
      [getLineupSlotKey('Q1', 'pg')]: 'p1',
      [getLineupSlotKey('Q1', 'sg')]: 'p2'
    });
  });

  it('builds a balanced local fallback lineup across all periods', () => {
    const plan = buildRoundRobinLineup(['Q1', 'Q2'], LINEUP_FORMATIONS['basketball-5v5'].positions, [
      { id: 'p1', name: 'Avery Smith', number: '1' },
      { id: 'p2', name: 'Blake Jones', number: '2' }
    ]);

    expect(plan[getLineupSlotKey('Q1', 'pg')]).toBe('p1');
    expect(plan[getLineupSlotKey('Q1', 'sg')]).toBe('p2');
    expect(plan[getLineupSlotKey('Q2', 'pg')]).toBe('p2');
  });
});
