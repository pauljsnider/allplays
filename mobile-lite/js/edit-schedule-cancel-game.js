import { buildScheduleNotificationTargets, postScheduleNotificationTargets } from './schedule-notifications.js?v=3';

function formatCancelledGameDate(value) {
    const gameDate = value?.toDate ? value.toDate() : new Date(value);
    return gameDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
    });
}

function buildCancelledGameText(opponentLabel, dateValue) {
    const label = String(opponentLabel || '').trim() || 'Game';
    return `⚠️ Game cancelled: ${label} on ${formatCancelledGameDate(dateValue)}`;
}

export async function cancelScheduledGame({
    teamId,
    gameId,
    user,
    game,
    cancelGame,
    postChatMessage,
    counterpartTeamId = null,
    counterpartOpponent = null
}) {
    try {
        await cancelGame(teamId, gameId, user.uid);
    } catch (error) {
        return {
            cancelled: false,
            error: error?.message || 'Unknown cancellation error'
        };
    }

    const targets = buildScheduleNotificationTargets({
        teamId,
        title: `vs. ${game?.opponent || 'Opponent'}`,
        counterpartTeamId,
        counterpartTitle: counterpartOpponent ? `vs. ${counterpartOpponent}` : null
    });
    const notificationResult = await postScheduleNotificationTargets({
        targets,
        postChatMessage,
        senderId: user.uid,
        senderName: user.displayName || user.email,
        senderEmail: user.email,
        buildText: (target) => buildCancelledGameText(target.title, game?.date)
    });

    return {
        cancelled: true,
        notificationError: notificationResult.failedCount > 0 ? notificationResult.errorMessage : null
    };
}
