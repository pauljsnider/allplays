export const PASSWORD_RESET_CONFIRMATION_MESSAGE = "If an account exists for that email, a reset email has been queued.";

export function getPasswordResetErrorMessage(error) {
    if (error?.code === 'auth/invalid-email') {
        return 'Invalid email address format.';
    }

    if (error?.code === 'auth/too-many-requests') {
        return 'Too many requests. Please try again later.';
    }

    return error?.message || 'Unable to reset password right now.';
}

function showPasswordResetMessage(errorDiv, message, isSuccess) {
    errorDiv.classList.remove('hidden', 'text-red-500', 'text-green-600');
    errorDiv.classList.add(isSuccess ? 'text-green-600' : 'text-red-500');
    errorDiv.textContent = message;
}

export function createForgotPasswordHandler({ emailInput, errorDiv, resetPassword }) {
    return async function handleForgotPasswordClick() {
        errorDiv.classList.add('hidden');
        errorDiv.classList.remove('text-green-600');
        errorDiv.classList.add('text-red-500');

        const email = emailInput.value.trim();
        if (!email) {
            showPasswordResetMessage(errorDiv, 'Please enter your email address', false);
            return;
        }

        try {
            await resetPassword(email);
            emailInput.value = '';
            showPasswordResetMessage(
                errorDiv,
                PASSWORD_RESET_CONFIRMATION_MESSAGE,
                true
            );
        } catch (error) {
            if (error?.code === 'auth/user-not-found') {
                emailInput.value = '';
                showPasswordResetMessage(errorDiv, PASSWORD_RESET_CONFIRMATION_MESSAGE, true);
                return;
            }
            showPasswordResetMessage(errorDiv, getPasswordResetErrorMessage(error), false);
            console.error('Password reset error:', error);
        }
    };
}

export function shouldInitializeSignupMode({ windowObject = window, urlCodeParam = null } = {}) {
    if (urlCodeParam && urlCodeParam.length === 8) {
        return true;
    }

    return String(windowObject.location.hash || '').toLowerCase() === '#signup';
}

export function getGoogleAuthModeForLoginPage({ isLogin = true, urlCodeParam = null } = {}) {
    if (isLogin) {
        return 'login';
    }

    if (urlCodeParam && urlCodeParam.length === 8) {
        return 'invite';
    }

    return 'signup';
}

const REDEEMABLE_INVITE_TYPES = new Set([
    '',
    'standard',
    'site',
    'parent',
    'parent_invite',
    'admin',
    'admin_invite',
    'household',
    'household_invite',
    'coparent',
    'co_parent',
    'co-parent',
    'coparent_invite',
    'friend',
    'friend_invite'
]);
export const PENDING_LOGIN_INVITE_CODE_STORAGE_KEY = 'pendingLoginInviteCode';

export function createLoginRedirectCoordinator({
    windowObject = window,
    getRedirectUrl,
    getPostAuthRedirectUrl
} = {}) {
    const urlParams = new URLSearchParams(windowObject.location.search);
    const urlCodeParam = urlParams.get('code');
    const urlInviteType = typeof urlParams.get('type') === 'string'
        ? urlParams.get('type').trim().toLowerCase()
        : '';
    const shouldRedeemInviteFromLogin = Boolean(urlCodeParam) && REDEEMABLE_INVITE_TYPES.has(urlInviteType);
    let inviteRedemptionOverride = null;
    let inviteCodeOverride = null;
    let inviteTypeOverride = null;

    function getPostAuthRedirect(userWithRoles, shouldRedeemInvite = false, inviteCodeOverride = null, inviteTypeOverride = null) {
        const defaultRedirect = getRedirectUrl(userWithRoles);
        return getPostAuthRedirectUrl(
            defaultRedirect,
            inviteCodeOverride || urlCodeParam,
            shouldRedeemInvite,
            inviteTypeOverride || urlInviteType
        );
    }

    function getGoogleRedirectUrl(userWithRoles) {
        const googleAuthMode = windowObject.sessionStorage.getItem('postGoogleAuthMode');
        const pendingInviteCode = windowObject.sessionStorage.getItem(PENDING_LOGIN_INVITE_CODE_STORAGE_KEY);
        const effectivePendingInviteCode = urlCodeParam ? null : pendingInviteCode;
        windowObject.sessionStorage.removeItem('postGoogleAuthMode');
        windowObject.sessionStorage.removeItem(PENDING_LOGIN_INVITE_CODE_STORAGE_KEY);
        const shouldRedeemInvite = (shouldRedeemInviteFromLogin &&
            (googleAuthMode === 'login' || googleAuthMode === 'invite')) ||
            Boolean(effectivePendingInviteCode);
        inviteRedemptionOverride = shouldRedeemInvite;
        inviteCodeOverride = effectivePendingInviteCode || null;
        inviteTypeOverride = effectivePendingInviteCode ? '' : null;
        return getPostAuthRedirect(userWithRoles, shouldRedeemInvite, effectivePendingInviteCode);
    }

    function getAutoRedirectUrl(userWithRoles) {
        if (inviteRedemptionOverride !== null) {
            return getPostAuthRedirect(userWithRoles, inviteRedemptionOverride, inviteCodeOverride, inviteTypeOverride);
        }

        const pendingInviteCode = urlCodeParam
            ? null
            : windowObject.sessionStorage.getItem(PENDING_LOGIN_INVITE_CODE_STORAGE_KEY);
        if (pendingInviteCode) {
            windowObject.sessionStorage.removeItem(PENDING_LOGIN_INVITE_CODE_STORAGE_KEY);
            inviteRedemptionOverride = true;
            inviteCodeOverride = pendingInviteCode;
            inviteTypeOverride = '';
            return getPostAuthRedirect(userWithRoles, true, pendingInviteCode, '');
        }

        return getPostAuthRedirect(userWithRoles, shouldRedeemInviteFromLogin);
    }

    return {
        urlCodeParam,
        shouldRedeemInviteFromLogin,
        getPostAuthRedirect,
        getGoogleRedirectUrl,
        getAutoRedirectUrl
    };
}

export function createLoginAuthStateManager() {
    let isProcessingAuth = false;
    let pendingRedirectUser = null;

    function beginProcessing() {
        isProcessingAuth = true;
        pendingRedirectUser = null;
    }

    function finishProcessing({ keepPendingRedirectUser = false } = {}) {
        isProcessingAuth = false;

        if (!keepPendingRedirectUser) {
            pendingRedirectUser = null;
        }
    }

    function captureAuthenticatedUser(user) {
        if (!user) {
            pendingRedirectUser = null;
            return false;
        }

        if (isProcessingAuth) {
            pendingRedirectUser = user;
            return false;
        }

        return true;
    }

    function consumePendingRedirectUser() {
        if (isProcessingAuth || !pendingRedirectUser) {
            return null;
        }

        const user = pendingRedirectUser;
        pendingRedirectUser = null;
        return user;
    }

    return {
        beginProcessing,
        finishProcessing,
        captureAuthenticatedUser,
        consumePendingRedirectUser
    };
}
