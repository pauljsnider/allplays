function getPlayersByName(players = []) {
    const byName = new Map();
    players.forEach((player) => {
        if (!player?.name || !player?.id || byName.has(player.name)) return;
        byName.set(player.name, player.id);
    });
    return byName;
}

export function buildOnFieldMap({
    period,
    rotationPlan = {},
    rotationActual = {},
    players = []
}) {
    const actual = rotationActual?.[period] || {};
    const plan = rotationPlan?.[period] || {};
    const onField = { ...plan };
    const playerIdsByName = getPlayersByName(players);

    Object.values(actual).flat().forEach((sub) => {
        if (!sub?.position || !sub?.in) return;
        const playerId = playerIdsByName.get(sub.in);
        if (playerId) onField[sub.position] = playerId;
    });

    return onField;
}

export function getSubstitutionOptions({
    period,
    rotationPlan = {},
    rotationActual = {},
    players = []
}) {
    const onField = buildOnFieldMap({
        period,
        rotationPlan,
        rotationActual,
        players
    });
    const onFieldIds = new Set(Object.values(onField).filter(Boolean));

    return {
        onField,
        onFieldPlayers: players.filter((player) => onFieldIds.has(player.id)),
        offFieldPlayers: players.filter((player) => !onFieldIds.has(player.id))
    };
}

export function applyLiveSubstitution({
    period,
    outId,
    inId,
    rotationPlan = {},
    rotationActual = {},
    players = [],
    now = new Date()
}) {
    const outPlayer = players.find((player) => player.id === outId);
    const inPlayer = players.find((player) => player.id === inId);
    if (!period || !outPlayer || !inPlayer) return null;

    const onField = buildOnFieldMap({
        period,
        rotationPlan,
        rotationActual,
        players
    });
    const position = Object.entries(onField).find(([, playerId]) => playerId === outId)?.[0] || 'unknown';
    const periodPlan = {
        ...(rotationPlan?.[period] || {}),
        [position]: inId
    };
    const nextRotationPlan = {
        ...(rotationPlan || {}),
        [period]: periodPlan
    };
    const subKey = `sub-${now.getTime()}`;
    const nextRotationActual = {
        ...(rotationActual || {}),
        [period]: {
            ...(rotationActual?.[period] || {}),
            [subKey]: [{
                position,
                out: outPlayer.name,
                in: inPlayer.name,
                appliedAt: now.toISOString()
            }]
        }
    };

    return {
        position,
        outPlayer,
        inPlayer,
        rotationPlan: nextRotationPlan,
        rotationActual: nextRotationActual
    };
}
