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

function normalizedPlacements(sponsor) {
    const placements = Array.isArray(sponsor?.placements) ? sponsor.placements : [];
    return [sponsor?.placement, sponsor?.placementType, sponsor?.sponsorPlacement, ...placements]
        .map((item) => asString(item).toLowerCase())
        .filter(Boolean);
}

function hasPlacementToken(sponsor, tokens) {
    return normalizedPlacements(sponsor).some((placement) => tokens.includes(placement));
}

function hasLocalAttractionPlacement(sponsor) {
    const flags = [
        sponsor?.localAttraction,
        sponsor?.isLocalAttraction,
        sponsor?.localAttractionSponsor,
        sponsor?.attraction === true,
        sponsor?.category === 'local-attraction',
        sponsor?.category === 'local_attraction',
        hasPlacementToken(sponsor, ['local-attraction', 'local_attraction', 'local attraction'])
    ];

    return flags.some(Boolean);
}

function hasAdSpacePlacement(sponsor) {
    const category = asString(sponsor?.category).toLowerCase();
    const flags = [
        sponsor?.adSpace,
        sponsor?.isAdSpace,
        sponsor?.adSpaceSponsor,
        sponsor?.sponsorAdSpace,
        sponsor?.showInAdSpace,
        sponsor?.advertising === true,
        category === 'ad-space',
        category === 'ad_space',
        category === 'ad space',
        hasPlacementToken(sponsor, ['ad-space', 'ad_space', 'ad space', 'sponsor-ad', 'sponsor_ad', 'advertising'])
    ];

    return flags.some(Boolean);
}

function isPublishedSponsor(sponsor) {
    const status = asString(sponsor?.status).toLowerCase();
    return sponsor?.published === true || sponsor?.isPublished === true || status === 'published' || status === 'active';
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

function normalizeSponsorDisplayFields(sponsor) {
    const name = firstString(sponsor.name, sponsor.businessName, sponsor.title);
    if (!name) return null;

    return {
        id: sponsor.id || null,
        name,
        description: firstString(sponsor.description, sponsor.summary, sponsor.shortDescription, sponsor.tagline),
        phone: firstString(sponsor.phone, sponsor.phoneNumber, sponsor.contactPhone),
        imageUrl: firstString(sponsor.imageUrl, sponsor.photoUrl, sponsor.logoUrl, sponsor.logo, sponsor.adImageUrl, sponsor.bannerUrl),
        websiteUrl: normalizeExternalWebsiteUrl(firstString(sponsor.websiteUrl, sponsor.website, sponsor.url, sponsor.linkUrl)),
        sortOrder: firstNumber(sponsor.sortOrder, sponsor.displayOrder, sponsor.order, sponsor.rank)
    };
}

function sortSponsors(sponsors) {
    return sponsors.sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name);
    });
}

export function normalizeLocalAttractionSponsor(sponsor) {
    if (!sponsor || !isPublishedSponsor(sponsor) || !hasLocalAttractionPlacement(sponsor)) return null;
    return normalizeSponsorDisplayFields(sponsor);
}

export function normalizeLocalAttractionSponsors(sponsors = []) {
    return sortSponsors((Array.isArray(sponsors) ? sponsors : [])
        .map(normalizeLocalAttractionSponsor)
        .filter(Boolean));
}

export function normalizeAdSpaceSponsor(sponsor) {
    if (!sponsor || !isPublishedSponsor(sponsor) || !hasAdSpacePlacement(sponsor)) return null;
    return normalizeSponsorDisplayFields(sponsor);
}

export function normalizeAdSpaceSponsors(sponsors = []) {
    return sortSponsors((Array.isArray(sponsors) ? sponsors : [])
        .map(normalizeAdSpaceSponsor)
        .filter(Boolean));
}

export function selectRotatingSponsor(sponsors = [], previousSponsorId = '') {
    const eligible = Array.isArray(sponsors) ? sponsors.filter(Boolean) : [];
    if (eligible.length === 0) return null;
    if (eligible.length === 1) return eligible[0];

    const previousIndex = eligible.findIndex((sponsor) => sponsor.id && sponsor.id === previousSponsorId);
    return eligible[(previousIndex + 1 + eligible.length) % eligible.length];
}
