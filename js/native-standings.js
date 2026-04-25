function toInt(value) {
    const n = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) ? n : 0;
}

function toNullableInt(value) {
    if (value === '' || value == null) return null;
    const n = Number.parseInt(String(value), 10);
    return Number.isFinite(n) ? n : null;
}

function normalizeTeamName(value) {
    return String(value || '').trim();
}

function safeRankingMode(value) {
    return value === 'win_pct' ? 'win_pct' : 'points';
}

function safePointsSchema(points) {
    const source = points && typeof points === 'object' ? points : {};
    return {
        win: toInt(source.win ?? 3),
        tie: toInt(source.tie ?? 1),
        loss: toInt(source.loss ?? 0)
    };
}

function normalizeTiebreaker(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    if (normalized === 'goal_diff') return 'point_diff';
    if (normalized === 'goals_for') return 'points_for';
    if (normalized === 'fewest_goals_allowed') return 'fewest_points_against';
    if (normalized === 'most_games_won') return 'wins';
    return normalized;
}

function safeTiebreakers(list, defaults) {
    if (!Array.isArray(list) || list.length === 0) return [...defaults];
    const normalized = list
        .map(normalizeTiebreaker)
        .filter(Boolean);
    return normalized.length > 0 ? normalized : [...defaults];
}

function safeMaxGoalDiff(value) {
    const parsed = toNullableInt(value);
    if (!Number.isFinite(parsed) || parsed == null || parsed <= 0) return null;
    return parsed;
}

function compareNumbersDesc(a, b) {
    if (a === b) return 0;
    return a > b ? -1 : 1;
}

function compareNumbersAsc(a, b) {
    if (a === b) return 0;
    return a < b ? -1 : 1;
}

function isFinalGameStatus(game) {
    const status = String(game?.status || '').toLowerCase();
    return status === 'completed' || status === 'final';
}

function safeStandingsConfig(configInput = {}) {
    const points = safePointsSchema(configInput.points);
    const defaults = ['head_to_head', 'point_diff', 'points_for', 'fewest_points_against', 'name'];
    const multiDefaults = ['group_head_to_head', 'point_diff', 'points_for', 'fewest_points_against', 'name'];
    const legacyTiebreakers = safeTiebreakers(configInput.tiebreakers, defaults);
    const twoTeamTiebreakers = safeTiebreakers(configInput.twoTeamTiebreakers, legacyTiebreakers);
    const multiTeamFallback = legacyTiebreakers.map((item) => item === 'head_to_head' ? 'group_head_to_head' : item);
    const multiTeamTiebreakers = safeTiebreakers(configInput.multiTeamTiebreakers, multiTeamFallback.length ? multiTeamFallback : multiDefaults);

    return {
        rankingMode: safeRankingMode(configInput.rankingMode),
        points,
        maxGoalDiff: safeMaxGoalDiff(configInput.maxGoalDiff),
        tiebreakers: legacyTiebreakers,
        twoTeamTiebreakers,
        multiTeamTiebreakers
    };
}

function getCappedDiff(homeScore, awayScore, maxGoalDiff) {
    const diff = homeScore - awayScore;
    if (!Number.isFinite(maxGoalDiff)) return diff;
    if (diff === 0) return 0;
    return Math.sign(diff) * Math.min(Math.abs(diff), maxGoalDiff);
}

function buildRecordString(entry) {
    return entry.t > 0 ? `${entry.w}-${entry.l}-${entry.t}` : `${entry.w}-${entry.l}`;
}

function buildRawTable(games, config) {
    const tableByTeam = new Map();

    for (const game of games) {
        const homeTeam = normalizeTeamName(game?.homeTeam);
        const awayTeam = normalizeTeamName(game?.awayTeam);
        const homeScore = Number(game?.homeScore);
        const awayScore = Number(game?.awayScore);

        if (!homeTeam || !awayTeam) continue;
        if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

        if (!tableByTeam.has(homeTeam)) {
            tableByTeam.set(homeTeam, { team: homeTeam, gp: 0, w: 0, l: 0, t: 0, pf: 0, pa: 0, pd: 0, points: 0 });
        }
        if (!tableByTeam.has(awayTeam)) {
            tableByTeam.set(awayTeam, { team: awayTeam, gp: 0, w: 0, l: 0, t: 0, pf: 0, pa: 0, pd: 0, points: 0 });
        }

        const homeEntry = tableByTeam.get(homeTeam);
        const awayEntry = tableByTeam.get(awayTeam);
        const cappedDiff = getCappedDiff(homeScore, awayScore, config.maxGoalDiff);

        homeEntry.gp += 1;
        awayEntry.gp += 1;
        homeEntry.pf += homeScore;
        homeEntry.pa += awayScore;
        awayEntry.pf += awayScore;
        awayEntry.pa += homeScore;
        homeEntry.pd += cappedDiff;
        awayEntry.pd -= cappedDiff;

        if (homeScore > awayScore) {
            homeEntry.w += 1;
            awayEntry.l += 1;
            homeEntry.points += config.points.win;
            awayEntry.points += config.points.loss;
        } else if (homeScore < awayScore) {
            awayEntry.w += 1;
            homeEntry.l += 1;
            awayEntry.points += config.points.win;
            homeEntry.points += config.points.loss;
        } else {
            homeEntry.t += 1;
            awayEntry.t += 1;
            homeEntry.points += config.points.tie;
            awayEntry.points += config.points.tie;
        }
    }

    return Array.from(tableByTeam.values()).map((entry) => {
        const gp = entry.gp || 0;
        return {
            ...entry,
            winPct: gp > 0 ? (entry.w + (entry.t * 0.5)) / gp : 0,
            record: buildRecordString(entry)
        };
    });
}

