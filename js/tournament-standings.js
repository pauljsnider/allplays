import { computeNativeStandingsDetailed } from './native-standings.js';

function normalizeString(value) {
    const text = String(value || '').trim();
    return text || '';
}

function isCompletedTournamentPoolGame(game = {}) {
    return String(game?.competitionType || '').toLowerCase() === 'tournament'
        && normalizeString(game?.tournament?.poolName)
        && Number.isFinite(Number(game?.homeScore))
        && Number.isFinite(Number(game?.awayScore))
        && ['completed', 'final'].includes(String(game?.status || '').toLowerCase());
}

function buildPoolGame(teamName, game) {
    const opponent = normalizeString(game?.opponent);
    if (!teamName || !opponent) return null;

    const isHome = game?.isHome !== false;
    return {
        poolName: normalizeString(game?.tournament?.poolName),
        homeTeam: isHome ? teamName : opponent,
        awayTeam: isHome ? opponent : teamName,
        homeScore: Number(game.homeScore),
        awayScore: Number(game.awayScore),
        status: String(game?.status || '')
    };
}

export function computeTournamentPoolStandings(gamesInput, options = {}) {
    const games = Array.isArray(gamesInput) ? gamesInput : [];
    const teamName = normalizeString(options?.teamName);
    if (!teamName) return [];

    const pools = new Map();
    for (const game of games) {
        if (!isCompletedTournamentPoolGame(game)) continue;
        const poolGame = buildPoolGame(teamName, game);
        if (!poolGame) continue;
        const existing = pools.get(poolGame.poolName) || [];
        existing.push(poolGame);
        pools.set(poolGame.poolName, existing);
    }

    return Array.from(pools.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([poolName, poolGames]) => {
            const rows = computeNativeStandingsDetailed(poolGames, options?.standingsConfig || {}).map((row) => ({
                ...row,
                teamName: row.team
            }));
            return {
                poolName,
                rows,
                unresolvedTie: rows.some((row) => row.unresolvedTie)
            };
        })
        .filter((pool) => pool.rows.length > 0);
}
