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
        redeemFriendInvite,
        redeemHouseholdInvite,
        redeemCoParentInvite,
        updateUserProfile,
        markAccessCodeAsUsed,
        rollbackParentInviteRedemption,
        sendVerificationEmail,
        signOut
    } = dependencies;

    if (!activationCode) {
        throw new Error('Activation code is required');
    }

    async function cleanupFailedSignup(createdUser, options = {}) {
        const rollbackCode = String(options.inviteCode || '').trim().toUpperCase();
        if (createdUser?.uid && rollbackCode && typeof rollbackParentInviteRedemption === 'function') {
            try {
                await rollbackParentInviteRedemption(createdUser.uid, rollbackCode);
            } catch (rollbackError) {
                console.error('Error rolling back failed signup invite redemption:', rollbackError);
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
                console.error('Error signing out after failed invite signup:', signOutError);
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
    let pendingInvite = null;

    if (shouldValidateAfterSignup) {
        try {
            validation = await validateAccessCode(activationCode);
        } catch (error) {
            await cleanupFailedSignup(userCredential?.user);
            throw error;
        }

        if (!validation.valid) {
            await cleanupFailedSignup(userCredential?.user);
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

    function isEmailVerificationRequired(error) {
        return error?.details?.reason === 'email-verification-required';
    }

    function preservePendingInvite(type, code) {
        const pendingCode = String(code || activationCode).trim().toUpperCase();
        pendingInvite = { code: pendingCode, type };
        try {
            globalThis.localStorage?.setItem('inviteCode', pendingCode);
            globalThis.localStorage?.setItem('inviteType', type);
        } catch (_storageError) {
            // The returned credential still carries the pending invite for callers
            // when browser storage is unavailable.
        }
    }

    if (validation.type === 'parent_invite') {
        try {
            await redeemParentInvite(userId, activationCode, email);
        } catch (e) {
            console.error('Error linking parent:', e);
            if (isEmailVerificationRequired(e)) {
                preservePendingInvite('parent', validation.data?.code || activationCode);
                await writeSignupProfile({ email });
            } else {
                await cleanupFailedSignup(userCredential?.user, { inviteCode: validation.data?.code || activationCode });
                throw e;
            }
        }

        // Best-effort profile write after invite redemption.
        if (!pendingInvite) {
            await writeSignupProfile({ email });
        }
    } else if (validation.type === 'friend_invite') {
        try {
            if (typeof redeemFriendInvite !== 'function') {
                throw new Error('Missing friend invite redemption handler');
            }
            await redeemFriendInvite(userId, validation.data?.code || activationCode, email);
            await writeSignupProfile({ email });
        } catch (e) {
            console.error('Error linking friend invite:', e);
            await cleanupFailedSignup(userCredential?.user);
            throw e;
        }
    } else if (validation.type === 'admin_invite') {
        preservePendingInvite('admin', validation.data?.code || activationCode);
        await writeSignupProfile({ email });
    } else if (validation.type === 'household_invite') {
        try {
            if (typeof redeemHouseholdInvite !== 'function') {
                throw new Error('Missing household invite redemption handler');
            }
            await redeemHouseholdInvite(userId, validation.data?.code || activationCode);
            await writeSignupProfile({ email });
        } catch (e) {
            console.error('Error redeeming household invite:', e);
            if (isEmailVerificationRequired(e)) {
                preservePendingInvite('household', validation.data?.code || activationCode);
                await writeSignupProfile({ email });
            } else {
                await cleanupFailedSignup(userCredential?.user, { inviteCode: validation.data?.code || activationCode });
                throw e;
            }
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
            if (isEmailVerificationRequired(e)) {
                preservePendingInvite('coparent', validation.data?.code || activationCode);
                await writeSignupProfile({ email });
            } else {
                await cleanupFailedSignup(userCredential?.user, { inviteCode: validation.data?.code || activationCode });
                throw e;
            }
        }
    } else {
        try {
            await markAccessCodeAsUsed(validation.codeId, userId);
        } catch (error) {
            console.error('Error marking code as used:', error);
            await cleanupFailedSignup(userCredential?.user);
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

    async function queueVerificationEmail() {
        const user = auth.currentUser;
        if (user) {
            await user.reload();
            console.log('SIGNUP: Queueing verification email for:', user.email);
            await sendVerificationEmail();
            console.log('SIGNUP: Verification email queued successfully');
        }
    }

    try {
        await queueVerificationEmail();
    } catch (e) {
        console.error('SIGNUP ERROR:', e.code, e.message);
    }

    if (pendingInvite) {
        userCredential.pendingFamilyInvite = pendingInvite;
    }
    return userCredential;
}
