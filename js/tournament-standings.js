import { computeNativeStandings, computeNativeStandingsDetailed } from './native-standings.js';

function normalizeString(value) {
    const text = String(value || '').trim();
    return text || null;
}

function buildLegacyTournamentPoolOverrideKey(poolName) {
    const normalized = normalizeString(poolName);
    if (!normalized) return 'pool';
    return normalized
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'pool';
}

function hashTournamentPoolName(poolName) {
    const normalized = normalizeString(poolName) || '';
    let hash = 2166136261;
    for (let index = 0; index < normalized.length; index += 1) {
        hash ^= normalized.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function buildTournamentPoolOverrideKey(poolName) {
    const normalized = normalizeString(poolName);
    if (!normalized) return 'pool-00000000';
    return `${buildLegacyTournamentPoolOverrideKey(normalized)}-${hashTournamentPoolName(normalized)}`;
}

export function buildTournamentGroupOverrideKey(groupKey) {
    const normalized = normalizeString(groupKey);
    if (!normalized) return null;
    return `group-${Array.from(normalized)
        .map((character) => character.codePointAt(0).toString(16))
        .join('-')}`;
}

function getSlotTeamName(slot = {}) {
    if (String(slot?.sourceType || '').toLowerCase() !== 'team') return null;
    return normalizeString(slot?.teamName);
}

function isTournamentGame(game = {}) {
    return String(game?.competitionType || '').toLowerCase() === 'tournament';
}

function hasFiniteScore(value) {
    if (value === '' || value == null) return false;
    if (typeof value === 'string' && value.trim() === '') return false;
    return Number.isFinite(Number(value));
}

function hasCompletedTournamentScore(game = {}) {
    return ['completed', 'final'].includes(String(game?.status || '').toLowerCase())
        && hasFiniteScore(game?.homeScore)
        && hasFiniteScore(game?.awayScore);
}

function getTournamentPoolName(game = {}) {
    return normalizeString(game?.tournament?.poolName);
}

function getTournamentDivisionName(game = {}) {
    return normalizeString(game?.tournament?.divisionName)
        || normalizeString(game?.tournament?.division);
}

export function getTournamentStandingsGroupIdentity(game = {}) {
    return {
        divisionName: getTournamentDivisionName(game) || '',
        poolName: getTournamentPoolName(game) || ''
    };
}

export function getTournamentStandingsGroupKey(game = {}) {
    const group = getTournamentStandingsGroupIdentity(game);
    return group.divisionName || group.poolName
        ? JSON.stringify([group.divisionName, group.poolName])
        : null;
}

export function getTournamentStandingsGroupName(game = {}) {
    const { divisionName, poolName } = getTournamentStandingsGroupIdentity(game);
    if (divisionName && poolName) return `${divisionName} • ${poolName}`;
    return poolName || divisionName || null;
}

export function matchesTournamentStandingsGroup(game = {}, group = {}) {
    if (!isTournamentGame(game)) return false;
    const actual = getTournamentStandingsGroupIdentity(game);
    const expected = {
        divisionName: normalizeString(group?.divisionName || group?.division) || '',
        poolName: normalizeString(group?.poolName) || ''
    };
    return actual.divisionName === expected.divisionName && actual.poolName === expected.poolName;
}

function getTournamentGroupDisplayName(divisionName, poolName) {
    if (divisionName && poolName) return `${divisionName} • ${poolName}`;
    return poolName || divisionName || null;
}

function normalizeConfiguredTournamentGroup(value, sourceType = 'display') {
    if (typeof value === 'string') {
        const name = normalizeString(value);
        if (!name) return null;
        if (sourceType === 'division') {
            return { groupKey: JSON.stringify([name, '']), groupName: name, displayOnly: false };
        }
        if (sourceType === 'pool') {
            return { groupKey: JSON.stringify(['', name]), groupName: name, displayOnly: false };
        }
        return { groupKey: null, groupName: name, displayOnly: true };
    }
    if (!value || typeof value !== 'object') return null;
    const divisionName = normalizeString(value.divisionName) || normalizeString(value.division);
    const poolName = normalizeString(value.poolName);
    if (divisionName || poolName) {
        return {
            groupKey: JSON.stringify([divisionName || '', poolName || '']),
            groupName: getTournamentGroupDisplayName(divisionName, poolName),
            displayOnly: false
        };
    }
    const groupName = normalizeString(value.name) || normalizeString(value.label);
    if (!groupName) return null;
    if (sourceType === 'division') {
        return { groupKey: JSON.stringify([groupName, '']), groupName, displayOnly: false };
    }
    if (sourceType === 'pool') {
        return { groupKey: JSON.stringify(['', groupName]), groupName, displayOnly: false };
    }
    return { groupKey: null, groupName, displayOnly: true };
}

function getConfiguredTournamentGroups(options = {}) {
    const sources = [
        { values: options.groupNames, sourceType: 'display' },
        { values: options.poolNames, sourceType: 'pool' },
        { values: options.divisionNames, sourceType: 'division' },
        { values: options.tournamentGroups, sourceType: 'display' },
        { values: options.tournamentPools, sourceType: 'pool' },
        { values: options.tournamentDivisions, sourceType: 'division' }
    ];

    return sources
        .flatMap(({ values, sourceType }) => (Array.isArray(values) ? values : [])
            .map((value) => normalizeConfiguredTournamentGroup(value, sourceType)))
        .filter(Boolean);
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
            ? {
                homeTeam: currentTeam,
                awayTeam: opponent,
                homeScore: Number(game.homeScore),
                awayScore: Number(game.awayScore)
            }
            : {
                homeTeam: opponent,
                awayTeam: currentTeam,
                homeScore: Number(game.awayScore),
                awayScore: Number(game.homeScore)
            };
    }

    return {
        homeTeam: resolvedHome || slotHome || currentTeam || null,
        awayTeam: resolvedAway || slotAway || opponent || null
    };
}

function isCompletedTournamentPoolGame(game = {}) {
    return isTournamentGame(game)
        && getTournamentStandingsGroupName(game)
        && hasCompletedTournamentScore(game);
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
        const matchIndex = remaining.findIndex((row) => normalizeString(row?.teamName || row?.team) === teamName);
        if (matchIndex >= 0) {
            ordered.push(remaining.splice(matchIndex, 1)[0]);
        }
    });

    const isApplied = ordered.length > 0;
    const finalRows = [...ordered, ...remaining].map((row, index) => ({
        ...row,
        rank: index + 1,
        ...(isApplied ? {
            displayRank: String(index + 1),
            unresolvedTie: false
        } : {})
    }));

    return {
        rows: finalRows,
        isOverridden: isApplied,
        override: isApplied ? override : null
    };
}

