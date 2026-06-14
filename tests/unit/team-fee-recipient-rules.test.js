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
});
