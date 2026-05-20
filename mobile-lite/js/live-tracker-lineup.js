export function restoreLiveLineup({ liveLineup, roster }) {
    const rosterIds = (roster || []).map((player) => player?.id).filter(Boolean);
    const rosterSet = new Set(rosterIds);
    const seen = new Set();

    const savedOnCourt = Array.isArray(liveLineup?.onCourt) ? liveLineup.onCourt : [];
    const savedBench = Array.isArray(liveLineup?.bench) ? liveLineup.bench : [];

    const keepPlayer = (playerId) => {
        if (!rosterSet.has(playerId)) return false;
        if (seen.has(playerId)) return false;
        seen.add(playerId);
        return true;
    };

    savedOnCourt.forEach((playerId) => keepPlayer(playerId));
    const onCourtSet = new Set(seen);
    const onCourt = rosterIds.filter((playerId) => onCourtSet.has(playerId));

    savedBench.forEach((playerId) => keepPlayer(playerId));
    const bench = rosterIds.filter((playerId) => !onCourtSet.has(playerId));

    return { onCourt, bench };
}
