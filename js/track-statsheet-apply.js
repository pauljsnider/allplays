export function isTrackStatsheetPointsColumn(colOrKey) {
    const upper = String(colOrKey || '').toUpperCase();
    return upper === 'PTS' || upper === 'POINTS' || upper === 'GOALS';
}

export function getTrackStatsheetPointsKey(columns = []) {
    const match = (columns || []).find((col) => isTrackStatsheetPointsColumn(col));
    return String(match || 'PTS').toLowerCase();
}

export function validateTrackStatsheetApplyRows(homeRows = []) {
    const includedHome = (homeRows || []).filter((row) => row?.include);

    if (includedHome.length === 0) {
        return {
            ok: false,
            alertMessage: 'Please include at least one home player.'
        };
    }

    const unmatched = includedHome.filter((row) => !row?.mappedPlayerId);
    if (unmatched.length > 0) {
        return {
            ok: false,
            alertMessage: 'Please map every included home row to a roster player or uncheck it.'
        };
    }

    const duplicateCheck = new Set();
    for (const row of includedHome) {
        if (duplicateCheck.has(row.mappedPlayerId)) {
            return {
                ok: false,
                alertMessage: 'A roster player is selected more than once. Please fix duplicates.'
            };
        }
        duplicateCheck.add(row.mappedPlayerId);
    }

    return {
        ok: true,
        includedHome
    };
}

export function buildTrackStatsheetApplyPlan({
    includedHome = [],
    includedVisitor = [],
    roster = [],
    columns = [],
    homeScore = 0,
    awayScore = 0,
    statSheetPhotoUrl = null
} = {}) {
    const configColumns = (columns || []).map((col) => String(col || '').toLowerCase());
    const pointsKey = getTrackStatsheetPointsKey(columns);

    const aggregatedStatsWrites = includedHome.reduce((writes, row) => {
        const player = (roster || []).find((candidate) => candidate.id === row.mappedPlayerId);
        if (!player) {
            return writes;
        }

        const stats = {};
        configColumns.forEach((col) => {
            stats[col] = 0;
        });
        stats[pointsKey] = Number(row.totalPoints || 0) || 0;
        stats.fouls = Number(row.fouls || 0) || 0;

        writes.push({
            playerId: player.id,
            data: {
                playerName: player.name,
                playerNumber: player.number,
                participated: true,
                participationStatus: 'appeared',
                participationSource: 'statsheet-import',
                stats
            }
        });
        return writes;
    }, []);

    const opponentStats = {};
    includedVisitor.forEach((row, index) => {
        const opponentId = `statsheet_${index + 1}`;
        opponentStats[opponentId] = {
            name: row.name || '',
            number: row.number || '',
            fouls: Number(row.fouls || 0) || 0
        };
        opponentStats[opponentId][pointsKey] = Number(row.totalPoints || 0) || 0;
        configColumns.forEach((col) => {
            if (opponentStats[opponentId][col] === undefined) {
                opponentStats[opponentId][col] = 0;
            }
        });
    });

    return {
        aggregatedStatsWrites,
        gameUpdate: {
            homeScore: Number(homeScore || 0) || 0,
            awayScore: Number(awayScore || 0) || 0,
            opponentStats,
            status: 'completed',
            statSheetPhotoUrl: statSheetPhotoUrl || null
        }
    };
}
