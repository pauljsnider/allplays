export function getPeriodsForNumPeriods(numPeriods) {
  const parsed = Number.parseInt(numPeriods, 10) || 2;
  if (parsed === 4) return ['Q1', 'Q2', 'Q3', 'Q4'];
  return ['H1', 'H2'];
}

export function getPeriodsForFormation(formation = {}) {
  return getPeriodsForNumPeriods(formation?.numPeriods);
}

function parseSubstitutionPeriodLabel(period) {
  const label = String(period || '').trim();
  const minuteMatch = label.match(/^(.*\D)\s+(\d+(?:\.\d+)?)\s*'?$/);
  const basePeriod = minuteMatch ? minuteMatch[1].trim() : label;
  const baseMatch = basePeriod.match(/^([A-Za-z]+)(\d+)$/);

  return {
    label,
    basePrefix: baseMatch ? baseMatch[1] : basePeriod,
    baseNumber: baseMatch ? Number.parseInt(baseMatch[2], 10) : Number.MAX_SAFE_INTEGER,
    minute: minuteMatch ? Number.parseFloat(minuteMatch[2]) : -1
  };
}

export function compareSubstitutionPeriods(a, b) {
  const left = parseSubstitutionPeriodLabel(a);
  const right = parseSubstitutionPeriodLabel(b);
  const prefixCompare = left.basePrefix.localeCompare(right.basePrefix, undefined, { numeric: true, sensitivity: 'base' });
  if (prefixCompare !== 0) return prefixCompare;
  if (left.baseNumber !== right.baseNumber) return left.baseNumber - right.baseNumber;
  if (left.minute !== right.minute) return left.minute - right.minute;
  return left.label.localeCompare(right.label, undefined, { numeric: true, sensitivity: 'base' });
}

export function sortSubstitutionPeriods(periods = []) {
  return [...periods].sort(compareSubstitutionPeriods);
}

export function normalizeActivePeriod(periods, currentPeriod) {
  if (Array.isArray(periods) && periods.includes(currentPeriod)) {
    return currentPeriod;
  }
  return Array.isArray(periods) && periods.length ? periods[0] : 'H1';
}
