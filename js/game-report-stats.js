import {
  DIAMOND_TRACKING_ENGINE,
  getPublicDiamondStatCatalog
} from './diamond-stat-presentation.js?v=1';

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

function getDiamondReportDefinitions(resolvedConfig = null) {
  return getPublicDiamondStatCatalog(resolvedConfig, 'player');
}

function resolveDiamondColumns(statsMap, resolvedConfig) {
  const definitions = getDiamondReportDefinitions(resolvedConfig);
  const actualFields = Object.values(statsMap || {});
  const orderedDefinitions = [];
  const seen = new Set();
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));

  buildConfiguredStatFields(resolvedConfig?.columns || [], actualFields).forEach(({ fieldName, label }) => {
    const id = String(fieldName || '').trim().toLowerCase();
    if (!id || seen.has(id)) return;
    orderedDefinitions.push({ ...(byId.get(id) || {}), id, label });
    seen.add(id);
  });
  definitions.forEach((definition) => {
    if (seen.has(definition.id)) return;
    orderedDefinitions.push(definition);
    seen.add(definition.id);
  });

  return {
    statKeys: orderedDefinitions.map((definition) => definition.id),
    statLabels: Object.fromEntries(orderedDefinitions.map((definition) => [definition.id, definition.label || definition.acronym || definition.id.toUpperCase()])),
    statDefinitions: Object.fromEntries(orderedDefinitions.map((definition) => [definition.id, definition]))
  };
}

export function resolveReportStatColumns({ statsMap = {}, resolvedConfig = null, trackingEngine = '' } = {}) {
  if (trackingEngine === DIAMOND_TRACKING_ENGINE) {
    return resolveDiamondColumns(statsMap, resolvedConfig);
  }
  let statKeys = [];
  const statLabels = {};

  if (resolvedConfig?.columns) {
    buildConfiguredStatFields(resolvedConfig.columns, Object.values(statsMap)).forEach(({ fieldName, label }) => {
      statKeys.push(fieldName);
      statLabels[fieldName] = label;
    });
  }

  if (statKeys.length === 0) {
    // If no explicit columns are configured, always start with a base set of common defaults
    let discoveredKeys = new Set();
    const metadataKeys = new Set(['name', 'number', 'notes', 'photoUrl', '_playerId']); // Re-introduce metadataKeys here

    Object.values(statsMap).forEach((stats) => {
      Object.keys(stats || {}).forEach((key) => {
        if (!metadataKeys.has(key)) { // Filter metadata keys
          discoveredKeys.add(key); // Add any actual stats
        }
      });
    });

    if (discoveredKeys.size > 0) {
      statKeys = Array.from(discoveredKeys).sort();
    } else {
      // If no explicit columns are configured AND no stats are discovered, use a base set of common defaults
      const defaultBaseKeys = new Set(['pts', 'rebs', 'ast', 'fouls']);
      statKeys = Array.from(defaultBaseKeys).sort();
    }
    
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

export function formatGameReportEventTimestamp(timestamp) {
  if (!timestamp) return '';

  let date = null;

  if (typeof timestamp === 'number') {
    date = new Date(timestamp);
  } else if (timestamp instanceof Date) {
    date = timestamp;
  } else if (typeof timestamp.toDate === 'function') {
    date = timestamp.toDate();
  } else if (typeof timestamp.seconds === 'number') {
    date = new Date(timestamp.seconds * 1000);
  }

  if (!date || Number.isNaN(date.getTime())) return '';

  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function resolveOpponentReportStatColumns({ opponentStats = {}, resolvedConfig = null, trackingEngine = '' } = {}) {
  if (trackingEngine === DIAMOND_TRACKING_ENGINE) {
    const { statKeys, statLabels, statDefinitions } = resolveDiamondColumns(opponentStats, resolvedConfig);
    return { oppKeys: statKeys, oppLabels: statLabels, oppDefinitions: statDefinitions };
  }
  const metadataKeys = new Set(['name', 'number', 'notes', 'photoUrl', 'playerId', 'diamondCoverage', 'diamondSourceRevision']);
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
