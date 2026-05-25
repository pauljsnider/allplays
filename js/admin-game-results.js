function toDate(value) {
    if (!value) return null;
    if (value.toDate) return value.toDate();
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function hasScore(game) {
    const homeScore = toNumber(game?.homeScore);
    const awayScore = toNumber(game?.awayScore);
    return homeScore !== null && awayScore !== null && (homeScore !== 0 || awayScore !== 0);
}

function isRecentResultCandidate(game) {
    const status = String(game?.status || '').toLowerCase();
    return status === 'completed' || hasScore(game);
}

function getResultStatus(homeScore, awayScore) {
    if (homeScore === null || awayScore === null) return 'Played';
    if (homeScore > awayScore) return 'Win';
    if (homeScore < awayScore) return 'Loss';
    return 'Tie';
}

export function formatGameResult(game = {}) {
    const homeScore = toNumber(game.homeScore);
    const awayScore = toNumber(game.awayScore);
    const score = homeScore !== null && awayScore !== null ? `${homeScore}-${awayScore}` : 'No score';
    const status = String(game.status || '').toLowerCase() === 'completed'
        ? getResultStatus(homeScore, awayScore)
        : 'Scored';

    return { score, status };
}

export function buildRecentGameResultsRows(games = [], { limit = 10 } = {}) {
    return games
        .filter(isRecentResultCandidate)
        .map((game) => {
            const date = toDate(game.date);
            const { score, status } = formatGameResult(game);
            return {
                teamId: game.teamId || '',
                gameId: game.id || game.gameId || '',
                teamName: game.teamName || 'Unknown team',
                opponent: game.opponent || 'Opponent',
                date,
                dateLabel: date ? date.toLocaleDateString() : 'Unknown date',
                score,
                status
            };
        })
        .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
        .slice(0, limit);
}
