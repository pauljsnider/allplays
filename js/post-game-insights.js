function toNumber(value) {
    return Number.isFinite(value) ? value : Number(value) || 0;
}

function normalizeStatKey(statKey) {
    return String(statKey || '').trim().toLowerCase();
}

function isCompletedGame(game) {
    const status = String(game?.status || '').toLowerCase();
    const liveStatus = String(game?.liveStatus || '').toLowerCase();
    return status === 'completed' || status === 'final' || liveStatus === 'completed';
}

function getPointsValue(stats = {}) {
    return toNumber(stats.pts) || toNumber(stats.points) || toNumber(stats.point) || toNumber(stats.goals) || toNumber(stats.goal);
}

function getTurnoverValue(stats = {}) {
    return toNumber(stats.to) || toNumber(stats.tov) || toNumber(stats.turnovers);
}

function getAssistValue(stats = {}) {
    return toNumber(stats.ast) || toNumber(stats.assists) || toNumber(stats.assist);
}

function getReboundValue(stats = {}) {
    return toNumber(stats.reb) || toNumber(stats.rebs) || toNumber(stats.rebounds);
}

function getShotValue(stats = {}) {
    return toNumber(stats.shots) || toNumber(stats.shot);
}

function getPassValue(stats = {}) {
    return toNumber(stats.passes) || toNumber(stats.pass);
}

function getBlockValue(stats = {}) {
    return toNumber(stats.blocks) || toNumber(stats.block);
}

function getHustleValue(stats = {}) {
    return toNumber(stats.hustle);
}

function getFoulValue(stats = {}) {
    return toNumber(stats.fouls) || toNumber(stats.foul);
}

function formatMinutes(timeMs) {
    const minutes = Math.round((toNumber(timeMs) / 60000) * 10) / 10;
    if (minutes <= 0) return '0';
    return Number.isInteger(minutes) ? `${minutes}` : minutes.toFixed(1);
}

function formatMoment(event) {
    const period = String(event?.period || '').trim();
    const clock = String(event?.clock || event?.gameTime || '').trim();
    return [period, clock].filter(Boolean).join(' ');
}

function detectPrimaryScoringStat(statsMap = {}) {
    const statEntries = Object.values(statsMap || {});
    if (statEntries.some((stats) => toNumber(stats?.goals) > 0 || toNumber(stats?.goal) > 0)) {
        return {
            singular: 'goal',
            plural: 'goals'
        };
    }

    return {
        singular: 'point',
        plural: 'points'
    };
}

function isClosingPeriod(periodValue) {
    const period = String(periodValue || '').trim().toUpperCase();
    return period === 'Q4'
        || period.startsWith('OT')
        || period === 'H2'
        || period === '2H'
        || period === 'SECOND HALF';
}

function getEventStatKey(event) {
    return normalizeStatKey(event?.statKey || event?.undoData?.statKey);
}

function getEventValue(event) {
    if (event?.value !== undefined && event?.value !== null) {
        return toNumber(event.value);
    }
    return toNumber(event?.undoData?.value);
}

function extractEventPoints(event) {
    const statKey = getEventStatKey(event);
    if (statKey === 'pts' || statKey === 'points' || statKey === 'point' || statKey === 'goals' || statKey === 'goal') {
        return Math.max(0, getEventValue(event));
    }

    const text = String(event?.text || '').toLowerCase();
    if (text.includes(' goal')) return 1;
    if (text.includes('3-pointer') || text.includes('three-pointer') || text.includes('3 point')) return 3;
    if (text.includes('free throw')) return 1;
    if (text.includes('layup') || text.includes('jumper') || text.includes('hook shot') || text.includes('dunk')) return 2;
    return 0;
}

function isOpponentEvent(event) {
    if (typeof event?.isOpponent === 'boolean') {
        return event.isOpponent;
    }
    return Boolean(event?.undoData?.isOpponent);
}

function buildPlayerLookup(players = []) {
    const lookup = new Map();
    players.forEach((player) => {
        if (player?.id) lookup.set(player.id, player);
    });
    return lookup;
}

function sortInsights(insights) {
    return insights.filter(Boolean).slice(0, 5);
}

