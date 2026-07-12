import {
    auth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    isSignInWithEmailLink,
    signInWithEmailLink,
    updatePassword
} from './firebase.js?v=20';
import { validateAccessCode, markAccessCodeAsUsed, updateUserProfile, redeemParentInvite, redeemHouseholdInvite, redeemCoParentInvite, rollbackParentInviteRedemption, getUserProfile, getUserTeams, getTeam, listMyParentMembershipRequests, normalizeParentScopeLinks } from './db.js?v=92';
import { executeEmailPasswordSignup } from './signup-flow.js?v=7';
import { redeemAdminInviteAcceptance, redeemAdminInviteAtomically } from './admin-invite.js?v=6';
import { mergeApprovedParentMembershipRequests } from './parent-membership-utils.js?v=2';
import { createInviteProcessor } from './accept-invite-flow.js?v=10';
import {
    queueCurrentUserVerificationEmail,
    queueInviteSignInEmail,
    queuePasswordResetEmail
} from './auth-email.js?v=1';

async function cleanupFailedNewUser(user, context, options = {}) {
    const activationCode = String(options.activationCode || '').trim().toUpperCase();
    if (user?.uid && activationCode) {
        try {
            await rollbackParentInviteRedemption(user.uid, activationCode);
        } catch (rollbackError) {
            console.error(`Error rolling back invite redemption after ${context}:`, rollbackError);
        }
    }

    if (!user) {
        try {
            await signOut(auth);
        } catch (signOutError) {
            console.error(`Error signing out after ${context}:`, signOutError);
        }
        return;
    }

    try {
        await user.delete();
    } catch (deleteError) {
        console.error(`Error deleting user after ${context}:`, deleteError);
    }

    try {
        await signOut(auth);
    } catch (signOutError) {
        console.error(`Error signing out after ${context}:`, signOutError);
    }
}

async function linkParentInviteOrRollback(user, parentInviteCode) {
    try {
        await redeemParentInvite(user.uid, parentInviteCode, user.email);
    } catch (inviteLinkError) {
        console.error('Error linking parent:', inviteLinkError);
        clearPendingActivationCode();
        await cleanupFailedNewUser(user, 'parent invite link failure', { activationCode: parentInviteCode });
        // Fail closed only for invite-linking errors.
        throw inviteLinkError;
    }
}

async function redeemHouseholdInviteOrRollback(user, code) {
    try {
        await redeemHouseholdInvite(user.uid, code);
    } catch (inviteLinkError) {
        console.error('Error linking household invite:', inviteLinkError);
        clearPendingActivationCode();
        await cleanupFailedNewUser(user, 'household invite link failure', { activationCode: code });
        throw inviteLinkError;
    }
}

async function redeemCoParentInviteOrRollback(user, code) {
    try {
        await redeemCoParentInvite(user.uid, code, user.email);
    } catch (inviteLinkError) {
        console.error('Error linking co-parent invite:', inviteLinkError);
        clearPendingActivationCode();
        await cleanupFailedNewUser(user, 'co-parent invite link failure', { activationCode: code });
        throw inviteLinkError;
    }
}

export async function login(email, password) {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);

    // Update user profile in Firestore to ensure they appear in Admin Users list
    try {
        await updateUserProfile(userCredential.user.uid, {
            email: email,
            lastLogin: new Date()
        });
    } catch (e) {
        console.error('Error updating user profile on login:', e);
    }

    return userCredential;
}

export async function signup(email, password, activationCode) {
    return executeEmailPasswordSignup({
        email,
        password,
        activationCode,
        auth,
        dependencies: {
            validateAccessCode,
            createUserWithEmailAndPassword,
            redeemParentInvite,
            redeemAdminInviteAcceptance,
            redeemHouseholdInvite,
            redeemCoParentInvite,
            rollbackParentInviteRedemption,
            updateUserProfile,
            markAccessCodeAsUsed,
            getTeam,
            getUserProfile,
            sendVerificationEmail: queueCurrentUserVerificationEmail,
            signOut
        }
    });
}

