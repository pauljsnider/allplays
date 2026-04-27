export function hasPlayerProfileParticipation(statData = {}) {
    if (statData.didNotPlay === true) {
        return false;
    }

    const timeMs = Number(statData.timeMs || 0);
    if (timeMs > 0) {
        return true;
    }

    const stats = statData.stats || {};
    return Object.values(stats).some((value) => Number(value || 0) !== 0);
}
