export async function executeEmailPasswordSignup({
    email,
    password,
    activationCode,
    auth,
    dependencies
}) {
    const {
        validateAccessCode,
        createUserWithEmailAndPassword,
        redeemParentInvite,
        redeemAdminInviteAcceptance,
        redeemHouseholdInvite,
        redeemCoParentInvite,
        updateUserProfile,
        markAccessCodeAsUsed,
        getTeam,
        getUserProfile,
        sendEmailVerification,
        signOut,
        rollbackFailedSignupRedemption
    } = dependencies;

    if (!activationCode) {
        throw new Error('Activation code is required');
    }

    async function cleanupFailedParentInviteSignup(createdUser, { rollbackRedemption = false } = {}) {
        // Roll back anything the redemption already wrote (code marked used,
        // users/{uid} parent links) BEFORE deleting the auth user — the
        // rollback callable requires the user to still be authenticated.
        // Rollback failures must never mask the original signup error.
        if (rollbackRedemption && typeof rollbackFailedSignupRedemption === 'function') {
            try {
                await rollbackFailedSignupRedemption(activationCode);
            } catch (rollbackError) {
                console.error('Error rolling back signup redemption:', rollbackError);
            }
        }

        if (createdUser && typeof createdUser.delete === 'function') {
            try {
                await createdUser.delete();
            } catch (deleteError) {
                console.error('Error deleting failed signup auth user:', deleteError);
            }
        }

        if (typeof signOut === 'function') {
            try {
                await signOut(auth);
            } catch (signOutError) {
                console.error('Error signing out after failed parent invite:', signOutError);
            }
        }
    }

    function isGenericPreAuthValidationFailure(validationResult) {
        const message = String(validationResult?.message || '').trim().toLowerCase();
        return !validationResult?.valid && message === 'invalid or expired access code';
    }

    const preAuthValidation = await validateAccessCode(activationCode);
    const shouldValidateAfterSignup = isGenericPreAuthValidationFailure(preAuthValidation);
    if (!preAuthValidation.valid && !shouldValidateAfterSignup) {
        throw new Error(preAuthValidation.message || 'Invalid activation code');
    }

    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const userId = userCredential.user.uid;
    let validation = preAuthValidation;

    if (shouldValidateAfterSignup) {
        try {
            validation = await validateAccessCode(activationCode);
        } catch (error) {
            await cleanupFailedParentInviteSignup(userCredential?.user);
            throw error;
        }

        if (!validation.valid) {
            await cleanupFailedParentInviteSignup(userCredential?.user);
            throw new Error(validation.message || 'Invalid activation code');
        }
    }

    async function writeSignupProfile(profileFields) {
        try {
            await updateUserProfile(userId, {
                ...profileFields,
                createdAt: new Date(),
                emailVerificationRequired: true
            });
        } catch (e) {
            console.error('Error creating user profile after invite redeem:', e);
        }
    }

    if (validation.type === 'parent_invite') {
        try {
            await redeemParentInvite(userId, activationCode, email);
        } catch (e) {
            console.error('Error linking parent:', e);
            await cleanupFailedParentInviteSignup(userCredential?.user, { rollbackRedemption: true });
            throw e;
        }

        // Best-effort profile write after invite redemption.
        await writeSignupProfile({ email });
    } else if (validation.type === 'admin_invite') {
        try {
            await redeemAdminInviteAcceptance({
                userId,
                userEmail: email,
                codeId: validation.codeId,
                getTeam,
                getUserProfile
            });
            await writeSignupProfile({ email });
        } catch (e) {
            console.error('Error redeeming admin invite:', e);
            await cleanupFailedParentInviteSignup(userCredential?.user, { rollbackRedemption: true });
            throw e;
        }
    } else if (validation.type === 'household_invite') {
        try {
            if (typeof redeemHouseholdInvite !== 'function') {
                throw new Error('Missing household invite redemption handler');
            }
            await redeemHouseholdInvite(userId, validation.data?.code || activationCode);
            await writeSignupProfile({ email });
        } catch (e) {
            console.error('Error redeeming household invite:', e);
            await cleanupFailedParentInviteSignup(userCredential?.user, { rollbackRedemption: true });
            throw e;
        }
    } else if (validation.type === 'coparent_invite') {
        try {
            if (typeof redeemCoParentInvite !== 'function') {
                throw new Error('Missing co-parent invite redemption handler');
            }
            await redeemCoParentInvite(userId, validation.data?.code || activationCode, email);
            await writeSignupProfile({ email });
        } catch (e) {
            console.error('Error redeeming co-parent invite:', e);
            await cleanupFailedParentInviteSignup(userCredential?.user, { rollbackRedemption: true });
            throw e;
        }
    } else {
        try {
            await markAccessCodeAsUsed(validation.codeId, userId);
        } catch (error) {
            console.error('Error marking code as used:', error);
            await cleanupFailedParentInviteSignup(userCredential?.user, { rollbackRedemption: true });
            throw error;
        }

        try {
            await updateUserProfile(userId, {
                email: email,
                createdAt: new Date(),
                emailVerificationRequired: true
            });
        } catch (e) {
            console.error('Error creating user profile:', e);
        }
    }

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
