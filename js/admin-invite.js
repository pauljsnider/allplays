export async function redeemAdminInviteAcceptance({
    userId,
    userEmail,
    teamId,
    codeId = null,
    markAccessCodeAsUsed,
    getTeam,
    addTeamAdminEmail,
    getUserProfile,
    updateUserProfile
}) {
    if (!userId) throw new Error('Missing userId');
    if (!teamId) throw new Error('Missing teamId');

    const team = await getTeam(teamId);
    if (!team) {
        throw new Error('Team not found');
    }

    if (!userEmail) {
        throw new Error('Missing user email');
    }

    const profile = await getUserProfile(userId);
    const existingCoachOf = Array.isArray(profile?.coachOf) ? profile.coachOf : [];
    const existingRoles = Array.isArray(profile?.roles) ? profile.roles : [];

    const coachOf = Array.from(new Set([...existingCoachOf, teamId]));
    const roles = Array.from(new Set([...existingRoles, 'coach']));

    await updateUserProfile(userId, {
        coachOf,
        roles
    });

    await addTeamAdminEmail(teamId, userEmail);

    if (codeId) {
        await markAccessCodeAsUsed(codeId, userId);
    }

    return team;
}
