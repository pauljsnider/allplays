import { describe, it, expect } from 'vitest';
import {
    normalizeAssignment,
    getClaimableAssignments,
    getOpenClaimableAssignments,
    getClaimForRole,
    isClaimedByUser,
    mergeAssignmentsWithClaims
} from '../../js/snack-helpers.js';

describe('normalizeAssignment', () => {
    it('sets claimable to false when missing', () => {
        expect(normalizeAssignment({ role: 'Snack', value: '' }).claimable).toBe(false);
    });

    it('coerces truthy claimable to boolean true', () => {
        expect(normalizeAssignment({ role: 'Snack', value: '', claimable: true }).claimable).toBe(true);
    });

    it('trims role and value', () => {
        const result = normalizeAssignment({ role: '  Snack  ', value: '  Jane  ', claimable: false });
        expect(result.role).toBe('Snack');
        expect(result.value).toBe('Jane');
    });

    it('handles missing fields gracefully', () => {
        const result = normalizeAssignment({});
        expect(result.role).toBe('');
        expect(result.value).toBe('');
        expect(result.claimable).toBe(false);
    });
});

describe('getClaimableAssignments', () => {
    it('returns only claimable assignments with no pre-filled value', () => {
        const assignments = [
            { role: 'Snack', value: '', claimable: true },
            { role: 'Setup', value: 'Coach Mike', claimable: true },
            { role: 'Cleanup', value: '', claimable: false },
            { role: 'Photographer', value: '', claimable: true }
        ];
        const result = getClaimableAssignments(assignments);
        expect(result.map((a) => a.role)).toEqual(['Snack', 'Photographer']);
    });

    it('returns empty array for non-array input', () => {
        expect(getClaimableAssignments(null)).toEqual([]);
        expect(getClaimableAssignments(undefined)).toEqual([]);
    });

    it('excludes assignments with empty role', () => {
        const result = getClaimableAssignments([{ role: '', value: '', claimable: true }]);
        expect(result).toHaveLength(0);
    });
});

describe('getOpenClaimableAssignments', () => {
    const assignments = [
        { role: 'Snack', value: '', claimable: true },
        { role: 'Drinks', value: '', claimable: true }
    ];

    it('returns all claimable when no claims exist', () => {
        expect(getOpenClaimableAssignments(assignments, {})).toHaveLength(2);
    });

    it('excludes roles that have been claimed', () => {
        const claims = { Snack: { claimedByUserId: 'u1', claimedByName: 'Jane' } };
        const open = getOpenClaimableAssignments(assignments, claims);
        expect(open.map((a) => a.role)).toEqual(['Drinks']);
    });

    it('returns all when claims object is empty', () => {
        expect(getOpenClaimableAssignments(assignments, {})).toHaveLength(2);
    });
});

describe('getClaimForRole', () => {
    const claims = {
        Snack: { claimedByUserId: 'u1', claimedByName: 'Jane' }
    };

    it('returns the claim for a known role', () => {
        expect(getClaimForRole(claims, 'Snack')).toEqual({ claimedByUserId: 'u1', claimedByName: 'Jane' });
    });

    it('returns null for an unclaimed role', () => {
        expect(getClaimForRole(claims, 'Drinks')).toBeNull();
    });

    it('returns null when role is empty', () => {
        expect(getClaimForRole(claims, '')).toBeNull();
    });
});

describe('isClaimedByUser', () => {
    const claims = {
        Snack: { claimedByUserId: 'u1', claimedByName: 'Jane' }
    };

    it('returns true when user owns the claim', () => {
        expect(isClaimedByUser(claims, 'Snack', 'u1')).toBe(true);
    });

    it('returns false when a different user owns the claim', () => {
        expect(isClaimedByUser(claims, 'Snack', 'u2')).toBe(false);
    });

    it('returns false when role is unclaimed', () => {
        expect(isClaimedByUser(claims, 'Drinks', 'u1')).toBe(false);
    });

    it('returns false when userId is empty', () => {
        expect(isClaimedByUser(claims, 'Snack', '')).toBe(false);
    });
});

describe('mergeAssignmentsWithClaims', () => {
    it('attaches claim to claimable assignments', () => {
        const assignments = [
            { role: 'Snack', value: '', claimable: true },
            { role: 'Coach Notes', value: 'Coach A', claimable: false }
        ];
        const claims = { Snack: { claimedByUserId: 'u1', claimedByName: 'Jane' } };
        const merged = mergeAssignmentsWithClaims(assignments, claims);

        expect(merged[0].claim).toEqual({ claimedByUserId: 'u1', claimedByName: 'Jane' });
        expect(merged[1].claim).toBeNull();
    });

    it('sets claim to null when slot is unclaimed', () => {
        const assignments = [{ role: 'Snack', value: '', claimable: true }];
        const merged = mergeAssignmentsWithClaims(assignments, {});
        expect(merged[0].claim).toBeNull();
    });

    it('handles non-array input gracefully', () => {
        expect(mergeAssignmentsWithClaims(null, {})).toEqual([]);
    });
});
