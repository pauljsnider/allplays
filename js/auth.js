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
    sendPasswordResetEmail,
    sendEmailVerification,
    sendSignInLinkToEmail,
    isSignInWithEmailLink,
    signInWithEmailLink,
    updatePassword
} from './firebase.js?v=9';
import { validateAccessCode, markAccessCodeAsUsed, updateUserProfile, redeemParentInvite, getUserProfile, getUserTeams, getUserByEmail } from './db.js?v=14';

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
    // Validate activation code first
    if (!activationCode) {
        throw new Error('Activation code is required');
    }

    const validation = await validateAccessCode(activationCode);
    if (!validation.valid) {
        throw new Error(validation.message || 'Invalid activation code');
    }

    // Create user account
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const userId = userCredential.user.uid;

    if (validation.type === 'parent_invite') {
        // Parent Invite Flow
        try {
            await redeemParentInvite(userId, validation.data.code);
            // Also create basic profile
            await updateUserProfile(userId, {
                email: email,
                createdAt: new Date(),
                emailVerificationRequired: true
            });
        } catch (e) {
            console.error('Error linking parent:', e);
            // Don't fail the whole signup, but log it
        }
    } else {
        // Standard Flow (Coach/Admin)
        // Create user profile in Firestore with emailVerificationRequired flag
        try {
            await updateUserProfile(userId, {
                email: email,
                createdAt: new Date(),
                emailVerificationRequired: true  // Flag for new email/password signups
            });
        } catch (e) {
            console.error('Error creating user profile:', e);
        }

        // Mark the code as used
        try {
            await markAccessCodeAsUsed(validation.codeId, userId);
        } catch (error) {
            console.error('Error marking code as used:', error);
        }
    }

    // Send verification email - use auth.currentUser exactly like resend does
    try {
        const user = auth.currentUser;
        if (user) {
            await user.reload();
            console.log('SIGNUP: Sending verification email to:', user.email);
            await sendEmailVerification(user);
            console.log('SIGNUP: Verification email sent successfully');
        }
    } catch (e) {
        console.error('SIGNUP ERROR:', e.code, e.message);
    }

    return userCredential;
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
            try {
                await result.user.delete();
                await signOut(auth);
            } catch (deleteError) {
                console.error('Error deleting unauthorized Google user:', deleteError);
                await signOut(auth);
            }
            throw new Error('Activation code is required for new accounts');
        }

        // Validate activation code
        const validation = await validateAccessCode(code);
        if (!validation.valid) {
            try {
                await result.user.delete();
                await signOut(auth);
            } catch (deleteError) {
                console.error('Error deleting user with invalid code:', deleteError);
                await signOut(auth);
            }
            throw new Error(validation.message || 'Invalid activation code');
        }

        const userId = result.user.uid;

        if (validation.type === 'parent_invite') {
            try {
                await redeemParentInvite(userId, validation.data.code);
                await updateUserProfile(userId, {
                    email: result.user.email,
                    fullName: result.user.displayName,
                    photoUrl: result.user.photoURL,
                    createdAt: new Date()
                });
            } catch (e) {
                console.error('Error linking parent:', e);
            }
        } else {
            try {
                await markAccessCodeAsUsed(validation.codeId, userId);
            } catch (error) {
                console.error('Error marking code as used:', error);
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
        window.sessionStorage.removeItem('pendingActivationCode');
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
                const profile = await getUserProfile(user.uid);
                if (profile) {
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
