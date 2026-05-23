export function buildRotationPlanFromGamePlan(gamePlan) {
  if (!gamePlan?.lineups || typeof gamePlan.lineups !== 'object') return {};
  const plan = {};
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

    const legacyMatch = /^(\d+)-(\d+|full)-(.+)$/.exec(key);
    if (!legacyMatch) return;
    const periodNum = Number.parseInt(legacyMatch[1], 10);
    const timeLabel = legacyMatch[2];
    const posId = legacyMatch[3];
    if (!Number.isFinite(periodNum)) return;

    const basePeriod = `${periodPrefix}${periodNum}`;
    const period = timeLabel === 'full' ? basePeriod : `${basePeriod} ${timeLabel}'`;
    if (!plan[period]) plan[period] = {};
    plan[period][posId] = playerId;
  });

  return plan;
}