export async function loginWithGoogle(activationCode = null) {
    const provider = new GoogleAuthProvider();

    // Store activation code in sessionStorage (needed for both popup and redirect flows)
    if (activationCode) {
        window.sessionStorage.setItem('pendingActivationCode', activationCode);
    }

    console.log('[Google Auth] Starting hybrid auth flow...');

    try {
        // Try popup first - works on most desktop browsers and is smoother UX
        console.log('[Google Auth] Attempting popup sign-in...');
        const result = await signInWithPopup(auth, provider);
        console.log('[Google Auth] Popup succeeded for:', result.user.email);

        // Process the result immediately (same logic as redirect handler)
        return await processGoogleAuthResult(result, activationCode);
    } catch (error) {
        console.log('[Google Auth] Popup error:', error.code, error.message);

        // Fall back to redirect only when the popup cannot be used at all.
        // User-cancelled or duplicate popup requests should stay on the page.
        if (error.code === 'auth/popup-blocked' ||
            error.code === 'auth/operation-not-supported-in-this-environment') {

            console.log('[Google Auth] Falling back to redirect flow...');
            await signInWithRedirect(auth, provider);
            // Function returns here; user will be redirected to Google
            // Result will be handled by handleGoogleRedirectResult() on return
            return null;
        }

        // For other errors, clear the stored activation code and re-throw
        window.sessionStorage.removeItem('pendingActivationCode');
        throw error;
    }
}

function clearPendingActivationCode() {
    try {
        window.sessionStorage.removeItem('pendingActivationCode');
    } catch (storageError) {
        console.error('Error clearing pending activation code:', storageError);
    }
}

function getStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : undefined;
}

// Shared function to process Google auth result (used by both popup and redirect flows)
async function processGoogleAuthResult(result, activationCode = null) {
    console.log('[Google Auth] Processing result for user:', result.user.email);

    // Check if this is a new user (first time signing in)
    const isNewUser = result.user.metadata.creationTime === result.user.metadata.lastSignInTime;
    const code = activationCode || window.sessionStorage.getItem('pendingActivationCode');
    console.log('[Google Auth] Is new user:', isNewUser);

    if (isNewUser) {
        console.log('[Google Auth] Activation code:', code || 'None');

        // New user - require activation code
        if (!code) {
            console.log('[Google Auth] No activation code - deleting unauthorized user');
            clearPendingActivationCode();
            await cleanupFailedNewUser(result.user, 'missing activation code');
            throw new Error('Activation code is required for new accounts');
        }

        // Validate activation code
        const validation = await validateAccessCode(code);
        if (!validation.valid) {
            clearPendingActivationCode();
            await cleanupFailedNewUser(result.user, 'invalid activation code');
            throw new Error(validation.message || 'Invalid activation code');
        }

        const userId = result.user.uid;

        if (validation.type === 'parent_invite') {
            await linkParentInviteOrRollback(result.user, validation.data?.code || code);

            // Best-effort profile write after invite redemption.
            try {
                await updateUserProfile(userId, {
                    email: result.user.email,
                    fullName: result.user.displayName,
                    photoUrl: result.user.photoURL,
                    createdAt: new Date()
                });
            } catch (e) {
                console.error('Error creating user profile after parent invite redeem:', e);
            }
        } else if (validation.type === 'household_invite') {
            await redeemHouseholdInviteOrRollback(result.user, validation.data?.code || code);

            try {
                await updateUserProfile(userId, {
                    email: result.user.email,
                    fullName: result.user.displayName,
                    photoUrl: result.user.photoURL,
                    createdAt: new Date()
                });
            } catch (e) {
                console.error('Error creating user profile after household invite redeem:', e);
            }
        } else if (validation.type === 'coparent_invite') {
            await redeemCoParentInviteOrRollback(result.user, validation.data?.code || code);

            try {
                await updateUserProfile(userId, {
                    email: result.user.email,
                    fullName: result.user.displayName,
                    photoUrl: result.user.photoURL,
                    createdAt: new Date()
                });
            } catch (e) {
                console.error('Error creating user profile after co-parent invite redeem:', e);
            }
        } else if (validation.type === 'admin_invite') {
            try {
                await redeemAdminInviteAcceptance({
                    userId,
                    userEmail: result.user.email,
                    codeId: validation.codeId,
                    getTeam,
                    getUserProfile
                });
            } catch (e) {
                console.error('Error linking admin invite:', e);
                clearPendingActivationCode();
                await cleanupFailedNewUser(result.user, 'admin invite link failure');
                throw e;
            }

            try {
                await updateUserProfile(userId, {
                    email: result.user.email,
                    fullName: result.user.displayName,
                    photoUrl: result.user.photoURL,
                    createdAt: new Date()
                });
            } catch (e) {
                console.error('Error creating user profile after admin invite redeem:', e);
            }
        } else {
            try {
                await markAccessCodeAsUsed(validation.codeId, userId);
            } catch (error) {
                console.error('Error marking code as used:', error);
                clearPendingActivationCode();
                await cleanupFailedNewUser(result.user, 'standard access code claim failure');
                throw error;
            }

            try {
                await updateUserProfile(userId, {
                    email: result.user.email,
                    fullName: result.user.displayName,
                    photoUrl: result.user.photoURL,
                    createdAt: new Date()
                });
            } catch (e) {
                console.error('Error creating user profile:', e);
            }
        }

        // Clear the activation code from sessionStorage
        clearPendingActivationCode();
        result.activationCodeRedeemed = true;
        console.log('[Google Auth] New user setup complete');
    } else {
        if (code) {
            const processInvite = createInviteProcessor({
                validateAccessCode,
                redeemParentInvite,
                redeemHouseholdInvite,
                redeemCoParentInvite,
                redeemAdminInviteAtomically,
                getTeam,
                getUserProfile,
                markAccessCodeAsUsed
            });
            await processInvite(result.user.uid, code, result.user.email);
            result.activationCodeRedeemed = true;
        }
        clearPendingActivationCode();
        console.log('[Google Auth] Existing user setup complete');
    }

    console.log('[Google Auth] Returning result for user:', result.user.email);
    return result;
}

