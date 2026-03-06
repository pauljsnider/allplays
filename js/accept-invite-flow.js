export function createInviteProcessor(deps) {
    return async function processInvite(userId, code, authEmail = null) {
        return processInviteCode(userId, code, deps, authEmail);
    };
}

export async function processInviteCode(userId, code, deps, authEmail = null) {
    const {
        validateAccessCode,
        redeemParentInvite,
        getTeam,
        getUserProfile,
        updateTeam,
        updateUserProfile,
        markAccessCodeAsUsed,
        redeemAdminInviteAtomically
    } = deps;

    const validation = await validateAccessCode(code);
    if (!validation.valid) {
        throw new Error(validation.message || 'Invalid or expired invite code');
    }

    if (validation.type === 'parent_invite') {
        await redeemParentInvite(userId, code);
        const team = await getTeam(validation.data.teamId);
        return {
            success: true,
            message: `You've been added to follow ${validation.data.playerNum ? '#' + validation.data.playerNum : 'a player'} on ${team?.name || 'the team'}!`,
            redirectUrl: 'parent-dashboard.html'
        };
    }

    if (validation.type === 'admin_invite') {
        if (typeof redeemAdminInviteAtomically !== 'function') {
            throw new Error('Missing atomic admin invite redemption handler');
        }

        const redeemResult = await redeemAdminInviteAtomically(validation.codeId, userId, authEmail);

        return {
            success: true,
            message: `You've been added as an admin of ${redeemResult.teamName || 'the team'}!`,
            redirectUrl: 'dashboard.html'
        };
    }

    throw new Error('Unknown invite type');
}
