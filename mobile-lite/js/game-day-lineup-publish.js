function normalizeLineupMap(lineups) {
    if (!lineups || typeof lineups !== 'object') return {};
    return Object.entries(lineups).reduce((acc, [key, value]) => {
        if (!key || !value) return acc;
        acc[key] = value;
        return acc;
    }, {});
}

export function flattenRotationPlan(plan) {
    if (!plan || typeof plan !== 'object') return {};
    const lineups = {};
    Object.entries(plan).forEach(([period, positions]) => {
        if (!positions || typeof positions !== 'object') return;
        Object.entries(positions).forEach(([posId, playerId]) => {
            if (!period || !posId || !playerId) return;
            lineups[`${period}-${posId}`] = playerId;
        });
    });
    return lineups;
}

function buildBasePayload({ formationId, numPeriods, rotationPlan, previousGamePlan = {} }) {
    const lineups = flattenRotationPlan(rotationPlan);
    return {
        formationId,
        numPeriods,
        lineups,
        isPublished: false,
        publishedAt: previousGamePlan?.publishedAt || null,
        publishedBy: previousGamePlan?.publishedBy || null,
        publishedByName: previousGamePlan?.publishedByName || null,
        publishedVersion: Number.parseInt(previousGamePlan?.publishedVersion, 10) || 0,
        publishedFormationId: previousGamePlan?.publishedFormationId || null,
        publishedNumPeriods: Number.parseInt(previousGamePlan?.publishedNumPeriods, 10) || null,
        publishedLineups: normalizeLineupMap(previousGamePlan?.publishedLineups),
        publishedRecipientPlayerIds: Array.isArray(previousGamePlan?.publishedRecipientPlayerIds)
            ? [...previousGamePlan.publishedRecipientPlayerIds]
            : [],
        publishedRecipientParentIds: Array.isArray(previousGamePlan?.publishedRecipientParentIds)
            ? [...previousGamePlan.publishedRecipientParentIds]
            : [],
        publishedReadBy: Array.isArray(previousGamePlan?.publishedReadBy)
            ? [...previousGamePlan.publishedReadBy]
            : []
    };
}

export function buildLineupDraftPayload(input) {
    return buildBasePayload(input);
}

export function countLineupChanges(previousLineups, nextLineups) {
    const before = normalizeLineupMap(previousLineups);
    const after = normalizeLineupMap(nextLineups);
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    let changedAssignments = 0;
    keys.forEach((key) => {
        if ((before[key] || null) !== (after[key] || null)) {
            changedAssignments += 1;
        }
    });
    return changedAssignments;
}

export function buildLineupPublishPayload({
    formationId,
    numPeriods,
    rotationPlan,
    previousGamePlan = {},
    publishedBy = null,
    publishedByName = null,
    publishedAt = new Date(),
    recipientPlayerIds = [],
    recipientParentIds = []
}) {
    const payload = buildBasePayload({
        formationId,
        numPeriods,
        rotationPlan,
        previousGamePlan
    });
    return {
        ...payload,
        isPublished: true,
        publishedAt,
        publishedBy,
        publishedByName,
        publishedVersion: (Number.parseInt(previousGamePlan?.publishedVersion, 10) || 0) + 1,
        publishedFormationId: formationId,
        publishedNumPeriods: numPeriods,
        publishedLineups: { ...payload.lineups },
        publishedRecipientPlayerIds: [...recipientPlayerIds],
        publishedRecipientParentIds: [...recipientParentIds],
        publishedReadBy: []
    };
}

export function buildLineupPublishMessage({
    opponentName,
    publishedVersion,
    changedAssignments = 0
}) {
    const safeOpponent = opponentName || 'your opponent';
    if ((Number.parseInt(publishedVersion, 10) || 0) <= 1) {
        return `Lineup published for ${safeOpponent}. Open Game Day to review the final assignments.`;
    }
    const changeText = changedAssignments > 0
        ? ` ${changedAssignments} assignment${changedAssignments === 1 ? '' : 's'} changed.`
        : '';
    return `Lineup updated for ${safeOpponent}.${changeText} Open Game Day to review the latest assignments.`;
}