function getPoolOverride(poolOverrides = {}, poolName, groupKey = null, allowLegacyLookup = true) {
    if (!poolOverrides || typeof poolOverrides !== 'object') return null;
    const normalizedPoolName = normalizeString(poolName);
    if (!normalizedPoolName) return null;

    const structuredKey = buildTournamentGroupOverrideKey(groupKey);
    const structuredOverride = structuredKey ? poolOverrides[structuredKey] : null;
    if (structuredOverride && normalizeString(structuredOverride?.groupKey) === groupKey) {
        return structuredOverride;
    }
    if (!allowLegacyLookup) return null;

    const directOverride = poolOverrides[buildTournamentPoolOverrideKey(normalizedPoolName)] || null;
    if (directOverride) return directOverride;

    const legacyOverride = poolOverrides[buildLegacyTournamentPoolOverrideKey(normalizedPoolName)] || null;
    if (normalizeString(legacyOverride?.poolName) === normalizedPoolName) {
        return legacyOverride;
    }

    return Object.values(poolOverrides).find((override) => normalizeString(override?.poolName) === normalizedPoolName) || null;
}

export function buildTournamentPoolStandings(gamesInput = [], options = {}) {
    const games = Array.isArray(gamesInput) ? gamesInput : [];
    const currentTeamName = normalizeString(options?.currentTeamName || options?.teamName);
    const standingsConfig = options?.standingsConfig || {};
    const poolOverrides = options?.poolOverrides || {};
    const poolGames = new Map();

    games.forEach((game) => {
        if (!isCompletedTournamentPoolGame(game)) return;
        const groupKey = getTournamentStandingsGroupKey(game);
        const groupName = getTournamentStandingsGroupName(game);
        const groupIdentity = getTournamentStandingsGroupIdentity(game);
        const { homeTeam, awayTeam, homeScore, awayScore } = getTournamentGameTeams(game, currentTeamName);
        if (!groupKey || !groupName || !homeTeam || !awayTeam) return;
        if (homeTeam === awayTeam) return;

        const normalizedGame = {
            homeTeam,
            awayTeam,
            homeScore: Number(homeScore ?? game.homeScore),
            awayScore: Number(awayScore ?? game.awayScore),
            status: 'completed'
        };
        const existing = poolGames.get(groupKey) || {
            groupKey,
            groupName,
            divisionName: groupIdentity.divisionName,
            poolName: groupIdentity.poolName,
            games: []
        };
        existing.games.push(normalizedGame);
        poolGames.set(groupKey, existing);
    });

    const groupNameCounts = Array.from(poolGames.values()).reduce((counts, group) => {
        counts.set(group.groupName, (counts.get(group.groupName) || 0) + 1);
        return counts;
    }, new Map());

    return Array.from(poolGames.entries())
        .sort((a, b) => a[1].groupName.localeCompare(b[1].groupName) || a[0].localeCompare(b[0]))
        .reduce((acc, [groupKey, group]) => {
            const poolGameList = group.games;
            const computedRows = computeNativeStandings(poolGameList, standingsConfig).map((row) => ({
                ...row,
                teamName: row.team
            }));
            // Legacy overrides are display-label keyed. Do not apply an
            // ambiguous override to multiple distinct structured groups.
            const override = getPoolOverride(
                poolOverrides,
                group.groupName,
                groupKey,
                groupNameCounts.get(group.groupName) === 1
            );
            const applied = applyTournamentStandingsOverride(computedRows, override);
            acc[groupKey] = {
                groupKey,
                groupName: group.groupName,
                divisionName: group.divisionName,
                poolName: group.groupName,
                gameCount: poolGameList.length,
                computedRows,
                rows: applied.rows,
                isOverridden: applied.isOverridden,
                override: applied.override
            };
            return acc;
        }, {});
}

