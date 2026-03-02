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
        updateUserProfile,
        markAccessCodeAsUsed,
        getTeam,
        addTeamAdminEmail,
        getUserProfile,
        sendEmailVerification,
        signOut
    } = dependencies;

    if (!activationCode) {
        throw new Error('Activation code is required');
    }

    const validation = await validateAccessCode(activationCode);
    if (!validation.valid) {
        throw new Error(validation.message || 'Invalid activation code');
    }

    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const userId = userCredential.user.uid;

    async function cleanupFailedParentInviteSignup(createdUser) {
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

    if (validation.type === 'parent_invite') {
        try {
            await redeemParentInvite(userId, validation.data.code);
            await updateUserProfile(userId, {
                email: email,
                createdAt: new Date(),
                emailVerificationRequired: true
            });
        } catch (e) {
            console.error('Error linking parent:', e);
            await cleanupFailedParentInviteSignup(userCredential?.user);
            throw e;
        }
    } else if (validation.type === 'admin_invite') {
        await redeemAdminInviteAcceptance({
            userId,
            userEmail: email,
            teamId: validation?.data?.teamId,
            codeId: validation.codeId,
            markAccessCodeAsUsed,
            getTeam,
            addTeamAdminEmail,
            getUserProfile,
            updateUserProfile
        });
    } else {
        try {
            await updateUserProfile(userId, {
                email: email,
                createdAt: new Date(),
                emailVerificationRequired: true
            });
        } catch (e) {
            console.error('Error creating user profile:', e);
        }

        try {
            await markAccessCodeAsUsed(validation.codeId, userId);
        } catch (error) {
            console.error('Error marking code as used:', error);
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
