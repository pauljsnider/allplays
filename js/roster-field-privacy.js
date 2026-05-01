const SENSITIVE_FIELD_IDS = new Set([
    'emergencyContact',
    'emergency_contact',
    'emergencyContactName',
    'emergencyContactPhone',
    'medicalInfo',
    'medical_info',
    'medicalNotes',
    'medical_notes'
]);

function normalizeKey(value) {
    return String(value || '').trim();
}

function normalizeVisibility(field) {
    const raw = String(field?.visibility || field?.privacy || field?.access || '').trim().toLowerCase();
    if (!raw) return SENSITIVE_FIELD_IDS.has(field?.id) ? 'admin' : 'public';
    if (['private', 'admin', 'admins', 'admin-only', 'admin_only', 'restricted'].includes(raw)) return 'admin';
    if (['team', 'teammates', 'members', 'parents', 'family', 'authenticated'].includes(raw)) return 'team';
    return 'public';
}

export function getRosterFieldDefinitions(team = {}) {
    const candidates = [
        team.rosterFields,
        team.rosterProfileFields,
        team.playerProfileFields,
        team.customRosterFields,
        team.rosterFieldDefinitions
    ];

    const fields = candidates.find((entry) => Array.isArray(entry) && entry.length > 0) || [];
    return fields
        .map((field) => {
            const id = normalizeKey(field?.id || field?.key || field?.name);
            if (!id) return null;
            return {
                ...field,
                id,
                label: normalizeKey(field?.label || field?.name || id),
                visibility: normalizeVisibility({ ...field, id })
            };
        })
        .filter(Boolean);
}

export function getRosterFieldValue(player = {}, field = {}) {
    const id = field.id;
    const valueSources = [
        player.rosterFieldValues,
        player.customFields,
        player.profileFields,
        player.extraFields
    ];

    for (const source of valueSources) {
        if (source && Object.prototype.hasOwnProperty.call(source, id)) {
            return source[id];
        }
    }

    if (Object.prototype.hasOwnProperty.call(player, id) && !SENSITIVE_FIELD_IDS.has(id)) {
        return player[id];
    }

    return undefined;
}

export function canViewRosterField(field = {}, access = {}) {
    if (SENSITIVE_FIELD_IDS.has(field.id)) return !!access.isAdmin;

    const visibility = normalizeVisibility(field);
    if (visibility === 'admin') return !!access.isAdmin;
    if (visibility === 'team') return !!(access.isAdmin || access.isTeamMember || access.isLinkedParent);
    return true;
}

export function getVisibleRosterFieldValues(team = {}, player = {}, access = {}) {
    return getRosterFieldDefinitions(team)
        .filter((field) => canViewRosterField(field, access))
        .map((field) => ({
            field,
            value: getRosterFieldValue(player, field)
        }))
        .filter(({ value }) => value !== undefined && value !== null && String(value).trim() !== '');
}
