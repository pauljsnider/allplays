import { describe, expect, it } from 'vitest';
import { getScheduleTournamentInfo } from '../../apps/app/src/lib/scheduleLogic.ts';

describe('native schedule tournament info', () => {
  it('builds a concise label and details from tournament bracket metadata', () => {
    expect(getScheduleTournamentInfo({
      competitionType: 'tournament',
      tournament: {
        divisionName: '10U Gold',
        bracketName: 'Championship',
        roundName: 'Semifinal',
        poolName: 'Pool A',
        gameLabel: 'Game 12',
        seedLabel: 'A1 vs B2'
      }
    } as any)).toEqual({
      isTournament: true,
      label: '10U Gold / Championship / Semifinal',
      details: 'Pool: Pool A - Game 12 - A1 vs B2',
      divisionName: '10U Gold',
      bracketName: 'Championship',
      roundName: 'Semifinal',
      poolName: 'Pool A',
      matchupLabel: '',
      positionLabel: 'Game 12',
      standings: null
    });
  });

  it('normalizes legacy slot assignments and inline standings rows for read-only rendering', () => {
    expect(getScheduleTournamentInfo({
      competitionType: 'tournament',
      tournament: {
        divisionName: '10U Gold',
        bracketName: 'Gold Bracket',
        roundName: 'Semifinal',
        poolName: 'Pool A',
        slotAssignments: {
          home: { sourceType: 'pool_seed', poolName: 'Pool A', seed: 1 },
          away: { sourceType: 'game_result', gameId: 'R1G2', outcome: 'winner' }
        },
        standings: {
          poolName: '10U Gold / Pool A',
          rows: [
            { rank: 1, teamName: 'Tigers', wins: 2, losses: 0, points: 6 },
            { rank: 2, team: 'Lions', record: '1-1', points: 3 }
          ],
          isOverridden: true
        }
      }
    } as any)).toMatchObject({
      isTournament: true,
      label: '10U Gold / Gold Bracket / Semifinal',
      details: 'Pool: Pool A - 10U Gold / Pool A #1 vs Winner R1G2',
      matchupLabel: '10U Gold / Pool A #1 vs Winner R1G2',
      standings: {
        groupName: '10U Gold / Pool A',
        isOverridden: true,
        note: 'Final ranking',
        rows: [
          { rank: '1', teamName: 'Tigers', record: '2-0', points: 6 },
          { rank: '2', teamName: 'Lions', record: '1-1', points: 3 }
        ]
      }
    });
  });

  it('falls back to pool labels and hides info for non-tournament events', () => {
    expect(getScheduleTournamentInfo({
      competitionType: 'league',
      tournament: {
        poolName: 'Pool B'
      }
    } as any)).toMatchObject({
      isTournament: true,
      label: 'Pool B',
      details: 'Pool B'
    });

    expect(getScheduleTournamentInfo({
      competitionType: 'league',
      tournament: {
        poolStandings: {
          'Pool C': {
            rows: [{ teamName: 'Bears', displayRank: 'T-1', record: '1-0-1' }],
            unresolvedTie: true
          }
        }
      }
    } as any)).toMatchObject({
      isTournament: true,
      standings: {
        groupName: 'Pool C',
        note: 'Tie unresolved',
        rows: [{ rank: 'T-1', teamName: 'Bears', record: '1-0-1', points: null }]
      }
    });

    expect(getScheduleTournamentInfo({ competitionType: 'league', tournament: null } as any)).toEqual({
      isTournament: false,
      label: '',
      details: '',
      divisionName: '',
      bracketName: '',
      roundName: '',
      poolName: '',
      matchupLabel: '',
      positionLabel: '',
      standings: null
    });
  });
});