export function computeTournamentPoolStandings(gamesInput, options = {}) {
    const games = Array.isArray(gamesInput) ? gamesInput : [];
    const currentTeamName = normalizeString(options?.teamName || options?.currentTeamName);
    if (!currentTeamName) return [];

    const groupGames = new Map();
    const ensureGroup = (groupKey, groupName) => {
        const normalizedGroupKey = normalizeString(groupKey);
        const normalizedGroupName = normalizeString(groupName);
        if (!normalizedGroupKey || !normalizedGroupName) return null;
        if (!groupGames.has(normalizedGroupKey)) {
            groupGames.set(normalizedGroupKey, {
                groupKey: normalizedGroupKey,
                groupName: normalizedGroupName,
                games: [],
                scheduledGameCount: 0,
                noScoreGameCount: 0
            });
        }
        return groupGames.get(normalizedGroupKey);
    };

    const configuredGroups = getConfiguredTournamentGroups(options);
    configuredGroups
        .filter((group) => !group.displayOnly)
        .forEach((group) => ensureGroup(group.groupKey, group.groupName));

    games.forEach((game) => {
        if (!isTournamentGame(game)) return;
        const groupKey = getTournamentStandingsGroupKey(game);
        const groupName = getTournamentStandingsGroupName(game);
        const group = ensureGroup(groupKey, groupName);
        if (!group) return;

        group.scheduledGameCount += 1;

        if (!hasCompletedTournamentScore(game)) {
            group.noScoreGameCount += 1;
            return;
        }

        const { homeTeam, awayTeam, homeScore, awayScore } = getTournamentGameTeams(game, currentTeamName);
        if (!groupName || !homeTeam || !awayTeam) return;
        if (homeTeam === awayTeam) return;

        const normalizedGame = {
            homeTeam,
            awayTeam,
            homeScore: Number(homeScore ?? game.homeScore),
            awayScore: Number(awayScore ?? game.awayScore),
            status: 'completed'
        };
        group.games.push(normalizedGame);
    });

    configuredGroups
        .filter((group) => group.displayOnly)
        .forEach((group) => {
            const matchingGroups = Array.from(groupGames.values())
                .filter((candidate) => candidate.groupName === group.groupName);
            if (matchingGroups.length === 1) return;
            ensureGroup(JSON.stringify(['', group.groupName]), group.groupName);
        });

    const groupNameCounts = Array.from(groupGames.values()).reduce((counts, group) => {
        counts.set(group.groupName, (counts.get(group.groupName) || 0) + 1);
        return counts;
    }, new Map());

    return Array.from(groupGames.entries())
        .sort((a, b) => a[1].groupName.localeCompare(b[1].groupName) || a[0].localeCompare(b[0]))
        .map(([groupKey, pool]) => {
            const poolName = pool.groupName;
            const poolGameList = pool.games;
            const rows = computeNativeStandingsDetailed(poolGameList, options?.standingsConfig || {}).map((row) => ({
                ...row,
                teamName: row.team
            }));
            const override = getPoolOverride(
                options?.poolOverrides || {},
                poolName,
                groupKey,
                groupNameCounts.get(poolName) === 1
            );
            const applied = applyTournamentStandingsOverride(rows, override);
            return {
                groupKey,
                poolName,
                groupName: poolName,
                gameCount: poolGameList.length,
                scheduledGameCount: pool.scheduledGameCount,
                noScoreGameCount: pool.noScoreGameCount,
                computedRows: rows,
                rows: applied.rows,
                isOverridden: applied.isOverridden,
                override: applied.override,
                unresolvedTie: applied.isOverridden ? false : rows.some((row) => row.unresolvedTie)
            };
        });
}
