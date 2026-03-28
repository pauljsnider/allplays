function toInt(value) {
    const n = Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(n) ? n : 0;
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

function safeTiebreakers(list) {
    const defaults = ['head_to_head', 'point_diff', 'points_for', 'fewest_points_against', 'name'];
    if (!Array.isArray(list) || list.length === 0) return defaults;
    return list
        .map((item) => String(item || '').trim())
        .filter(Boolean);
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

function getHeadToHeadSummary(games, teamA, teamB) {
    let winsA = 0;
    let winsB = 0;
    let ties = 0;

    for (const game of games) {
        if (!game) continue;
        const homeTeam = normalizeTeamName(game.homeTeam);
        const awayTeam = normalizeTeamName(game.awayTeam);
        const involvesPair = (homeTeam === teamA && awayTeam === teamB) || (homeTeam === teamB && awayTeam === teamA);
        if (!involvesPair) continue;

        const homeScore = Number(game.homeScore);
        const awayScore = Number(game.awayScore);
        if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;

        if (homeScore === awayScore) {
            ties += 1;
            continue;
        }

        const homeWon = homeScore > awayScore;
        const winner = homeWon ? homeTeam : awayTeam;
        if (winner === teamA) winsA += 1;
        if (winner === teamB) winsB += 1;
    }

    const total = winsA + winsB + ties;
    if (total === 0) return null;
    return {
        teamAWinPct: (winsA + ties * 0.5) / total,
        teamBWinPct: (winsB + ties * 0.5) / total
    };
}

function compareByTiebreaker(tiebreaker, a, b, allGames) {
    if (tiebreaker === 'head_to_head') {
        const hh = getHeadToHeadSummary(allGames, a.team, b.team);
        if (!hh) return 0;
        return compareNumbersDesc(hh.teamAWinPct, hh.teamBWinPct);
    }
    if (tiebreaker === 'point_diff') return compareNumbersDesc(a.pd, b.pd);
    if (tiebreaker === 'points_for') return compareNumbersDesc(a.pf, b.pf);
    if (tiebreaker === 'fewest_points_against') return compareNumbersAsc(a.pa, b.pa);
    if (tiebreaker === 'wins') return compareNumbersDesc(a.w, b.w);
    if (tiebreaker === 'name') return a.team.localeCompare(b.team);
    return 0;
}

function buildRecordString(entry) {
    return entry.t > 0 ? `${entry.w}-${entry.l}-${entry.t}` : `${entry.w}-${entry.l}`;
}

export function computeNativeStandings(gamesInput, configInput = {}) {
    const games = Array.isArray(gamesInput) ? gamesInput : [];
    const completedGames = games.filter(isFinalGameStatus);
    const rankingMode = safeRankingMode(configInput.rankingMode);
    const pointsSchema = safePointsSchema(configInput.points);
    const tiebreakers = safeTiebreakers(configInput.tiebreakers);

    const tableByTeam = new Map();

    for (const game of completedGames) {
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

        homeEntry.gp += 1;
        awayEntry.gp += 1;
        homeEntry.pf += homeScore;
        homeEntry.pa += awayScore;
        awayEntry.pf += awayScore;
        awayEntry.pa += homeScore;

        if (homeScore > awayScore) {
            homeEntry.w += 1;
            awayEntry.l += 1;
            homeEntry.points += pointsSchema.win;
            awayEntry.points += pointsSchema.loss;
        } else if (homeScore < awayScore) {
            awayEntry.w += 1;
            homeEntry.l += 1;
            awayEntry.points += pointsSchema.win;
            homeEntry.points += pointsSchema.loss;
        } else {
            homeEntry.t += 1;
            awayEntry.t += 1;
            homeEntry.points += pointsSchema.tie;
            awayEntry.points += pointsSchema.tie;
        }
    }

    const table = Array.from(tableByTeam.values()).map((entry) => {
        const gp = entry.gp || 0;
        const winPct = gp > 0 ? (entry.w + (entry.t * 0.5)) / gp : 0;
        const pd = entry.pf - entry.pa;
        return {
            ...entry,
            pd,
            winPct,
            record: buildRecordString(entry)
        };
    });

    table.sort((a, b) => {
        const primary = rankingMode === 'win_pct'
            ? compareNumbersDesc(a.winPct, b.winPct)
            : compareNumbersDesc(a.points, b.points);
        if (primary !== 0) return primary;

        for (const tiebreaker of tiebreakers) {
            const decision = compareByTiebreaker(tiebreaker, a, b, completedGames);
            if (decision !== 0) return decision;
        }

        return a.team.localeCompare(b.team);
    });

    return table.map((row, index) => ({
        ...row,
        rank: index + 1
    }));
}