function getPrimaryMetric(entry, config) {
    return config.rankingMode === 'win_pct' ? entry.winPct : entry.points;
}

function getApplicableTiebreakers(config, groupSize) {
    if (groupSize > 2) return config.multiTeamTiebreakers;
    return config.twoTeamTiebreakers;
}

function buildHeadToHeadMetric(group, allGames, config) {
    const teamSet = new Set(group.map((row) => row.team));
    const relevantGames = allGames.filter((game) => teamSet.has(normalizeTeamName(game?.homeTeam)) && teamSet.has(normalizeTeamName(game?.awayTeam)));
    if (relevantGames.length === 0) return null;

    const miniTable = buildRawTable(relevantGames, config);
    if (miniTable.length === 0) return null;

    const values = new Map();
    for (const row of miniTable) {
        values.set(row.team, getPrimaryMetric(row, config));
    }

    return group.map((row) => ({
        row,
        value: values.has(row.team) ? values.get(row.team) : null
    }));
}

function buildTiebreakerValues(tiebreaker, group, allGames, config) {
    if (tiebreaker === 'head_to_head') {
        if (group.length !== 2) return null;
        return buildHeadToHeadMetric(group, allGames, config);
    }
    if (tiebreaker === 'group_head_to_head') {
        if (group.length <= 2) return null;
        return buildHeadToHeadMetric(group, allGames, config);
    }
    if (tiebreaker === 'point_diff') {
        return group.map((row) => ({ row, value: row.pd }));
    }
    if (tiebreaker === 'points_for') {
        return group.map((row) => ({ row, value: row.pf }));
    }
    if (tiebreaker === 'fewest_points_against') {
        return group.map((row) => ({ row, value: row.pa }));
    }
    if (tiebreaker === 'wins') {
        return group.map((row) => ({ row, value: row.w }));
    }
    if (tiebreaker === 'name') {
        return group.map((row) => ({ row, value: row.team }));
    }
    return null;
}

function compareTiebreakerValues(tiebreaker, a, b) {
    if (tiebreaker === 'fewest_points_against') return compareNumbersAsc(a, b);
    if (tiebreaker === 'name') return String(a).localeCompare(String(b));
    return compareNumbersDesc(a, b);
}

function partitionTieGroup(group, tiebreaker, values) {
    const ordered = values
        .filter((item) => item.value != null)
        .sort((a, b) => {
            const decision = compareTiebreakerValues(tiebreaker, a.value, b.value);
            if (decision !== 0) return decision;
            return a.row.team.localeCompare(b.row.team);
        });

    if (ordered.length !== group.length) return [group];

    const partitions = [];
    let current = [];

    for (const item of ordered) {
        if (current.length === 0) {
            current.push(item);
            continue;
        }

        const last = current[current.length - 1];
        if (compareTiebreakerValues(tiebreaker, last.value, item.value) === 0) {
            current.push(item);
            continue;
        }

        partitions.push(current.map((entry) => entry.row));
        current = [item];
    }

    if (current.length > 0) {
        partitions.push(current.map((entry) => entry.row));
    }

    return partitions.length > 0 ? partitions : [group];
}

