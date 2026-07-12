// Build the list of linked parent/guardian accounts to show as roster chips for
// a player. Team owners/admins cannot list the whole /users collection (that is
// gated to global admins), so relying on getAllUsers() silently hid every chip
// for regular coaches. The linked accounts are already stored on the player doc
// (player.parents, written by the invite/link flow and readable by team staff),
// so use those as the primary source and merge any user-directory links on top.

function isHouseholdOrRemovedParent(parent) {
    return Boolean(
        parent?.source === 'household' ||
        parent?.accessSource === 'household' ||
        parent?.organizerUserId ||
        parent?.invitedByUserId ||
        parent?.inviterUserId ||
        parent?.status === 'removed'
    );
}

function normalizeParentContact(parent) {
    const userId = String(parent?.userId || '').trim();
    if (!userId) return null;
    return {
        userId,
        email: String(parent?.email || '').trim() || 'Pending',
        name: String(parent?.name || parent?.fullName || parent?.displayName || parent?.email || 'Parent').trim(),
        relation: parent?.relation || null
    };
}

/**
 * @param {object} player - roster player doc (may include a `parents` array)
 * @param {Array<{userId,email,name,relation}>} usersDerivedLinks - links derived
 *        from the /users directory (only available to global admins).
 * @returns {Array<{userId,email,name,relation}>} deduped linked parent accounts.
 */
export function buildLinkedParentContacts(player = {}, usersDerivedLinks = []) {
    const byUserId = new Map();

    // Directory-derived links first (richest data when available).
    (Array.isArray(usersDerivedLinks) ? usersDerivedLinks : []).forEach((link) => {
        const normalized = normalizeParentContact(link);
        if (normalized) byUserId.set(normalized.userId, normalized);
    });

    // Player-doc linked accounts (readable by team staff) — excludes household
    // delegated contacts and removed links, which are shown separately.
    (Array.isArray(player?.parents) ? player.parents : [])
        .filter((parent) => parent?.userId && !isHouseholdOrRemovedParent(parent))
        .forEach((parent) => {
            const normalized = normalizeParentContact(parent);
            if (!normalized) return;
            const existing = byUserId.get(normalized.userId);
            if (existing) {
                // Prefer a real email over a "Pending" placeholder from either source.
                if ((!existing.email || existing.email === 'Pending') && normalized.email !== 'Pending') {
                    existing.email = normalized.email;
                }
                if (!existing.relation && normalized.relation) existing.relation = normalized.relation;
            } else {
                byUserId.set(normalized.userId, normalized);
            }
        });

    return [...byUserId.values()];
}
