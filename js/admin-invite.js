import { redeemAdminInviteAtomicPersistence } from './db.js?v=79';

export async function redeemAdminInviteAcceptance({
    userId,
    userEmail,
    codeId = null,
    getTeam,
    getUserProfile,
    redeemAdminInviteAtomicPersistence: redeemAdminInviteAtomicPersistenceOverride = redeemAdminInviteAtomicPersistence
}) {
    if (!userId) throw new Error('Missing userId');
    if (!codeId) throw new Error('Missing codeId');

    const profile = await getUserProfile(userId);
    const resolvedUserEmail = String(userEmail || profile?.email || '').trim().toLowerCase();
    if (!resolvedUserEmail) {
        throw new Error('Missing user email');
    }

    if (typeof redeemAdminInviteAtomicPersistenceOverride !== 'function') {
        throw new Error('Missing atomic admin invite persistence handler');
    }

    const redeemResult = await redeemAdminInviteAtomicPersistenceOverride({
        userId,
        userEmail: resolvedUserEmail,
        codeId
    });

    if (!redeemResult) {
        throw new Error('Admin invite redemption returned no result');
    }

    const teamId = redeemResult.teamId || null;
    if (!teamId) {
        throw new Error('Missing teamId');
    }

    const team = await getTeam(teamId);
    if (!team) {
        throw new Error('Team not found');
    }

    return team;
}
