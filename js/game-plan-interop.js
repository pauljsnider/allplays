export function buildRotationPlanFromGamePlan(gamePlan) {
  if (!gamePlan?.lineups || typeof gamePlan.lineups !== 'object') return {};
  const plan = {};
  const legacyByPeriodTime = {};
  const numPeriods = Number.parseInt(gamePlan?.numPeriods, 10) || 2;
  const periodPrefix = numPeriods === 4 ? 'Q' : 'H';

  Object.entries(gamePlan.lineups).forEach(([key, playerId]) => {
    const currentMatch = /^([HQ]\d+(?: \d+')?)-(.+)$/.exec(key);
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
    const periodTime = Number.isFinite(timeNum) ? `${period} ${timeNum}'` : period;
    if (!legacyByPeriodTime[periodTime]) legacyByPeriodTime[periodTime] = {};
    legacyByPeriodTime[periodTime][posId] = playerId;
  });

  Object.entries(legacyByPeriodTime).forEach(([periodTime, assignments]) => {
    if (!plan[periodTime]) plan[periodTime] = {};
    Object.entries(assignments).forEach(([posId, playerId]) => {
      if (!plan[periodTime][posId]) {
        plan[periodTime][posId] = playerId;
      }
    });
  });

  return plan;
}
