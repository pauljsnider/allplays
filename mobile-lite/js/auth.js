import {
    auth,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
    GoogleAuthProvider,
    signInWithCredential,
    signInWithPopup,
    signInWithRedirect,
    getRedirectResult,
    sendPasswordResetEmail,
    sendEmailVerification,
    sendSignInLinkToEmail,
    isSignInWithEmailLink,
    signInWithEmailLink,
    updatePassword
} from './firebase.js?v=13';
import { validateAccessCode, markAccessCodeAsUsed, updateUserProfile, redeemParentInvite, getUserProfile, getUserTeams, getUserByEmail, getTeam, listMyParentMembershipRequests } from './db.js?v=31';
import { executeEmailPasswordSignup } from './signup-flow.js?v=3';
import { redeemAdminInviteAcceptance } from './admin-invite.js?v=4';
import { mergeApprovedParentMembershipRequests } from './parent-membership-utils.js?v=1';
import { getAppLoginUrl, getAppPostAuthRedirectUrl, isAppMode, isNativeApp, signInWithNativeGoogle } from './native-app.js?v=4';

const NATIVE_AUTH_SESSION_STORAGE_KEY = 'allplays-native-auth-session';
const NATIVE_AUTH_OBSERVER_TIMEOUT_MS = 4000;