export async function handleGoogleRedirectResult() {
    console.log('[Google Auth] Checking for redirect result...');
    const result = await getRedirectResult(auth);

    console.log('[Google Auth] Redirect result:', result ? 'Found' : 'None', result?.user?.email || '');

    if (!result || !result.user) {
        // No redirect result (user didn't just come back from Google)
        console.log('[Google Auth] No redirect result found');
        return null;
    }

    // Use shared processing function
    return await processGoogleAuthResult(result);
}

export function logout() {
    return signOut(auth);
}

export function requireAuth() {
    return new Promise((resolve, reject) => {
        const unsubscribe = onAuthStateChanged(auth, (user) => {
            unsubscribe();
            if (user) {
                resolve(user);
            } else {
                window.location.href = 'login.html';
                reject('Not authenticated');
            }
        });
    });
}

export function getRedirectUrl(user) {
    // 1. If Coach or Admin, go to main dashboard
    if (user.isAdmin || (user.coachOf && user.coachOf.length > 0)) {
        return 'dashboard.html';
    }
    // 2. If Parent, go to parent dashboard
    if (user.parentOf && user.parentOf.length > 0) {
        return 'parent-dashboard.html';
    }
    // 3. Default fallback
    return 'dashboard.html';
}

export function checkAuth(callback, options = {}) {
    const { skipEmailVerificationCheck = true } = options;

    return onAuthStateChanged(auth, async (user) => {
        if (user) {
            try {
                let profile = await getUserProfile(user.uid) || {};

                try {
                    const approvedRequests = await listMyParentMembershipRequests(user.uid);
                    const parentRequestSync = mergeApprovedParentMembershipRequests(profile, approvedRequests);
                    if (parentRequestSync.changed) {
                        await updateUserProfile(user.uid, parentRequestSync.userUpdate);
                        profile = {
                            ...profile,
                            ...parentRequestSync.userUpdate
                        };
                        console.log('[auth] Synced approved parent membership requests to user profile');
                    }
                } catch (err) {
                    console.warn('[auth] Failed to sync approved parent membership requests:', err);
                }

                if (profile) {
                    if (profile.email) {
                        user.profileEmail = profile.email;
                        if (!user.email) {
                            user.email = profile.email;
                        }
                    }
                    if (profile.isAdmin) user.isAdmin = true;
                    if (profile.parentOf) user.parentOf = profile.parentOf;
                    const teamMediaUploadTeamIds = getStringArray(profile.teamMediaUploadTeamIds);
                    const mediaUploadTeamIds = getStringArray(profile.mediaUploadTeamIds);
                    if (teamMediaUploadTeamIds) user.teamMediaUploadTeamIds = teamMediaUploadTeamIds;
                    if (mediaUploadTeamIds) user.mediaUploadTeamIds = mediaUploadTeamIds;

                    // Auto-migrate: ensure parent scope fields only reflect active team/player links
                    if (Array.isArray(profile.parentOf) || Array.isArray(profile.parentTeamIds) || Array.isArray(profile.parentPlayerKeys)) {
                        const normalizedParentScope = await normalizeParentScopeLinks(profile.parentOf || []);
                        const expectedTeamIds = normalizedParentScope.parentTeamIds.slice().sort();
                        const expectedParentPlayerKeys = normalizedParentScope.parentPlayerKeys.slice().sort();
                        const currentTeamIds = (profile.parentTeamIds || []).slice().sort();
                        const currentParentPlayerKeys = (profile.parentPlayerKeys || []).slice().sort();
                        if (JSON.stringify(expectedTeamIds) !== JSON.stringify(currentTeamIds) ||
                            JSON.stringify(expectedParentPlayerKeys) !== JSON.stringify(currentParentPlayerKeys)) {
                            try {
                                await updateUserProfile(user.uid, {
                                    parentTeamIds: expectedTeamIds,
                                    parentPlayerKeys: expectedParentPlayerKeys
                                });
                                console.log('[auth] Auto-migrated parentTeamIds/parentPlayerKeys for user');
                            } catch (err) {
                                console.warn('[auth] Failed to auto-migrate parent parent scope fields:', err);
                            }
                        }
                    }

                    if (profile.coachOf) {
                        user.coachOf = profile.coachOf;
                    } else {
                        // Dynamic check for owned teams (backward compatibility)
                        try {
                            const ownedTeams = await getUserTeams(user.uid);
                            if (ownedTeams && ownedTeams.length > 0) {
                                user.coachOf = ownedTeams.map(t => t.id);
                            }
                        } catch (err) {
                            console.warn('Error fetching owned teams in auth check:', err);
                        }
                    }

                    if (profile.roles) user.roles = profile.roles;
                }

                // Email verification: tracked but not enforced.
                // Users can enter the app unverified. Verification status is
                // shown on the profile page and admin dashboard.
                // To re-enable the gate, uncomment the redirect below.
                // if (!skipEmailVerificationCheck &&
                //     profile &&
                //     profile.emailVerificationRequired &&
                //     !user.emailVerified) {
                //     if (!window.location.pathname.includes('verify-pending.html') &&
                //         !window.location.pathname.includes('reset-password.html')) {
                //         window.location.href = 'verify-pending.html';
                //         return;
                //     }
                // }
            } catch (e) {
                console.error('Error fetching user profile for auth check:', e);
            }
        }
        callback(user);
    });
}

