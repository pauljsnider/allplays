import { normalizeYouTubeEmbedUrl as legacyNormalizeYouTubeEmbedUrl } from '@legacy/live-stream-utils.js';

/**
 * Typed adapter boundary for the legacy js/ live-stream URL helpers (#2066).
 */
export function normalizeYouTubeEmbedUrl(url: string): string | null {
  return legacyNormalizeYouTubeEmbedUrl(url) ?? null;
}
