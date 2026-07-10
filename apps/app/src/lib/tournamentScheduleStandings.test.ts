import { describe, expect, it } from 'vitest';
import { buildTournamentPoolOverrideKey } from '../../../../js/tournament-standings.js';
import { getScheduleTournamentInfo } from './scheduleLogic';
import {
  enrichTournamentScheduleStandings,
  getTournamentScheduleGroupQuery,
  matchesTournamentScheduleGroup
} from './tournamentScheduleStandings';

function buildWebTournamentGames() {
  return [
    {
      id: 'pool-a-1',
      competitionType: 'tournament',
      status: 'completed',
      homeScore: 3,
      awayScore: 1,
      tournament: {
        divisionName: '10U Gold',
        poolName: 'Pool A',
        slotAssignments: {
          home: { sourceType: 'team', teamName: 'Tigers' },
          away: { sourceType: 'team', teamName: 'Lions' }
        }
      }
    },
    {
      id: 'pool-a-2',
      competitionType: 'tournament',
      status: 'completed',
      homeScore: 2,
      awayScore: 0,
      tournament: {
        divisionName: '10U Gold',
        poolName: 'Pool A',
        slotAssignments: {
          home: { sourceType: 'team', teamName: 'Bears' },
          away: { sourceType: 'team', teamName: 'Tigers' }
        }
      }
    },
    {
      id: 'pool-a-3',
      competitionType: 'tournament',
      status: 'completed',
      homeScore: 4,
      awayScore: 1,
      tournament: {
        divisionName: '10U Gold',
        poolName: 'Pool A',
        slotAssignments: {
          home: { sourceType: 'team', teamName: 'Lions' },
          away: { sourceType: 'team', teamName: 'Bears' }
        }
      }
    }
  ];
}

describe('tournament schedule standings enrichment', () => {
  it('builds an exact pool query and rejects same-named pools from another division', () => {
    const [game] = buildWebTournamentGames();
    const group = getTournamentScheduleGroupQuery(game);

    expect(group).toEqual({ poolName: 'Pool A', divisionName: '10U Gold' });
    expect(matchesTournamentScheduleGroup(game, group!)).toBe(true);
    expect(matchesTournamentScheduleGroup({
      ...game,
      tournament: { ...game.tournament, divisionName: '12U Gold' }
    }, group!)).toBe(false);
  });

  it('preserves legacy division-only standings groups', () => {
    const game = {
      ...buildWebTournamentGames()[0],
      tournament: {
        division: '10U Gold',
        slotAssignments: buildWebTournamentGames()[0].tournament.slotAssignments
      }
    };
    const group = getTournamentScheduleGroupQuery(game);

    expect(group).toEqual({ poolName: '', divisionName: '10U Gold' });
    expect(matchesTournamentScheduleGroup(game, group!)).toBe(true);
  });

  it('derives legacy standings for ordinary web-created game docs with no inline rows', () => {
    const webGames = buildWebTournamentGames();
    const enriched = enrichTournamentScheduleStandings(webGames, {
      name: 'Tigers',
      standingsConfig: {
        rankingMode: 'points',
        points: { win: 3, tie: 1, loss: 0 }
      }
    });

    expect(webGames[0].tournament).not.toHaveProperty('computedStandings');
    expect(enriched[0]).not.toBe(webGames[0]);
    expect(getScheduleTournamentInfo(enriched[0] as any).standings).toEqual({
      groupName: '10U Gold • Pool A',
      isOverridden: false,
      note: '',
      rows: [
        { rank: '1', teamName: 'Lions', record: '1-1', points: 3 },
        { rank: '2', teamName: 'Tigers', record: '1-1', points: 3 },
        { rank: '3', teamName: 'Bears', record: '1-1', points: 3 }
      ]
    });
  });

  it('applies team tournamentPoolOverrides through the same legacy ranking contract', () => {
    const groupName = '10U Gold • Pool A';
    const enriched = enrichTournamentScheduleStandings(buildWebTournamentGames(), {
      name: 'Tigers',
      standingsConfig: {
        rankingMode: 'points',
        points: { win: 3, tie: 1, loss: 0 }
      },
      tournamentPoolOverrides: {
        [buildTournamentPoolOverrideKey(groupName)]: {
          poolName: groupName,
          teamOrder: ['Bears', 'Tigers', 'Lions']
        }
      }
    });

    expect(getScheduleTournamentInfo(enriched[1] as any).standings).toMatchObject({
      groupName,
      isOverridden: true,
      note: 'Final ranking',
      rows: [
        { rank: '1', teamName: 'Bears' },
        { rank: '2', teamName: 'Tigers' },
        { rank: '3', teamName: 'Lions' }
      ]
    });
  });

  it('keeps an existing inline standings payload ahead of derived standings', () => {
    const webGames = buildWebTournamentGames();
    const inlineStandings = {
      poolName: 'Published Pool A',
      rows: [{ rank: 7, teamName: 'Published Tigers', wins: 9, losses: 0, points: 27 }],
      isOverridden: true
    };
    webGames[0].tournament = {
      ...webGames[0].tournament,
      standings: inlineStandings
    } as typeof webGames[0]['tournament'];

    const enriched = enrichTournamentScheduleStandings(webGames, { name: 'Tigers' });

    expect((enriched[0].tournament as Record<string, unknown>)?.standings).toBe(inlineStandings);
    expect(getScheduleTournamentInfo(enriched[0] as any).standings).toEqual({
      groupName: 'Published Pool A',
      isOverridden: true,
      note: 'Final ranking',
      rows: [{ rank: '7', teamName: 'Published Tigers', record: '9-0', points: 27 }]
    });
  });
});
