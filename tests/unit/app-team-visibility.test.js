import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { isTeamActive } from '../../apps/app/src/lib/adapters/legacyTeamVisibility.ts';

describe('mobile isTeamActive', () => {
    it('delegates to js/team-visibility.js through the typed adapter instead of hand-copying the rule', () => {
        // Regression guard: this used to be a hand-copied mirror of the legacy
        // rule with a comment asking editors to remember to update both files —
        // exactly the pattern that let js/team-access.js and the React app's
        // canManageTeamAdmins() drift apart (see PR #3388). Importing through
        // the adapter means there's only one implementation to keep in sync.
        const adapterSource = readFileSync('apps/app/src/lib/adapters/legacyTeamVisibility.ts', 'utf8');
        expect(adapterSource).toContain("from '@legacy/team-visibility.js'");
    });


    it('treats missing flags as active (matches legacy default)', () => {
        expect(isTeamActive({})).toBe(true);
        expect(isTeamActive({ active: true })).toBe(true);
        expect(isTeamActive(undefined)).toBe(true);
        expect(isTeamActive(null)).toBe(true);
    });

    it('treats explicitly deactivated, archived, or inactive-status teams as inactive', () => {
        expect(isTeamActive({ active: false })).toBe(false);
        expect(isTeamActive({ archived: true })).toBe(false);
        expect(isTeamActive({ status: 'archived' })).toBe(false);
        expect(isTeamActive({ status: 'inactive' })).toBe(false);
        expect(isTeamActive({ status: 'disabled' })).toBe(false);
        expect(isTeamActive({ status: 'DISABLED' })).toBe(false);
    });

    it('ignores unrelated status values', () => {
        expect(isTeamActive({ status: 'active' })).toBe(true);
        expect(isTeamActive({ status: '' })).toBe(true);
    });
});
