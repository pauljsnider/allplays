function normalizeSport(value) {
  return String(value || '').trim().toLowerCase();
}

const goalSportAliases = {
  'field-hockey': 'field hockey',
  fieldhockey: 'field hockey',
  'ice hockey': 'hockey',
  waterpolo: 'water polo',
  'water-polo': 'water polo'
};

const goalSportProfiles = {
  soccer: {
    sport: 'soccer',
    label: 'Soccer',
    periodLabels: ['H1', 'H2', 'ET1', 'ET2', 'PK'],
    statColumns: ['GOALS']
  },
  'field hockey': {
    sport: 'field hockey',
    label: 'Field hockey',
    periodLabels: ['Q1', 'Q2', 'Q3', 'Q4', 'OT'],
    statColumns: ['GOALS']
  },
  hockey: {
    sport: 'hockey',
    label: 'Hockey',
    periodLabels: ['P1', 'P2', 'P3', 'OT', 'SO'],
    statColumns: ['GOALS']
  },
  lacrosse: {
    sport: 'lacrosse',
    label: 'Lacrosse',
    periodLabels: ['Q1', 'Q2', 'Q3', 'Q4', 'OT'],
    statColumns: ['GOALS']
  },
  'water polo': {
    sport: 'water polo',
    label: 'Water polo',
    periodLabels: ['Q1', 'Q2', 'Q3', 'Q4', 'OT'],
    statColumns: ['GOALS']
  }
};

function normalizeGoalSportKey(value) {
  const normalized = normalizeSport(value);
  return goalSportAliases[normalized] || normalized;
}

function getExplicitPeriodLabels(periods) {
  if (!Array.isArray(periods)) return [];
  return periods
    .map((period) => String(period?.label || period || '').trim())
    .filter(Boolean);
}

function getSportDefaults(sport) {
  const goalProfile = goalSportProfiles[normalizeGoalSportKey(sport)];
  if (goalProfile) return [...goalProfile.periodLabels];

  switch (normalizeSport(sport)) {
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

export function getGoalSportProfile({ sport = '', game = null, team = null, config = null } = {}) {
  const matchedSport = [sport, game?.sport, team?.sport, config?.baseType]
    .map((candidate) => String(candidate || '').trim())
    .find((candidate) => goalSportProfiles[normalizeGoalSportKey(candidate)]);
  const profile = goalSportProfiles[normalizeGoalSportKey(matchedSport)];
  return profile ? {
    ...profile,
    periodLabels: [...profile.periodLabels],
    statColumns: [...profile.statColumns]
  } : null;
}

export function isGoalSport(options = {}) {
  return !!getGoalSportProfile(options);
}

export function getSportPeriodLabels({ sport = '', periods = null, game = null, team = null, config = null } = {}) {
  const explicit = getExplicitPeriodLabels(periods || config?.periods || game?.periods);
  if (explicit.length) return explicit;
  const goalProfile = getGoalSportProfile({ sport, game, team, config });
  if (goalProfile) return goalProfile.periodLabels;
  return getSportDefaults(resolveLiveSport({ sport, game, team, config }));
}

export function getDefaultLivePeriod(options = {}) {
  return getSportPeriodLabels(options)[0] || 'Q1';
}
