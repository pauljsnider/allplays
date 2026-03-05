export function inferSeasonLabelFromGame(game) {
  if (typeof game?.seasonLabel === 'string' && game.seasonLabel.trim()) {
    return game.seasonLabel.trim();
  }
  const rawDate = game?.date;
  const d = rawDate?.toDate ? rawDate.toDate() : new Date(rawDate || Date.now());
  if (Number.isNaN(d.getTime())) return String(new Date().getFullYear());
  return String(d.getFullYear());
}

export function gameCountsTowardSeasonRecord(game) {
  return game?.countsTowardSeasonRecord !== false;
}

export function isCompletedGame(game) {
  if (!game || game.type === 'practice') return false;
  const status = String(game.status || '').toLowerCase();
  const liveStatus = String(game.liveStatus || '').toLowerCase();
  if (status !== 'completed' && liveStatus !== 'completed') return false;
  return typeof game.homeScore === 'number' && typeof game.awayScore === 'number';
}

export function calculateSeasonRecord(games, { seasonLabel } = {}) {
  let wins = 0;
  let losses = 0;
  let ties = 0;

  (Array.isArray(games) ? games : []).forEach((game) => {
    if (!isCompletedGame(game)) return;
    if (!gameCountsTowardSeasonRecord(game)) return;
    if (seasonLabel && inferSeasonLabelFromGame(game) !== seasonLabel) return;

    if (game.homeScore > game.awayScore) wins += 1;
    else if (game.homeScore < game.awayScore) losses += 1;
    else ties += 1;
  });

  return { wins, losses, ties };
}

export function listSeasonLabels(games) {
  const labels = new Set();
  (Array.isArray(games) ? games : []).forEach((game) => {
    if (game?.type === 'practice') return;
    labels.add(inferSeasonLabelFromGame(game));
  });
  return Array.from(labels)
    .filter(Boolean)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
}
