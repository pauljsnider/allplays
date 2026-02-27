export async function redeemAdminInviteAcceptance({
    userId,
    validation,
    getTeam,
    getUserProfile,
    redeemAdminInviteAtomicPersistence
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

    if (typeof redeemAdminInviteAtomicPersistence !== 'function') {
        throw new Error('Missing atomic persistence handler for admin invite');
    }

    await redeemAdminInviteAtomicPersistence({
        teamId,
        userId,
        userEmail,
        codeId: validation.codeId
    });

    return {
        success: true,
        teamId,
        teamName: team?.name || null
    };
}
