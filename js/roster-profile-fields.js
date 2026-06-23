const SUPPORTED_TYPES = new Set(['text', 'menu', 'checkbox', 'date']);
const SUPPORTED_VISIBILITY = new Set(['public', 'team', 'parents', 'admins']);

function slugify(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function normalizeFieldType(type) {
    const normalized = String(type || 'text').trim().toLowerCase();
    if (normalized === 'select' || normalized === 'dropdown') return 'menu';
    if (normalized === 'boolean' || normalized === 'bool') return 'checkbox';
    return SUPPORTED_TYPES.has(normalized) ? normalized : 'text';
}

function normalizeOptions(options) {
    if (!Array.isArray(options)) return [];
    return options
        .map((option) => {
            if (option && typeof option === 'object') {
                const value = String(option.value ?? option.label ?? '').trim();
                const label = String(option.label ?? option.value ?? '').trim();
                return value ? { value, label: label || value } : null;
            }
            const value = String(option || '').trim();
            return value ? { value, label: value } : null;
        })
        .filter(Boolean);
}

function normalizeVisibility(value) {
    const normalized = String(value || 'team').trim().toLowerCase();
    if (normalized === 'private' || normalized === 'admin') return 'admins';
    if (normalized === 'family') return 'parents';
    return SUPPORTED_VISIBILITY.has(normalized) ? normalized : 'team';
}

export function buildRosterFieldDefinitionPayload(field = {}, fallbackOrder = 0) {
    const label = String(field.label || field.name || field.title || '').trim();
    const key = String(field.key || field.id || slugify(label) || `field-${fallbackOrder + 1}`).trim();
    if (!key || !label) {
        throw new Error('Roster field label is required.');
    }

    const type = normalizeFieldType(field.type || field.fieldType);
    const options = normalizeOptions(field.options || field.choices || field.values);

    return {
        key,
        label,
        type,
        section: String(field.section || '').trim(),
        required: field.required === true,
        options,
        description: String(field.description || field.helpText || '').trim(),
        visibility: normalizeVisibility(field.visibility || field.defaultVisibility),
        active: field.active !== false,
        sortOrder: Number.isFinite(Number(field.sortOrder ?? field.order)) ? Number(field.sortOrder ?? field.order) : fallbackOrder
    };
}

export function normalizeRosterFieldDefinitions(fields = [], options = {}) {
    if (!Array.isArray(fields)) return [];
    const includeInactive = options.includeInactive === true;

    return fields
        .map((field, index) => {
            if (!field || typeof field !== 'object') return null;
            try {
                return buildRosterFieldDefinitionPayload(field, index);
            } catch (e) {
                return null;
            }
        })
        .filter((field) => field && (includeInactive || field.active !== false))
        .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label));
}

export function getRosterProfileValues(player = {}) {
    return {
        ...(player?.rosterFieldValues || {}),
        ...(player?.customFields || {}),
        ...(player?.profile?.rosterFields || {}),
        ...(player?.profile?.customFields || {})
    };
}

export function validateRosterProfileValues(fields = [], values = {}) {
    const errors = [];
    fields.forEach((field) => {
        const value = values?.[field.key];
        const missing = field.type === 'checkbox' ? value !== true : String(value ?? '').trim() === '';
        if (field.required && missing) {
            errors.push(`${field.label} is required.`);
            return;
        }
        if (missing) return;
        if (field.type === 'menu' && (field.options || []).length > 0) {
            const valid = (field.options || []).some((option) => String(option.value) === String(value));
            if (!valid) errors.push(`${field.label} must be one of the configured options.`);
        }
        if (field.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
            errors.push(`${field.label} must use YYYY-MM-DD format.`);
        }
    });
    return errors;
}

function coerceRosterProfileValue(field, value) {
    if (field.type === 'checkbox') return value === true;
    return String(value ?? '').trim();
}

export function collectRosterProfileValues(container, fields = []) {
    const values = {};
    fields.forEach((field) => {
        const input = Array.from(container?.querySelectorAll?.('[data-roster-profile-field]') || [])
            .find((el) => el.dataset.rosterProfileField === field.key);
        if (!input) return;
        values[field.key] = coerceRosterProfileValue(field, field.type === 'checkbox' ? input.checked : input.value);
    });
    return values;
}


