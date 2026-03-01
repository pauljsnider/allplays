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
        updateUserProfile,
        markAccessCodeAsUsed,
        sendEmailVerification
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
            throw e;
        }
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
