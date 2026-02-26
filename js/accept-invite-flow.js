export function createInviteProcessor(deps) {
    const {
        validateAccessCode,
        redeemParentInvite,
        updateUserProfile,
        getTeam,
        getUserProfile,
        updateTeam,
        markAccessCodeAsUsed
    } = deps;

    return async function processInvite(userId, code) {
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
            const adminEmails = team.adminEmails || [];
            const normalizedEmail = userEmail ? userEmail.toLowerCase() : null;

            if (normalizedEmail && !adminEmails.map((email) => email.toLowerCase()).includes(normalizedEmail)) {
                await updateTeam(validation.data.teamId, {
                    adminEmails: [...adminEmails, normalizedEmail]
                });
            }

            const existingCoachOf = Array.isArray(profile?.coachOf) ? profile.coachOf : [];
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
    };
}
