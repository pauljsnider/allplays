const HOMEPAGE_SECTION_IDS = ['live-games-list', 'past-games-list'];

export function showHomepageLoadFailure(document, message = 'Live game information is temporarily unavailable. Please try again later.') {
    HOMEPAGE_SECTION_IDS.forEach((id) => {
        const container = document.getElementById(id);
        if (!container || !/Loading/.test(container.textContent)) {
            return;
        }

        container.innerHTML = `<div class="col-span-full rounded-lg border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-800" role="alert" data-homepage-load-error>${message}</div>`;
    });
}

export async function bootHomepage({ document, loadDependencies, initOptions, logger = console }) {
    try {
        const { checkAuth, getRedirectUrl, getPublicHomepageGames, initHomepage } = await loadDependencies();
        await initHomepage({
            ...initOptions,
            document,
            checkAuth,
            getRedirectUrl,
            getHomepageGames: getPublicHomepageGames
        });
        return true;
    } catch (error) {
        logger.error('Failed to initialize homepage:', error);
        showHomepageLoadFailure(document);
        return false;
    }
}
