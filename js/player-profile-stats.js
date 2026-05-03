export function hasPlayerProfileParticipation(statData = {}) {
    if (statData.didNotPlay === true) {
        return false;
    }

    if (
        statData.participated === true
        || statData.participationStatus === 'appeared'
        || statData.participationSource === 'statsheet-import'
    ) {
        return true;
    }

    if (statData.participationStatus === 'unused') {
        return false;
    }

    const timeMs = Number(statData.timeMs || 0);
    if (timeMs > 0) {
        return true;
    }

    const stats = statData.stats || {};
    return Object.values(stats).some((value) => Number(value || 0) !== 0);
}
