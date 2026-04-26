function normalizeString(value) {
    const text = String(value || '').trim();
    return text || null;
}

function normalizeSeed(value) {
    const seed = Number.parseInt(value, 10);
    return Number.isFinite(seed) && seed > 0 ? seed : null;
}

function getTournamentPoolLabel(source = {}, context = {}) {
    const divisionName = normalizeString(source.divisionName)
        || normalizeString(source.division)
        || normalizeString(context.divisionName)
        || normalizeString(context.division);
    const poolName = normalizeString(source.poolName) || normalizeString(context.poolName);
    if (divisionName && poolName) return `${divisionName} • ${poolName}`;
    return poolName || divisionName;
}

function isCompletedTournamentGame(game) {
    return String(game?.status || '').toLowerCase() === 'completed'
        && Number.isFinite(Number(game?.homeScore))
        && Number.isFinite(Number(game?.awayScore));
}

function normalizePoolRanking(ranking = []) {
    return (Array.isArray(ranking) ? ranking : [])
        .map((row) => normalizeString(row?.teamName || row?.team || row?.name || row))
        .map((teamName) => (teamName ? { teamName } : null));
}

function upsertPoolStanding(poolStandings = {}, poolName, seed, teamName) {
    if (!poolName || !seed || !teamName) return;
    if (!Array.isArray(poolStandings[poolName])) {
        poolStandings[poolName] = [];
    }
    if (!poolStandings[poolName][seed - 1]) {
        poolStandings[poolName][seed - 1] = { teamName };
    }
}