function normalizeHeaderKey(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function parseCsvRows(csvText = '') {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;
    const text = String(csvText || '').replace(/^\uFEFF/, '');

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];
        const next = text[i + 1];
        if (char === '"') {
            if (inQuotes && next === '"') {
                cell += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            row.push(cell);
            cell = '';
        } else if ((char === '\n' || char === '\r') && !inQuotes) {
            if (char === '\r' && next === '\n') i += 1;
            row.push(cell);
            if (row.some((value) => String(value || '').trim() !== '')) rows.push(row);
            row = [];
            cell = '';
        } else {
            cell += char;
        }
    }

    row.push(cell);
    if (row.some((value) => String(value || '').trim() !== '')) rows.push(row);
    return rows;
}

function parseCheckboxValue(value) {
    const normalized = String(value ?? '').trim().toLowerCase();
    if (normalized === '') return false;
    if (['true', 'yes', 'y', '1', 'checked', 'x'].includes(normalized)) return true;
    if (['false', 'no', 'n', '0', 'unchecked'].includes(normalized)) return false;
    return null;
}

function parseIsoDateValue(label, rawValue) {
    const value = String(rawValue ?? '').trim();
    if (value === '') return { value: '' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { error: `${label} must use YYYY-MM-DD format.` };
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        return { error: `${label} must be a valid date.` };
    }
    return { value };
}

function parseRosterCsvFieldValue(field, rawValue) {
    const value = String(rawValue ?? '').trim();
    if (value === '') return { value: field.type === 'checkbox' ? false : '' };

    if (field.type === 'checkbox') {
        const parsed = parseCheckboxValue(value);
        if (parsed === null) return { error: `${field.label} must be yes/no.` };
        return { value: parsed };
    }

    if (field.type === 'date') {
        return parseIsoDateValue(field.label, value);
    }

    if (field.type === 'menu') {
        const option = (field.options || []).find((item) =>
            String(item.value || '').trim().toLowerCase() === value.toLowerCase() ||
            String(item.label || '').trim().toLowerCase() === value.toLowerCase()
        );
        if (!option) {
            const choices = (field.options || []).map((item) => item.label || item.value).filter(Boolean).join(', ');
            return { error: `${field.label} must be one of: ${choices}.` };
        }
        return { value: option.value };
    }

    return { value };
}

function isAdminOnlyRosterField(field = {}) {
    const visibility = String(field.visibility || '').trim().toLowerCase();
    return ['admin', 'admins', 'private', 'restricted'].includes(visibility);
}

export function splitRosterProfileValuesByVisibility(fields = [], values = {}) {
    const publicValues = {};
    const privateValues = {};
    fields.forEach((field) => {
        if (!Object.prototype.hasOwnProperty.call(values || {}, field.key)) return;
        if (isAdminOnlyRosterField(field)) {
            privateValues[field.key] = values[field.key];
        } else {
            publicValues[field.key] = values[field.key];
        }
    });
    return { publicValues, privateValues };
}

function getExistingPlayersByName(existingPlayers = []) {
    const byName = new Map();
    existingPlayers.forEach((player) => {
        const key = String(player?.name || '').trim().toLowerCase();
        if (!key) return;
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(player);
    });
    return byName;
}

const CONTACT_HEADER_GROUPS = [
    { prefix: 'emergencycontact', bucket: 'contacts', defaultRelation: 'Emergency Contact' },
    { prefix: 'familycontact', bucket: 'contacts', defaultRelation: 'Family Contact' },
    { prefix: 'guardian', bucket: 'guardians', defaultRelation: 'Guardian' },
    { prefix: 'mother', bucket: 'guardians', defaultRelation: 'Mother' },
    { prefix: 'father', bucket: 'guardians', defaultRelation: 'Father' },
    { prefix: 'parent', bucket: 'guardians', defaultRelation: 'Parent' },
    { prefix: 'contact', bucket: 'contacts', defaultRelation: 'Contact' }
];

