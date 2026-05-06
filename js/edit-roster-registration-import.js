import { getRosterProfileValues, splitRosterProfileValuesByVisibility } from './roster-profile-fields.js';

const SUPPORTED_ROSTER_FIELD_TYPES = new Set(['text', 'menu', 'checkbox', 'date']);

function normalizeString(value) {
    return String(value || '').trim();
}

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeAnswerKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function normalizeSource(source = {}) {
    return {
        sourceType: normalizeString(source.sourceType || source.type || source.provider || source.name || 'registration'),
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

function getKnownExistingSource(player = {}) {
    const source = player.sourceMetadata || player.registrationSource || {};
    const sourceType = normalizeString(source.sourceType || source.type || source.provider || source.name);
    const sourceId = normalizeString(source.sourceId || source.id || source.providerId || source.registrationSourceId);
    if (!sourceType && !sourceId) return null;

    return {
        sourceType: sourceType || 'registration',
        sourceId: sourceId || 'registration'
    };
}

function getSourceExternalKey(source = {}, externalPlayerId = '') {
    const normalizedSource = normalizeSource(source);
    const normalizedExternalPlayerId = normalizeString(externalPlayerId);
    if (!normalizedExternalPlayerId) return '';

    return [
        normalizedSource.sourceType.toLowerCase(),
        normalizedSource.sourceId.toLowerCase(),
        normalizedExternalPlayerId
    ].join('::');
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

function getRegistrationAnswerSources(sourcePlayer = {}) {
    const submitted = asObject(sourcePlayer.submittedData || sourcePlayer.submission || sourcePlayer.payload || sourcePlayer.formData || sourcePlayer.answers || sourcePlayer.data);
    const playerSource = asObject(sourcePlayer.player || sourcePlayer.playerData || sourcePlayer.athlete || submitted.player || submitted.playerData || submitted.athlete);
    return [
        asObject(sourcePlayer.rosterFieldValues),
        asObject(sourcePlayer.customFields),
        asObject(sourcePlayer.profileFields),
        asObject(sourcePlayer.extraFields),
        asObject(sourcePlayer.answers),
        asObject(sourcePlayer.formData),
        asObject(sourcePlayer.submittedData),
        asObject(playerSource.rosterFieldValues),
        asObject(playerSource.customFields),
        asObject(playerSource.profileFields),
        asObject(submitted.rosterFieldValues),
        asObject(submitted.customFields),
        asObject(submitted.profileFields)
    ].filter((source) => Object.keys(source).length > 0);
}

function buildRegistrationAnswerLookup(sourcePlayer = {}) {
    const lookup = new Map();
    getRegistrationAnswerSources(sourcePlayer).forEach((source) => {
        Object.entries(source).forEach(([key, value]) => {
            const normalizedKey = normalizeAnswerKey(key);
            if (!normalizedKey || lookup.has(normalizedKey)) return;
            lookup.set(normalizedKey, value);
        });
    });
    return lookup;
}

function parseCheckboxValue(value) {
    if (value === true || value === false) return { value };
    const normalized = String(value ?? '').trim().toLowerCase();
    if (['true', 'yes', 'y', '1', 'checked', 'x'].includes(normalized)) return { value: true };
    if (['false', 'no', 'n', '0', 'unchecked'].includes(normalized)) return { value: false };
    return { skipped: 'invalid' };
}

function parseRegistrationRosterFieldValue(field = {}, rawValue) {
    const type = String(field.type || 'text').trim().toLowerCase();
    if (!SUPPORTED_ROSTER_FIELD_TYPES.has(type)) return { skipped: 'unsupported' };
    if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') return { skipped: 'blank' };

    if (type === 'checkbox') return parseCheckboxValue(rawValue);

    const value = String(rawValue).trim();
    if (type === 'date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { skipped: 'invalid' };
        const date = new Date(`${value}T00:00:00Z`);
        if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return { skipped: 'invalid' };
        return { value };
    }

    if (type === 'menu') {
        const option = (field.options || []).find((item) =>
            String(item.value || '').trim().toLowerCase() === value.toLowerCase() ||
            String(item.label || '').trim().toLowerCase() === value.toLowerCase()
        );
        if (!option) return { skipped: 'invalid' };
        return { value: option.value };
    }

    return { value };
}

function collectRegistrationRosterFieldValues(sourcePlayer = {}, fields = [], results = null) {
    const lookup = buildRegistrationAnswerLookup(sourcePlayer);
    const values = {};
    const skipReasons = results?.fieldSkipReasons || {};

    (fields || []).forEach((field) => {
        const keyMatches = [field.key, field.label].map(normalizeAnswerKey).filter(Boolean);
        const matchKey = keyMatches.find((key) => lookup.has(key));
        if (!matchKey) return;

        const parsed = parseRegistrationRosterFieldValue(field, lookup.get(matchKey));
        if (Object.prototype.hasOwnProperty.call(parsed, 'value')) {
            values[field.key] = parsed.value;
            if (results) results.fieldsImported = (results.fieldsImported || 0) + 1;
            return;
        }

        const reason = parsed.skipped || 'invalid';
        if (results) {
            results.fieldsSkipped = (results.fieldsSkipped || 0) + 1;
            skipReasons[reason] = (skipReasons[reason] || 0) + 1;
            results.fieldSkipReasons = skipReasons;
        }
    });

    return values;
}

function mergeRosterFieldValuesIntoPayload(payload, fieldValues, fields, existingPlayer = {}) {
    if (!Object.keys(fieldValues).length) return { payload, privateRosterFields: null };

    const { publicValues, privateValues } = splitRosterProfileValuesByVisibility(fields, fieldValues);
    const privateRosterFields = Object.keys(privateValues).length > 0 ? privateValues : null;
    if (Object.keys(publicValues).length === 0) return { payload, privateRosterFields };

    const existingProfile = existingPlayer?.profile || {};
    return {
        payload: {
            ...payload,
            profile: {
                ...existingProfile,
                customFields: {
                    ...getRosterProfileValues(existingPlayer),
                    ...publicValues
                }
            }
        },
        privateRosterFields
    };
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

export function planRegistrationRosterImport({ sourcePlayers = [], existingPlayers = [], source = {}, fields = [] } = {}) {
    const existingBySourceAndExternalId = new Map();
    const legacyExistingByExternalId = new Map();
    (existingPlayers || []).forEach((player) => {
        const externalPlayerId = getExistingExternalPlayerId(player);
        if (!externalPlayerId) return;

        const knownSource = getKnownExistingSource(player);
        if (knownSource) {
            existingBySourceAndExternalId.set(getSourceExternalKey(knownSource, externalPlayerId), player);
        } else {
            legacyExistingByExternalId.set(externalPlayerId, player);
        }
    });

    const seenExternalIds = new Set();
    const operations = [];
    const results = {
        added: 0,
        updated: 0,
        skipped: 0,
        conflicted: 0,
        fieldsImported: 0,
        fieldsSkipped: 0,
        fieldSkipReasons: {},
        conflicts: []
    };

    (sourcePlayers || []).forEach((sourcePlayer) => {
        const externalPlayerId = getExternalPlayerId(sourcePlayer);
        if (!externalPlayerId || seenExternalIds.has(externalPlayerId)) {
            results.skipped += 1;
            return;
        }
        seenExternalIds.add(externalPlayerId);

        const existing = existingBySourceAndExternalId.get(getSourceExternalKey(source, externalPlayerId)) || legacyExistingByExternalId.get(externalPlayerId);
        const payload = buildRegistrationRosterPlayerPayload(sourcePlayer, { source });
        if (!payload) {
            results.skipped += 1;
            return;
        }

        if (!existing) {
            const conflict = (existingPlayers || []).find((candidate) => isSameLocalPlayer(sourcePlayer, candidate));
            if (conflict) {
                results.conflicted += 1;
                results.conflicts.push({ externalPlayerId, existingPlayerId: conflict.id || null });
                return;
            }
        }

        const fieldValues = collectRegistrationRosterFieldValues(sourcePlayer, fields, results);
        const merged = mergeRosterFieldValuesIntoPayload(payload, fieldValues, fields, existing || {});

        if (existing?.id) {
            operations.push({ type: 'update', playerId: existing.id, payload: merged.payload, privateRosterFields: merged.privateRosterFields });
            results.updated += 1;
            return;
        }

        operations.push({ type: 'add', payload: merged.payload, privateRosterFields: merged.privateRosterFields });
        results.added += 1;
    });

    return { operations, results };
}

export function formatRegistrationRosterImportResults(results = {}) {
    const parts = [`${results.added || 0} added, ${results.updated || 0} updated, ${results.skipped || 0} skipped, ${results.conflicted || 0} conflicted`];
    if ((results.fieldsImported || 0) > 0 || (results.fieldsSkipped || 0) > 0) {
        parts.push(`${results.fieldsImported || 0} configured field value${(results.fieldsImported || 0) === 1 ? '' : 's'} imported`);
        parts.push(`${results.fieldsSkipped || 0} configured field value${(results.fieldsSkipped || 0) === 1 ? '' : 's'} skipped`);
    }

    const reasons = results.fieldSkipReasons || {};
    const reasonText = [
        reasons.blank ? `${reasons.blank} blank` : '',
        reasons.unsupported ? `${reasons.unsupported} unsupported type` : '',
        reasons.invalid ? `${reasons.invalid} invalid option/date/checkbox` : ''
    ].filter(Boolean).join(', ');
    if (reasonText) parts.push(`skipped: ${reasonText}`);

    return parts.join(', ');
}
