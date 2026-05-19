/**
 * Helpers for claimable assignment slots (e.g. snack duty).
 *
 * An assignment is "claimable" when `claimable: true` and `value` is empty.
 * Claims are stored as separate documents in the `assignmentClaims` subcollection
 * keyed by role name (e.g. "Snack"). This keeps the admin-managed assignments
 * array immutable while allowing parents to self-sign-up.
 */

export function normalizeAssignment(assignment = {}) {
    return {
        ...assignment,
        role: typeof assignment.role === 'string' ? assignment.role.trim() : '',
        value: typeof assignment.value === 'string' ? assignment.value.trim() : '',
        claimable: assignment.claimable === true
    };
}

/**
 * Returns assignments that have the claimable flag set and no pre-filled value.
 */
export function getClaimableAssignments(assignments = []) {
    if (!Array.isArray(assignments)) return [];
    return assignments
        .map(normalizeAssignment)
        .filter((a) => a.claimable && a.role && !a.value);
}

/**
 * Returns claimable assignments that have not yet been claimed.
 * `claims` is a plain object keyed by role name.
 */
export function getOpenClaimableAssignments(assignments = [], claims = {}) {
    return getClaimableAssignments(assignments).filter((a) => !claims[a.role]);
}

/**
 * Returns the claim object for a role, or null if unclaimed.
 */
export function getClaimForRole(claims = {}, role) {
    if (!role) return null;
    return claims[role] || null;
}

/**
 * Returns true if the given user has claimed the specified role.
 */
export function isClaimedByUser(claims = {}, role, userId) {
    if (!role || !userId) return false;
    const claim = claims[role];
    return !!(claim && claim.claimedByUserId === userId);
}

/**
 * Merges admin assignments with live claims for rendering.
 * Returns an array of assignment display objects:
 *   { role, value, claimable, claim | null }
 */
export function mergeAssignmentsWithClaims(assignments = [], claims = {}) {
    if (!Array.isArray(assignments)) return [];
    return assignments.map(normalizeAssignment).map((a) => ({
        ...a,
        claim: a.claimable ? (claims[a.role] || null) : null
    }));
}
