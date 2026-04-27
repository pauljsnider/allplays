function normalizeSport(value) {
  return String(value || '').trim().toLowerCase();
}

function getExplicitPeriodLabels(periods) {
  if (!Array.isArray(periods)) return [];
  return periods
    .map((period) => String(period?.label || period || '').trim())
    .filter(Boolean);
}

function getSportDefaults(sport) {
  switch (normalizeSport(sport)) {
    case 'volleyball':
      return ['Set 1', 'Set 2', 'Set 3', 'Set 4', 'Set 5'];
    case 'soccer':
      return ['H1', 'H2', 'ET1', 'ET2', 'PK'];
    case 'baseball':
    case 'softball':
      return ['T1', 'B1', 'T2', 'B2', 'T3', 'B3', 'T4', 'B4', 'T5', 'B5', 'T6', 'B6', 'T7', 'B7'];
    default:
      return ['Q1', 'Q2', 'Q3', 'Q4', 'OT'];
  }
}

export function resolveLiveSport({ sport = '', game = null, team = null, config = null } = {}) {
  return String(sport || game?.sport || team?.sport || config?.baseType || '').trim();
}

export function getSportPeriodLabels({ sport = '', periods = null, game = null, team = null, config = null } = {}) {
  const explicit = getExplicitPeriodLabels(periods || config?.periods || game?.periods);
  if (explicit.length) return explicit;
  return getSportDefaults(resolveLiveSport({ sport, game, team, config }));
}

export function getDefaultLivePeriod(options = {}) {
  return getSportPeriodLabels(options)[0] || 'Q1';
}
