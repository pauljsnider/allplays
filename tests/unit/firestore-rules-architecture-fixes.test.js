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

    it('keeps stat tracker configs publicly readable so shareable replay links keep working', () => {
        // Codex caught a regression here: live-game.js loads getConfigs(state.teamId)
        // for a specific shareable/public *game*, but that read isn't scoped to a
        // gameId, and a game can be individually shareable even when its team is
        // inactive/non-public (isShareableGameDocument, independent of team-level
        // isPublic/active). Requiring team-level public+active status broke replay
        // links for exactly the teams that need them. The data (sport type + column
        // names) has no meaningful sensitivity, so it stays open.
        const start = rules.indexOf('match /statTrackerConfigs/{configId}');
        const end = rules.indexOf('\n      }', start) + '\n      }'.length;
        const statTrackerConfigRules = rules.slice(start, end);

        expect(statTrackerConfigRules).toContain('allow read: if true;');
        expect(statTrackerConfigRules).toContain('allow write: if isTeamOwnerOrAdmin(teamId);');
    });
});
