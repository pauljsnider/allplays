// Shared catalog of optional player profile fields, so the manual roster form,
// CSV import, and AI roster import can all capture the same standard details
// instead of just name + number (#3866).
//
// Only PUBLIC, non-sensitive fields belong here — these are safe to write to the
// player doc. Contact/guardian/medical data is sensitive and must go to the
// player's private profile subdocument (teams/{teamId}/players/{playerId}/private/profile),
// never through this catalog. db.assertNoSensitivePlayerFields() enforces that.

const HAND_FOOT_VALUES = new Set(['left', 'right', 'both']);

function cleanText(value, maxLength = 120) {
    return String(value ?? '').trim().slice(0, maxLength);
}

function normalizeDob(value) {
    const text = cleanText(value, 10);
    if (!text) return null;
    // Accept ISO YYYY-MM-DD only; reject anything else so we never store garbage.
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    if (!match) return null;
    const [, y, m, d] = match;
    const date = new Date(Number(y), Number(m) - 1, Number(d));
    if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(m) - 1 || date.getDate() !== Number(d)) {
        return null;
    }
    return text;
}

function normalizeSide(value) {
    const text = cleanText(value, 10).toLowerCase();
    return HAND_FOOT_VALUES.has(text) ? text : null;
}

function normalizeHeightInches(value) {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0 || num > 96) return null;
    return Math.round(num);
}

// key -> { label, storage: 'public', aliases, normalize }
export const PLAYER_FIELD_CATALOG = [
    { key: 'preferredName', label: 'Preferred name', aliases: ['nickname', 'preferred name'], normalize: (v) => cleanText(v) },
    { key: 'position', label: 'Position', aliases: ['pos', 'positions'], normalize: (v) => cleanText(v, 60) },
    { key: 'dob', label: 'Date of birth', aliases: ['dob', 'birthdate', 'date of birth', 'birthday'], normalize: normalizeDob },
    { key: 'gender', label: 'Gender', aliases: ['sex'], normalize: (v) => cleanText(v, 32) },
    { key: 'grade', label: 'Grade', aliases: ['grade level'], normalize: (v) => cleanText(v, 24) },
    { key: 'school', label: 'School', aliases: ['school name'], normalize: (v) => cleanText(v) },
    { key: 'jerseySize', label: 'Jersey size', aliases: ['jersey', 'shirt size', 'uniform size', 'size'], normalize: (v) => cleanText(v, 24) },
    { key: 'dominantHand', label: 'Dominant hand', aliases: ['handedness', 'throws', 'bats'], normalize: normalizeSide },
    { key: 'dominantFoot', label: 'Dominant foot', aliases: ['footedness', 'kicks'], normalize: normalizeSide },
    { key: 'heightInches', label: 'Height (in)', aliases: ['height', 'height inches'], normalize: normalizeHeightInches },
    { key: 'memberId', label: 'Association/member ID', aliases: ['member id', 'league id', 'aau', 'ussf id', 'usa hockey id'], normalize: (v) => cleanText(v, 60) }
];

const CATALOG_BY_KEY = new Map(PLAYER_FIELD_CATALOG.map((field) => [field.key, field]));
const CATALOG_BY_ALIAS = new Map();
PLAYER_FIELD_CATALOG.forEach((field) => {
    CATALOG_BY_ALIAS.set(field.key.toLowerCase(), field);
    CATALOG_BY_ALIAS.set(field.label.toLowerCase(), field);
    field.aliases.forEach((alias) => CATALOG_BY_ALIAS.set(String(alias).toLowerCase(), field));
});

export function getPlayerCatalogFieldKeys() {
    return PLAYER_FIELD_CATALOG.map((field) => field.key);
}

export function resolvePlayerCatalogField(keyOrLabel) {
    const text = String(keyOrLabel || '').trim().toLowerCase();
    return CATALOG_BY_KEY.get(keyOrLabel) || CATALOG_BY_ALIAS.get(text) || null;
}

/**
 * Validate and normalize a raw object of optional player fields (from AI/CSV/form).
 * Unknown keys are dropped; invalid values are dropped. Returns only the
 * public catalog fields with non-empty normalized values — safe to spread onto
 * an addPlayer/updatePlayer payload.
 */
export function normalizePlayerCatalogFields(raw = {}) {
    const result = {};
    if (!raw || typeof raw !== 'object') return result;
    Object.keys(raw).forEach((rawKey) => {
        const field = resolvePlayerCatalogField(rawKey);
        if (!field) return;
        const normalized = field.normalize(raw[rawKey]);
        if (normalized !== null && normalized !== undefined && normalized !== '') {
            result[field.key] = normalized;
        }
    });
    return result;
}
