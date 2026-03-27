export function createLoginRedirectCoordinator({
    windowObject = window,
    getRedirectUrl,
    getPostAuthRedirectUrl
} = {}) {
    const urlParams = new URLSearchParams(windowObject.location.search);
    const urlCodeParam = urlParams.get('code');
    const urlInviteType = urlParams.get('type');
    const shouldRedeemInviteFromLogin = urlInviteType === 'parent' || urlInviteType === 'admin';
    let inviteRedemptionOverride = null;

    function getPostAuthRedirect(userWithRoles, shouldRedeemInvite = false) {
        const defaultRedirect = getRedirectUrl(userWithRoles);
        return getPostAuthRedirectUrl(defaultRedirect, urlCodeParam, shouldRedeemInvite);
    }

    function getGoogleRedirectUrl(userWithRoles) {
        const googleAuthMode = windowObject.sessionStorage.getItem('postGoogleAuthMode');
        windowObject.sessionStorage.removeItem('postGoogleAuthMode');
        const shouldRedeemInvite = shouldRedeemInviteFromLogin && googleAuthMode === 'login';
        inviteRedemptionOverride = shouldRedeemInvite;
        return getPostAuthRedirect(userWithRoles, shouldRedeemInvite);
    }

    function getAutoRedirectUrl(userWithRoles) {
        const shouldRedeemInvite = inviteRedemptionOverride ?? shouldRedeemInviteFromLogin;
        return getPostAuthRedirect(userWithRoles, shouldRedeemInvite);
    }

    return {
        urlCodeParam,
        shouldRedeemInviteFromLogin,
        getPostAuthRedirect,
        getGoogleRedirectUrl,
        getAutoRedirectUrl
    };
}