const CONTACT_FIELD_ALIASES = new Map([
    ['name', 'name'],
    ['fullname', 'name'],
    ['firstname', 'firstName'],
    ['first', 'firstName'],
    ['lastname', 'lastName'],
    ['last', 'lastName'],
    ['email', 'email'],
    ['emailaddress', 'email'],
    ['phone', 'phone'],
    ['phonenumber', 'phone'],
    ['mobile', 'phone'],
    ['mobilephone', 'phone'],
    ['cell', 'phone'],
    ['cellphone', 'phone'],
    ['relation', 'relation'],
    ['relationship', 'relation']
]);

const PROFILE_HEADER_ALIASES = new Map([
    ['position', { profileField: 'position' }],
    ['primaryposition', { profileField: 'position' }],
    ['playerposition', { profileField: 'position' }],
    ['pos', { profileField: 'position' }],
    ['birthdate', { profileField: 'birthDate' }],
    ['dateofbirth', { profileField: 'birthDate' }],
    ['dob', { profileField: 'birthDate' }],
    ['birthday', { profileField: 'birthDate' }],
    ['gender', { profileField: 'gender' }],
    ['sex', { profileField: 'gender' }],
    ['street', { profileField: 'address', addressField: 'street' }],
    ['streetaddress', { profileField: 'address', addressField: 'street' }],
    ['address', { profileField: 'address', addressField: 'address1' }],
    ['homeaddress', { profileField: 'address', addressField: 'address1' }],
    ['address1', { profileField: 'address', addressField: 'address1' }],
    ['addressline1', { profileField: 'address', addressField: 'address1' }],
    ['line1', { profileField: 'address', addressField: 'address1' }],
    ['address2', { profileField: 'address', addressField: 'address2' }],
    ['addressline2', { profileField: 'address', addressField: 'address2' }],
    ['line2', { profileField: 'address', addressField: 'address2' }],
    ['street2', { profileField: 'address', addressField: 'address2' }],
    ['unit', { profileField: 'address', addressField: 'address2' }],
    ['apt', { profileField: 'address', addressField: 'address2' }],
    ['apartment', { profileField: 'address', addressField: 'address2' }],
    ['suite', { profileField: 'address', addressField: 'address2' }],
    ['city', { profileField: 'address', addressField: 'city' }],
    ['town', { profileField: 'address', addressField: 'city' }],
    ['state', { profileField: 'address', addressField: 'state' }],
    ['province', { profileField: 'address', addressField: 'state' }],
    ['zip', { profileField: 'address', addressField: 'zip' }],
    ['zipcode', { profileField: 'address', addressField: 'zip' }],
    ['postalcode', { profileField: 'address', addressField: 'zip' }],
    ['postal', { profileField: 'address', addressField: 'zip' }],
    ['rosterstatus', { profileField: 'rosterStatus', statusMode: 'status' }],
    ['playerstatus', { profileField: 'rosterStatus', statusMode: 'status' }],
    ['participantstatus', { profileField: 'rosterStatus', statusMode: 'status' }],
    ['memberstatus', { profileField: 'rosterStatus', statusMode: 'status' }],
    ['playertype', { profileField: 'rosterStatus', statusMode: 'status' }],
    ['participanttype', { profileField: 'rosterStatus', statusMode: 'status' }],
    ['membertype', { profileField: 'rosterStatus', statusMode: 'status' }],
    ['rostertype', { profileField: 'rosterStatus', statusMode: 'status' }],
    ['rosterrole', { profileField: 'rosterStatus', statusMode: 'status' }],
    ['staffstatus', { profileField: 'rosterStatus', statusMode: 'staffFlag' }],
    ['nonplayerstatus', { profileField: 'rosterStatus', statusMode: 'nonPlayerFlag' }],
    ['staff', { profileField: 'rosterStatus', statusMode: 'staffFlag' }],
    ['isstaff', { profileField: 'rosterStatus', statusMode: 'staffFlag' }],
    ['staffmember', { profileField: 'rosterStatus', statusMode: 'staffFlag' }],
    ['nonplayer', { profileField: 'rosterStatus', statusMode: 'nonPlayerFlag' }],
    ['isnonplayer', { profileField: 'rosterStatus', statusMode: 'nonPlayerFlag' }],
    ['notaplayer', { profileField: 'rosterStatus', statusMode: 'nonPlayerFlag' }]
]);

