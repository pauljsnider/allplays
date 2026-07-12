import { functions, httpsCallable } from './firebase.js?v=20';

/**
 * Server-side rollback for a failed new-account signup (issue #3845).
 *
 * When a signup consumes an invite/access code and a later step fails, the
 * cleanup path deletes the just-created Firebase Auth user. Anything the
 * redemption already wrote (code marked used, users/{uid} doc with parent
 * links) must be rolled back FIRST, while the user is still authenticated —
 * otherwise the code is permanently burned and a ghost parent-linked user
 * doc is left behind.
 *
 * @param {string} code - The activation/invite code the signup attempted to redeem
 * @returns {Promise<{success: boolean, codeRolledBack: boolean, userDocDeleted: boolean}>}
 */
export async function rollbackFailedSignupRedemption(code) {
    const normalizedCode = String(code || '').trim().toUpperCase();
    if (!normalizedCode) {
        return { success: false, codeRolledBack: false, userDocDeleted: false };
    }

    const callable = httpsCallable(functions, 'rollbackFailedSignupRedemption');
    const result = await callable({ code: normalizedCode });
    const payload = result?.data || result;
    return payload && typeof payload === 'object'
        ? payload
        : { success: false, codeRolledBack: false, userDocDeleted: false };
}
