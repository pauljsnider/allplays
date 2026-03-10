function formatCancelledGameDate(value) {
    const gameDate = value?.toDate ? value.toDate() : new Date(value);
    return gameDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
    });
}

export async function cancelScheduledGame({
    teamId,
    gameId,
    user,
    game,
    cancelGame,
    postChatMessage
}) {
    try {
        await cancelGame(teamId, gameId, user.uid);
    } catch (error) {
        return {
            cancelled: false,
            error: error?.message || 'Unknown cancellation error'
        };
    }

    try {
        await postChatMessage(teamId, {
            text: `⚠️ Game cancelled: vs. ${game.opponent} on ${formatCancelledGameDate(game.date)}`,
            senderId: user.uid,
            senderName: user.displayName || user.email,
            senderEmail: user.email
        });

        return {
            cancelled: true,
            notificationError: null
        };
    } catch (error) {
        return {
            cancelled: true,
            notificationError: error?.message || 'Unknown chat notification error'
        };
    }
}
