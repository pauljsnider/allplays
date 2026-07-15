const ROLLOVER_OMITTED_PLAYER_FIELDS = new Set([
    'id',
    'createdAt',
    'updatedAt',
    'deactivatedAt',
    'sourceTeamId',
    'sourcePlayerId',
    'rolledOverAt',
    'privateProfileRosterFields',

]);

const ROLLOVER_SENSITIVE_PLAYER_FIELDS = new Set([
    'birthDate', 'gender', 'grade', 'school', 'jerseySize', 'memberId', 'dominantHandFoot', 'address',
    'medicalInfo', 'medical_info', 'medicalNotes', 'medical_notes',
    'emergencyContact', 'emergency_contact', 'emergencyContactName', 'emergencyContactPhone',
    'contacts', 'contact', 'contactInfo', 'contact_info', 'contactEmail', 'contactPhone', 'contactRelation',
    'parents', 'parent', 'parentEmail', 'parentPhone', 'parentRelation',
    'guardian', 'guardians', 'guardianEmail', 'guardianPhone', 'guardianRelation',
    'householdContact', 'householdContacts', 'householdEmail', 'householdPhone', 'householdRelation'
]);

const ROLLOVER_PRIVATE_ROSTER_FIELDS = new Set([
    'birthDate', 'gender', 'grade', 'school', 'jerseySize', 'memberId', 'dominantHandFoot', 'address'
]);

const ROLLOVER_ROSTER_FIELD_SOURCES = new Set([
    'rosterFieldValues',
    'customFields',
    'profileFields',
    'extraFields'
]);

const ROLLOVER_PROFILE_ROSTER_FIELD_SOURCES = new Set([
    'rosterFields',
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
        if (ROLLOVER_SENSITIVE_PLAYER_FIELDS.has(key)) return;
        if (ROLLOVER_PROFILE_ROSTER_FIELD_SOURCES.has(key) && isPlainRosterMap(value)) {
            copy[key] = omitSensitiveRosterFields(value);
            return;
        }
        copy[key] = value;
    });
    return copy;
}

function collectPrivateRosterFields(target, source = {}) {
    if (!isPlainRosterMap(source)) return;
    Object.entries(source).forEach(([key, value]) => {
        if (ROLLOVER_PRIVATE_ROSTER_FIELDS.has(key)) target[key] = value;
    });
}

export function buildRolloverPrivateRosterFields(sourcePlayer = {}) {
    const privateRosterFields = {};
    collectPrivateRosterFields(privateRosterFields, sourcePlayer);
    ROLLOVER_ROSTER_FIELD_SOURCES.forEach((key) => {
        collectPrivateRosterFields(privateRosterFields, sourcePlayer[key]);
    });
    if (isPlainRosterMap(sourcePlayer.profile)) {
        collectPrivateRosterFields(privateRosterFields, sourcePlayer.profile);
        ROLLOVER_PROFILE_ROSTER_FIELD_SOURCES.forEach((key) => {
            collectPrivateRosterFields(privateRosterFields, sourcePlayer.profile[key]);
        });
    }
    collectPrivateRosterFields(privateRosterFields, sourcePlayer.privateProfileRosterFields);
    return privateRosterFields;
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