const ROSTER_STATUS_VALUE_ALIASES = new Map([
    ['player', 'player'],
    ['athlete', 'player'],
    ['participant', 'player'],
    ['rosterplayer', 'player'],
    ['activeplayer', 'player'],
    ['staff', 'staff'],
    ['coach', 'staff'],
    ['headcoach', 'staff'],
    ['assistantcoach', 'staff'],
    ['manager', 'staff'],
    ['teammanager', 'staff'],
    ['admin', 'staff'],
    ['administrator', 'staff'],
    ['volunteer', 'staff'],
    ['trainer', 'staff'],
    ['nonplayer', 'non-player'],
    ['nonathlete', 'non-player'],
    ['notplayer', 'non-player'],
    ['notaplayer', 'non-player'],
    ['benchstaff', 'staff']
]);

function getContactHeaderMapping(normalizedHeader = '', label = '') {
    for (const group of CONTACT_HEADER_GROUPS) {
        if (!normalizedHeader.startsWith(group.prefix)) continue;
        const remainder = normalizedHeader.slice(group.prefix.length);
        const match = remainder.match(/^(\d*)([a-z]+)(\d*)$/);
        if (!match) continue;
        const [, leadingSuffix, fieldToken, trailingSuffix] = match;
        const field = CONTACT_FIELD_ALIASES.get(fieldToken);
        if (!field) continue;
        return {
            type: 'contact',
            label,
            contactKey: `${group.prefix}${leadingSuffix || trailingSuffix || '1'}`,
            contactField: field,
            contactBucket: group.bucket,
            defaultRelation: group.defaultRelation
        };
    }
    return null;
}

function getProfileHeaderMapping(normalizedHeader = '', label = '') {
    const profile = PROFILE_HEADER_ALIASES.get(normalizedHeader);
    if (!profile) return null;
    return {
        type: 'profile',
        label,
        ...profile
    };
}

function normalizeImportedContact(contact = {}) {
    const name = String(contact.name || '').trim() || [contact.firstName, contact.lastName]
        .map((part) => String(part || '').trim())
        .filter(Boolean)
        .join(' ');
    const email = String(contact.email || '').trim().toLowerCase();
    const phone = String(contact.phone || '').trim();
    const relation = String(contact.relation || contact.defaultRelation || 'Parent').trim() || 'Parent';
    if (!name && !email && !phone) return null;
    return {
        name,
        email,
        phone,
        relation,
        source: 'roster-csv'
    };
}

function getContactDedupeKey(contact = {}) {
    const email = String(contact.email || '').trim().toLowerCase();
    if (email) return `email:${email}`;
    const phone = String(contact.phone || '').trim().toLowerCase();
    if (phone) return `phone:${phone}`;
    return `name:${String(contact.name || '').trim().toLowerCase()}:${String(contact.relation || '').trim().toLowerCase()}`;
}

function mergeImportedContacts(existingContacts = [], importedContacts = []) {
    const merged = [];
    const seen = new Set();
    [...(Array.isArray(existingContacts) ? existingContacts : []), ...importedContacts].forEach((contact) => {
        const normalized = normalizeImportedContact(contact);
        if (!normalized) return;
        const key = getContactDedupeKey(normalized);
        if (seen.has(key)) return;
        seen.add(key);
        merged.push(normalized);
    });
    return merged;
}

function buildRosterCsvContactPlan(contactValues = new Map(), rowNumber = 0) {
    const guardians = [];
    const contacts = [];
    const errors = [];
    contactValues.forEach((draft) => {
        const normalized = normalizeImportedContact(draft);
        if (!normalized) return;
        if (normalized.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized.email)) {
            errors.push(`Row ${rowNumber}: ${normalized.relation} email must be valid.`);
            return;
        }
        if (draft.bucket === 'contacts') {
            contacts.push(normalized);
        } else {
            guardians.push(normalized);
        }
    });
    const familyContacts = [...guardians, ...contacts];
    const inviteRequests = familyContacts
        .filter((contact) => contact.email)
        .map((contact) => ({
            email: contact.email,
            displayName: contact.name || contact.email,
            relation: contact.relation,
            phone: contact.phone
        }));
    return { guardians, contacts, familyContacts, inviteRequests, errors };
}

