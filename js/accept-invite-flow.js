import { hasFullTeamAccess } from './team-access.js?v=1';

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function assertInviteEmailMatches(validation, authEmail) {
    const invitedEmail = normalizeEmail(validation?.data?.email);
    if (!invitedEmail) {
        return;
    }

    const signedInEmail = normalizeEmail(authEmail);
    if (signedInEmail === invitedEmail) {
        return;
    }

    throw new Error(`This invite was sent to ${invitedEmail}. Sign in with that email to accept it.`);
}


function getHouseholdInviteRedemptionMessage(error) {
    const rawMessage = String(error?.message || '');
    const lowerMessage = rawMessage.toLowerCase();
    const code = String(error?.code || '').toLowerCase();

    if (lowerMessage.includes('this invite was sent to')) {
        return rawMessage;
    }
    if (lowerMessage.includes('invalid or used') || lowerMessage.includes('expired') || lowerMessage.includes('revoked')) {
        return 'This invite is invalid, expired, revoked, or has already been used.';
    }
    if (lowerMessage.includes('team or player not found')) {
        return 'This invite points to a team or player that no longer exists. Ask the coach to send a new invite.';
    }
    if (code.includes('permission-denied') || lowerMessage.includes('permission')) {
        return 'We could not accept this invite because your account does not have permission. Sign in with the invited email or ask the coach to resend it.';
    }
    if (code.includes('unavailable') || lowerMessage.includes('network') || lowerMessage.includes('offline')) {
        return 'We could not accept this invite because of a network issue. Check your connection and try again.';
    }

    return 'We could not accept this household invite. Please try again or ask the coach to send a new invite.';
}

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
        redeemAdminInviteAtomically,
        redeemHouseholdInvite
    } = deps;

    const validation = await validateAccessCode(code);
    if (!validation.valid) {
        throw new Error(validation.message || 'Invalid or expired invite code');
    }

    assertInviteEmailMatches(validation, authEmail);

    if (validation.type === 'parent_invite') {
        await redeemParentInvite(userId, code);
        const team = await getTeam(validation.data.teamId);
        return {
            success: true,
            message: `You've been added to follow ${validation.data.playerNum ? '#' + validation.data.playerNum : 'a player'} on ${team?.name || 'the team'}!`,
            redirectUrl: 'parent-dashboard.html'
        };
    }

    if (validation.type === 'household_invite') {
        if (typeof redeemHouseholdInvite !== 'function') {
            throw new Error('Missing household invite redemption handler');
        }

        let redeemResult;
        try {
            redeemResult = await redeemHouseholdInvite(userId, code);
        } catch (error) {
            console.error('Failed to redeem household invite', error);
            throw new Error(getHouseholdInviteRedemptionMessage(error));
        }

        const teamId = redeemResult?.teamId || validation.data.teamId;
        const team = await getTeam(teamId);
        return {
            success: true,
            message: `You've been added to follow ${validation.data.playerNum ? '#' + validation.data.playerNum : validation.data.playerName || 'a player'} on ${team?.name || validation.data.teamName || 'the team'}!`,
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