async function cleanupFailedNewUser(user, context) {
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

function normalizeSignupEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function assertInviteEmailMatchesGoogleSignup(validation, signupEmail) {
    if (validation?.type !== 'parent_invite' && validation?.type !== 'admin_invite') {
        return;
    }

    const invitedEmail = normalizeSignupEmail(validation?.data?.email);
    if (!invitedEmail) {
        return;
    }

    if (normalizeSignupEmail(signupEmail) === invitedEmail) {
        return;
    }

    throw new Error(`This invite was sent to ${invitedEmail}. Sign up with that email to accept it.`);
}

async function linkParentInviteOrRollback(user, parentInviteCode) {
    try {
        await redeemParentInvite(user.uid, parentInviteCode);
    } catch (inviteLinkError) {
        console.error('Error linking parent:', inviteLinkError);
        clearPendingActivationCode();
        await cleanupFailedNewUser(user, 'parent invite link failure');
        // Fail closed only for invite-linking errors.
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
            updateUserProfile,
            markAccessCodeAsUsed,
            getTeam,
            getUserProfile,
            sendEmailVerification,
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
        if (isNativeApp()) {
            console.log('[Google Auth] Attempting native Google sign-in...');
            const result = await signInWithNativeGoogle({
                auth,
                GoogleAuthProvider,
                signInWithCredential
            });
            return await processGoogleAuthResult(result, activationCode);
        }

        // Try popup first - works on most desktop browsers and is smoother UX
        console.log('[Google Auth] Attempting popup sign-in...');
        const result = await signInWithPopup(auth, provider);
        console.log('[Google Auth] Popup succeeded for:', result.user.email);

        // Process the result immediately (same logic as redirect handler)
        return await processGoogleAuthResult(result, activationCode);
    } catch (error) {
        console.log('[Google Auth] Popup error:', error.code, error.message);

        // Fall back to redirect for specific popup-related errors
        if (error.code === 'auth/popup-blocked' ||
            error.code === 'auth/popup-closed-by-user' ||
            error.code === 'auth/cancelled-popup-request' ||
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

function readNativeAuthSession() {
    try {
        const rawSession = window.localStorage?.getItem(NATIVE_AUTH_SESSION_STORAGE_KEY);
        return rawSession ? JSON.parse(rawSession) : null;
    } catch (error) {
        console.warn('[auth] Unable to read native auth fallback session:', error);
        return null;
    }
}

function writeNativeAuthSession(session) {
    try {
        window.localStorage?.setItem(NATIVE_AUTH_SESSION_STORAGE_KEY, JSON.stringify(session));
    } catch (error) {
        console.warn('[auth] Unable to update native auth fallback session:', error);
    }
}

function clearNativeAuthSession() {
    try {
        window.localStorage?.removeItem(NATIVE_AUTH_SESSION_STORAGE_KEY);
    } catch (error) {
        console.warn('[auth] Unable to clear native auth fallback session:', error);
    }
}

async function refreshNativeAuthSession(session) {
    const apiKey = session?.apiKey || auth.app?.options?.apiKey || '';
    if (!apiKey || !session?.refreshToken) {
        throw new Error('Native auth refresh is unavailable.');
    }

    const response = await fetch(`https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: session.refreshToken
        })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(payload?.error?.message || 'Unable to refresh native auth session.');
    }

    const expiresInSeconds = Number.parseInt(payload.expires_in || '3600', 10);
    const nextSession = {
        ...session,
        uid: payload.user_id || session.uid,
        idToken: payload.id_token || session.idToken,
        refreshToken: payload.refresh_token || session.refreshToken,
        expirationTime: Date.now() + Math.max(expiresInSeconds - 30, 60) * 1000
    };
    writeNativeAuthSession(nextSession);
    return nextSession;
}

function getNativeAuthFallbackUser() {
    const session = readNativeAuthSession();
    if (!session?.uid || !session?.idToken) return null;

    return {
        uid: session.uid,
        email: session.email || '',
        isNativeRestSession: true,
        async getIdToken(forceRefresh = false) {
            let currentSession = readNativeAuthSession() || session;
            if (forceRefresh || Number(currentSession.expirationTime || 0) < Date.now() + 60000) {
                currentSession = await refreshNativeAuthSession(currentSession);
            }
            return currentSession.idToken;
        }
    };
}

// Shared function to process Google auth result (used by both popup and redirect flows)
async function processGoogleAuthResult(result, activationCode = null) {
    console.log('[Google Auth] Processing result for user:', result.user.email);

    // Check if this is a new user (first time signing in)
    const isNewUser = result.user.metadata.creationTime === result.user.metadata.lastSignInTime;
    console.log('[Google Auth] Is new user:', isNewUser);

    if (isNewUser) {
        // Get activation code from parameter or sessionStorage
        const code = activationCode || window.sessionStorage.getItem('pendingActivationCode');
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

        try {
            assertInviteEmailMatchesGoogleSignup(validation, result.user.email);
        } catch (emailMismatchError) {
            clearPendingActivationCode();
            await cleanupFailedNewUser(result.user, 'invite email mismatch');
            throw emailMismatchError;
        }

        const userId = result.user.uid;

        if (validation.type === 'parent_invite') {
            await linkParentInviteOrRollback(result.user, validation.data.code);

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
        } else if (validation.type === 'admin_invite') {
            try {
                await redeemAdminInviteAcceptance({
                    userId,
                    userEmail: result.user.email,
                    teamId: validation.data.teamId,
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
        console.log('[Google Auth] New user setup complete');
    } else {
        console.log('[Google Auth] Existing user - no setup needed');
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
    clearNativeAuthSession();
    return signOut(auth);
}

export function requireAuth() {
    return new Promise((resolve, reject) => {
        let settled = false;
        let timeoutId = null;
        let unsubscribe = null;

        const finish = (callback) => {
            if (settled) return;
            settled = true;
            if (timeoutId) window.clearTimeout(timeoutId);
            if (typeof unsubscribe === 'function') unsubscribe();
            callback();
        };

        if (isAppMode()) {
            timeoutId = window.setTimeout(() => {
                const fallbackUser = getNativeAuthFallbackUser();
                if (fallbackUser) {
                    finish(() => resolve(fallbackUser));
                    return;
                }

                finish(() => {
                    window.location.href = getAppLoginUrl();
                    reject(new Error('Not authenticated'));
                });
            }, NATIVE_AUTH_OBSERVER_TIMEOUT_MS);
        }

        unsubscribe = onAuthStateChanged(auth, (user) => {
            if (user) {
                finish(() => resolve(user));
            } else {
                const fallbackUser = isAppMode() ? getNativeAuthFallbackUser() : null;
                if (fallbackUser) {
                    finish(() => resolve(fallbackUser));
                    return;
                }

                finish(() => {
                    window.location.href = getAppLoginUrl();
                    reject(new Error('Not authenticated'));
                });
            }
        });
        if (settled && typeof unsubscribe === 'function') {
            unsubscribe();
        }
    });
}

export function getRedirectUrl(user) {
    // 1. If Coach or Admin, go to main dashboard
    if (user.isAdmin || (user.coachOf && user.coachOf.length > 0)) {
        return getAppPostAuthRedirectUrl('dashboard.html');
    }
    // 2. If Parent, go to parent dashboard
    if (user.parentOf && user.parentOf.length > 0) {
        return getAppPostAuthRedirectUrl('parent-dashboard.html');
    }
    // 3. Default fallback
    return getAppPostAuthRedirectUrl('dashboard.html');
}

export function checkAuth(callback, options = {}) {
    const { skipEmailVerificationCheck = true } = options;

    return onAuthStateChanged(auth, async (user) => {
        if (!user && isAppMode()) {
            user = getNativeAuthFallbackUser();
        }

        if (user) {
            if (user.isNativeRestSession) {
                callback(user);
                return;
            }

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

                    // Auto-migrate: ensure parentTeamIds and parentPlayerKeys are in sync with parentOf
                    if (Array.isArray(profile.parentOf) && profile.parentOf.length > 0) {
                        const expectedTeamIds = [...new Set(profile.parentOf.map(p => p.teamId).filter(Boolean))].sort();
                        const expectedParentPlayerKeys = [...new Set(
                            profile.parentOf
                                .map(p => (p?.teamId && p?.playerId ? `${p.teamId}::${p.playerId}` : null))
                                .filter(Boolean)
                        )].sort();
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
    const actionCodeSettings = {
        // URL to redirect back to after password reset
        url: 'https://allplays.ai/reset-password.html',
        handleCodeInApp: true
    };

    return sendPasswordResetEmail(auth, email, actionCodeSettings);
}

export async function resendVerificationEmail() {
    const user = auth.currentUser;
    if (!user) {
        throw new Error('No user is currently signed in');
    }

    // Reload user to ensure we have fresh state
    await user.reload();

    console.log('Attempting to send verification email to:', user.email);
    await sendEmailVerification(user);
    console.log('Verification email sent successfully to:', user.email);
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
    // Check if user already exists
    const existingUser = await getUserByEmail(email);

    // Build the continue URL with invite code
    const continueUrl = `https://allplays.ai/accept-invite.html?code=${inviteCode}&type=${inviteType}`;

    const actionCodeSettings = {
        url: continueUrl,
        handleCodeInApp: true
    };

    try {
        await sendSignInLinkToEmail(auth, email, actionCodeSettings);

        // Store email locally so we can retrieve it on the landing page
        // This helps when user opens link on a different device
        window.localStorage.setItem('emailForSignIn', email);
        window.localStorage.setItem('inviteCode', inviteCode);
        window.localStorage.setItem('inviteType', inviteType);

        return {
            success: true,
            emailSent: true,
            existingUser: !!existingUser
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
