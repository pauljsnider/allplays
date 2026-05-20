export function buildOpponentStatDefaults(columns = []) {
  const stats = { time: 0, fouls: 0 };
  columns.forEach(col => {
    stats[String(col).toLowerCase()] = 0;
  });
  return stats;
}

export function hydrateOpponentStats(data = {}, columns = []) {
  const stats = buildOpponentStatDefaults(columns);
  columns.forEach(col => {
    const key = String(col).toLowerCase();
    if (data[key] !== undefined) stats[key] = data[key];
  });
  if (data.fouls !== undefined) stats.fouls = data.fouls;
  return stats;
}
