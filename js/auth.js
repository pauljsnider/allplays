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
} from './firebase.js?v=33';
import { validateAccessCode, markAccessCodeAsUsed, updateUserProfile, redeemParentInvite, redeemHouseholdInvite, redeemCoParentInvite, redeemFriendInvite, rollbackParentInviteRedemption, getUserProfile, getUserTeams, getTeam, listMyParentMembershipRequests, normalizeParentScopeLinks } from './db.js?v=4433190';
import { executeEmailPasswordSignup } from './signup-flow.js?v=14';
import { redeemAdminInviteAcceptance, redeemAdminInviteAtomically } from './admin-invite.js?v=12';
import { mergeApprovedParentMembershipRequests } from './parent-membership-utils.js?v=3';
import { createInviteProcessor } from './accept-invite-flow.js?v=443314';
import {
    queueCurrentUserVerificationEmail,
    queueInviteSignInEmail,
    queuePasswordResetEmail
} from './auth-email.js?v=7';
import { loadAuthProfileViaRest } from './auth-profile-rest.js?v=1';
import { raceFirstSuccessfulRead } from './hedged-read.js?v=1';

const AUTH_PROFILE_REST_HEDGE_DELAY_MS = 750;
const AUTH_PROFILE_PRIMARY_TIMEOUT_MS = 8000;
const AUTH_ACCESS_ENRICHMENT_TIMEOUT_MS = 1500;

async function loadAuthProfile(user) {
    const result = await raceFirstSuccessfulRead({
        primary: () => getUserProfile(user.uid),
        fallback: () => loadAuthProfileViaRest({
            auth,
            user,
            timeoutMs: AUTH_PROFILE_PRIMARY_TIMEOUT_MS
        }),
        label: 'Profile load',
        fallbackDelayMs: AUTH_PROFILE_REST_HEDGE_DELAY_MS,
        primaryTimeoutMs: AUTH_PROFILE_PRIMARY_TIMEOUT_MS
    });
    if (result.source === 'fallback') {
        console.warn('[auth] Loaded profile through authenticated REST after the SDK read was slow.');
    }
    return result.value;
}

function trackSettlement(promise) {
    const state = { result: undefined };
    const task = Promise.resolve(promise).then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason })
    ).then((result) => {
        state.result = result;
        return result;
    });
    return { state, task };
}

async function waitForAccessEnrichment(tasks) {
    let timeoutId;
    await Promise.race([
        Promise.all(tasks),
        new Promise((resolve) => {
            timeoutId = setTimeout(resolve, AUTH_ACCESS_ENRICHMENT_TIMEOUT_MS);
        })
    ]).finally(() => {
        if (timeoutId) clearTimeout(timeoutId);
    });
}

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

async function linkFriendInviteOrRollback(user, friendInviteCode) {
    try {
        await redeemFriendInvite(user.uid, friendInviteCode, user.email);
    } catch (inviteLinkError) {
        console.error('Error linking friend invite:', inviteLinkError);
        clearPendingActivationCode();
        await cleanupFailedNewUser(user, 'friend invite link failure');
        throw inviteLinkError;
    }
}

