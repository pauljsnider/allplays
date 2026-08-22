'use strict';

const DEFAULT_TIME_ZONE = 'America/Chicago';
const MAX_SHARE_CLIP_MS = 24 * 60 * 60 * 1000;

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

function buildLiveGameShareMetadata({ teamName, opponent, startsAt, timeZone, mode = 'live' } = {}) {
  const safeTeamName = compactText(teamName, 100) || 'ALL PLAYS';
  const safeOpponent = compactText(opponent, 100);
  const fallbackLabel = mode === 'highlight'
    ? 'game highlight'
    : mode === 'replay'
      ? 'game replay'
      : 'live game';
  const matchup = safeOpponent && safeOpponent.toLowerCase() !== 'tbd'
    ? `${safeTeamName} vs ${safeOpponent}`
    : `${safeTeamName} ${fallbackLabel}`;
  const when = formatLiveGameStart(startsAt, timeZone);
  return {
    title: compactText(when ? `${matchup} — ${when}` : matchup, 220),
    description: mode === 'highlight'
      ? 'Watch this game highlight on ALL PLAYS.'
      : mode === 'replay'
        ? 'Watch the game replay on ALL PLAYS.'
        : 'Watch the live game on ALL PLAYS.',
    imageUrl: 'https://allplays.ai/img/logo_large.png',
    imageAlt: 'ALL PLAYS logo',
    siteName: 'ALL PLAYS'
  };
}

function buildGameReportShareMetadata({ teamName, opponent, startsAt, timeZone } = {}) {
  const safeTeamName = compactText(teamName, 100) || 'ALL PLAYS';
  const safeOpponent = compactText(opponent, 100);
  const matchup = safeOpponent && safeOpponent.toLowerCase() !== 'tbd'
    ? `${safeTeamName} vs ${safeOpponent}`
    : `${safeTeamName} game report`;
  const when = formatLiveGameStart(startsAt, timeZone);
  return {
    title: compactText(when ? `${matchup} — ${when}` : matchup, 220),
    description: 'View the game report on ALL PLAYS.',
    imageUrl: 'https://allplays.ai/img/logo_large.png',
    imageAlt: 'ALL PLAYS logo',
    siteName: 'ALL PLAYS'
  };
}

function normalizeShareClipMs(value) {
  const raw = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  if (!/^\d{1,8}$/.test(raw)) return null;
  const normalized = Number(raw);
  return normalized <= MAX_SHARE_CLIP_MS ? normalized : null;
}

function buildLiveGameShareParams({ teamId, gameId, replay, clipStart, clipEnd } = {}) {
  const params = new URLSearchParams({ teamId, gameId });
  const clipStartMs = normalizeShareClipMs(clipStart);
  const clipEndMs = normalizeShareClipMs(clipEnd);
  const hasClipRange = clipStartMs !== null && clipEndMs !== null && clipEndMs > clipStartMs;

  if (replay === true || replay === 'true' || hasClipRange) params.set('replay', 'true');
  if (hasClipRange) {
    params.set('clipStart', String(clipStartMs));
    params.set('clipEnd', String(clipEndMs));
  }
  return params;
}

function buildSharePreviewHtml({ metadata, redirectUrl, shareUrl, openLabel } = {}) {
  const title = escapeHtml(metadata?.title || 'ALL PLAYS');
  const description = escapeHtml(metadata?.description || 'Open on ALL PLAYS.');
  const imageUrl = escapeHtml(metadata?.imageUrl || 'https://allplays.ai/img/logo_large.png');
  const imageAlt = escapeHtml(metadata?.imageAlt || 'ALL PLAYS logo');
  const siteName = escapeHtml(metadata?.siteName || 'ALL PLAYS');
  const safeOpenLabel = escapeHtml(openLabel || 'Open on ALL PLAYS');
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
  <p><a href="${safeRedirectUrl}">${safeOpenLabel}</a></p>
  <script>window.location.replace(${JSON.stringify(redirectUrl || 'https://allplays.ai/')});</script>
</body>
</html>`;
}

function buildLiveGameShareHtml(options = {}) {
  return buildSharePreviewHtml({
    ...options,
    openLabel: options.openLabel || 'Open the live game on ALL PLAYS'
  });
}

function buildGameReportShareHtml(options = {}) {
  return buildSharePreviewHtml({
    ...options,
    openLabel: options.openLabel || 'Open the game report on ALL PLAYS'
  });
}

module.exports = {
  DEFAULT_TIME_ZONE,
  MAX_SHARE_CLIP_MS,
  buildGameReportShareHtml,
  buildGameReportShareMetadata,
  buildLiveGameShareHtml,
  buildLiveGameShareMetadata,
  buildLiveGameShareParams,
  buildSharePreviewHtml,
  compactText,
  escapeHtml,
  formatLiveGameStart,
  resolveTimeZone
};
