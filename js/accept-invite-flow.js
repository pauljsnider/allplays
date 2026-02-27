export async function processInviteCode(userId, code, deps) {
    const {
        validateAccessCode,
        redeemParentInvite,
        updateUserProfile,
        getTeam,
        getUserProfile,
        markAccessCodeAsUsed
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
        const team = await getTeam(validation.data.teamId);
        if (!team) {
            throw new Error('Team not found');
        }

        const profile = await getUserProfile(userId);
        const userEmail = profile?.email;

        if (userEmail) {
            const adminEmails = team.adminEmails || [];
            if (!adminEmails.map((email) => email.toLowerCase()).includes(userEmail.toLowerCase())) {
                adminEmails.push(userEmail.toLowerCase());
            }
        }

        await updateUserProfile(userId, {
            coachOf: [validation.data.teamId],
            roles: ['coach']
        });

        await markAccessCodeAsUsed(validation.codeId, userId);

        return {
            success: true,
            message: `You've been added as an admin of ${team?.name || 'the team'}!`,
            redirectUrl: 'dashboard.html'
        };
    }

    throw new Error('Unknown invite type');
}
