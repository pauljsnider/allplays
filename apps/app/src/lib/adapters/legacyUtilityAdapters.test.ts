import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@legacy/certificates/renderer.js', () => ({
    renderCertificate: vi.fn(() => document.createElement('div'))
}));
vi.mock('@legacy/notification-preferences.js', () => ({
    NOTIFICATION_PREFERENCE_GROUPS: [{ id: 'gameDay', label: 'Game day', categories: [{ id: 'gameDay', label: 'Game Day' }] }]
}));
vi.mock('@legacy/registration-flow.js', () => ({
    calculateRegistrationFeeSnapshot: vi.fn(() => ({
        currency: 'USD',
        quantity: 1,
        originalFeeAmountCents: 1000,
        subtotalAmountCents: 1000,
        appliedDiscounts: [],
        finalAmountDueCents: 1000
    })),
    decideRegistrationPlacement: vi.fn(() => ({
        status: 'pending',
        selectedOption: { id: 'option-1', title: 'Camp' },
        nextCounts: { enrolled: 1, waitlisted: 0 }
    })),
    formatFeeSnapshotLines: vi.fn(() => [{ label: 'Final amount due', amountCents: 1000, strong: true }]),
    getActiveRegistrationOptions: vi.fn(() => [{ id: 'option-1', title: 'Camp' }]),
    getPaymentPlanChoices: vi.fn(() => [{ id: 'pay_full', type: 'pay_full', title: 'Pay in full' }]),
    hasQuantityDiscountRule: vi.fn(() => true),
    requiresRegistrationOption: vi.fn(() => true)
}));
vi.mock('@legacy/drill-constants.js', () => ({
    DRILL_LEVELS: ['All', 'Advanced'],
    DRILL_TYPES: ['Technical'],
    DRILL_TYPE_COLORS: { Technical: { bg: 'bg-purple-100', text: 'text-purple-800', bar: 'bg-purple-400' } }
}));
vi.mock('@legacy/team-media-utils.js', () => ({
    isSupportedTeamMediaDocument: vi.fn(() => true)
}));

import { renderCertificate } from './legacyCertificates';
import { DRILL_LEVELS, DRILL_TYPES, DRILL_TYPE_COLORS } from './legacyDrills';
import { NOTIFICATION_PREFERENCE_GROUPS } from './legacyProfile';
import {
    calculateRegistrationFeeSnapshot,
    decideRegistrationPlacement,
    formatFeeSnapshotLines,
    getActiveRegistrationOptions,
    getPaymentPlanChoices,
    hasQuantityDiscountRule,
    requiresRegistrationOption
} from './legacyRegistration';
import { isSupportedTeamMediaDocument } from './legacyTeamMedia';

it('keeps utility-backed pages behind legacy adapters and the shared alias boundary', () => {
    const profileSource = readFileSync('src/pages/Profile.tsx', 'utf8');
    const registrationDetailSource = readFileSync('src/pages/RegistrationDetail.tsx', 'utf8');
    const teamCertificatesSource = readFileSync('src/pages/TeamCertificates.tsx', 'utf8');
    const teamDrillsSource = readFileSync('src/pages/TeamDrills.tsx', 'utf8');
    const teamMediaSource = readFileSync('src/pages/TeamMedia.tsx', 'utf8');
    const viteConfigSource = readFileSync('vite.config.ts', 'utf8');

    expect(profileSource).not.toContain('../../../../js/');
    expect(profileSource).toContain('../lib/adapters/legacyProfile');
    expect(registrationDetailSource).not.toContain('../../../../js/');
    expect(registrationDetailSource).toContain('../lib/adapters/legacyRegistration');
    expect(teamCertificatesSource).not.toContain('../../../../js/');
    expect(teamCertificatesSource).toContain('../lib/adapters/legacyCertificates');
    expect(teamDrillsSource).not.toContain('../../../../js/');
    expect(teamDrillsSource).toContain('../lib/adapters/legacyDrills');
    expect(teamMediaSource).not.toContain('../../../../js/');
    expect(teamMediaSource).toContain('../lib/adapters/legacyTeamMedia');
    expect(viteConfigSource).toContain("'@legacy'");
});

describe('legacy utility adapters', () => {
    it('returns typed values from the adapter boundary', () => {
        expect(renderCertificate({})).toBeInstanceOf(HTMLDivElement);
        expect(NOTIFICATION_PREFERENCE_GROUPS[0]?.categories[0]?.id).toBe('gameDay');
        expect(getActiveRegistrationOptions({}, {})).toEqual([{ id: 'option-1', title: 'Camp' }]);
        expect(getPaymentPlanChoices({})).toEqual([{ id: 'pay_full', type: 'pay_full', title: 'Pay in full' }]);
        expect(requiresRegistrationOption({})).toBe(true);
        expect(hasQuantityDiscountRule([])).toBe(true);
        expect(calculateRegistrationFeeSnapshot({}, { quantity: 1 })).toMatchObject({ finalAmountDueCents: 1000 });
        expect(formatFeeSnapshotLines(calculateRegistrationFeeSnapshot({}, { quantity: 1 }))[0]).toMatchObject({ strong: true });
        expect(decideRegistrationPlacement({ form: {}, selectedOptionId: 'option-1', counts: {} })).toMatchObject({ status: 'pending' });
        expect(DRILL_TYPES).toEqual(['Technical']);
        expect(DRILL_LEVELS).toEqual(['All', 'Advanced']);
        expect(DRILL_TYPE_COLORS.Technical.text).toBe('text-purple-800');
        expect(isSupportedTeamMediaDocument(new File(['demo'], 'doc.pdf', { type: 'application/pdf' }))).toBe(true);
    });
});
