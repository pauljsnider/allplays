const SENSITIVE_PLAYER_KEYS = new Set([
    'medicalInfo',
    'medical_info',
    'medicalNotes',
    'medical_notes',
    'emergencyContact',
    'emergency_contact',
    'emergencyContactName',
    'emergencyContactPhone'
]);

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function cleanString(value) {
    return String(value || '').trim();
}

function cleanEmail(value) {
    return cleanString(value).toLowerCase();
}

function firstNonEmpty(...values) {
    return values.map(cleanString).find(Boolean) || '';
}

function fullNameFromParts(source) {
    const first = firstNonEmpty(source.firstName, source.givenName, source.playerFirstName, source.athleteFirstName);
    const last = firstNonEmpty(source.lastName, source.familyName, source.playerLastName, source.athleteLastName);
    return [first, last].filter(Boolean).join(' ').trim();
}

function stripSensitiveFields(values = {}) {
    return Object.entries(asObject(values)).reduce((acc, [key, value]) => {
        if (!SENSITIVE_PLAYER_KEYS.has(key)) {
            acc[key] = value;
        }
        return acc;
    }, {});
}

export function normalizeRegistrationStatus(status) {
    const normalized = cleanString(status).toLowerCase();
    if (['approved', 'accepted'].includes(normalized)) return 'approved';
    if (['rejected', 'denied', 'declined'].includes(normalized)) return 'rejected';
    return 'pending';
}

export function getRegistrationSubmittedData(registration = {}) {
    const data = asObject(registration);
    return asObject(data.submittedData || data.submission || data.payload || data.formData || data.answers || data.data);
}

export function getRegistrationPlayerDraft(registration = {}) {
    const data = asObject(registration);
    const submitted = getRegistrationSubmittedData(data);
    const playerSource = asObject(data.player || data.playerData || data.athlete || submitted.player || submitted.playerData || submitted.athlete);
    const name = firstNonEmpty(
        playerSource.name,
        playerSource.fullName,
        playerSource.playerName,
        playerSource.athleteName,
        submitted.playerName,
        submitted.athleteName,
        fullNameFromParts(playerSource),
        fullNameFromParts(submitted)
    );
    const number = firstNonEmpty(playerSource.number, playerSource.jerseyNumber, playerSource.jersey, submitted.playerNumber, submitted.jerseyNumber, submitted.jersey);
    const rosterFieldValues = stripSensitiveFields({
        ...asObject(playerSource.rosterFieldValues),
        ...asObject(playerSource.customFields),
        ...asObject(playerSource.profileFields),
        ...asObject(submitted.rosterFieldValues),
        ...asObject(submitted.customFields),
        ...asObject(submitted.profileFields)
    });

    const draft = {
        name,
        number,
        active: true
    };
    if (Object.keys(rosterFieldValues).length > 0) {
        draft.rosterFieldValues = rosterFieldValues;
    }
    return draft;
}

export function getRegistrationGuardianDrafts(registration = {}) {
    const data = asObject(registration);
    const submitted = getRegistrationSubmittedData(data);
    const sources = [];
    [data.guardian, data.parent, data.primaryGuardian, submitted.guardian, submitted.parent, submitted.primaryGuardian]
        .filter(Boolean)
        .forEach((entry) => sources.push(entry));
    [data.guardians, data.parents, submitted.guardians, submitted.parents]
        .filter(Array.isArray)
        .forEach((entries) => entries.forEach((entry) => sources.push(entry)));

    const deduped = new Map();
    sources.map(asObject).forEach((source) => {
        const email = cleanEmail(source.email || source.parentEmail || source.guardianEmail);
        const name = firstNonEmpty(source.name, source.fullName, source.parentName, source.guardianName, fullNameFromParts(source), email);
        if (!email && !name) return;
        const key = email || name.toLowerCase();
        if (!deduped.has(key)) {
            deduped.set(key, {
                email,
                name,
                relation: firstNonEmpty(source.relation, source.relationship, source.type, 'Guardian'),
                phone: firstNonEmpty(source.phone, source.phoneNumber, source.mobile)
            });
        }
    });
    return [...deduped.values()];
}

export function matchesRegistrationReviewStatus(registration = {}, status = 'all') {
    const wantedStatus = cleanString(status).toLowerCase() || 'all';
    switch (wantedStatus) {
        case 'all':
            return true;
        case 'registration-approved':
            return registration.registrationApproved === true;
        case 'roster-approved':
            return registration.rosterApproved === true;
        case 'rejected':
            return normalizeRegistrationStatus(registration.status) === 'rejected' ||
                registration.registrationApproved === false ||
                registration.rosterApproved === false;
        default:
            return normalizeRegistrationStatus(registration.status) === wantedStatus;
    }
}

export function buildRegistrationRosterDecision({ registration = {}, team = {}, playerId = '', rosterDestinationType = '', reviewer = {}, now = null, decisionNote = '' } = {}) {
    const playerDraft = getRegistrationPlayerDraft(registration);
    if (!playerDraft.name) {
        throw new Error('Registration is missing a player name.');
    }
    const guardians = getRegistrationGuardianDrafts(registration);
    const linkedAt = now || new Date();
    const source = {
        formId: registration.formId || '',
        registrationId: registration.id || '',
        status: 'approved',
        linkedAt
    };

    return {
        player: {
            ...playerDraft,
            registrationSource: source
        },
        guardians,
        registrationUpdate: {
            status: 'approved',
            linkedTeamId: team.id || registration.teamId || '',
            linkedTeamName: team.name || registration.teamName || '',
            linkedPlayerId: playerId || null,
            decidedAt: linkedAt,
            decidedBy: reviewer.userId || '',
            decidedByName: reviewer.name || reviewer.email || 'Admin',
            decisionNote: cleanString(decisionNote),
            rosterDestination: {
                teamId: team.id || registration.teamId || '',
                playerId: playerId || null,
                type: rosterDestinationType || (playerId ? 'existing-player' : 'new-player')
            }
        }
    };
}

export function summarizeRegistration(registration = {}) {
    const player = getRegistrationPlayerDraft(registration);
    const guardians = getRegistrationGuardianDrafts(registration);
    return {
        status: normalizeRegistrationStatus(registration.status),
        playerName: player.name || 'Unnamed player',
        playerNumber: player.number || '',
        guardianLabel: guardians.map((guardian) => guardian.email || guardian.name).filter(Boolean).join(', '),
        submittedAt: registration.submittedAt || registration.createdAt || null
    };
}
