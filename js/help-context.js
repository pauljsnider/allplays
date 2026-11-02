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

    const contextualLinks = new Set(doc.querySelectorAll('a[data-help-back-link]'));
    const relatedWorkflowsHeading = doc.getElementById('related-workflows');
    let relatedContent = relatedWorkflowsHeading?.nextElementSibling;

    while (relatedContent && relatedContent.tagName !== 'H2') {
        if (relatedContent.matches('a[href]')) {
            contextualLinks.add(relatedContent);
        }
        relatedContent.querySelectorAll('a[href]').forEach((link) => contextualLinks.add(link));
        relatedContent = relatedContent.nextElementSibling;
    }

    const baseUrl = new URL(doc.baseURI);
    contextualLinks.forEach((link) => {
        const href = link.getAttribute('href');
        if (!href) {
            return;
        }

        const url = new URL(href, baseUrl);
        if (url.origin !== baseUrl.origin) {
            return;
        }

        url.search = query;
        link.href = url.toString();
    });
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    preserveHelpBackLinkContext(document, window.location.search);
}
