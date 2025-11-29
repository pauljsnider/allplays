import { auth } from './firebase.js';
import { signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/12.6.0/firebase-auth.js";
import { validateAccessCode, markAccessCodeAsUsed } from './db.js';

export function login(email, password) {
    return signInWithEmailAndPassword(auth, email, password);
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

    // Mark the code as used (optional - don't fail if this doesn't work)
    try {
        await markAccessCodeAsUsed(validation.codeId, userCredential.user.uid);
    } catch (error) {
        console.error('Error marking code as used:', error);
        // Don't fail signup if we can't mark the code, user is already created
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

        // Validate activation code BEFORE marking as used
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

        // Mark code as used (optional - don't fail if this doesn't work)
        try {
            await markAccessCodeAsUsed(validation.codeId, result.user.uid);
        } catch (error) {
            console.error('Error marking code as used:', error);
            // Don't fail signup if we can't mark the code, user is already created
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

export function checkAuth(callback) {
    return onAuthStateChanged(auth, callback);
}

export function resetPassword(email) {
    return sendPasswordResetEmail(auth, email);
}
