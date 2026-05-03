const ROLLOVER_OMITTED_PLAYER_FIELDS = new Set([
    'id',
    'createdAt',
    'updatedAt',
    'deactivatedAt',
    'sourceTeamId',
    'sourcePlayerId',
    'rolledOverAt',
    'medicalInfo',
    'emergencyContact'
]);

export function buildRolloverPlayerCopy(sourcePlayer, sourceTeamId, rolledOverAt) {
    if (!sourcePlayer || typeof sourcePlayer !== 'object') {
        throw new Error('Source player is required');
    }

    const copy = {};
    Object.entries(sourcePlayer).forEach(([key, value]) => {
        if (ROLLOVER_OMITTED_PLAYER_FIELDS.has(key)) return;
        copy[key] = value;
    });

    copy.active = true;
    copy.sourceTeamId = sourceTeamId;
    copy.sourcePlayerId = sourcePlayer.id || null;
    copy.rolledOverAt = rolledOverAt;

    return copy;
}
