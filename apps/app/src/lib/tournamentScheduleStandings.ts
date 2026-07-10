import { buildTournamentPoolStandings, getTournamentStandingsGroupName } from './adapters/legacyTournamentStandings';

export type ScheduleTournamentGameLike = {
  competitionType?: unknown;
  tournament?: Record<string, unknown> | null;
  [key: string]: unknown;
};

export type ScheduleTournamentTeamLike = {
  name?: unknown;
  standingsConfig?: Record<string, unknown> | null;
  tournamentPoolOverrides?: Record<string, unknown> | null;
};

export type TournamentScheduleGroupQuery = {
  poolName: string;
  divisionName: string;
};

function compactString(value: unknown) {
  return String(value || '').trim();
}

export function getTournamentScheduleGroupQuery(game: ScheduleTournamentGameLike): TournamentScheduleGroupQuery | null {
  const tournament = game?.tournament && typeof game.tournament === 'object' ? game.tournament : {};
  const divisionName = compactString(tournament.divisionName || tournament.division);
  const poolName = compactString(tournament.poolName);
  return poolName || divisionName ? { poolName, divisionName } : null;
}

export function matchesTournamentScheduleGroup(game: ScheduleTournamentGameLike, group: TournamentScheduleGroupQuery) {
  const expectedGroupName = group.divisionName && group.poolName
    ? `${group.divisionName} • ${group.poolName}`
    : group.poolName || group.divisionName;
  return compactString(game?.competitionType).toLowerCase() === 'tournament' &&
    getTournamentStandingsGroupName(game as Record<string, unknown>) === expectedGroupName;
}

export function hasTournamentScheduleGames(gamesInput: readonly ScheduleTournamentGameLike[]) {
  return (Array.isArray(gamesInput) ? gamesInput : []).some((game) => (
    compactString(game?.competitionType).toLowerCase() === 'tournament'
  ));
}

/**
 * Add the legacy-computed pool result to tournament game read models without
 * changing the stored document or replacing any inline standings payload.
 */
export function enrichTournamentScheduleStandings<T extends ScheduleTournamentGameLike>(
  gamesInput: readonly T[],
  team: ScheduleTournamentTeamLike | null | undefined,
  standingsGamesInput: readonly ScheduleTournamentGameLike[] = gamesInput
): T[] {
  const games = Array.isArray(gamesInput) ? gamesInput : [];
  if (!games.length || !hasTournamentScheduleGames(standingsGamesInput)) return [...games];

  const standingsByGroup = buildTournamentPoolStandings(
    [...standingsGamesInput] as Array<Record<string, unknown>>,
    {
      currentTeamName: compactString(team?.name) || null,
      standingsConfig: team?.standingsConfig || {},
      poolOverrides: team?.tournamentPoolOverrides || {}
    }
  );

  if (!Object.keys(standingsByGroup).length) return [...games];

  return games.map((game) => {
    if (compactString(game?.competitionType).toLowerCase() !== 'tournament') return game;
    const groupName = getTournamentStandingsGroupName(game);
    const computedStandings = groupName ? standingsByGroup[groupName] : null;
    const tournament = game?.tournament && typeof game.tournament === 'object' ? game.tournament : null;
    if (!computedStandings || !tournament) return game;

    return {
      ...game,
      tournament: {
        ...tournament,
        computedStandings: tournament.computedStandings || computedStandings
      }
    };
  });
}
