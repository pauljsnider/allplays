export function preserveHelpBackLinkContext(doc = document, locationSearch = window.location.search) {
    const params = new URLSearchParams(locationSearch || '');
    if (params.get('context') !== 'team' || !params.get('teamId')) {
        return;
    }

    const preservedParams = new URLSearchParams();
    ['context', 'teamId', 'role'].forEach((key) => {
        const value = params.get(key);
        if (value) {
            preservedParams.set(key, value);
        }
    });

    const query = preservedParams.toString();
    if (!query) {
        return;
    }

    doc.querySelectorAll('a[data-help-back-link]').forEach((link) => {
        const href = link.getAttribute('href');
        if (!href) {
            return;
        }

        const url = new URL(href, window.location.href);
        url.search = query;
        link.href = url.toString();
    });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    preserveHelpBackLinkContext(document, window.location.search);
}
