import { describe, expect, it } from 'vitest';

import {
  assignLineupPlayer,
  buildProjectedPlayingTimeSummary,
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

  it('dedupes interval periods even when the position id is hyphenated', () => {
    expect(assignLineupPlayer({
      "Q2 5'-right-defense": 'p1',
      "Q2 5'-left-defense": 'p2'
    }, "Q2 5'-left-defense", 'p1')).toEqual({
      "Q2 5'-left-defense": 'p1'
    });
  });

  it('does not clear unrelated malformed slot keys when assigning a player', () => {
    expect(assignLineupPlayer({
      bench: 'p1',
      'Q1-pg': 'p2'
    }, 'Q1-sg', 'p1')).toEqual({
      bench: 'p1',
      'Q1-pg': 'p2',
      'Q1-sg': 'p1'
    });
  });

  it('does not remove a valid same-player slot when the target key has no parsed period', () => {
    expect(assignLineupPlayer({
      'Q1-pg': 'p1'
    }, 'bench', 'p1')).toEqual({
      'Q1-pg': 'p1',
      bench: 'p1'
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

  it('preserves non-overridden whole-period minutes when timed current-shape overrides are mixed in', () => {
    const summary = buildProjectedPlayingTimeSummary('soccer-9v9', {
      formationId: 'soccer-9v9',
      numPeriods: 2,
      periodDuration: 30,
      subTimes: [14],
      lineups: {
        'H1-keeper': 'p1',
        "H1 14'-keeper": 'p2',
        'H2-keeper': 'p1',
        'H1-right-defense': 'p3',
        'H2-right-defense': 'p3',
        'H1-sweeper': 'p4',
        'H2-sweeper': 'p4',
        'H1-left-defense': 'p5',
        'H2-left-defense': 'p5',
        'H1-left-mid': 'p6',
        'H2-left-mid': 'p6',
        'H1-center-mid-1': 'p7',
        'H2-center-mid-1': 'p7',
        'H1-center-mid-2': 'p8',
        'H2-center-mid-2': 'p8',
        'H1-right-mid': 'p9',
        'H2-right-mid': 'p9',
        'H1-striker': 'p10',
        'H2-striker': 'p10'
      }
    }, [
      { id: 'p1', name: 'Alex Keeper', number: '1' },
      { id: 'p2', name: 'Bailey Sub', number: '2' },
      { id: 'p3', name: 'Casey Right Defense', number: '3' },
      { id: 'p4', name: 'Devon Sweeper', number: '4' },
      { id: 'p5', name: 'Emery Left Defense', number: '5' },
      { id: 'p6', name: 'Finley Left Mid', number: '6' },
      { id: 'p7', name: 'Gray Center Mid', number: '7' },
      { id: 'p8', name: 'Harper Center Mid', number: '8' },
      { id: 'p9', name: 'Indy Right Mid', number: '9' },
      { id: 'p10', name: 'Jules Striker', number: '10' }
    ]);

    expect(summary.find((row) => row.playerId === 'p1')).toMatchObject({
      minutes: 46,
      status: 'balanced'
    });
    expect(summary.find((row) => row.playerId === 'p2')).toMatchObject({
      minutes: 14,
      status: 'under-utilized'
    });
  });

  it('calculates legacy planner interval totals and status labels exactly', () => {
    const summary = buildProjectedPlayingTimeSummary('soccer-9v9', {
      formationId: 'soccer-9v9',
      numPeriods: 2,
      periodDuration: 20,
      subTimes: [7, 14],
      lineups: {
        ...buildLegacyIntervalAssignments('keeper', 'p1', ['1-7', '1-20', '2-20']),
        ...buildLegacyIntervalAssignments('keeper', 'p2', ['1-14', '2-14']),
        ...buildLegacyIntervalAssignments('keeper', 'p3', ['2-7']),
        ...buildLegacyIntervalAssignments('right-defense', 'p1'),
        ...buildLegacyIntervalAssignments('sweeper', 'p1'),
        ...buildLegacyIntervalAssignments('left-defense', 'p2'),
        ...buildLegacyIntervalAssignments('left-mid', 'p2', ['1-7', '1-14', '2-7']),
        ...buildLegacyIntervalAssignments('center-mid-1', 'p3'),
        ...buildLegacyIntervalAssignments('center-mid-2', 'p4'),
        ...buildLegacyIntervalAssignments('right-mid', 'p5'),
        ...buildLegacyIntervalAssignments('striker', 'p5')
      }
    }, [
      { id: 'p1', name: 'Alex Keeper', number: '1' },
      { id: 'p2', name: 'Bailey Utility', number: '2' },
      { id: 'p3', name: 'Casey Mid', number: '3' },
      { id: 'p4', name: 'Devon Center Mid', number: '4' },
      { id: 'p5', name: 'Emery Attack', number: '5' }
    ]);

    expect(summary.find((row) => row.playerId === 'p1')).toMatchObject({
      minutes: 99,
      targetMinutes: 72,
      status: 'over-utilized'
    });
    expect(summary.find((row) => row.playerId === 'p2')).toMatchObject({
      minutes: 75,
      targetMinutes: 72,
      status: 'balanced'
    });
    expect(summary.find((row) => row.playerId === 'p3')).toMatchObject({
      minutes: 47,
      targetMinutes: 72,
      status: 'under-utilized'
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

function buildLegacyIntervalAssignments(positionId: string, playerId: string, intervalKeys = ['1-7', '1-14', '1-20', '2-7', '2-14', '2-20']) {
  return Object.fromEntries(intervalKeys.map((intervalKey) => [`${intervalKey}-${positionId}`, playerId]));
}
