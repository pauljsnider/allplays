import { hasFullTeamAccess } from './team-access.js?v=1';

/**
 * True when an invite failed only because the code was already redeemed/used (#1808).
 * A returning user who already accepted an invite and opens the same link again
 * should be treated like a normal login, not dead-ended on a used-code error.
 */
export function isInviteAlreadyRedeemedError(error) {
    const message = String(error?.message || '').toLowerCase();
    if (!message) return false;
    return (
        message.includes('already used')
        || message.includes('already been used')
        || message.includes('already redeemed')
        || message.includes('already a member')
        || message.includes('already an admin')
    );
}

/** Dashboard a successful redemption of this invite type would land on. */
export function getInviteDashboardUrl(inviteType) {
    const normalized = String(inviteType || '').trim().toLowerCase();
    if (normalized === 'admin' || normalized === 'admin_invite' || normalized === 'standard' || normalized === 'site') {
        return 'dashboard.html';
    }
    // parent, household, and unknown types all land on the parent dashboard.
    return 'parent-dashboard.html';
}

function normalizeInviteEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function getInviteEmailMismatchMessage(invitedEmail) {
    return `This invite was sent to ${invitedEmail}. Sign in with that email to accept it.`;
}

function assertInviteEmailMatches(invitedEmail, authEmail) {
    const normalizedInvitedEmail = normalizeInviteEmail(invitedEmail);
    if (!normalizedInvitedEmail) {
        return;
    }

    const normalizedAuthEmail = normalizeInviteEmail(authEmail);
    if (!normalizedAuthEmail || normalizedAuthEmail !== normalizedInvitedEmail) {
        throw new Error(getInviteEmailMismatchMessage(normalizedInvitedEmail));
    }
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
        redeemHouseholdInvite,
        redeemCoParentInvite
    } = deps;

    const validation = await validateAccessCode(code);
    if (!validation.valid) {
        throw new Error(validation.message || 'Invalid or expired invite code');
    }

    if (validation.alreadyRedeemed === true) {
        return {
            success: true,
            alreadyRedeemed: true,
            message: 'This code is already connected to your account.',
            redirectUrl: getInviteDashboardUrl(validation.type)
        };
    }

    if (validation.type === 'standard' || !validation.type) {
        if (typeof markAccessCodeAsUsed !== 'function') {
            throw new Error('Missing access code redemption handler');
        }
        await markAccessCodeAsUsed(validation.codeId, userId);
        return {
            success: true,
            message: "Your ALL PLAYS access code has been applied!",
            redirectUrl: 'dashboard.html'
        };
    }

    if (validation.type === 'parent_invite') {
        assertInviteEmailMatches(validation.data?.email, authEmail);

        const redeemResult = await redeemParentInvite(userId, code, authEmail);
        const teamId = redeemResult?.teamId || null;
        const team = teamId ? await getTeam(teamId) : null;
        return {
            success: true,
            message: `You've been added to follow ${redeemResult?.playerNum ? '#' + redeemResult.playerNum : 'a player'} on ${team?.name || redeemResult?.teamName || 'the team'}!`,
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

        const teamId = redeemResult?.teamId || null;
        const team = teamId ? await getTeam(teamId) : null;
        const playerLabel = redeemResult?.playerNum || validation.data?.playerNum
            ? `#${redeemResult?.playerNum || validation.data?.playerNum}`
            : redeemResult?.playerName || validation.data?.playerName || 'a player';

        return {
            success: true,
            message: `You've been added to follow ${playerLabel} on ${team?.name || redeemResult?.teamName || validation.data?.teamName || 'the team'}!`,
            redirectUrl: 'parent-dashboard.html'
        };
    }

    if (validation.type === 'coparent_invite') {
        assertInviteEmailMatches(validation.data?.email, authEmail);

        if (typeof redeemCoParentInvite !== 'function') {
            throw new Error('Missing co-parent invite redemption handler');
        }

        const redeemResult = await redeemCoParentInvite(userId, code, authEmail);
        const teamId = redeemResult?.teamId || null;
        const team = teamId ? await getTeam(teamId) : null;
        const playerLabel = redeemResult?.playerNum || validation.data?.playerNum
            ? `#${redeemResult?.playerNum || validation.data?.playerNum}`
            : redeemResult?.playerName || validation.data?.playerName || 'a player';

        return {
            success: true,
            message: `You've been added as a co-parent for ${playerLabel} on ${team?.name || redeemResult?.teamName || validation.data?.teamName || 'the team'}!`,
            redirectUrl: 'parent-dashboard.html'
        };
    }

    if (validation.type === 'admin_invite') {
        assertInviteEmailMatches(validation.data?.email, authEmail);

        if (typeof redeemAdminInviteAtomically !== 'function') {
            throw new Error('Missing atomic admin invite redemption handler');
        }

        const redeemResult = await redeemAdminInviteAtomically(validation.codeId, userId, authEmail);
        if (!redeemResult || !redeemResult.success) {
            throw new Error('Failed to redeem admin invite atomically');
        }

        const teamId = redeemResult.teamId || null;
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
            message: `You've been added as an admin of ${redeemResult.teamName || team?.name || 'the team'}!`,
            redirectUrl: 'dashboard.html'
        };
    }

    throw new Error(`This invite code type isn't supported here (${validation.type}). Ask whoever sent it for a new invite link.`);
}
