import { buildGamePlanIntervals } from './game-plan-intervals.js';
import { getPeriodPrefixForFormation } from './game-day-periods.js';

function parseCurrentShapeKey(key) {
  const match = /^([HQI])(\d+)(?: (\d+)')?-(.+)$/.exec(key);
  if (!match) return null;
  return {
    periodNum: Number.parseInt(match[2], 10),
    time: match[3] ? Number.parseInt(match[3], 10) : null,
    posId: match[4]
  };
}

function plannerKeysForCurrentShapeKey(key, intervals) {
  const parsed = parseCurrentShapeKey(key);
  if (!parsed || !Number.isFinite(parsed.periodNum)) return [];

  const periodIntervals = intervals.filter(interval => interval.period === parsed.periodNum);
  if (periodIntervals.length === 0) return [];

  if (parsed.time == null) {
    return periodIntervals.map(interval => `${interval.key}-${parsed.posId}`);
  }

  const interval = periodIntervals.find(candidate => Number(candidate.time) === parsed.time);
  return interval ? [`${interval.key}-${parsed.posId}`] : [];
}

export function normalizeLineupsForGamePlanPlanner(gamePlan) {
  if (!gamePlan?.lineups || typeof gamePlan.lineups !== 'object') return {};

  const intervals = buildGamePlanIntervals(gamePlan);
  const normalized = {};
  const legacyAndOtherEntries = [];

  Object.entries(gamePlan.lineups).forEach(([key, playerId]) => {
    const plannerKeys = plannerKeysForCurrentShapeKey(key, intervals);
    if (plannerKeys.length > 0) {
      plannerKeys.forEach((plannerKey) => {
        normalized[plannerKey] = playerId;
      });
    } else {
      legacyAndOtherEntries.push([key, playerId]);
    }
  });

  legacyAndOtherEntries.forEach(([key, playerId]) => {
    normalized[key] = playerId;
  });

  return normalized;
}

export function buildRotationPlanFromGamePlan(gamePlan) {
  if (!gamePlan?.lineups || typeof gamePlan.lineups !== 'object') return {};
  const plan = {};
  const numPeriods = Number.parseInt(gamePlan?.numPeriods, 10) || 2;
  const periodPrefix = getPeriodPrefixForFormation(gamePlan);

  Object.entries(gamePlan.lineups).forEach(([key, playerId]) => {
    const currentMatch = /^([HQI]\d+(?: \d+')?)-(.+)$/.exec(key);
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
    const useWholePeriodLabel = periodPrefix === 'I' && (timeLabel === 'full' || String(timeLabel) === '1');
    const period = useWholePeriodLabel ? basePeriod : (timeLabel === 'full' ? basePeriod : `${basePeriod} ${timeLabel}'`);
    if (!plan[period]) plan[period] = {};
    plan[period][posId] = playerId;
  });

  return plan;
}