function normalizeRosterStatusProfile(status = '') {
    const rosterStatus = String(status || '').trim();
    const isStaff = rosterStatus === 'staff';
    const nonPlayer = isStaff || rosterStatus === 'non-player';
    return { rosterStatus, isStaff, nonPlayer };
}

function normalizeRosterStatusValue(rawValue, mapping = {}) {
    const value = String(rawValue ?? '').trim();
    if (!value) return { value: null };
    const normalized = normalizeHeaderKey(value);
    const alias = ROSTER_STATUS_VALUE_ALIASES.get(normalized);
    if (alias) return { value: normalizeRosterStatusProfile(alias) };

    if (mapping.statusMode === 'staffFlag' || mapping.statusMode === 'nonPlayerFlag') {
        const parsed = parseCheckboxValue(value);
        if (parsed === null) return { error: `${mapping.label} must be yes/no or a supported roster status.` };
        const status = parsed
            ? mapping.statusMode === 'staffFlag' ? 'staff' : 'non-player'
            : 'player';
        return { value: normalizeRosterStatusProfile(status) };
    }

    return { value: normalizeRosterStatusProfile(value) };
}

function parseRosterCsvProfileValue(mapping = {}, rawValue) {
    const value = String(rawValue ?? '').trim();
    if (!value) return { value: null };
    if (mapping.profileField === 'birthDate') return parseIsoDateValue(mapping.label, value);
    if (mapping.profileField === 'rosterStatus') return normalizeRosterStatusValue(value, mapping);
    return { value };
}

function getProfileMappingDedupeKey(mapping = {}) {
    if (mapping.profileField === 'address') return `address.${mapping.addressField}`;
    return mapping.profileField || '';
}

function mergeProfileImportValues(existingProfile = {}, profileValues = {}, addressValues = {}) {
    const nextProfile = {
        ...existingProfile,
        ...profileValues
    };
    if (Object.keys(addressValues).length > 0) {
        nextProfile.address = {
            ...(existingProfile.address || {}),
            ...addressValues
        };
    }
    return nextProfile;
}

