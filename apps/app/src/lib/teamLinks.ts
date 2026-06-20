import { normalizeYouTubeEmbedUrl } from '../../../../js/live-stream-utils.js';

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

  const twitchMatch = url.match(/(?:(?:www\.)?twitch\.tv\/|player\.twitch\.tv\/\?.*channel=)([a-zA-Z0-9_]{1,25})/i);
  if (twitchMatch) {
    return {
      twitchChannel: twitchMatch[1].toLowerCase(),
      streamEmbedUrl: null,
      youtubeEmbedUrl: null
    };
  }

  if (url.includes('youtube.com/embed/')) {
    const normalized = normalizeYouTubeEmbedUrl(url);
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

  const channelMatch = url.match(/youtube\.com\/channel\/(UC[a-zA-Z0-9_-]{22})/i);
  if (channelMatch) {
    return {
      twitchChannel: null,
      streamEmbedUrl: `https://www.youtube.com/embed/live_stream?channel=${channelMatch[1]}&autoplay=1&mute=1`,
      youtubeEmbedUrl: null
    };
  }

  const pathMatch = url.match(/(?:youtube\.com\/(?:live|embed)\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/i);
  const queryMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/i);
  const videoId = (pathMatch && pathMatch[1]) || (queryMatch && queryMatch[1]);
  if (videoId) {
    return {
      twitchChannel: null,
      streamEmbedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1&mute=1`,
      youtubeEmbedUrl: null
    };
  }

  return null;
}
