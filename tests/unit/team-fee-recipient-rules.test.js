import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

describe('team fee recipient Firestore rules', () => {
    it('passes teamId to the parent recipient helper for collection-group reads', () => {
        expect(rules).toContain('function isTeamFeeRecipientForCurrentParent(data, teamId)');
        expect(rules).not.toContain('isTeamFeeRecipientForCurrentParent(resource.data) ||');
        expect(rules).toContain("isTeamFeeRecipientForCurrentParent(resource.data, resource.data.get('teamId', ''))");
        expect(rules).toContain('isTeamFeeRecipientForCurrentParent(resource.data, resource.data.teamId)');
    });

    it('blocks private billing fields on parent-readable fee recipient documents while keeping adminBilling admin-only', () => {
        expect(rules).toContain('function hasNoPrivateTeamFeeBillingFields(data)');
        expect(rules).toContain("'stripePaymentIntentId'");
        expect(rules).toContain("'recordedBy'");
        expect(rules).toContain('hasNoPrivateTeamFeeBillingFields(request.resource.data)');
        expect(rules).toContain('match /adminBilling/{billingId} {');
        expect(rules).toContain('allow read, create, update, delete: if isTeamOwnerOrAdmin(teamId);');
    });
});
