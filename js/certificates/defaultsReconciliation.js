import { normalizeSigners } from './signers.js?v=2';

const CERTIFICATE_DEFAULT_FIELDS = [
    'templateId',
    'teamNameOverride',
    'awardTitle',
    'seasonLabel',
    'footerUrl',
    'framePurchaseLink',
    'colorMode',
    'customColors',
    'descriptionTone',
    'statsWindow',
    'fonts',
    'signers',
    'foregroundImageRef',
    'backgroundImageRef',
    'backgroundOpacity',
    'watermarkImageRef',
    'watermarkOpacity'
];

function sortPlainValue(value) {
    if (Array.isArray(value)) return value.map(sortPlainValue);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .filter((key) => value[key] !== undefined)
            .map((key) => [key, sortPlainValue(value[key])])
    );
}

export function normalizeCertificateDefaultsForComparison(defaults = {}) {
    const source = defaults && typeof defaults === 'object' ? defaults : {};
    const comparable = Object.fromEntries(CERTIFICATE_DEFAULT_FIELDS.map((field) => [
        field,
        field === 'signers' ? normalizeSigners(source.signers || []) : source[field]
    ]));
    return sortPlainValue(comparable);
}

export function certificateDefaultsMatch(expectedDefaults, authoritativeDefaults) {
    return JSON.stringify(normalizeCertificateDefaultsForComparison(authoritativeDefaults)) ===
        JSON.stringify(normalizeCertificateDefaultsForComparison(expectedDefaults));
}
