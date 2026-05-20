function buildCancellationChatMessage({ game = {}, currentUser = {} } = {}) {
    const gameDate = game.date?.toDate ? game.date.toDate() : new Date(game.date);
    const dateStr = gameDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
    });

    return {
        text: `⚠️ Game cancelled: vs. ${game.opponent} on ${dateStr}`,
        senderId: currentUser.uid,
        senderName: currentUser.displayName || currentUser.email,
        senderEmail: currentUser.email
    };
}

export async function runGameCancellationFlow({
    teamId,
    gameId,
    game,
    currentUser,
    cancelGame,
    postChatMessage
} = {}) {
    await cancelGame(teamId, gameId, currentUser.uid);

    try {
        await postChatMessage(teamId, buildCancellationChatMessage({ game, currentUser }));
        return {
            cancellationSucceeded: true,
            notificationSucceeded: true,
            notificationError: null
        };
    } catch (notificationError) {
        return {
            cancellationSucceeded: true,
            notificationSucceeded: false,
            notificationError
        };
    }
}
