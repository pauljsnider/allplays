import { redeemAdminInviteAtomicPersistence } from './db.js?v=16';

export async function redeemAdminInviteAcceptance({
    userId,
    userEmail,
    teamId,
    codeId = null,
    getTeam,
    getUserProfile,
    redeemAdminInviteAtomicPersistence: redeemAdminInviteAtomicPersistenceOverride = redeemAdminInviteAtomicPersistence
}) {
    if (!userId) throw new Error('Missing userId');
    if (!teamId) throw new Error('Missing teamId');
    if (!codeId) throw new Error('Missing codeId');

    const team = await getTeam(teamId);
    if (!team) {
        throw new Error('Team not found');
    }

    const profile = await getUserProfile(userId);
    const resolvedUserEmail = String(userEmail || profile?.email || '').trim().toLowerCase();
    if (!resolvedUserEmail) {
        throw new Error('Missing user email');
    }

    if (typeof redeemAdminInviteAtomicPersistenceOverride !== 'function') {
        throw new Error('Missing atomic admin invite persistence handler');
    }

    await redeemAdminInviteAtomicPersistenceOverride({
        teamId,
        userId,
        userEmail: resolvedUserEmail,
        codeId
    });

    return team;
}
