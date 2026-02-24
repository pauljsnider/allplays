export async function acceptAdminInvite({
    userId,
    teamId,
    getTeam,
    getUserProfile,
    updateTeam,
    updateUserProfile
}) {
    const team = await getTeam(teamId);
    if (!team) {
        throw new Error('Team not found');
    }

    const profile = await getUserProfile(userId);
    const userEmail = String(profile?.email || '').trim().toLowerCase();
    const adminEmails = Array.isArray(team.adminEmails) ? team.adminEmails : [];
    const normalizedAdmins = adminEmails.map((email) => String(email || '').toLowerCase());

    if (userEmail && !normalizedAdmins.includes(userEmail)) {
        await updateTeam(teamId, {
            adminEmails: [...adminEmails, userEmail]
        });
    }

    const currentCoachOf = Array.isArray(profile?.coachOf) ? profile.coachOf : [];
    const currentRoles = Array.isArray(profile?.roles) ? profile.roles : [];
    const coachOf = Array.from(new Set([...currentCoachOf, teamId]));
    const roles = Array.from(new Set([...currentRoles, 'coach']));

    await updateUserProfile(userId, {
        coachOf,
        roles
    });

    return team;
}