function resolveTieGroup(group, tiebreakers, allGames, config) {
    if (group.length <= 1) return [...group];
    if (!Array.isArray(tiebreakers) || tiebreakers.length === 0) {
        return [...group].sort((a, b) => a.team.localeCompare(b.team));
    }

    const [current, ...rest] = tiebreakers;
    const values = buildTiebreakerValues(current, group, allGames, config);
    if (!values) {
        return resolveTieGroup(group, rest, allGames, config);
    }

    const partitions = partitionTieGroup(group, current, values);
    if (partitions.length === 1 && partitions[0].length === group.length) {
        return resolveTieGroup(group, rest, allGames, config);
    }

    return partitions.flatMap((partition) => {
        const nextTiebreakers = getApplicableTiebreakers(config, partition.length);
        return resolveTieGroup(partition, nextTiebreakers, allGames, config);
    });
}

function resolveTieGroupWithMetadata(group, tiebreakers, allGames, config) {
    if (group.length <= 1) return [{ rows: [...group], unresolved: false }];
    if (!Array.isArray(tiebreakers) || tiebreakers.length === 0) {
        return [{ rows: [...group].sort((a, b) => a.team.localeCompare(b.team)), unresolved: true }];
    }

    const [current, ...rest] = tiebreakers;
    if (current === 'name') {
        return [{ rows: [...group].sort((a, b) => a.team.localeCompare(b.team)), unresolved: true }];
    }

    const values = buildTiebreakerValues(current, group, allGames, config);
    if (!values) {
        return resolveTieGroupWithMetadata(group, rest, allGames, config);
    }

    const partitions = partitionTieGroup(group, current, values);
    if (partitions.length === 1 && partitions[0].length === group.length) {
        return resolveTieGroupWithMetadata(group, rest, allGames, config);
    }

    return partitions.flatMap((partition) => {
        if (partition.length <= 1) return [{ rows: [...partition], unresolved: false }];
        const nextTiebreakers = getApplicableTiebreakers(config, partition.length);
        return resolveTieGroupWithMetadata(partition, nextTiebreakers, allGames, config);
    });
}

function sortStandingsTable(table, allGames, config) {
    const primaryGroups = new Map();
    for (const row of table) {
        const key = String(getPrimaryMetric(row, config));
        const existing = primaryGroups.get(key) || [];
        existing.push(row);
        primaryGroups.set(key, existing);
    }

    const sortedPrimaryKeys = Array.from(primaryGroups.keys()).sort((a, b) => compareNumbersDesc(Number(a), Number(b)));
    const resolved = [];

    for (const key of sortedPrimaryKeys) {
        const group = primaryGroups.get(key) || [];
        const tiebreakers = getApplicableTiebreakers(config, group.length);
        resolved.push(...resolveTieGroup(group, tiebreakers, allGames, config));
    }

    return resolved;
}

function sortStandingsTableWithMetadata(table, allGames, config) {
    const primaryGroups = new Map();
    for (const row of table) {
        const key = String(getPrimaryMetric(row, config));
        const existing = primaryGroups.get(key) || [];
        existing.push(row);
        primaryGroups.set(key, existing);
    }

    const sortedPrimaryKeys = Array.from(primaryGroups.keys()).sort((a, b) => compareNumbersDesc(Number(a), Number(b)));
    const resolved = [];

    for (const key of sortedPrimaryKeys) {
        const group = primaryGroups.get(key) || [];
        const tiebreakers = getApplicableTiebreakers(config, group.length);
        resolved.push(...resolveTieGroupWithMetadata(group, tiebreakers, allGames, config));
    }

    return resolved;
}

export function computeNativeStandings(gamesInput, configInput = {}) {
    const games = Array.isArray(gamesInput) ? gamesInput : [];
    const completedGames = games.filter(isFinalGameStatus);
    const config = safeStandingsConfig(configInput);
    const table = buildRawTable(completedGames, config);
    const sortedTable = sortStandingsTable(table, completedGames, config);

    return sortedTable.map((row, index) => ({
        ...row,
        rank: index + 1
    }));
}

export function computeNativeStandingsDetailed(gamesInput, configInput = {}) {
    const games = Array.isArray(gamesInput) ? gamesInput : [];
    const completedGames = games.filter(isFinalGameStatus);
    const config = safeStandingsConfig(configInput);
    const table = buildRawTable(completedGames, config);
    const segments = sortStandingsTableWithMetadata(table, completedGames, config);
    const rows = [];
    let placementRank = 1;

    for (const segment of segments) {
        const unresolvedTie = !!(segment?.unresolved && Array.isArray(segment.rows) && segment.rows.length > 1);
        const displayRank = unresolvedTie ? `T-${placementRank}` : null;

        segment.rows.forEach((row, index) => {
            rows.push({
                ...row,
                rank: rows.length + 1,
                placementRank,
                displayRank: displayRank || String(placementRank + index),
                unresolvedTie
            });
        });

        placementRank += segment.rows.length;
    }

    return rows;
}
