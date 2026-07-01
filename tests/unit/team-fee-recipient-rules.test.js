import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

describe('team fee recipient Firestore rules', () => {
    it('defines the feeRecipients collection-group rule exactly once', () => {
        // Regression guard: this rule was previously duplicated into two back-to-back
        // match blocks with equivalent (but not identical) logic, which made the ruleset
        // harder to audit. See tests/unit/firestore-rules-architecture-fixes.test.js.
        const occurrences = rules.split('match /{path=**}/feeRecipients/{recipientId}').length - 1;
        expect(occurrences).toBe(1);
    });

    it('passes teamId to the parent recipient helper for collection-group reads', () => {
        expect(rules).toContain('function isTeamFeeRecipientForCurrentParent(data, teamId)');
        expect(rules).not.toContain('isTeamFeeRecipientForCurrentParent(resource.data) ||');
        expect(rules).toContain('isTeamFeeRecipientForCurrentParent(resource.data, resource.data.teamId)');
    });

    it('blocks private billing fields on parent-readable fee recipient documents while keeping adminBilling admin-only', () => {
        expect(rules).toContain('function hasNoPrivateTeamFeeBillingFields(data)');
        expect(rules).toContain('function hasNoIntroducedPrivateTeamFeeBillingFields()');
        expect(rules).toContain("'stripePaymentIntentId'");
        expect(rules).toContain("'recordedBy'");
        expect(rules).toContain('hasNoPrivateTeamFeeBillingFields(request.resource.data)');
        expect(rules).toContain('hasNoIntroducedPrivateTeamFeeBillingFields()');
        expect(rules).toContain("request.resource.data.get('stripePaymentIntentId', null) == null");
        expect(rules).toContain('match /adminBilling/{billingId} {');
        expect(rules).toContain('allow read, create, update, delete: if isTeamOwnerOrAdmin(teamId);');
    });
});