export function resetPassword(email) {
    return queuePasswordResetEmail(email);
}

export async function resendVerificationEmail() {
    const user = auth.currentUser;
    if (!user) {
        throw new Error('No user is currently signed in');
    }

    // Reload user to ensure we have fresh state
    await user.reload();

    console.log('Attempting to queue verification email for:', user.email);
    await queueCurrentUserVerificationEmail();
    console.log('Verification email queued successfully for:', user.email);
}

export function getCurrentUser() {
    return auth.currentUser;
}

// ============================================
// Email Link Authentication (Passwordless)
// ============================================

/**
 * Send an invite email using Firebase Email Link authentication.
 * @param {string} email - The recipient's email address
 * @param {string} inviteCode - The invite code to include in the link
 * @param {string} inviteType - 'parent' or 'admin'
 * @param {Object} metadata - Additional info like teamName, playerName
 * @returns {Promise<{success: boolean, emailSent: boolean, existingUser: boolean}>}
 */
export async function sendInviteEmail(email, inviteCode, inviteType, metadata = {}) {
    try {
        const result = await queueInviteSignInEmail(inviteCode);

        // NOTE: We intentionally do NOT store emailForSignIn / inviteCode / inviteType
        // in localStorage here. The sender is not the recipient — storing the recipient's
        // email on the sender's device would let the sender auto-complete sign-in when
        // the invite link is opened in the same browser (issue #2318).
        // The recipient's device will be asked for their email by accept-invite.html
        // if they open the link on a different device from where they requested it.

        return {
            success: true,
            emailSent: true,
            existingUser: result.existingUser === true
        };
    } catch (error) {
        console.error('Error sending invite email:', error);
        throw error;
    }
}

/**
 * Check if the current URL is a sign-in email link
 * @returns {boolean}
 */
export function isEmailSignInLink() {
    return isSignInWithEmailLink(auth, window.location.href);
}

/**
 * Complete sign-in with email link
 * @param {string} email - The email address to sign in
 * @returns {Promise<UserCredential>}
 */
export async function completeEmailLinkSignIn(email) {
    if (!isSignInWithEmailLink(auth, window.location.href)) {
        throw new Error('Invalid sign-in link');
    }

    const result = await signInWithEmailLink(auth, email, window.location.href);

    // Clear the stored email
    window.localStorage.removeItem('emailForSignIn');

    return result;
}

/**
 * Set password for a passwordless user
 * @param {string} newPassword - The new password to set
 * @returns {Promise<void>}
 */
export async function setUserPassword(newPassword) {
    const user = auth.currentUser;
    if (!user) {
        throw new Error('No user is currently signed in');
    }

    await updatePassword(user, newPassword);

    // Update profile to indicate they now have a password
    await updateUserProfile(user.uid, {
        hasPassword: true,
        passwordSetAt: new Date()
    });
}

/**
 * Check if current user signed in with email link (passwordless)
 * @returns {boolean}
 */
export function isPasswordlessUser() {
    const user = auth.currentUser;
    if (!user) return false;

    // Check provider data - email link users won't have password provider
    const providers = user.providerData.map(p => p.providerId);
    return providers.includes('password') === false ||
           (providers.length === 1 && providers[0] === 'password' && !user.emailVerified);
}
