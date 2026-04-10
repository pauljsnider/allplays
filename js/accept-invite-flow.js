import { hasFullTeamAccess } from './team-access.js?v=1';

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
        if (!redeemResult || !redeemResult.success) {
            throw new Error('Failed to redeem admin invite atomically');
        }

        const teamId = redeemResult.teamId || validation?.data?.teamId || null;
        const [team, profile] = await Promise.all([
            typeof getTeam === 'function' && teamId ? getTeam(teamId) : null,
            typeof getUserProfile === 'function' ? getUserProfile(userId) : null
        ]);
        const accessUser = {
            uid: userId,
            email: authEmail,
            profileEmail: profile?.email,
            isAdmin: profile?.isAdmin === true
        };

        if (!team || !hasFullTeamAccess(accessUser, { ...team, id: team?.id || teamId })) {
            throw new Error('Admin invite did not grant team management access');
        }

        return {
            success: true,
            message: `You've been added as an admin of ${redeemResult.teamName || 'the team'}!`,
            redirectUrl: 'dashboard.html'
        };
    }

    throw new Error('Unknown invite type');
}
