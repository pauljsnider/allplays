export function getPeriodsForNumPeriods(numPeriods) {
  const parsed = Number.parseInt(numPeriods, 10) || 2;
  if (parsed === 4) return ['Q1', 'Q2', 'Q3', 'Q4'];
  return ['H1', 'H2'];
}

export function getPeriodsForFormation(formation = {}) {
  return getPeriodsForNumPeriods(formation?.numPeriods);
}

export function normalizeActivePeriod(periods, currentPeriod) {
  if (Array.isArray(periods) && periods.includes(currentPeriod)) {
    return currentPeriod;
  }
  return Array.isArray(periods) && periods.length ? periods[0] : 'H1';
}
