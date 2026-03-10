function normalizeString(value) {
    const text = String(value || '').trim();
    return text || null;
}

function normalizeSeed(value) {
    const seed = Number.parseInt(value, 10);
    return Number.isFinite(seed) && seed > 0 ? seed : null;
}

function isCompletedTournamentGame(game) {
    return String(game?.status || '').toLowerCase() === 'completed'
        && Number.isFinite(Number(game?.homeScore))
        && Number.isFinite(Number(game?.awayScore));
}

export function describeTournamentSource(source = {}) {
    const sourceType = normalizeString(source.sourceType) || 'team';
    if (sourceType === 'pool_seed') {
        const poolName = normalizeString(source.poolName) || 'Pool';
        const seed = normalizeSeed(source.seed);
        return seed ? `${poolName} #${seed}` : poolName;
    }
    if (sourceType === 'game_result') {
        const outcome = normalizeString(source.outcome) || 'winner';
        const label = outcome === 'loser' ? 'Loser' : 'Winner';
        const gameId = normalizeString(source.gameId) || 'game';
        return `${label} ${gameId}`;
    }
    return normalizeString(source.teamName) || 'TBD';
}

export function getTournamentWinner(game = {}) {
    if (!isCompletedTournamentGame(game)) return null;
    const homeScore = Number(game.homeScore);
    const awayScore = Number(game.awayScore);
    if (homeScore === awayScore) return null;
    return homeScore > awayScore ? 'home' : 'away';
}

function getTournamentLoser(game = {}) {
    const winner = getTournamentWinner(game);
    if (!winner) return null;
    return winner === 'home' ? 'away' : 'home';
}

function getPoolSeedTeamName(poolStandings = {}, source = {}) {
    const poolName = normalizeString(source.poolName);
    const seed = normalizeSeed(source.seed);
    if (!poolName || !seed) return null;
    const poolRows = Array.isArray(poolStandings?.[poolName]) ? poolStandings[poolName] : [];
    const row = poolRows[seed - 1];
    return normalizeString(row?.teamName || row?.team || row?.name);
}

function resolveGameResultSlot(gamesById, source, poolStandings, memo) {
    const upstreamId = normalizeString(source.gameId);
    if (!upstreamId) {
        return { teamName: null, label: describeTournamentSource(source), ready: false };
    }
    const upstream = gamesById.get(upstreamId);
    if (!upstream) {
        return { teamName: null, label: describeTournamentSource(source), ready: false };
    }

    const upstreamResolved = resolveTournamentGame(upstream, gamesById, poolStandings, memo);
    const outcome = normalizeString(source.outcome) || 'winner';
    const side = outcome === 'loser' ? getTournamentLoser(upstream) : getTournamentWinner(upstream);
    if (!side) {
        return { teamName: null, label: describeTournamentSource(source), ready: false };
    }

    const teamName = side === 'home'
        ? upstreamResolved.homeTeamName
        : upstreamResolved.awayTeamName;

    return {
        teamName: teamName || null,
        label: teamName || describeTournamentSource(source),
        ready: !!teamName
    };
}

function resolveTournamentSource(source = {}, gamesById, poolStandings, memo) {
    const sourceType = normalizeString(source.sourceType) || 'team';
    if (sourceType === 'pool_seed') {
        const teamName = getPoolSeedTeamName(poolStandings, source);
        return {
            teamName,
            label: teamName || describeTournamentSource(source),
            ready: !!teamName
        };
    }
    if (sourceType === 'game_result') {
        return resolveGameResultSlot(gamesById, source, poolStandings, memo);
    }
    const teamName = normalizeString(source.teamName);
    return {
        teamName,
        label: teamName || 'TBD',
        ready: !!teamName
    };
}

export function resolveTournamentGame(game = {}, gamesByIdInput, poolStandings = {}, memo = new Map()) {
    const gameId = normalizeString(game.id);
    if (gameId && memo.has(gameId)) return memo.get(gameId);

    const placeholder = {
        homeLabel: 'TBD',
        awayLabel: 'TBD',
        homeTeamName: null,
        awayTeamName: null,
        matchupLabel: 'TBD vs TBD',
        ready: false
    };
    if (gameId) memo.set(gameId, placeholder);

    const tournament = game?.tournament || {};
    const slotAssignments = tournament.slotAssignments || {};
    const gamesById = gamesByIdInput instanceof Map
        ? gamesByIdInput
        : new Map(Array.isArray(gamesByIdInput) ? gamesByIdInput.map((item) => [item.id, item]) : []);

    const home = resolveTournamentSource(slotAssignments.home || {}, gamesById, poolStandings, memo);
    const away = resolveTournamentSource(slotAssignments.away || {}, gamesById, poolStandings, memo);
    const resolved = {
        homeLabel: home.label,
        awayLabel: away.label,
        homeTeamName: home.teamName || null,
        awayTeamName: away.teamName || null,
        matchupLabel: `${home.label} vs ${away.label}`,
        ready: !!(home.ready && away.ready)
    };

    if (gameId) memo.set(gameId, resolved);
    return resolved;
}

function resolvedStatesEqual(current = {}, next = {}) {
    return current.homeLabel === next.homeLabel
        && current.awayLabel === next.awayLabel
        && current.homeTeamName === next.homeTeamName
        && current.awayTeamName === next.awayTeamName
        && current.matchupLabel === next.matchupLabel
        && current.ready === next.ready;
}

export function collectTournamentAdvancementPatches(games = [], options = {}) {
    const poolStandings = options?.poolStandings || {};
    const gamesById = new Map((games || []).filter((game) => game?.id).map((game) => [game.id, game]));
    const memo = new Map();

    return (games || [])
        .filter((game) => String(game?.competitionType || '').toLowerCase() === 'tournament' && game?.tournament?.slotAssignments)
        .map((game) => {
            const resolved = resolveTournamentGame(game, gamesById, poolStandings, memo);
            if (resolvedStatesEqual(game?.tournament?.resolved || {}, resolved)) return null;
            return {
                gameId: game.id,
                tournament: {
                    resolved
                }
            };
        })
        .filter(Boolean);
}
