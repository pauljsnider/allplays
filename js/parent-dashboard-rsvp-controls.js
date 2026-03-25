export function createParentDashboardRsvpController({
    getAllScheduleEvents,
    getCurrentUserId,
    getCurrentUser,
    documentRef,
    resolveRsvpPlayerIdsForSubmission,
    submitRsvp,
    submitRsvpForPlayer,
    renderScheduleFromControls,
    alertFn = (message) => alert(message),
    consoleRef = console
}) {
    async function submitGameRsvp(teamId, gameId, response, childContext = {}) {
        try {
            const allScheduleEvents = typeof getAllScheduleEvents === 'function' ? getAllScheduleEvents() : [];
            const playerIds = resolveRsvpPlayerIdsForSubmission(allScheduleEvents, teamId, gameId, childContext);
            const isSinglePlayerSelection = playerIds.length === 1;
            const currentUser = typeof getCurrentUser === 'function' ? getCurrentUser() : null;
            const currentUserId = typeof getCurrentUserId === 'function' ? getCurrentUserId() : '';
            const displayName = currentUser?.displayName || currentUser?.email;
            const summary = isSinglePlayerSelection
                ? await submitRsvpForPlayer(teamId, gameId, currentUserId, {
                    displayName,
                    playerId: playerIds[0],
                    response
                })
                : await submitRsvp(teamId, gameId, currentUserId, {
                    displayName,
                    playerIds,
                    response
                });

            allScheduleEvents.forEach((event) => {
                if (event?.teamId !== teamId || event?.id !== gameId) return;
                if (isSinglePlayerSelection && (event?.childId || event?.playerId) !== playerIds[0]) return;
                event.myRsvp = response;
                if (summary) event.rsvpSummary = summary;
                else if (!event.rsvpSummary) event.rsvpSummary = { going: 0, maybe: 0, notGoing: 0, notResponded: 0, total: 0 };
            });

            renderScheduleFromControls();
            return summary;
        } catch (err) {
            consoleRef.error('RSVP error:', err);
            alertFn('Failed to submit RSVP: ' + err.message);
            return null;
        }
    }

    function submitGameRsvpFromButton(button, response) {
        const teamId = button?.dataset?.teamId || '';
        const gameId = button?.dataset?.gameId || '';
        if (!teamId || !gameId) return Promise.resolve(null);

        const selectedChildId = documentRef?.getElementById?.('player-filter')?.value || '';
        return submitGameRsvp(teamId, gameId, response, {
            selectedChildId,
            childId: button?.dataset?.childId || '',
            childIds: button?.dataset?.childIds || ''
        });
    }

    return {
        submitGameRsvp,
        submitGameRsvpFromButton
    };
}
