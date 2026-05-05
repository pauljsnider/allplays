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
    return player?.profile?.customFields || player?.profile?.rosterFields || player?.customFields || {};
}

export function validateRosterProfileValues(fields = [], values = {}) {
    const errors = [];
    fields.forEach((field) => {
        if (!field.required) return;
        const value = values?.[field.key];
        const missing = field.type === 'checkbox' ? value !== true : String(value ?? '').trim() === '';
        if (missing) {
            errors.push(`${field.label} is required.`);
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
