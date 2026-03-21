export function resolveSelectedRideChildId({
    includeChildPicker = false,
    selectedChildId = '',
    defaultChildId = '',
    childChoices = [],
    offer = {},
    parentUserId = ''
} = {}) {
    if (!includeChildPicker) return defaultChildId;

    const validChildIds = new Set(
        (Array.isArray(childChoices) ? childChoices : [])
            .map((child) => child?.childId)
            .filter(Boolean)
    );

    if (selectedChildId && validChildIds.has(selectedChildId)) {
        return selectedChildId;
    }

    const ownRequestChildId = (Array.isArray(offer?.requests) ? offer.requests : []).find((request) =>
        request?.parentUserId === parentUserId && validChildIds.has(request?.childId)
    )?.childId || '';
    if (ownRequestChildId) {
        return ownRequestChildId;
    }

    if (defaultChildId && validChildIds.has(defaultChildId)) {
        return defaultChildId;
    }

    return childChoices[0]?.childId || '';
}

export function resolveRideRequestSelection({
    defaultChildId = '',
    defaultChildName = '',
    selectorValue = '',
    childChoices = []
} = {}) {
    const childId = selectorValue || defaultChildId || '';
    const selectedChild = (Array.isArray(childChoices) ? childChoices : []).find((child) => child?.childId === childId);
    return {
        childId,
        childName: selectedChild?.childName || defaultChildName || 'Player'
    };
}

export function createRideRequestHandlers({
    documentRef,
    resolveChildChoices,
    getRideOfferSelectionKey,
    selectedRideChildByOffer,
    requestRideSpot,
    cancelRideRequest,
    refreshRideshareForEvent,
    renderScheduleFromControls,
    rerenderActiveDayModal,
    alertFn = globalThis.alert,
    consoleRef = globalThis.console
} = {}) {
    return {
        async requestRideSpotForChild(teamId, gameId, legacyGameId, offerGameId, offerId, defaultChildId, defaultChildName, selectorId = '') {
            try {
                const selector = selectorId ? documentRef?.getElementById(selectorId) : null;
                const { childId, childName } = resolveRideRequestSelection({
                    defaultChildId,
                    defaultChildName,
                    selectorValue: selector?.value || '',
                    childChoices: resolveChildChoices(teamId)
                });
                if (!childId) throw new Error('Select a child first.');

                const selectionKey = getRideOfferSelectionKey(teamId, gameId, offerId);
                if (selectionKey && selectedRideChildByOffer?.set) {
                    selectedRideChildByOffer.set(selectionKey, childId);
                }

                await requestRideSpot(teamId, offerGameId, offerId, { childId, childName });
                await refreshRideshareForEvent(teamId, gameId, legacyGameId);
                renderScheduleFromControls();
                rerenderActiveDayModal();
            } catch (err) {
                consoleRef?.error?.('Failed to request spot:', err);
                alertFn?.(`Could not request spot: ${err?.message || err}`);
            }
        },

        async cancelMyRideRequest(teamId, gameId, legacyGameId, offerGameId, offerId, requestId) {
            try {
                await cancelRideRequest(teamId, offerGameId, offerId, requestId);
                await refreshRideshareForEvent(teamId, gameId, legacyGameId);
                renderScheduleFromControls();
                rerenderActiveDayModal();
            } catch (err) {
                consoleRef?.error?.('Failed to cancel request:', err);
                alertFn?.(`Could not cancel request: ${err?.message || err}`);
            }
        }
    };
}
