import { auth } from './firebase.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail, sendEmailVerification } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { validateAccessCode, markAccessCodeAsUsed, updateUserProfile, redeemParentInvite, getUserProfile, getUserTeams } from './db.js';

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

    // Send verification email using Firebase defaults
    try {
        await sendEmailVerification(userCredential.user);
        console.log('Verification email sent successfully');
    } catch (e) {
        console.error('Error sending verification email:', e);
        // Don't fail signup if email fails - user can request resend
    }

    return userCredential;
}

export async function loginWithGoogle(activationCode = null) {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);

    // Check if this is a new user (first time signing in)
    const isNewUser = result.user.metadata.creationTime === result.user.metadata.lastSignInTime;

    if (isNewUser) {
        // New user - require activation code
        if (!activationCode) {
            // Delete the newly created user account and sign out
            try {
                await result.user.delete();
                await signOut(auth);
            } catch (deleteError) {
                console.error('Error deleting unauthorized Google user:', deleteError);
                await signOut(auth); // Ensure sign out even if delete fails
            }
            throw new Error('Activation code is required for new accounts');
        }

        // Validate activation code
        const validation = await validateAccessCode(activationCode);
        if (!validation.valid) {
            // Delete the newly created user account and sign out
            try {
                await result.user.delete();
                await signOut(auth);
            } catch (deleteError) {
                console.error('Error deleting user with invalid code:', deleteError);
                await signOut(auth); // Ensure sign out even if delete fails
            }
            throw new Error(validation.message || 'Invalid activation code');
        }

        const userId = result.user.uid;

        if (validation.type === 'parent_invite') {
             // Parent Invite Flow
            try {
                await redeemParentInvite(userId, validation.data.code);
                // Profile update
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
            // Standard Flow
            // Mark code as used
            try {
                await markAccessCodeAsUsed(validation.codeId, userId);
            } catch (error) {
                console.error('Error marking code as used:', error);
            }

            // Create user profile in Firestore
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
    }

    return result;
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
    const { skipEmailVerificationCheck = false } = options;

    return onAuthStateChanged(auth, async (user) => {
        if (user) {
            try {
                const profile = await getUserProfile(user.uid);
                if (profile) {
                    if (profile.isAdmin) user.isAdmin = true;
                    if (profile.parentOf) user.parentOf = profile.parentOf;
                    
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

                // Check if user needs email verification (new email/password signups only)
                // Skip this check on verification-related pages
                if (!skipEmailVerificationCheck &&
                    profile &&
                    profile.emailVerificationRequired &&
                    !user.emailVerified) {
                    // Redirect to verification pending page
                    if (!window.location.pathname.includes('verify-pending.html') &&
                        !window.location.pathname.includes('reset-password.html')) {
                        window.location.href = 'verify-pending.html';
                        return;
                    }
                }
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

    // Use Firebase defaults - no actionCodeSettings needed
    // Firebase will use the template configured in Firebase Console
    await sendEmailVerification(user);
    console.log('Resend verification email sent successfully');
}

export function getCurrentUser() {
    return auth.currentUser;
}