function buildLateGameSwing(events = []) {
    const lateEvents = events.filter((event) => {
        const points = extractEventPoints(event);
        if (!points) return false;
        const period = String(event?.period || '').toUpperCase();
        const clock = String(event?.clock || event?.gameTime || '');
        const [minutesPart = '99'] = clock.split(':');
        const minutes = Number.parseInt(minutesPart, 10);
        return isClosingPeriod(period) && Number.isFinite(minutes) && minutes <= 3;
    });

    if (!lateEvents.length) return null;

    let teamPoints = 0;
    let opponentPoints = 0;
    lateEvents.forEach((event) => {
        const points = extractEventPoints(event);
        if (isOpponentEvent(event)) {
            opponentPoints += points;
        } else {
            teamPoints += points;
        }
    });

    const anchor = lateEvents[0];
    const moment = formatMoment(anchor) || 'late in the game';
    const margin = teamPoints - opponentPoints;
    if (margin > 0) {
        return {
            title: 'Late-game swing',
            body: `The group closed ${moment} on a ${teamPoints}-${opponentPoints} run, which helped protect the result.`,
            tone: 'positive'
        };
    }
    if (margin < 0) {
        return {
            title: 'Late-game swing',
            body: `The closing stretch at ${moment} tilted ${teamPoints}-${opponentPoints} the other way, so late execution was the swing factor.`,
            tone: 'warning'
        };
    }
    return {
        title: 'Late-game swing',
        body: `The final stretch stayed even at ${moment}, so the result was mostly decided before the closing possessions.`,
        tone: 'neutral'
    };
}

export function generatePlayerGameInsights({
    player,
    game,
    playerStats = {},
    playerTimeMs = 0,
    gameTeamStats = {},
    events = []
}) {
    if (!player?.id || !isCompletedGame(game)) return [];

    const points = getPointsValue(playerStats);
    const assists = getAssistValue(playerStats);
    const rebounds = getReboundValue(playerStats);
    const shots = getShotValue(playerStats);
    const passes = getPassValue(playerStats);
    const blocks = getBlockValue(playerStats);
    const hustle = getHustleValue(playerStats);
    const fouls = getFoulValue(playerStats);
    const turnovers = getTurnoverValue(playerStats);
    const totalTeamPoints = Object.values(gameTeamStats).reduce((sum, stats) => sum + getPointsValue(stats), 0);
    const scoringLabel = detectPrimaryScoringStat(gameTeamStats);
    const insights = [];

    if (points > 0 && totalTeamPoints > 0) {
        const share = Math.round((points / totalTeamPoints) * 100);
        insights.push({
            title: 'Scoring load',
            body: `${player.name} produced ${points} ${points === 1 ? scoringLabel.singular : scoringLabel.plural}, accounting for ${share}% of the team's scoring.`,
            tone: share >= 30 ? 'positive' : 'neutral'
        });
    }

    const supportStats = [];
    if (assists > 0) supportStats.push(`${assists} assist${assists === 1 ? '' : 's'}`);
    if (rebounds > 0) supportStats.push(`${rebounds} rebound${rebounds === 1 ? '' : 's'}`);
    if (shots > 0) supportStats.push(`${shots} shot${shots === 1 ? '' : 's'}`);
    if (passes > 0) supportStats.push(`${passes} pass${passes === 1 ? '' : 'es'}`);
    if (blocks > 0) supportStats.push(`${blocks} block${blocks === 1 ? '' : 's'}`);
    if (hustle > 0) supportStats.push(`${hustle} hustle play${hustle === 1 ? '' : 's'}`);
    if (supportStats.length) {
        insights.push({
            title: 'All-around impact',
            body: `${player.name} added ${supportStats.join(' and ')} to support the scoring line.`,
            tone: 'positive'
        });
    }

    if (playerTimeMs > 0) {
        insights.push({
            title: 'Workload',
            body: `${player.name} logged ${formatMinutes(playerTimeMs)} minutes, which points to a steady rotation role in this game.`,
            tone: 'neutral'
        });
    }

    if (fouls >= 3) {
        insights.push({
            title: 'Foul pressure',
            body: `${player.name} finished with ${fouls} fouls, so availability and aggression balance became part of the game story.`,
            tone: 'warning'
        });
    } else if (turnovers >= 3) {
        insights.push({
            title: 'Ball security',
            body: `${player.name} was charged with ${turnovers} turnovers, making possession management a clear development point.`,
            tone: 'warning'
        });
    }

    const closingScores = events.filter((event) => {
        if (event?.playerId !== player.id || isOpponentEvent(event)) return false;
        const pointsValue = extractEventPoints(event);
        if (!pointsValue) return false;
        const period = String(event?.period || '').toUpperCase();
        const [minutesPart = '99'] = String(event?.clock || event?.gameTime || '').split(':');
        const minutes = Number.parseInt(minutesPart, 10);
        return isClosingPeriod(period) && Number.isFinite(minutes) && minutes <= 3;
    });
    if (closingScores.length) {
        const lastMoment = formatMoment(closingScores[closingScores.length - 1]) || 'the closing stretch';
        insights.push({
            title: 'Closing presence',
            body: `${player.name} delivered scoring action in ${lastMoment}, keeping the player involved in the deciding possessions.`,
            tone: 'positive'
        });
    }

    return sortInsights(insights);
}

