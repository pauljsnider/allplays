export function buildRotationPlanFromGamePlan(gamePlan) {
  if (!gamePlan?.lineups || typeof gamePlan.lineups !== 'object') return {};
  const plan = {};
  const legacyByPeriodPos = {};
  const numPeriods = Number.parseInt(gamePlan?.numPeriods, 10) || 2;
  const periodPrefix = numPeriods === 4 ? 'Q' : 'H';

  Object.entries(gamePlan.lineups).forEach(([key, playerId]) => {
    const currentMatch = /^([HQ]\d+)-(.+)$/.exec(key);
    if (currentMatch) {
      const period = currentMatch[1];
      const posId = currentMatch[2];
      if (!plan[period]) plan[period] = {};
      plan[period][posId] = playerId;
      return;
    }

    const legacyMatch = /^(\d+)-(\d+)-(.+)$/.exec(key);
    if (!legacyMatch) return;
    const periodNum = Number.parseInt(legacyMatch[1], 10);
    const timeNum = Number.parseInt(legacyMatch[2], 10);
    const posId = legacyMatch[3];
    if (!Number.isFinite(periodNum)) return;

    const period = `${periodPrefix}${periodNum}`;
    const legacyKey = `${period}::${posId}`;
    const existing = legacyByPeriodPos[legacyKey];
    if (!existing || (Number.isFinite(timeNum) && timeNum < existing.time)) {
      legacyByPeriodPos[legacyKey] = {
        period,
        posId,
        time: Number.isFinite(timeNum) ? timeNum : 999,
        playerId
      };
    }
  });

  Object.values(legacyByPeriodPos).forEach((row) => {
    if (!plan[row.period]) plan[row.period] = {};
    if (!plan[row.period][row.posId]) {
      plan[row.period][row.posId] = row.playerId;
    }
  });

  return plan;
}
