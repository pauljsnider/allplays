'use strict';

const DEFAULT_TIME_ZONE = 'America/Chicago';

function compactText(value, maxLength) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function resolveTimeZone(value) {
  const timeZone = compactText(value, 100) || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date(0));
    return timeZone;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

function formatLiveGameStart(value, timeZoneValue = DEFAULT_TIME_ZONE) {
  const startsAt = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(startsAt.getTime())) return '';
  const timeZone = resolveTimeZone(timeZoneValue);
  const dateLabel = new Intl.DateTimeFormat('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone
  }).format(startsAt);
  const timeLabel = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone
  }).format(startsAt);
  return `${dateLabel} at ${timeLabel}`;
}

function buildLiveGameShareMetadata({ teamName, opponent, startsAt, timeZone } = {}) {
  const safeTeamName = compactText(teamName, 100) || 'ALL PLAYS';
  const safeOpponent = compactText(opponent, 100);
  const matchup = safeOpponent && safeOpponent.toLowerCase() !== 'tbd'
    ? `${safeTeamName} vs ${safeOpponent}`
    : `${safeTeamName} live game`;
  const when = formatLiveGameStart(startsAt, timeZone);
  return {
    title: compactText(when ? `${matchup} — ${when}` : matchup, 220),
    description: 'Watch the live game on ALL PLAYS.',
    imageUrl: 'https://allplays.ai/img/logo_large.png',
    imageAlt: 'ALL PLAYS logo',
    siteName: 'ALL PLAYS'
  };
}

function buildLiveGameShareHtml({ metadata, redirectUrl, shareUrl } = {}) {
  const title = escapeHtml(metadata?.title || 'Live game on ALL PLAYS');
  const description = escapeHtml(metadata?.description || 'Watch the live game on ALL PLAYS.');
  const imageUrl = escapeHtml(metadata?.imageUrl || 'https://allplays.ai/img/logo_large.png');
  const imageAlt = escapeHtml(metadata?.imageAlt || 'ALL PLAYS logo');
  const siteName = escapeHtml(metadata?.siteName || 'ALL PLAYS');
  const safeRedirectUrl = escapeHtml(redirectUrl || 'https://allplays.ai/');
  const safeShareUrl = escapeHtml(shareUrl || redirectUrl || 'https://allplays.ai/');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="robots" content="noindex,nofollow">
  <title>${title}</title>
  <meta name="description" content="${description}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${siteName}">
  <meta property="og:title" content="${title}">
  <meta property="og:description" content="${description}">
  <meta property="og:url" content="${safeShareUrl}">
  <meta property="og:image" content="${imageUrl}">
  <meta property="og:image:width" content="1512">
  <meta property="og:image:height" content="532">
  <meta property="og:image:alt" content="${imageAlt}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${title}">
  <meta name="twitter:description" content="${description}">
  <meta name="twitter:image" content="${imageUrl}">
  <link rel="canonical" href="${safeRedirectUrl}">
  <meta http-equiv="refresh" content="0;url=${safeRedirectUrl}">
</head>
<body>
  <p><a href="${safeRedirectUrl}">Open the live game on ALL PLAYS</a></p>
  <script>window.location.replace(${JSON.stringify(redirectUrl || 'https://allplays.ai/')});</script>
</body>
</html>`;
}

module.exports = {
  DEFAULT_TIME_ZONE,
  buildLiveGameShareHtml,
  buildLiveGameShareMetadata,
  escapeHtml,
  formatLiveGameStart,
  resolveTimeZone
};
