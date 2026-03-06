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
        if (typeof redeemAdminInviteAtomically === 'function') {
            const redeemResult = await redeemAdminInviteAtomically(validation.codeId, userId, authEmail);
            return {
                success: true,
                message: `You've been added as an admin of ${redeemResult.teamName || 'the team'}!`,
                redirectUrl: 'dashboard.html'
            };
        }

        const team = await getTeam(validation.data.teamId);
        if (!team) {
            throw new Error('Team not found');
        }

        const profile = await getUserProfile(userId);
        const userEmail = profile?.email || authEmail || validation?.data?.email;
        const adminEmails = Array.isArray(team.adminEmails) ? [...team.adminEmails] : [];
        const normalizedEmail = userEmail ? userEmail.toLowerCase() : null;
        const normalizedAdminEmails = adminEmails.map((email) => String(email || '').toLowerCase());

        if (normalizedEmail && !normalizedAdminEmails.includes(normalizedEmail)) {
            adminEmails.push(normalizedEmail);
            await updateTeam(validation.data.teamId, {
                adminEmails
            });
        }

        const existingCoachOf = Array.isArray(profile?.coachOf) ? [...profile.coachOf] : [];
        const mergedCoachOf = Array.from(new Set([...existingCoachOf, validation.data.teamId]));
        const existingRoles = Array.isArray(profile?.roles) ? profile.roles : [];
        const mergedRoles = existingRoles.includes('coach') ? existingRoles : [...existingRoles, 'coach'];

        await updateUserProfile(userId, {
            coachOf: mergedCoachOf,
            roles: mergedRoles
        });

        if (!validation.codeId) {
            throw new Error('Invite code record not found');
        }
        await markAccessCodeAsUsed(validation.codeId, userId);

        return {
            success: true,
            message: `You've been added as an admin of ${team?.name || 'the team'}!`,
            redirectUrl: 'dashboard.html'
        };
    }

    throw new Error('Unknown invite type');
}
