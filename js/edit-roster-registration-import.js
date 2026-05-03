function normalizeString(value) {
    return String(value || '').trim();
}

function normalizeSource(source = {}) {
    return {
        sourceType: normalizeString(source.type || source.provider || source.name || 'registration'),
        sourceId: normalizeString(source.id || source.sourceId || source.providerId || source.registrationSourceId || 'registration')
    };
}

function getExternalPlayerId(player = {}) {
    return normalizeString(
        player.externalPlayerId ||
        player.sourcePlayerId ||
        player.providerPlayerId ||
        player.athleteId ||
        player.id
    );
}

function getExistingExternalPlayerId(player = {}) {
    return normalizeString(
        player.sourceMetadata?.externalPlayerId ||
        player.registrationSource?.externalPlayerId ||
        player.externalPlayerId ||
        player.sourcePlayerId
    );
}

function getPlayerName(player = {}) {
    const directName = normalizeString(player.name || player.displayName || player.fullName);
    if (directName) return directName;

    const firstName = normalizeString(player.firstName || player.givenName);
    const lastName = normalizeString(player.lastName || player.familyName);
    return [firstName, lastName].filter(Boolean).join(' ').trim();
}

function getComparableName(value) {
    return normalizeString(value).toLowerCase().replace(/\s+/g, ' ');
}

function normalizeContacts(value) {
    if (!Array.isArray(value)) return [];
    return value
        .map((contact) => ({
            name: normalizeString(contact.name || contact.fullName || contact.displayName),
            email: normalizeString(contact.email || contact.emailAddress).toLowerCase(),
            phone: normalizeString(contact.phone || contact.phoneNumber || contact.mobilePhone),
            relation: normalizeString(contact.relation || contact.relationship || contact.type)
        }))
        .filter((contact) => contact.name || contact.email || contact.phone || contact.relation);
}

export function isExternallyLinkedRosterTeam(team = {}) {
    return !!(
        team.registrationSource ||
        team.registrationSourceId ||
        team.externalRegistrationTeamId ||
        team.registrationSourceSnapshot ||
        team.registrationRosterSnapshot ||
        team.registrationScheduleSnapshot
    );
}

export function getRegistrationRosterPlayers(team = {}) {
    const candidates = [
        team.registrationRosterSnapshot?.players,
        team.registrationSourceSnapshot?.rosterPlayers,
        team.registrationSourceSnapshot?.players,
        team.registrationSourceSnapshot?.roster,
        team.registrationSource?.rosterPlayers,
        team.registrationSource?.players,
        team.registrationSource?.roster,
        team.externalRosterPlayers
    ];
    return candidates.find(Array.isArray) || [];
}

export function buildRegistrationRosterPlayerPayload(sourcePlayer = {}, { source = {} } = {}) {
    const externalPlayerId = getExternalPlayerId(sourcePlayer);
    const name = getPlayerName(sourcePlayer);
    if (!externalPlayerId || !name) return null;

    const number = normalizeString(sourcePlayer.number || sourcePlayer.jerseyNumber || sourcePlayer.jersey || sourcePlayer.uniformNumber);
    const guardians = normalizeContacts(sourcePlayer.guardians || sourcePlayer.parents || sourcePlayer.familyContacts);
    const contacts = normalizeContacts(sourcePlayer.contacts || sourcePlayer.contactFields);
    const payload = {
        name,
        number,
        active: sourcePlayer.active === false ? false : true,
        sourceMetadata: {
            ...normalizeSource(source),
            externalPlayerId,
            importedAt: new Date().toISOString()
        }
    };

    if (guardians.length > 0) payload.guardians = guardians;
    if (contacts.length > 0) payload.contacts = contacts;

    return payload;
}

function isSameLocalPlayer(sourcePlayer, existingPlayer) {
    if (getExistingExternalPlayerId(existingPlayer)) return false;

    const sourceName = getComparableName(getPlayerName(sourcePlayer));
    const existingName = getComparableName(existingPlayer.name);
    if (!sourceName || !existingName || sourceName !== existingName) return false;

    const sourceNumber = normalizeString(sourcePlayer.number || sourcePlayer.jerseyNumber || sourcePlayer.jersey || sourcePlayer.uniformNumber);
    const existingNumber = normalizeString(existingPlayer.number);
    return !sourceNumber || !existingNumber || sourceNumber === existingNumber;
}

export function planRegistrationRosterImport({ sourcePlayers = [], existingPlayers = [], source = {} } = {}) {
    const existingByExternalId = new Map();
    (existingPlayers || []).forEach((player) => {
        const externalPlayerId = getExistingExternalPlayerId(player);
        if (externalPlayerId) existingByExternalId.set(externalPlayerId, player);
    });

    const seenExternalIds = new Set();
    const operations = [];
    const results = {
        added: 0,
        updated: 0,
        skipped: 0,
        conflicted: 0,
        conflicts: []
    };

    (sourcePlayers || []).forEach((sourcePlayer) => {
        const externalPlayerId = getExternalPlayerId(sourcePlayer);
        if (!externalPlayerId || seenExternalIds.has(externalPlayerId)) {
            results.skipped += 1;
            return;
        }
        seenExternalIds.add(externalPlayerId);

        const payload = buildRegistrationRosterPlayerPayload(sourcePlayer, { source });
        if (!payload) {
            results.skipped += 1;
            return;
        }

        const existing = existingByExternalId.get(externalPlayerId);
        if (existing?.id) {
            operations.push({ type: 'update', playerId: existing.id, payload });
            results.updated += 1;
            return;
        }

        const conflict = (existingPlayers || []).find((candidate) => isSameLocalPlayer(sourcePlayer, candidate));
        if (conflict) {
            results.conflicted += 1;
            results.conflicts.push({ externalPlayerId, existingPlayerId: conflict.id || null });
            return;
        }

        operations.push({ type: 'add', payload });
        results.added += 1;
    });

    return { operations, results };
}

export function formatRegistrationRosterImportResults(results = {}) {
    return `${results.added || 0} added, ${results.updated || 0} updated, ${results.skipped || 0} skipped, ${results.conflicted || 0} conflicted`;
}
