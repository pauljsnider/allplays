export function normalizeOfficialLinkEmail(email) {
    return String(email || '').trim().toLowerCase();
}

export function normalizeOfficialLinkPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) {
        return digits.slice(1);
    }
    return digits;
}

export function collectOfficialLookupTargets(users = []) {
    const emails = new Set();
    const phones = new Set();

    users.forEach((user) => {
        const email = normalizeOfficialLinkEmail(user?.email);
        const phone = normalizeOfficialLinkPhone(user?.phone);
        if (email) emails.add(email);
        if (phone) phones.add(phone);
    });

    return {
        emails: Array.from(emails),
        phones: Array.from(phones)
    };
}

export function buildOfficialLookupCacheKey(users = []) {
    return users.map((user) => [
        String(user?.id || '').trim(),
        normalizeOfficialLinkEmail(user?.email),
        normalizeOfficialLinkPhone(user?.phone)
    ].join(':')).join('|');
}

function getOfficialLookupKeys(official = {}) {
    return [
        normalizeOfficialLinkEmail(official.email),
        normalizeOfficialLinkPhone(official.phone)
    ].filter(Boolean);
}

export function buildOfficialUserLookup(officialEntries = []) {
    const lookup = new Map();

    officialEntries.forEach((entry) => {
        const lookupKeys = getOfficialLookupKeys(entry?.official);
        if (!lookupKeys.length) return;

        const existing = lookupKeys.map((key) => lookup.get(key)).find(Boolean) || {
            email: normalizeOfficialLinkEmail(entry?.official?.email) || null,
            phone: normalizeOfficialLinkPhone(entry?.official?.phone) || null,
            teamIds: new Set(),
            teamNames: new Set(),
            officialNames: new Set()
        };

        if (entry?.teamId) existing.teamIds.add(String(entry.teamId));
        if (entry?.teamName) existing.teamNames.add(String(entry.teamName).trim());

        const officialName = String(entry?.official?.name || entry?.official?.displayName || '').trim();
        if (officialName) existing.officialNames.add(officialName);

        lookupKeys.forEach((key) => lookup.set(key, existing));
    });

    return new Map(Array.from(lookup.entries()).map(([key, summary]) => [key, {
        email: summary.email,
        phone: summary.phone,
        teamIds: Array.from(summary.teamIds),
        teamNames: Array.from(summary.teamNames).sort((a, b) => a.localeCompare(b)),
        officialNames: Array.from(summary.officialNames).sort((a, b) => a.localeCompare(b))
    }]));
}

export function getOfficialUserSummary(user = {}, lookup = new Map()) {
    const email = normalizeOfficialLinkEmail(user?.email);
    const phone = normalizeOfficialLinkPhone(user?.phone);
    const summary = (email && lookup.get(email)) || (phone && lookup.get(phone)) || null;
    if (!summary) return null;

    return {
        ...summary,
        teamCount: Array.isArray(summary.teamIds) ? summary.teamIds.length : 0
    };
}

export function formatOfficialUserSummary(summary) {
    if (!summary) return '';

    const teamNames = Array.isArray(summary.teamNames) ? summary.teamNames : [];
    if (!teamNames.length) {
        return summary.teamCount === 1 ? '1 team' : `${summary.teamCount} teams`;
    }

    if (teamNames.length <= 2) {
        return `${summary.teamCount === 1 ? '1 team' : `${summary.teamCount} teams`}: ${teamNames.join(', ')}`;
    }

    return `${summary.teamCount} teams: ${teamNames.slice(0, 2).join(', ')} +${teamNames.length - 2} more`;
}

export function matchesOfficialUserSearch(user = {}, summary = null, term = '') {
    const normalizedTerm = String(term || '').trim().toLowerCase();
    if (!normalizedTerm) return true;

    const haystack = [
        user?.email,
        user?.fullName,
        user?.phone,
        summary ? 'official' : '',
        ...(summary?.teamNames || []),
        ...(summary?.officialNames || [])
    ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');

    return haystack.includes(normalizedTerm);
}
