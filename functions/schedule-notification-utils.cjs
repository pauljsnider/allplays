function coerceDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getEventTitle(event) {
  const type = String(event?.type || event?.eventType || '').toLowerCase();
  if (type === 'practice') {
    return event?.title || 'Practice';
  }
  if (event?.title) return event.title;
  return event?.opponent ? `vs. ${event.opponent}` : 'Game';
}

function formatScheduleUpdateDate(value, timeZone) {
  const date = coerceDate(value);
  if (!date || !timeZone) return '';
  return date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone
  });
}

module.exports = {
  coerceDate,
  getEventTitle,
  formatScheduleUpdateDate
};