export function planRosterCsvImport({ csvText = '', fields = [], existingPlayers = [] } = {}) {
    const errors = [];
    const normalizedFields = normalizeRosterFieldDefinitions(fields);
    const rows = parseCsvRows(csvText);
    if (rows.length === 0) return { errors: ['CSV is empty.'], operations: [] };

    const headers = rows[0].map((header) => String(header || '').trim());
    const fieldByHeader = new Map();
    normalizedFields.forEach((field) => {
        fieldByHeader.set(normalizeHeaderKey(field.key), field);
        fieldByHeader.set(normalizeHeaderKey(field.label), field);
    });

    const coreAliases = new Map([
        ['name', 'name'],
        ['player', 'name'],
        ['playername', 'name'],
        ['athlete', 'name'],
        ['athletename', 'name'],
        ['number', 'number'],
        ['jersey', 'number'],
        ['jerseynumber', 'number'],
        ['uniformnumber', 'number'],
        ['no', 'number']
    ]);

    const mappings = headers.map((header, index) => {
        const normalized = normalizeHeaderKey(header);
        if (!normalized) return { index, type: 'blank' };
        const core = coreAliases.get(normalized);
        if (core) return { index, type: core, label: header };
        const contact = getContactHeaderMapping(normalized, header);
        if (contact) return { index, ...contact };
        const field = fieldByHeader.get(normalized);
        if (field) return { index, type: 'field', field, label: header };
        const profile = getProfileHeaderMapping(normalized, header);
        if (profile) return { index, ...profile };
        return { index, type: 'unknown', label: header };
    });

    if (!mappings.some((mapping) => mapping.type === 'name')) {
        errors.push('CSV must include a player name header.');
    }

    const seenTypes = new Set();
    const seenFields = new Set();
    const seenContacts = new Set();
    const seenProfileFields = new Set();
    mappings.forEach((mapping) => {
        if (mapping.type === 'unknown') {
            errors.push(`Unknown CSV header "${mapping.label}". Use Name, Number, a supported player profile header, a supported parent/guardian contact header, or a configured roster field label/key.`);
        } else if (mapping.type === 'name' || mapping.type === 'number') {
            if (seenTypes.has(mapping.type)) errors.push(`Duplicate ${mapping.type === 'name' ? 'name' : 'number'} header.`);
            seenTypes.add(mapping.type);
        } else if (mapping.type === 'field') {
            if (seenFields.has(mapping.field.key)) errors.push(`Duplicate roster field header for ${mapping.field.label}.`);
            seenFields.add(mapping.field.key);
        } else if (mapping.type === 'contact') {
            const contactKey = `${mapping.contactKey}:${mapping.contactField}`;
            if (seenContacts.has(contactKey)) errors.push(`Duplicate contact header for ${mapping.label}.`);
            seenContacts.add(contactKey);
        } else if (mapping.type === 'profile') {
            const profileKey = getProfileMappingDedupeKey(mapping);
            if (seenProfileFields.has(profileKey)) errors.push(`Duplicate player profile header for ${mapping.label}.`);
            seenProfileFields.add(profileKey);
        }
    });

    if (errors.length) return { errors, operations: [] };

    const existingByName = getExistingPlayersByName(existingPlayers);
    const operations = [];
    rows.slice(1).forEach((row, rowIndex) => {
        const rowNumber = rowIndex + 2;
        if (!row.some((value) => String(value || '').trim() !== '')) return;

        const values = {};
        let name = '';
        let number = '';
        const contactValues = new Map();
        const profileValues = {};
        const addressValues = {};
        const hasNumberColumn = mappings.some((mapping) => mapping.type === 'number');
        mappings.forEach((mapping) => {
            const rawValue = row[mapping.index] ?? '';
            if (mapping.type === 'name') name = String(rawValue || '').trim();
            if (mapping.type === 'number') number = String(rawValue || '').trim();
            if (mapping.type === 'field') values[mapping.field.key] = rawValue;
            if (mapping.type === 'profile') {
                const parsed = parseRosterCsvProfileValue(mapping, rawValue);
                if (parsed.error) {
                    errors.push(`Row ${rowNumber}: ${parsed.error}`);
                } else if (parsed.value !== null && parsed.value !== '') {
                    if (mapping.profileField === 'address') {
                        addressValues[mapping.addressField] = parsed.value;
                    } else if (mapping.profileField === 'rosterStatus') {
                        Object.assign(profileValues, parsed.value);
                    } else {
                        profileValues[mapping.profileField] = parsed.value;
                    }
                }
            }
            if (mapping.type === 'contact') {
                const existing = contactValues.get(mapping.contactKey) || {
                    bucket: mapping.contactBucket,
                    defaultRelation: mapping.defaultRelation
                };
                existing[mapping.contactField] = rawValue;
                contactValues.set(mapping.contactKey, existing);
            }
        });

        if (!name) errors.push(`Row ${rowNumber}: player name is required.`);

        const parsedValues = {};
        normalizedFields.forEach((field) => {
            if (!Object.prototype.hasOwnProperty.call(values, field.key)) return;
            const parsed = parseRosterCsvFieldValue(field, values[field.key]);
            if (parsed.error) {
                errors.push(`Row ${rowNumber}: ${parsed.error}`);
            } else {
                parsedValues[field.key] = parsed.value;
            }
        });

        validateRosterProfileValues(normalizedFields, parsedValues).forEach((error) => {
            errors.push(`Row ${rowNumber}: ${error}`);
        });

        if (!name) return;
        const { publicValues, privateValues } = splitRosterProfileValuesByVisibility(normalizedFields, parsedValues);
        const contactPlan = buildRosterCsvContactPlan(contactValues, rowNumber);
        contactPlan.errors.forEach((error) => errors.push(error));
        const matches = existingByName.get(name.toLowerCase()) || [];
        if (matches.length > 1) {
            errors.push(`Row ${rowNumber}: multiple existing players named ${name}; update this player manually.`);
            return;
        }

        const existing = matches[0];
        const existingProfile = existing?.profile || {};
        const profile = {
            ...mergeProfileImportValues(existingProfile, profileValues, addressValues),
            customFields: {
                ...(existingProfile.customFields || {}),
                ...publicValues
            }
        };
        const payload = { name, profile };
        if (hasNumberColumn) payload.number = number;
        if (Object.prototype.hasOwnProperty.call(profileValues, 'position')) payload.position = profileValues.position;
        const mergedGuardians = mergeImportedContacts(existing?.guardians || existing?.parents || existing?.familyContacts || [], contactPlan.guardians);
        const mergedContacts = mergeImportedContacts(existing?.contacts || [], contactPlan.contacts);
        const privateRosterFields = Object.keys(privateValues).length > 0 ? privateValues : null;
        const privateFamilyContacts = mergedGuardians.length > 0 || mergedContacts.length > 0
            ? {
                ...(mergedGuardians.length > 0 ? { parents: mergedGuardians } : {}),
                ...(mergedContacts.length > 0 ? { contacts: mergedContacts } : {})
            }
            : null;
        operations.push(existing
            ? { type: 'update', playerId: existing.id, payload, privateRosterFields, privateFamilyContacts, familyContacts: contactPlan.familyContacts, inviteRequests: contactPlan.inviteRequests }
            : { type: 'add', payload, privateRosterFields, privateFamilyContacts, familyContacts: contactPlan.familyContacts, inviteRequests: contactPlan.inviteRequests });
    });

    if (errors.length) return { errors, operations: [] };
    return { errors: [], operations };
}

