import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

describe('firestore.rules architecture fixes', () => {
    // Duplicate-block regression coverage lives in tests/unit/team-fee-recipient-rules.test.js.
    it('keeps feeRecipients access scoped to the fee recipient or team owner/admin', () => {
        const start = rules.indexOf('match /{path=**}/feeRecipients/{recipientId}');
        const end = rules.indexOf('\n    }', start) + '\n    }'.length;
        const feeRecipientsRules = rules.slice(start, end);

        expect(feeRecipientsRules).toContain('isTeamFeeRecipientForCurrentParent(resource.data, resource.data.teamId)');
        expect(feeRecipientsRules).toContain('isTeamOwnerOrAdmin(resource.data.teamId)');
    });

    it('does not allow unauthenticated/public reads of roster field definitions', () => {
        const start = rules.indexOf('match /rosterFields/{fieldId}');
        const end = rules.indexOf('\n      }', start) + '\n      }'.length;
        const rosterFieldsRules = rules.slice(start, end);

        expect(rosterFieldsRules).not.toContain('allow read: if true;');
        expect(rosterFieldsRules).toContain('allow read: if isTeamOwnerOrAdmin(teamId) || isParentForTeam(teamId);');
    });

    it('does not allow unauthenticated/public reads of stat tracker configs except for public teams', () => {
        const start = rules.indexOf('match /statTrackerConfigs/{configId}');
        const end = rules.indexOf('\n      }', start) + '\n      }'.length;
        const statTrackerConfigRules = rules.slice(start, end);

        expect(statTrackerConfigRules).not.toContain('allow read: if true;');
        expect(statTrackerConfigRules).toContain('isTeamOwnerOrAdmin(teamId)');
        expect(statTrackerConfigRules).toContain('isParentForTeam(teamId)');
        expect(statTrackerConfigRules).toContain('isPublicTeamForConfigRead(teamId)');
    });

    it('gates the public stat tracker config fallback on the team being public and active', () => {
        expect(rules).toContain('function isPublicTeamForConfigRead(teamId) {');
        const start = rules.indexOf('function isPublicTeamForConfigRead(teamId) {');
        const end = rules.indexOf('\n    }', start) + '\n    }'.length;
        const helper = rules.slice(start, end);

        expect(helper).toContain('isPublicGameReadTeam(get(teamPath).data)');
    });
});