export async function login(email, password) {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);

    // Keep the successful authentication response off the profile/projection
    // write path. That write is best-effort and can wait on Firestore or a
    // callable without holding the login page in its submitting state.
    void Promise.resolve()
        .then(() => updateUserProfile(userCredential.user.uid, {
            email: email,
            lastLogin: new Date()
        }))
        .catch((error) => {
            const errorCode = typeof error?.code === 'string' &&
                /^[a-z0-9/_-]{1,80}$/i.test(error.code)
                ? error.code
                : 'unknown';
            console.warn('[auth] Deferred login profile sync failed.', { code: errorCode });
        });

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
            redeemFriendInvite,
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
        } else if (validation.type === 'friend_invite') {
            await linkFriendInviteOrRollback(result.user, validation.data?.code || code);

            try {
                await updateUserProfile(userId, {
                    email: result.user.email,
                    fullName: result.user.displayName,
                    photoUrl: result.user.photoURL,
                    createdAt: new Date()
                });
            } catch (e) {
                console.error('Error creating user profile after friend invite redeem:', e);
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
                redeemFriendInvite,
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
                window.location.href = '/app/#/auth';
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
    let active = true;
    let authGeneration = 0;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
        const generation = ++authGeneration;
        let initialCallbackDelivered = false;
        let lateAccessChanged = false;
        const publishLateAccess = () => {
            if (!active || generation !== authGeneration) return;
            if (!initialCallbackDelivered) {
                lateAccessChanged = true;
                return;
            }
            callback(user);
        };
        if (user) {
            try {
                const approvedRequestsRead = trackSettlement(listMyParentMembershipRequests(user.uid));
                const ownedTeamsRead = trackSettlement(getUserTeams(user.uid));
                const accessEnrichmentDeadline = waitForAccessEnrichment([
                    approvedRequestsRead.task,
                    ownedTeamsRead.task
                ]);
                let profile = await loadAuthProfile(user) || {};

                const syncApprovedRequests = (result) => {
                    if (result.status === 'rejected') {
                        console.warn('[auth] Failed to sync approved parent membership requests:', result.reason);
                        return false;
                    }
                    const parentRequestSync = mergeApprovedParentMembershipRequests(profile, result.value);
                    if (!parentRequestSync.changed) return { changed: false, persistence: Promise.resolve() };
                    profile = {
                        ...profile,
                        ...parentRequestSync.userUpdate
                    };
                    if (Array.isArray(parentRequestSync.userUpdate?.parentOf)) {
                        user.parentOf = parentRequestSync.userUpdate.parentOf;
                    }
                    if (Array.isArray(parentRequestSync.userUpdate?.roles)) {
                        user.roles = parentRequestSync.userUpdate.roles;
                    }
                    const persistence = Promise.resolve(updateUserProfile(user.uid, parentRequestSync.userUpdate))
                        .then(() => console.log('[auth] Synced approved parent membership requests to user profile'))
                        .catch((err) => console.warn('[auth] Failed to persist synced parent membership requests:', err));
                    return { changed: true, persistence };
                };

                const mergeOwnedTeams = (result) => {
                    if (result.status === 'rejected') {
                        console.warn('Error fetching owned teams in auth check:', result.reason);
                        return false;
                    }
                    const coachOf = Array.isArray(profile.coachOf) ? [...profile.coachOf] : [];
                    result.value?.forEach((team) => {
                        if (team?.id && !coachOf.includes(team.id)) coachOf.push(team.id);
                    });
                    const previousCoachOf = Array.isArray(user.coachOf) ? user.coachOf : [];
                    const changed = coachOf.length !== previousCoachOf.length
                        || coachOf.some((teamId, index) => teamId !== previousCoachOf[index]);
                    profile = { ...profile, coachOf };
                    user.coachOf = coachOf;
                    return changed;
                };

                // These are authoritative access reads. Wait only for the
                // bounded enrichment window so delayed successes reach this
                // callback without restoring an unbounded dashboard spinner.
                await accessEnrichmentDeadline;
                if (approvedRequestsRead.state.result) {
                    syncApprovedRequests(approvedRequestsRead.state.result);
                } else {
                    void approvedRequestsRead.task.then((result) => {
                        const syncResult = syncApprovedRequests(result);
                        if (syncResult?.changed) {
                            publishLateAccess();
                        }
                    });
                }

                if (profile) {
                    if (profile.email) {
                        user.profileEmail = profile.email;
                    }
                    if (profile.isAdmin) user.isAdmin = true;
                    // A successfully loaded profile is authoritative even when
                    // it has no parent links. Preserve that complete emptiness
                    // so dashboard callers do not issue a redundant SDK read.
                    user.parentOf = Array.isArray(profile.parentOf) ? profile.parentOf : [];
                    const teamMediaUploadTeamIds = getStringArray(profile.teamMediaUploadTeamIds);
                    const mediaUploadTeamIds = getStringArray(profile.mediaUploadTeamIds);
                    if (teamMediaUploadTeamIds) user.teamMediaUploadTeamIds = teamMediaUploadTeamIds;
                    if (mediaUploadTeamIds) user.mediaUploadTeamIds = mediaUploadTeamIds;
                    const storedCoachOf = getStringArray(profile.coachOf);
                    if (storedCoachOf) user.coachOf = storedCoachOf;

                    // Auto-migrate denormalized parent scope in the background.
                    // Authorization continues to use the complete parentOf links
                    // that were already loaded above.
                    if (Array.isArray(profile.parentOf) || Array.isArray(profile.parentTeamIds) || Array.isArray(profile.parentPlayerKeys)) {
                        const currentTeamIds = (profile.parentTeamIds || []).slice().sort();
                        const currentParentPlayerKeys = (profile.parentPlayerKeys || []).slice().sort();
                        normalizeParentScopeLinks(profile.parentOf || [])
                            .then((normalizedParentScope) => {
                                const expectedTeamIds = normalizedParentScope.parentTeamIds.slice().sort();
                                const expectedParentPlayerKeys = normalizedParentScope.parentPlayerKeys.slice().sort();
                                if (JSON.stringify(expectedTeamIds) === JSON.stringify(currentTeamIds) &&
                                    JSON.stringify(expectedParentPlayerKeys) === JSON.stringify(currentParentPlayerKeys)) {
                                    return null;
                                }
                                return Promise.resolve(updateUserProfile(user.uid, {
                                    parentTeamIds: expectedTeamIds,
                                    parentPlayerKeys: expectedParentPlayerKeys
                                })).then(() => console.log('[auth] Auto-migrated parentTeamIds/parentPlayerKeys for user'));
                            })
                            .catch((err) => console.warn('[auth] Failed to auto-migrate parent parent scope fields:', err));
                    }

                    if (Array.isArray(profile.coachOf)) {
                        user.coachOf = [...profile.coachOf];
                    }
                    const ownedTeamsResult = ownedTeamsRead.state.result;
                    if (ownedTeamsResult) {
                        mergeOwnedTeams(ownedTeamsResult);
                    } else {
                        void ownedTeamsRead.task.then((result) => {
                            if (mergeOwnedTeams(result)) publishLateAccess();
                        });
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
        if (!active || generation !== authGeneration) return;
        callback(user);
        initialCallbackDelivered = true;
        if (lateAccessChanged && active && generation === authGeneration) callback(user);
    });

    if (typeof unsubscribe !== 'function') return unsubscribe;
    return () => {
        active = false;
        unsubscribe();
    };
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
