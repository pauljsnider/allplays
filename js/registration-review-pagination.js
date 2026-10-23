export const LEGACY_REGISTRATION_REVIEW_PAGE_SIZE = 25;

export function createRegistrationReviewPaginationState() {
    return {
        registrations: [],
        lastDoc: null,
        hasMore: true
    };
}

export function appendRegistrationReviewPage(state, page = {}) {
    const registrations = Array.isArray(state?.registrations) ? state.registrations : [];
    const seenIds = new Set(registrations.map((registration) => registration?.id).filter(Boolean));
    const uniquePageRegistrations = (Array.isArray(page.registrations) ? page.registrations : [])
        .filter((registration) => {
            if (!registration?.id || seenIds.has(registration.id)) return false;
            seenIds.add(registration.id);
            return true;
        });

    return {
        registrations: [...registrations, ...uniquePageRegistrations],
        lastDoc: page.lastDoc || null,
        hasMore: page.hasMore === true
    };
}

export async function collectRegistrationReviewPages(loadPage, { onProgress } = {}) {
    let state = createRegistrationReviewPaginationState();

    while (state.hasMore) {
        const previousCursor = state.lastDoc;
        const page = await loadPage(previousCursor);
        state = appendRegistrationReviewPage(state, page);
        if (typeof onProgress === 'function') {
            onProgress(state.registrations.length);
        }
        if (state.hasMore && (!state.lastDoc || state.lastDoc === previousCursor)) {
            throw new Error('Registration review pagination did not advance.');
        }
    }

    return state.registrations;
}
