export async function processInviteCode(userId, code, deps) {
    const {
        validateAccessCode,
        redeemParentInvite,
        getTeam,
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
        const redeemResult = await redeemAdminInviteAtomically(validation.codeId, userId);

        return {
            success: true,
            message: `You've been added as an admin of ${redeemResult.teamName || 'the team'}!`,
            redirectUrl: 'dashboard.html'
        };
    }

    throw new Error('Unknown invite type');
}
