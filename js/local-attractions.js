function asString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function firstString(...values) {
    for (const value of values) {
        const normalized = asString(value);
        if (normalized) return normalized;
    }
    return '';
}

function firstNumber(...values) {
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number)) return number;
    }
    return Number.MAX_SAFE_INTEGER;
}

function hasLocalAttractionPlacement(sponsor) {
    const placements = Array.isArray(sponsor?.placements) ? sponsor.placements : [];
    const placement = asString(sponsor?.placement || sponsor?.placementType || sponsor?.sponsorPlacement).toLowerCase();
    const flags = [
        sponsor?.localAttraction,
        sponsor?.isLocalAttraction,
        sponsor?.localAttractionSponsor,
        sponsor?.attraction === true,
        sponsor?.category === 'local-attraction',
        sponsor?.category === 'local_attraction',
        placement === 'local-attraction',
        placement === 'local_attraction',
        placement === 'local attraction',
        placements.some((item) => {
            const normalized = asString(item).toLowerCase();
            return normalized === 'local-attraction' || normalized === 'local_attraction' || normalized === 'local attraction';
        })
    ];

    return flags.some(Boolean);
}

function isPublishedSponsor(sponsor) {
    const status = asString(sponsor?.status).toLowerCase();
    return sponsor?.published === true || sponsor?.isPublished === true || status === 'published';
}

export function normalizeExternalWebsiteUrl(value) {
    const rawUrl = asString(value);
    if (!rawUrl) return '';

    const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(rawUrl);
    if (hasScheme && !/^https?:\/\//i.test(rawUrl)) return '';

    try {
        const url = new URL(hasScheme ? rawUrl : `https://${rawUrl}`);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
        return url.href;
    } catch (error) {
        return '';
    }
}

export function normalizeLocalAttractionSponsor(sponsor) {
    if (!sponsor || !isPublishedSponsor(sponsor) || !hasLocalAttractionPlacement(sponsor)) return null;

    const name = firstString(sponsor.name, sponsor.businessName, sponsor.title);
    if (!name) return null;

    return {
        id: sponsor.id || null,
        name,
        description: firstString(sponsor.description, sponsor.summary, sponsor.shortDescription),
        phone: firstString(sponsor.phone, sponsor.phoneNumber, sponsor.contactPhone),
        imageUrl: firstString(sponsor.imageUrl, sponsor.photoUrl, sponsor.logoUrl, sponsor.logo),
        websiteUrl: normalizeExternalWebsiteUrl(firstString(sponsor.websiteUrl, sponsor.website, sponsor.url, sponsor.linkUrl)),
        sortOrder: firstNumber(sponsor.sortOrder, sponsor.displayOrder, sponsor.order, sponsor.rank)
    };
}

export function normalizeLocalAttractionSponsors(sponsors = []) {
    return (Array.isArray(sponsors) ? sponsors : [])
        .map(normalizeLocalAttractionSponsor)
        .filter(Boolean)
        .sort((a, b) => {
            if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
            return a.name.localeCompare(b.name);
        });
}
