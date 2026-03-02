export function applyRsvpHydration(events, teamId, gameId, hydration = {}) {
    if (!Array.isArray(events) || !teamId || !gameId) return events;

    const hasMyRsvp = Object.prototype.hasOwnProperty.call(hydration, 'myRsvp');
    const hasSummary = !!hydration.summary;

    events.forEach((event) => {
        if (event?.teamId !== teamId || event?.id !== gameId) return;
        if (hasMyRsvp) event.myRsvp = hydration.myRsvp;
        if (hasSummary) event.rsvpSummary = hydration.summary;
    });

    return events;
}