export function generateGameInsights({
    team,
    game,
    players = [],
    statsMap = {},
    timeMap = {},
    events = []
}) {
    if (!isCompletedGame(game)) {
        return {
            teamInsights: [],
            playerInsightsById: {},
            emptyMessage: 'Insights populate after the game is finalized.'
        };
    }

    const playerLookup = buildPlayerLookup(players);
    const playerStatsEntries = Object.entries(statsMap);
    const totalPoints = playerStatsEntries.reduce((sum, [, stats]) => sum + getPointsValue(stats), 0);
    const totalTurnovers = playerStatsEntries.reduce((sum, [, stats]) => sum + getTurnoverValue(stats), 0);
    const totalFouls = playerStatsEntries.reduce((sum, [, stats]) => sum + getFoulValue(stats), 0);
    const scoringLabel = detectPrimaryScoringStat(statsMap);
    const teamInsights = [];

    if (totalPoints > 0) {
        const [leaderId, leaderStats] = playerStatsEntries
            .map(([playerId, stats]) => [playerId, stats, getPointsValue(stats)])
            .sort((a, b) => b[2] - a[2])[0] || [];
        const leader = playerLookup.get(leaderId);
        const leaderPoints = getPointsValue(leaderStats);
        if (leader && leaderPoints > 0) {
            const share = Math.round((leaderPoints / totalPoints) * 100);
            teamInsights.push({
                title: 'Offensive catalyst',
                body: `${leader.name} led the scoring with ${leaderPoints} ${leaderPoints === 1 ? scoringLabel.singular : scoringLabel.plural}, supplying ${share}% of ${team?.name || 'the team'}'s offense.`,
                tone: share >= 30 ? 'positive' : 'neutral'
            });
        }
    }

    if (Object.keys(timeMap).length) {
        const rotation = players
            .map((player) => ({
                ...player,
                timeMs: toNumber(timeMap[player.id])
            }))
            .filter((player) => player.timeMs > 0)
            .sort((a, b) => b.timeMs - a.timeMs);
        if (rotation.length) {
            teamInsights.push({
                title: 'Rotation pattern',
                body: `${rotation.length} players logged minutes, with ${rotation[0].name} carrying the heaviest load at ${formatMinutes(rotation[0].timeMs)} minutes.`,
                tone: rotation.length >= 8 ? 'positive' : 'neutral'
            });
        }
    }

    const lateGameSwing = buildLateGameSwing(events);
    if (lateGameSwing) {
        teamInsights.push(lateGameSwing);
    }

    if (totalFouls > 0) {
        const foulLeader = players
            .map((player) => ({
                ...player,
                fouls: getFoulValue(statsMap[player.id] || {})
            }))
            .sort((a, b) => b.fouls - a.fouls)[0];
        if (foulLeader?.fouls > 0) {
            teamInsights.push({
                title: 'Discipline watch',
                body: `${team?.name || 'The team'} was charged with ${totalFouls} fouls, led by ${foulLeader.name}'s ${foulLeader.fouls}, so discipline was part of the pressure profile.`,
                tone: foulLeader.fouls >= 4 ? 'warning' : 'neutral'
            });
        }
    } else if (totalTurnovers > 0) {
        teamInsights.push({
            title: 'Possession pressure',
            body: `${team?.name || 'The team'} finished with ${totalTurnovers} turnovers, making ball security one of the clearest levers for the next game.`,
            tone: totalTurnovers >= 10 ? 'warning' : 'neutral'
        });
    }

    const playerInsightsById = {};
    players.forEach((player) => {
        const playerInsights = generatePlayerGameInsights({
            player,
            game,
            playerStats: statsMap[player.id] || {},
            playerTimeMs: timeMap[player.id] || 0,
            gameTeamStats: statsMap,
            events: events.filter((event) => event?.playerId === player.id)
        });
        if (playerInsights.length) {
            playerInsightsById[player.id] = playerInsights;
        }
    });

    const hasInsightData = teamInsights.length || Object.keys(playerInsightsById).length;
    return {
        teamInsights: sortInsights(teamInsights),
        playerInsightsById,
        emptyMessage: hasInsightData ? '' : `No post-game insights are available yet for ${team?.name || 'this team'}.`
    };
}