export function describeTournamentSource(source = {}, context = {}) {
    const sourceType = normalizeString(source.sourceType) || 'team';
    if (sourceType === 'pool_seed') {
        const poolName = getTournamentPoolLabel(source, context) || 'Pool';
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

function getPoolSeedTeamName(poolStandings = {}, source = {}, context = {}) {
    const poolName = getTournamentPoolLabel(source, context);
    const seed = normalizeSeed(source.seed);
    if (!poolName || !seed) return null;
    const fallbackPoolName = normalizeString(source.poolName) || normalizeString(context.poolName);
    const poolRows = Array.isArray(poolStandings?.[poolName])
        ? poolStandings[poolName]
        : (fallbackPoolName && Array.isArray(poolStandings?.[fallbackPoolName]) ? poolStandings[fallbackPoolName] : []);
    const row = poolRows[seed - 1];
    return normalizeString(row?.teamName || row?.team || row?.name);
}

function resolveGameResultSlot(gamesById, source, poolStandings, memo, context = {}) {
    const upstreamId = normalizeString(source.gameId);
    if (!upstreamId) {
        return { teamName: null, label: describeTournamentSource(source, context), ready: false };
    }
    const upstream = gamesById.get(upstreamId);
    if (!upstream) {
        return { teamName: null, label: describeTournamentSource(source, context), ready: false };
    }

    const upstreamResolved = resolveTournamentGame(upstream, gamesById, poolStandings, memo);
    const outcome = normalizeString(source.outcome) || 'winner';
    const side = outcome === 'loser' ? getTournamentLoser(upstream) : getTournamentWinner(upstream);
    if (!side) {
        return { teamName: null, label: describeTournamentSource(source, context), ready: false };
    }

    const teamName = side === 'home'
        ? upstreamResolved.homeTeamName
        : upstreamResolved.awayTeamName;

    return {
        teamName: teamName || null,
        label: teamName || describeTournamentSource(source, context),
        ready: !!teamName
    };
}

function resolveTournamentSource(source = {}, gamesById, poolStandings, memo, context = {}) {
    const sourceType = normalizeString(source.sourceType) || 'team';
    if (sourceType === 'pool_seed') {
        const teamName = getPoolSeedTeamName(poolStandings, source, context);
        return {
            teamName,
            label: teamName || describeTournamentSource(source, context),
            ready: !!teamName
        };
    }
    if (sourceType === 'game_result') {
        return resolveGameResultSlot(gamesById, source, poolStandings, memo, context);
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

    const home = resolveTournamentSource(slotAssignments.home || {}, gamesById, poolStandings, memo, tournament);
    const away = resolveTournamentSource(slotAssignments.away || {}, gamesById, poolStandings, memo, tournament);
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

export function buildPoolStandingsIndex(games = []) {
    const poolStandings = {};

    (games || []).forEach((game) => {
        const tournament = game?.tournament || {};
        const slotAssignments = tournament.slotAssignments || {};
        const resolved = tournament.resolved || {};

        [
            { slot: slotAssignments.home || {}, teamName: resolved.homeTeamName },
            { slot: slotAssignments.away || {}, teamName: resolved.awayTeamName }
        ].forEach(({ slot, teamName }) => {
            if ((normalizeString(slot.sourceType) || 'team') !== 'pool_seed') return;
            upsertPoolStanding(
                poolStandings,
                getTournamentPoolLabel(slot, tournament),
                normalizeSeed(slot.seed),
                normalizeString(teamName)
            );
        });
    });

    return poolStandings;
}

export function collectTournamentPoolSeeds(games = [], poolNameInput) {
    const poolName = normalizeString(poolNameInput);
    const seeds = new Set();

    (games || []).forEach((game) => {
        const tournament = game?.tournament || {};
        const slotAssignments = tournament.slotAssignments || {};
        [slotAssignments.home || {}, slotAssignments.away || {}].forEach((slot) => {
            if ((normalizeString(slot.sourceType) || 'team') !== 'pool_seed') return;
            if (getTournamentPoolLabel(slot, tournament) !== poolName) return;
            const seed = normalizeSeed(slot.seed);
            if (seed) seeds.add(seed);
        });
    });

    return Array.from(seeds).sort((a, b) => a - b);
}

function buildTournamentAdvancementPreviewRows(games = [], patches = []) {
    const gamesById = new Map((games || []).filter((game) => game?.id).map((game) => [game.id, game]));

    return (patches || []).flatMap((patch) => {
        const game = gamesById.get(patch?.gameId) || {};
        const tournament = game?.tournament || {};
        const currentResolved = tournament.resolved || {};
        const nextResolved = patch?.tournament?.resolved || {};
        const slotAssignments = tournament.slotAssignments || {};

        return ['home', 'away'].map((slot) => {
            const currentTeamName = normalizeString(currentResolved?.[`${slot}TeamName`]);
            const nextTeamName = normalizeString(nextResolved?.[`${slot}TeamName`]);
            const currentLabel = normalizeString(currentResolved?.[`${slot}Label`])
                || describeTournamentSource(slotAssignments?.[slot] || {}, tournament);
            const nextLabel = normalizeString(nextResolved?.[`${slot}Label`])
                || describeTournamentSource(slotAssignments?.[slot] || {}, tournament);

            if (currentTeamName === nextTeamName && currentLabel === nextLabel) return null;

            return {
                gameId: patch.gameId,
                slot,
                slotLabel: slot === 'home' ? 'Home' : 'Away',
                sourceLabel: describeTournamentSource(slotAssignments?.[slot] || {}, tournament),
                currentLabel,
                nextLabel,
                currentTeamName,
                nextTeamName,
                overwritesExistingTeam: !!(currentTeamName && nextTeamName && currentTeamName !== nextTeamName)
            };
        }).filter(Boolean);
    });
}

export function collectTournamentAdvancementPatches(games = [], options = {}) {
    const hasPoolStandingsOption = Object.prototype.hasOwnProperty.call(options || {}, 'poolStandings');
    const poolStandings = hasPoolStandingsOption ? (options?.poolStandings || {}) : buildPoolStandingsIndex(games);
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

export function planTournamentPoolAdvancement(games = [], options = {}) {
    const poolName = normalizeString(options?.poolName);
    const requiredSeeds = collectTournamentPoolSeeds(games, poolName);
    const ranking = normalizePoolRanking(options?.ranking || []);

    if (!poolName) {
        return {
            skipped: true,
            reason: 'Pool name is required to advance bracket slots.',
            poolName: null,
            requiredSeeds,
            missingSeeds: [],
            patches: [],
            previewRows: [],
            requiresOverwriteConfirmation: false
        };
    }

    if (!requiredSeeds.length) {
        return {
            skipped: true,
            reason: `No eligible pool-seed bracket slots were found for ${poolName}.`,
            poolName,
            requiredSeeds,
            missingSeeds: [],
            patches: [],
            previewRows: [],
            requiresOverwriteConfirmation: false
        };
    }

    if (!ranking.length) {
        return {
            skipped: true,
            reason: 'No finalized ranking was provided for this pool.',
            poolName,
            requiredSeeds,
            missingSeeds: requiredSeeds,
            patches: [],
            previewRows: [],
            requiresOverwriteConfirmation: false
        };
    }

    const missingSeeds = requiredSeeds.filter((seed) => !ranking[seed - 1]?.teamName);
    if (missingSeeds.length) {
        return {
            skipped: true,
            reason: `Missing finalized team name for seed${missingSeeds.length === 1 ? '' : 's'} ${missingSeeds.map((seed) => `#${seed}`).join(', ')}.`,
            poolName,
            requiredSeeds,
            missingSeeds,
            patches: [],
            previewRows: [],
            requiresOverwriteConfirmation: false
        };
    }

    const basePoolStandings = {
        ...buildPoolStandingsIndex(games),
        ...(options?.poolStandings || {})
    };
    const poolStandings = {
        ...basePoolStandings,
        [poolName]: ranking
    };
    const patches = collectTournamentAdvancementPatches(games, { poolStandings });
    const previewRows = buildTournamentAdvancementPreviewRows(games, patches);

    return {
        skipped: false,
        reason: null,
        poolName,
        requiredSeeds,
        missingSeeds: [],
        patches,
        previewRows,
        requiresOverwriteConfirmation: previewRows.some((row) => row.overwritesExistingTeam),
        poolStandings
    };
}
