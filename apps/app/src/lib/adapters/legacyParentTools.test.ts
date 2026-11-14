import { beforeEach, describe, expect, it, vi } from 'vitest';

const legacyRemoveFamilyMember = vi.hoisted(() => vi.fn());

vi.mock('@legacy/db.js', () => ({}));
vi.mock('@legacy/family-plan.js', () => ({
    addPendingFamilyMember: vi.fn(),
    readFamilyMembers: vi.fn(),
    removeFamilyMember: legacyRemoveFamilyMember
}));
vi.mock('@legacy/firebase.js', () => ({
    db: {},
    functions: {},
    collection: vi.fn(),
    doc: vi.fn(),
    getDoc: vi.fn(),
    httpsCallable: vi.fn(),
    serverTimestamp: vi.fn(),
    runTransaction: vi.fn()
}));
vi.mock('@legacy/parent-dashboard-fees.js', () => ({
    formatParentFeeAmount: vi.fn(),
    formatParentFeeDueDate: vi.fn(),
    getParentFeeStatusMeta: vi.fn(),
    normalizeParentFeeRecord: vi.fn(),
    sortParentFeeRecords: vi.fn()
}));
vi.mock('@legacy/stripe-service.js', () => ({}));
vi.mock('@legacy/registration-flow.js', () => ({
    buildPendingRegistrationRecord: vi.fn(),
    calculateRegistrationFeeSnapshot: vi.fn(),
    decideRegistrationPlacement: vi.fn(),
    getActiveRegistrationOptions: vi.fn(),
    getPaymentPlanChoices: vi.fn(),
    getRegistrationPaymentNotice: vi.fn(),
    hasOnlineRegistrationCheckout: vi.fn(),
    normalizeRegistrationForm: vi.fn(),
    requiresRegistrationOption: vi.fn()
}));
vi.mock('@legacy/registration-review.js', () => ({
    getRegistrationGuardianDrafts: vi.fn(),
    getRegistrationPlayerDraft: vi.fn(),
    getRegistrationSubmittedData: vi.fn(),
    normalizeRegistrationStatus: vi.fn()
}));
vi.mock('@legacy/team-media-utils.js', () => ({
    canContributeTeamMedia: vi.fn(),
    canManageTeamMedia: vi.fn(),
    canReadTeamMediaAlbum: vi.fn(),
    getTeamMediaItemUrl: vi.fn(),
    isSafeTeamMediaUrl: vi.fn(),
    normalizeTeamMediaVideoDraft: vi.fn(),
    sortByMediaOrder: vi.fn()
}));

import { removeFamilyMember } from './legacyParentTools';

describe('legacyParentTools household revocation adapter', () => {
    beforeEach(() => {
        legacyRemoveFamilyMember.mockReset();
    });

    it('delegates removeFamilyMember with unchanged arguments and result', async () => {
        const args = ['parent-1', 'member-1', { deps: { functions: {} } }];
        const result = { success: true };
        legacyRemoveFamilyMember.mockResolvedValue(result);

        await expect(removeFamilyMember(...args)).resolves.toBe(result);
        expect(legacyRemoveFamilyMember).toHaveBeenCalledWith(...args);
    });

    it('preserves the legacy rejection unchanged', async () => {
        const error = new Error('permission denied');
        legacyRemoveFamilyMember.mockRejectedValue(error);

        await expect(removeFamilyMember('parent-1', 'member-1')).rejects.toBe(error);
    });
});
