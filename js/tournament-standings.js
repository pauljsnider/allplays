import { computeNativeStandings } from './native-standings.js';

function normalizeString(value) {
    const text = String(value || '').trim();
    return text || null;
}

export function buildTournamentPoolOverrideKey(poolName) {
    const normalized = normalizeString(poolName);
    if (!normalized) return 'pool';
    return normalized
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'pool';
}

function getSlotTeamName(slot = {}) {
    if (String(slot?.sourceType || '').toLowerCase() !== 'team') return null;
    return normalizeString(slot?.teamName);
}

function getTournamentGameTeams(game = {}, currentTeamName = null) {
    const resolved = game?.tournament?.resolved || {};
    const slotAssignments = game?.tournament?.slotAssignments || {};
    const resolvedHome = normalizeString(resolved.homeTeamName);
    const resolvedAway = normalizeString(resolved.awayTeamName);
    const slotHome = getSlotTeamName(slotAssignments.home);
    const slotAway = getSlotTeamName(slotAssignments.away);
    const opponent = normalizeString(game?.opponent);
    const currentTeam = normalizeString(currentTeamName);

    if (resolvedHome && resolvedAway) {
        return { homeTeam: resolvedHome, awayTeam: resolvedAway };
    }

    if (slotHome && slotAway) {
        return { homeTeam: slotHome, awayTeam: slotAway };
    }

    if (currentTeam && opponent) {
        const isHome = game?.isHome !== false;
        return isHome
            ? { homeTeam: currentTeam, awayTeam: opponent }
            : { homeTeam: opponent, awayTeam: currentTeam };
    }

    return {
        homeTeam: resolvedHome || slotHome || currentTeam || null,
        awayTeam: resolvedAway || slotAway || opponent || null
    };
}

function isCompletedTournamentPoolGame(game = {}) {
    return String(game?.competitionType || '').toLowerCase() === 'tournament'
        && normalizeString(game?.tournament?.poolName)
        && ['completed', 'final'].includes(String(game?.status || '').toLowerCase())
        && Number.isFinite(Number(game?.homeScore))
        && Number.isFinite(Number(game?.awayScore));
}

export function applyTournamentStandingsOverride(rowsInput = [], override = null) {
    const rows = Array.isArray(rowsInput) ? rowsInput.map((row) => ({ ...row })) : [];
    const teamOrder = Array.isArray(override?.teamOrder)
        ? override.teamOrder.map(normalizeString).filter(Boolean)
        : [];

    if (!teamOrder.length) {
        return {
            rows: rows.map((row, index) => ({ ...row, rank: index + 1 })),
            isOverridden: false,
            override: null
        };
    }

    const remaining = [...rows];
    const ordered = [];
    teamOrder.forEach((teamName) => {
        const matchIndex = remaining.findIndex((row) => normalizeString(row?.team) === teamName);
        if (matchIndex >= 0) {
            ordered.push(remaining.splice(matchIndex, 1)[0]);
        }
    });

    const finalRows = [...ordered, ...remaining].map((row, index) => ({
        ...row,
        rank: index + 1
    }));

    return {
        rows: finalRows,
        isOverridden: ordered.length > 0,
        override: ordered.length > 0 ? override : null
    };
}

function getPoolOverride(poolOverrides = {}, poolName) {
    if (!poolOverrides || typeof poolOverrides !== 'object') return null;
    return poolOverrides[buildTournamentPoolOverrideKey(poolName)] || null;
}

export function buildTournamentPoolStandings(gamesInput = [], options = {}) {
    const games = Array.isArray(gamesInput) ? gamesInput : [];
    const currentTeamName = normalizeString(options?.currentTeamName);
    const standingsConfig = options?.standingsConfig || {};
    const poolOverrides = options?.poolOverrides || {};
    const poolGames = new Map();

    games.forEach((game) => {
        if (!isCompletedTournamentPoolGame(game)) return;
        const poolName = normalizeString(game?.tournament?.poolName);
        const { homeTeam, awayTeam } = getTournamentGameTeams(game, currentTeamName);
        if (!poolName || !homeTeam || !awayTeam) return;
        if (homeTeam === awayTeam) return;

        const normalizedGame = {
            homeTeam,
            awayTeam,
            homeScore: Number(game.homeScore),
            awayScore: Number(game.awayScore),
            status: 'completed'
        };
        const existing = poolGames.get(poolName) || [];
        existing.push(normalizedGame);
        poolGames.set(poolName, existing);
    });

    return Array.from(poolGames.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .reduce((acc, [poolName, poolGameList]) => {
            const computedRows = computeNativeStandings(poolGameList, standingsConfig).map((row) => ({
                ...row,
                teamName: row.team
            }));
            const override = getPoolOverride(poolOverrides, poolName);
            const applied = applyTournamentStandingsOverride(computedRows, override);
            acc[poolName] = {
                poolName,
                gameCount: poolGameList.length,
                computedRows,
                rows: applied.rows,
                isOverridden: applied.isOverridden,
                override: applied.override
            };
            return acc;
        }, {});
}
