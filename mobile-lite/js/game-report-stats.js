export function buildConfiguredStatFields(columns = [], statsObjects = []) {
  const actualFields = new Set();
  (statsObjects || []).forEach((stats) => {
    Object.keys(stats || {}).forEach((key) => actualFields.add(String(key || '').toLowerCase()));
  });

  return (columns || []).map((col) => {
    const normalized = String(col || '').toLowerCase();
    const variations = [normalized];

    if (!normalized.endsWith('s')) {
      variations.push(normalized + 's');
    } else {
      variations.push(normalized.slice(0, -1));
    }

    if (normalized === 'pts' || normalized === 'points' || normalized === 'goals') {
      variations.push('pts', 'points', 'pt', 'goals', 'goal');
    }
    if (normalized === 'rebs' || normalized === 'reb') {
      variations.push('rebs', 'reb', 'rebounds');
    }
    if (normalized === 'ast' || normalized === 'assists') {
      variations.push('ast', 'assists', 'assist');
    }

    const fieldName = variations.find((variant) => actualFields.has(variant)) || normalized;
    return { fieldName, label: col };
  });
}

export function resolveReportStatColumns({ statsMap = {}, resolvedConfig = null } = {}) {
  let statKeys = [];
  const statLabels = {};

  if (resolvedConfig?.columns) {
    buildConfiguredStatFields(resolvedConfig.columns, Object.values(statsMap)).forEach(({ fieldName, label }) => {
      statKeys.push(fieldName);
      statLabels[fieldName] = label;
    });
  }

  if (statKeys.length === 0) {
    const allKeys = new Set();
    Object.values(statsMap).forEach((stats) => {
      Object.keys(stats || {}).forEach((key) => allKeys.add(key));
    });
    statKeys = Array.from(allKeys).sort();
    statKeys.forEach((key) => {
      statLabels[key] = key.toUpperCase();
    });
  }

  if (!statKeys.includes('fouls')) {
    const hasFouls = Object.values(statsMap).some((stats) => stats?.fouls !== undefined);
    if (hasFouls) {
      statKeys.push('fouls');
      statLabels.fouls = 'FOULS';
    }
  }

  return { statKeys, statLabels };
}

export function resolveOpponentReportStatColumns({ opponentStats = {}, resolvedConfig = null } = {}) {
  const metadataKeys = new Set(['name', 'number', 'notes', 'photoUrl']);
  let oppKeys = [];
  const oppLabels = {};

  if (resolvedConfig?.columns) {
    buildConfiguredStatFields(
      resolvedConfig.columns,
      Object.values(opponentStats).map((stats) => {
        const values = { ...(stats || {}) };
        metadataKeys.forEach((key) => delete values[key]);
        return values;
      })
    ).forEach(({ fieldName, label }) => {
      oppKeys.push(fieldName);
      oppLabels[fieldName] = label;
    });
  }

  if (oppKeys.length === 0) {
    const opponentStatKeys = new Set();
    Object.values(opponentStats).forEach((stats) => {
      Object.keys(stats || {}).forEach((key) => {
        if (!metadataKeys.has(key)) {
          opponentStatKeys.add(key);
        }
      });
    });
    oppKeys = Array.from(opponentStatKeys).sort();
    oppKeys.forEach((key) => {
      oppLabels[key] = key.toUpperCase();
    });
  }

  const foulIndex = oppKeys.indexOf('fouls');
  if (foulIndex > -1) {
    oppKeys.splice(foulIndex, 1);
    oppKeys.push('fouls');
  }

  return { oppKeys, oppLabels };
}
