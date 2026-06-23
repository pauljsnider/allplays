import { describe, expect, it } from 'vitest';
import {
  applyStandardTrackerTallyDelta,
  buildStandardTrackerOpponentStatsEntry,
  buildStandardTrackerViewModel
} from './standardTrackerViewModel';

describe('standardTrackerViewModel', () => {
  it('builds a config-column grid for active roster players only', () => {
    const model = buildStandardTrackerViewModel({
      config: {
        columns: ['GOALS', 'SHOTS', 'ASSISTS'],
        statDefinitions: [
          { id: 'goals', label: 'GOALS' },
          { id: 'shots', label: 'SHOTS' },
          { id: 'assists', label: 'ASSISTS' }
        ]
      },
      roster: [
        { id: 'p1', name: 'Avery Smith', number: '12', stats: { goals: 1, shots: 3 } },
        { id: 'p2', name: 'Blake Jones', number: '7', stats: { goals: 2, assists: 1 } },
        { id: 'p3', name: 'Inactive Player', number: '5', active: false, stats: { goals: 9 } },
        { id: 'p4', name: 'Archived Player', archived: true, stats: { goals: 9 } },
        { id: 'p5', name: 'Disabled Player', status: 'inactive', stats: { goals: 9 } }
      ]
    });

    expect(model.columns.map((column) => column.key)).toEqual(['goals', 'shots', 'assists']);
    expect(model.rows.map((row) => row.player.id)).toEqual(['p1', 'p2']);
    expect(model.rows).toHaveLength(2);
    expect(model.rows[0].cells.map((cell) => `${cell.column.key}:${cell.value}`)).toEqual(['goals:1', 'shots:3', 'assists:0']);
    expect(model.totals.map((total) => `${total.key}:${total.value}`)).toEqual(['goals:3', 'shots:3', 'assists:1']);
  });

  it('uses stat definition ids for renamed labels and applies tally deltas immutably', () => {
    const model = buildStandardTrackerViewModel({
      config: {
        columns: ['Points'],
        statDefinitions: [{ id: 'pts', label: 'Points' }]
      },
      roster: [{ id: 'p1', name: 'Avery Smith', stats: { pts: 4 } }]
    });

    expect(model.columns).toEqual([{ key: 'pts', label: 'Points' }]);
    expect(model.rows[0].cells[0].value).toBe(4);

    const tallies = { p1: { pts: 4 } };
    const nextTallies = applyStandardTrackerTallyDelta(tallies, 'p1', 'PTS', 1);

    expect(nextTallies).toEqual({ p1: { pts: 5 } });
    expect(tallies).toEqual({ p1: { pts: 4 } });
  });

  it('preserves legacy custom column punctuation so tracking validation accepts taps', () => {
    const model = buildStandardTrackerViewModel({
      config: {
        columns: ['3-Pt', 'FG%']
      },
      roster: [{ id: 'p1', name: 'Avery Smith', stats: { '3-pt': 2, 'fg%': 50 } }]
    });

    expect(model.columns).toEqual([
      { key: '3-pt', label: '3-Pt' },
      { key: 'fg%', label: 'FG%' }
    ]);
    expect(model.rows[0].cells.map((cell) => `${cell.column.key}:${cell.value}`)).toEqual(['3-pt:2', 'fg%:50']);
    expect(applyStandardTrackerTallyDelta({ p1: { '3-pt': 2 } }, 'p1', '3-Pt', 1)).toEqual({
      p1: { '3-pt': 3 }
    });
  });

  it('builds linked and anonymous opponent stat entries in the legacy report shape', () => {
    const linkedModel = buildStandardTrackerViewModel({
      config: {
        columns: ['GOALS', 'SHOTS'],
        statDefinitions: [
          { id: 'goals', label: 'GOALS' },
          { id: 'shots', label: 'SHOTS' }
        ]
      },
      roster: [{
        id: 'opp-9',
        playerId: 'opp-9',
        name: 'Taylor Guard',
        number: '9',
        photoUrl: 'https://img.example/opp-9.png',
        stats: { goals: 2, shots: 3, fouls: 1 }
      }]
    });

    expect(buildStandardTrackerOpponentStatsEntry({
      player: linkedModel.rows[0].player,
      columns: linkedModel.columns,
      tallies: { 'opp-9': { goals: 2, shots: 3, fouls: 1 } }
    })).toEqual({
      name: 'Taylor Guard',
      number: '9',
      playerId: 'opp-9',
      photoUrl: 'https://img.example/opp-9.png',
      goals: 2,
      shots: 3,
      fouls: 1
    });

    const anonymousModel = buildStandardTrackerViewModel({
      config: { columns: ['GOALS'] },
      roster: [{ id: 'opponent', playerId: null, name: 'Wolves', stats: { goals: 0 } }]
    });

    expect(buildStandardTrackerOpponentStatsEntry({
      player: anonymousModel.rows[0].player,
      columns: anonymousModel.columns,
      tallies: { opponent: { goals: 1 } }
    })).toEqual({
      name: 'Wolves',
      number: '',
      playerId: null,
      photoUrl: '',
      goals: 1,
      fouls: 0
    });
  });
});
