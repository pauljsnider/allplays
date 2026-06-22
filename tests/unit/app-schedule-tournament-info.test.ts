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
      poolName: 'Pool A'
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

    expect(getScheduleTournamentInfo({ competitionType: 'league', tournament: null } as any)).toEqual({
      isTournament: false,
      label: '',
      details: '',
      divisionName: '',
      bracketName: '',
      roundName: '',
      poolName: ''
    });
  });
});