function createBaseField(field) {
    const wrapper = document.createElement('div');
    const label = document.createElement('label');
    label.className = 'block text-sm font-medium text-gray-700';
    label.textContent = field.required ? `${field.label} *` : field.label;
    wrapper.appendChild(label);

    if (field.description) {
        const help = document.createElement('p');
        help.className = 'text-xs text-gray-500 mt-1';
        help.textContent = field.description;
        wrapper.appendChild(help);
    }

    return { wrapper, label };
}

function applyInputClasses(input) {
    input.className = 'mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 border p-2';
}

export function renderRosterProfileFields(container, fields = [], values = {}) {
    if (!container) return;
    container.innerHTML = '';

    if (!fields.length) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');

    const heading = document.createElement('div');
    heading.className = 'pt-2 border-t border-gray-200';
    const title = document.createElement('h3');
    title.className = 'text-sm font-semibold text-gray-900';
    title.textContent = 'Roster Profile Fields';
    heading.appendChild(title);
    container.appendChild(heading);

    fields.forEach((field) => {
        const { wrapper, label } = createBaseField(field);
        let input;
        const value = values?.[field.key];

        if (field.type === 'menu') {
            input = document.createElement('select');
            applyInputClasses(input);
            const blank = document.createElement('option');
            blank.value = '';
            blank.textContent = 'Select...';
            input.appendChild(blank);
            field.options.forEach((option) => {
                const opt = document.createElement('option');
                opt.value = option.value;
                opt.textContent = option.label;
                input.appendChild(opt);
            });
            input.value = String(value ?? '');
        } else if (field.type === 'checkbox') {
            const checkWrap = document.createElement('label');
            checkWrap.className = 'mt-2 inline-flex items-center gap-2 text-sm text-gray-700';
            input = document.createElement('input');
            input.type = 'checkbox';
            input.className = 'rounded text-indigo-600 focus:ring-indigo-500';
            input.checked = value === true;
            const text = document.createElement('span');
            text.textContent = 'Yes';
            checkWrap.appendChild(input);
            checkWrap.appendChild(text);
            wrapper.appendChild(checkWrap);
        } else {
            input = document.createElement('input');
            input.type = field.type === 'date' ? 'date' : 'text';
            applyInputClasses(input);
            input.value = String(value ?? '');
        }

        input.dataset.rosterProfileField = field.key;
        input.required = field.required && field.type !== 'checkbox';
        input.setAttribute('aria-label', field.label);
        if (field.type !== 'checkbox') {
            wrapper.appendChild(input);
        }
        container.appendChild(wrapper);
    });
}
