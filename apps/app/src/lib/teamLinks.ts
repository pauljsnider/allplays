import { normalizeYouTubeEmbedUrl } from './adapters/legacyLiveStreamUtils';

const YOUTUBE_HOST_RE = /(^|\.)youtube\.com$/i;
const YOUTU_BE_HOST_RE = /(^|\.)youtu\.be$/i;

export type ParsedTeamLivestream = {
  twitchChannel: string | null;
  streamEmbedUrl: string | null;
  youtubeEmbedUrl: null;
};

export function normalizeOptionalHttpUrl(value: unknown) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return null;

  try {
    const parsed = new URL(trimmed);
    if (!/^https?:$/i.test(parsed.protocol)) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function parseHttpUrl(value: string) {
  try {
    const parsed = new URL(value);
    return /^https?:$/i.test(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

function isYouTubeUrl(parsed: URL) {
  return YOUTUBE_HOST_RE.test(parsed.hostname) || YOUTU_BE_HOST_RE.test(parsed.hostname);
}

export function parseTeamLivestreamInput(value: unknown): ParsedTeamLivestream | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return {
      twitchChannel: null,
      streamEmbedUrl: null,
      youtubeEmbedUrl: null
    };
  }

  const iframeSrcMatch = trimmed.match(/src="([^"]+)"/i);
  const url = iframeSrcMatch ? iframeSrcMatch[1] : trimmed;
  const parsedUrl = parseHttpUrl(url);

  const twitchMatch = url.match(/(?:(?:www\.)?twitch\.tv\/|player\.twitch\.tv\/\?.*channel=)([a-zA-Z0-9_]{1,25})/i);
  if (twitchMatch) {
    return {
      twitchChannel: twitchMatch[1].toLowerCase(),
      streamEmbedUrl: null,
      youtubeEmbedUrl: null
    };
  }

  if (parsedUrl && isYouTubeUrl(parsedUrl) && /^\/embed\//i.test(parsedUrl.pathname)) {
    const normalized = normalizeYouTubeEmbedUrl(parsedUrl.toString());
    return normalized
      ? {
          twitchChannel: null,
          streamEmbedUrl: normalized,
          youtubeEmbedUrl: null
        }
      : null;
  }

  if (/^UC[a-zA-Z0-9_-]{22}$/.test(url)) {
    return {
      twitchChannel: null,
      streamEmbedUrl: `https://www.youtube.com/embed/live_stream?channel=${url}&autoplay=1&mute=1`,
      youtubeEmbedUrl: null
    };
  }

  if (parsedUrl && YOUTUBE_HOST_RE.test(parsedUrl.hostname)) {
    const channelMatch = parsedUrl.pathname.match(/^\/channel\/(UC[a-zA-Z0-9_-]{22})$/i);
    if (channelMatch) {
      return {
        twitchChannel: null,
        streamEmbedUrl: `https://www.youtube.com/embed/live_stream?channel=${channelMatch[1]}&autoplay=1&mute=1`,
        youtubeEmbedUrl: null
      };
    }

    const pathMatch = parsedUrl.pathname.match(/^\/(?:live|embed)\/([a-zA-Z0-9_-]{11})$/i);
    const queryVideoId = parsedUrl.searchParams.get('v');
    const videoId = (pathMatch && pathMatch[1]) || (/^[a-zA-Z0-9_-]{11}$/.test(queryVideoId || '') ? queryVideoId : null);
    if (videoId) {
      return {
        twitchChannel: null,
        streamEmbedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1`,
        youtubeEmbedUrl: null
      };
    }
  }

  if (parsedUrl && YOUTU_BE_HOST_RE.test(parsedUrl.hostname)) {
    const videoId = parsedUrl.pathname.replace(/^\//, '');
    if (/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      return {
        twitchChannel: null,
        streamEmbedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1`,
        youtubeEmbedUrl: null
      };
    }
  }

  return null;
}
