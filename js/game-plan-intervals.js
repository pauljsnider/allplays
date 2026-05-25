export function buildGamePlanIntervals(gamePlan) {
    const numPeriods = Number(gamePlan?.numPeriods) || 0;
    const periodDuration = Number(gamePlan?.periodDuration) || 0;
    const rawSubTimes = Array.isArray(gamePlan?.subTimes) ? gamePlan.subTimes : [];
    const periodPrefix = String(gamePlan?.periodPrefix || '').trim().toUpperCase();
    const boundaries = [...new Set(rawSubTimes
        .map(time => Number(time))
        .filter(time => Number.isFinite(time) && time > 0 && time < periodDuration))]
        .sort((a, b) => a - b);

    if (rawSubTimes.length > 0 && periodDuration > 0) {
        boundaries.push(periodDuration);
    }

    const intervals = [];
    for (let period = 1; period <= numPeriods; period++) {
        const currentPeriodPrefix = periodPrefix || (numPeriods === 4 ? 'Q' : 'H');
        const periodName = `${currentPeriodPrefix}${period}`;
        const periodLabel = periodPrefix ? `${periodPrefix} ${period}` : (numPeriods === 2 ? `Half ${period}` : `Quarter ${period}`);
        let start = 0;

        // If there are no actual substitution times, this is a 'full' period interval
        if (boundaries.length === 0 || rawSubTimes.length === 0) {
            intervals.push({
                period,
                periodName,
                periodLabel,
                start: 0,
                end: periodDuration,
                duration: periodDuration,
                time: 'full',
                label: 'Full',
                key: `${period}-full`
            });
            continue;
        }

        boundaries.forEach(end => {
            intervals.push({
                period,
                periodName,
                periodLabel,
                start,
                end,
                duration: end - start,
                time: end,
                label: `${start}-${end}'`,
                key: `${period}-${end}`
            });
            start = end;
        });
    }

    return intervals;
}
