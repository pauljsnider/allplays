import {
    getRosterProfileValues as legacyGetRosterProfileValues,
    normalizeRosterFieldDefinitions as legacyNormalizeRosterFieldDefinitions,
    splitRosterProfileValuesByVisibility as legacySplitRosterProfileValuesByVisibility,
    splitProtectedRosterProfileValues as legacySplitProtectedRosterProfileValues,
    validateRosterProfileValues as legacyValidateRosterProfileValues
} from '@legacy/roster-profile-fields.js';
import { canViewRosterField as legacyCanViewRosterFieldVisibility } from '@legacy/roster-field-privacy.js';

type LegacyRecord = Record<string, unknown>;

export type RosterFieldType = 'text' | 'menu' | 'checkbox' | 'date';
export type RosterFieldVisibility = 'public' | 'team' | 'parents' | 'admins';
export type RosterFieldOption = {
    value: string;
    label: string;
};

export type RosterFieldDefinition = {
    key: string;
    label: string;
    type: RosterFieldType;
    section?: string;
    description?: string;
    visibility: RosterFieldVisibility;
    required?: boolean;
    options?: RosterFieldOption[];
    active?: boolean;
    sortOrder?: number;
    [key: string]: unknown;
};

export type RosterFieldAccess = {
    isAdmin: boolean;
    isTeamMember: boolean;
    isLinkedParent: boolean;
};

export type RosterProfileValue = string | boolean;
export type RosterProfileValues = Record<string, RosterProfileValue>;

export type RosterFieldVisibilityInput = {
    id?: string;
    key?: string;
    visibility?: string;
    privacy?: string;
    access?: string;
};

export type LegacyRosterFieldOption = RosterFieldOption;
export type LegacyRosterFieldDefinition = RosterFieldDefinition;
export type LegacyRosterFieldAccess = RosterFieldAccess;

const supportedTypes = new Set<RosterFieldType>(['text', 'menu', 'checkbox', 'date']);
const supportedVisibility = new Set<RosterFieldVisibility>(['public', 'team', 'parents', 'admins']);

function isRecord(value: unknown): value is LegacyRecord {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function cleanString(value: unknown): string {
    return String(value ?? '').trim();
}

function asArray(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function normalizeFieldType(value: unknown): RosterFieldType {
    const normalized = cleanString(value).toLowerCase();
    if (normalized === 'select' || normalized === 'dropdown') return 'menu';
    if (normalized === 'boolean' || normalized === 'bool') return 'checkbox';
    return supportedTypes.has(normalized as RosterFieldType) ? normalized as RosterFieldType : 'text';
}

function normalizeVisibility(value: unknown): RosterFieldVisibility {
    const normalized = cleanString(value || 'team').toLowerCase();
    if (normalized === 'private' || normalized === 'admin' || normalized === 'restricted') return 'admins';
    if (normalized === 'family') return 'parents';
    return supportedVisibility.has(normalized as RosterFieldVisibility) ? normalized as RosterFieldVisibility : 'team';
}

function normalizeOption(value: unknown): RosterFieldOption | null {
    if (isRecord(value)) {
        const optionValue = cleanString(value.value ?? value.label);
        if (!optionValue) return null;
        return {
            value: optionValue,
            label: cleanString(value.label ?? value.value) || optionValue
        };
    }

    const optionValue = cleanString(value);
    return optionValue ? { value: optionValue, label: optionValue } : null;
}

function normalizeOptions(value: unknown): RosterFieldOption[] {
    return asArray(value).map(normalizeOption).filter((option): option is RosterFieldOption => !!option);
}

function normalizeRosterFieldDefinition(value: unknown, index: number): RosterFieldDefinition | null {
    if (!isRecord(value)) return null;
    const key = cleanString(value.key || value.id);
    const label = cleanString(value.label || value.name || key);
    if (!key || !label) return null;

    return {
        ...value,
        key,
        label,
        type: normalizeFieldType(value.type || value.fieldType),
        section: cleanString(value.section) || undefined,
        description: cleanString(value.description || value.helpText) || undefined,
        visibility: normalizeVisibility(value.visibility || value.defaultVisibility),
        required: value.required === true,
        options: normalizeOptions(value.options || value.choices || value.values),
        active: value.active !== false,
        sortOrder: Number.isFinite(Number(value.sortOrder ?? value.order)) ? Number(value.sortOrder ?? value.order) : index
    };
}

function normalizeRosterProfileValue(value: unknown): RosterProfileValue {
    if (value === true || value === false) return value;
    return cleanString(value);
}

function normalizeRosterProfileValues(value: unknown): RosterProfileValues {
    if (!isRecord(value)) return {};
    return Object.entries(value).reduce<RosterProfileValues>((acc, [key, rawValue]) => {
        const cleanKey = cleanString(key);
        if (!cleanKey) return acc;
        acc[cleanKey] = normalizeRosterProfileValue(rawValue);
        return acc;
    }, {});
}

function splitByDefinitionVisibility(fields: RosterFieldDefinition[], values: RosterProfileValues) {
    return fields.reduce<{ publicValues: RosterProfileValues; privateValues: RosterProfileValues }>((acc, field) => {
        if (!Object.prototype.hasOwnProperty.call(values, field.key)) return acc;
        const visibility = normalizeVisibility(field.visibility);
        if (visibility === 'public') {
            acc.publicValues[field.key] = values[field.key];
        } else if (visibility === 'team' || visibility === 'parents' || visibility === 'admins') {
            acc.privateValues[field.key] = values[field.key];
        }
        return acc;
    }, { publicValues: {}, privateValues: {} });
}

export function normalizeRosterFieldDefinitions(fields: unknown): RosterFieldDefinition[] {
    return asArray(legacyNormalizeRosterFieldDefinitions(asArray(fields)))
        .map(normalizeRosterFieldDefinition)
        .filter((field): field is RosterFieldDefinition => !!field);
}

export function getRosterProfileValues(player: Record<string, unknown>): RosterProfileValues {
    return normalizeRosterProfileValues(legacyGetRosterProfileValues(player));
}

export function validateRosterProfileValues(fields: RosterFieldDefinition[], values: RosterProfileValues): string[] {
    return asArray(legacyValidateRosterProfileValues(fields, values)).map(cleanString).filter(Boolean);
}

export function splitRosterProfileValuesByVisibility(fields: RosterFieldDefinition[], values: RosterProfileValues): {
    publicValues: RosterProfileValues;
    privateValues: RosterProfileValues;
} {
    const normalizedValues = normalizeRosterProfileValues(values);
    const result = legacySplitRosterProfileValuesByVisibility(fields, normalizedValues);
    if (!isRecord(result)) {
        return splitByDefinitionVisibility(fields, normalizedValues);
    }

    return {
        publicValues: normalizeRosterProfileValues(result.publicValues),
        privateValues: normalizeRosterProfileValues(result.privateValues)
    };
}

export function splitProtectedRosterProfileValues(profile: Record<string, unknown>): {
    publicProfile: Record<string, any>;
    privateValues: Record<string, any>;
} {
    const result = legacySplitProtectedRosterProfileValues(profile);
    return {
        publicProfile: isRecord(result?.publicProfile) ? result.publicProfile : {},
        privateValues: isRecord(result?.privateValues) ? result.privateValues : {}
    };
}

export function canViewRosterField(field: RosterFieldVisibilityInput, access: RosterFieldAccess): boolean {
    return legacyCanViewRosterFieldVisibility({
        ...field,
        id: cleanString(field.id || field.key),
        visibility: normalizeVisibility(field.visibility || field.privacy || field.access)
    }, access) === true;
}
