const MILLIS_PER_DAY = 24 * 60 * 60 * 1000;
const CALENDAR_FEED_LOOKBACK_DAYS = 90;
const CALENDAR_FEED_LOOKAHEAD_DAYS = 365;

function getCalendarFeedDateWindow(now = new Date()) {
  const anchor = now instanceof Date ? new Date(now.getTime()) : new Date(now);
  if (Number.isNaN(anchor.getTime())) {
    throw new TypeError('Calendar feed window requires a valid date');
  }

  return {
    start: new Date(anchor.getTime() - CALENDAR_FEED_LOOKBACK_DAYS * MILLIS_PER_DAY),
    end: new Date(anchor.getTime() + CALENDAR_FEED_LOOKAHEAD_DAYS * MILLIS_PER_DAY)
  };
}

function buildCalendarFeedGamesQuery(gamesCollection, { now = new Date() } = {}) {
  if (!gamesCollection || typeof gamesCollection.where !== 'function') {
    throw new TypeError('Calendar feed games collection must support bounded queries');
  }

  const { start, end } = getCalendarFeedDateWindow(now);
  return gamesCollection
    .where('date', '>=', start)
    .where('date', '<=', end)
    .orderBy('date');
}

module.exports = {
  CALENDAR_FEED_LOOKAHEAD_DAYS,
  CALENDAR_FEED_LOOKBACK_DAYS,
  buildCalendarFeedGamesQuery,
  getCalendarFeedDateWindow
};
