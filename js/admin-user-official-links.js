export function normalizeOfficialLinkEmail(email) {
    return String(email || '').trim().toLowerCase();
}

export function buildOfficialUserLookup(officialEntries = []) {
    const lookup = new Map();

    officialEntries.forEach((entry) => {
        const email = normalizeOfficialLinkEmail(entry?.official?.email);
        if (!email) return;

        const existing = lookup.get(email) || {
            email,
            teamIds: new Set(),
            teamNames: new Set(),
            officialNames: new Set()
        };

        if (entry?.teamId) existing.teamIds.add(String(entry.teamId));
        if (entry?.teamName) existing.teamNames.add(String(entry.teamName).trim());

        const officialName = String(entry?.official?.name || entry?.official?.displayName || '').trim();
        if (officialName) existing.officialNames.add(officialName);

        lookup.set(email, existing);
    });

    return new Map(Array.from(lookup.entries()).map(([email, summary]) => [email, {
        email,
        teamIds: Array.from(summary.teamIds),
        teamNames: Array.from(summary.teamNames).sort((a, b) => a.localeCompare(b)),
        officialNames: Array.from(summary.officialNames).sort((a, b) => a.localeCompare(b))
    }]));
}

export function getOfficialUserSummary(user = {}, lookup = new Map()) {
    const email = normalizeOfficialLinkEmail(user?.email);
    if (!email) return null;

    const summary = lookup.get(email);
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
