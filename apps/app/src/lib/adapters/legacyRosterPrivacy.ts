import {
    getRosterProfileValues as legacyGetRosterProfileValues,
    normalizeRosterFieldDefinitions as legacyNormalizeRosterFieldDefinitions,
    splitRosterProfileValuesByVisibility as legacySplitRosterProfileValuesByVisibility,
    validateRosterProfileValues as legacyValidateRosterProfileValues
} from '../../../../../js/roster-profile-fields.js';
import { canViewRosterField as legacyCanViewRosterFieldVisibility } from '../../../../../js/roster-field-privacy.js';

export type LegacyRosterFieldOption = {
    value: string;
    label: string;
};

export type LegacyRosterFieldDefinition = {
    key: string;
    label: string;
    type: 'text' | 'menu' | 'checkbox' | 'date';
    section?: string;
    description?: string;
    visibility: string;
    required?: boolean;
    options?: LegacyRosterFieldOption[];
    active?: boolean;
    sortOrder?: number;
    [key: string]: any;
};

export type LegacyRosterFieldAccess = {
    isAdmin: boolean;
    isTeamMember: boolean;
    isLinkedParent: boolean;
};

export function normalizeRosterFieldDefinitions(fields: unknown[]): LegacyRosterFieldDefinition[] {
    return legacyNormalizeRosterFieldDefinitions(fields) as LegacyRosterFieldDefinition[];
}

export function getRosterProfileValues(player: Record<string, any>) {
    return legacyGetRosterProfileValues(player) as Record<string, unknown>;
}

export function validateRosterProfileValues(fields: LegacyRosterFieldDefinition[], values: Record<string, unknown>) {
    return legacyValidateRosterProfileValues(fields, values);
}

export function splitRosterProfileValuesByVisibility(fields: LegacyRosterFieldDefinition[], values: Record<string, unknown>) {
    return legacySplitRosterProfileValuesByVisibility(fields, values) as {
        publicValues: Record<string, unknown>;
        privateValues: Record<string, unknown>;
    };
}

export function canViewRosterField(field: { id: string; visibility: string }, access: LegacyRosterFieldAccess) {
    return legacyCanViewRosterFieldVisibility(field, access);
}
