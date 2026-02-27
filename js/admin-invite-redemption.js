export async function redeemAdminInviteAcceptance({
    userId,
    validation,
    getTeam,
    getUserProfile,
    updateTeam,
    updateUserProfile,
    markAccessCodeAsUsed
}) {
    if (!validation || validation.type !== 'admin_invite') {
        throw new Error('Not an admin invite code');
    }

    const teamId = validation?.data?.teamId;
    if (!teamId) {
        throw new Error('Missing team for admin invite');
    }

    const team = await getTeam(teamId);
    if (!team) {
        throw new Error('Team not found');
    }

    const profile = await getUserProfile(userId);
    const userEmail = String(profile?.email || '').trim().toLowerCase();
    if (!userEmail) {
        throw new Error('Could not determine user email for admin invite');
    }

    const adminEmails = (Array.isArray(team.adminEmails) ? team.adminEmails : [])
        .map((email) => String(email || '').trim().toLowerCase())
        .filter(Boolean);
    if (!adminEmails.includes(userEmail)) {
        adminEmails.push(userEmail);
    }

    await updateTeam(teamId, { adminEmails });

    const coachOf = Array.from(new Set([
        ...(Array.isArray(profile?.coachOf) ? profile.coachOf : []),
        teamId
    ]));
    const roles = Array.from(new Set([
        ...(Array.isArray(profile?.roles) ? profile.roles : []),
        'coach'
    ]));
    await updateUserProfile(userId, { coachOf, roles });

    if (validation.codeId) {
        await markAccessCodeAsUsed(validation.codeId, userId);
    }

    return {
        success: true,
        teamId,
        teamName: team?.name || null
    };
}
