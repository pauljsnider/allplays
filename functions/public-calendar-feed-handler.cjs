const {
  buildPublicGamesIcs,
  canExposeEmptyPublicFeed,
  isPublicFanGame,
  normalizePublicCalendarTeamId
} = require('./public-calendar-core.cjs');

function createPublicCalendarFeedHandler({
  checkRateLimit,
  getTeamSnapshot,
  getGamesSnapshot,
  logError = console.error
}) {
  return async function publicCalendarFeedHandler(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.status(405).send('Method not allowed');
      return;
    }

    const rateLimit = checkRateLimit(req);
    res.set('X-RateLimit-Remaining', String(rateLimit.remaining));
    if (!rateLimit.allowed) {
      res.set('Retry-After', String(rateLimit.retryAfterSeconds));
      res.set('Cache-Control', 'no-store');
      res.status(429).send('Too many requests');
      return;
    }

    const teamId = normalizePublicCalendarTeamId(req.query?.teamId);
    if (!teamId) {
      res.status(400).send('Missing or invalid teamId');
      return;
    }

    try {
      const teamSnap = await getTeamSnapshot(teamId);
      if (!teamSnap.exists) {
        res.status(404).send('Calendar not found');
        return;
      }

      const team = { id: teamId, ...(teamSnap.data() || {}) };
      const gamesSnap = await getGamesSnapshot(teamId);
      const games = [];
      gamesSnap.forEach((docSnap) => games.push({ id: docSnap.id, ...(docSnap.data() || {}) }));
      const publicGames = games.filter((game) => isPublicFanGame(team, game));

      if (!publicGames.length && !canExposeEmptyPublicFeed(team)) {
        res.status(404).send('Calendar not found');
        return;
      }

      const icsText = buildPublicGamesIcs({ teamId, team, games: publicGames });
      res.set('Content-Type', 'text/calendar; charset=utf-8');
      res.set('Content-Disposition', 'inline; filename="allplays-public-games.ics"');
      res.set('Cache-Control', 'public, max-age=300');
      res.status(200).send(req.method === 'HEAD' ? '' : icsText);
    } catch (error) {
      logError('Failed to build public team games ICS:', error);
      res.status(500).send('Calendar unavailable');
    }
  };
}

module.exports = { createPublicCalendarFeedHandler };
