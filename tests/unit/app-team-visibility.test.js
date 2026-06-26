import { describe, expect, it } from 'vitest';

import { isTeamActive } from '../../apps/app/src/lib/teamVisibility.ts';

describe('mobile isTeamActive', () => {
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
