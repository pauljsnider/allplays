const ROLLOVER_OMITTED_PLAYER_FIELDS = new Set([
    'id',
    'createdAt',
    'updatedAt',
    'deactivatedAt',
    'sourceTeamId',
    'sourcePlayerId',
    'rolledOverAt',

]);

const ROLLOVER_SENSITIVE_PLAYER_FIELDS = new Set([
    'medicalInfo', 'medical_info', 'medicalNotes', 'medical_notes',
    'emergencyContact', 'emergency_contact', 'emergencyContactName', 'emergencyContactPhone',
    'contacts', 'contact', 'contactInfo', 'contact_info', 'contactEmail', 'contactPhone', 'contactRelation',
    'parents', 'parent', 'parentEmail', 'parentPhone', 'parentRelation',
    'guardian', 'guardians', 'guardianEmail', 'guardianPhone', 'guardianRelation',
    'householdContact', 'householdContacts', 'householdEmail', 'householdPhone', 'householdRelation'
]);

const ROLLOVER_ROSTER_FIELD_SOURCES = new Set([
    'rosterFieldValues',
    'customFields',
    'profileFields',
    'extraFields'
]);

function omitSensitiveRosterFields(source = {}) {
    const copy = {};
    Object.entries(source).forEach(([key, value]) => {
        if (ROLLOVER_SENSITIVE_PLAYER_FIELDS.has(key)) return;
        copy[key] = value;
    });
    return copy;
}

function isPlainRosterMap(value) {
    return value && typeof value === 'object' && !Array.isArray(value);
}

function omitSensitiveProfileRosterFields(profile = {}) {
    const copy = {};
    Object.entries(profile).forEach(([key, value]) => {
        if ((key === 'rosterFields' || key === 'customFields') && isPlainRosterMap(value)) {
            copy[key] = omitSensitiveRosterFields(value);
            return;
        }
        copy[key] = value;
    });
    return copy;
}

export function buildRolloverPlayerCopy(sourcePlayer, sourceTeamId, rolledOverAt) {
    if (!sourcePlayer || typeof sourcePlayer !== 'object') {
        throw new Error('Source player is required');
    }

    const copy = {};
    Object.entries(sourcePlayer).forEach(([key, value]) => {
        if (ROLLOVER_OMITTED_PLAYER_FIELDS.has(key)) return;
        if (ROLLOVER_SENSITIVE_PLAYER_FIELDS.has(key)) return;
        if (ROLLOVER_ROSTER_FIELD_SOURCES.has(key) && isPlainRosterMap(value)) {
            copy[key] = omitSensitiveRosterFields(value);
            return;
        }
        if (key === 'profile' && isPlainRosterMap(value)) {
            copy[key] = omitSensitiveProfileRosterFields(value);
            return;
        }
        copy[key] = value;
    });

    copy.active = true;
    copy.sourceTeamId = sourceTeamId;
    copy.sourcePlayerId = sourcePlayer.id || null;
    copy.rolledOverAt = rolledOverAt;

    return copy;
}
