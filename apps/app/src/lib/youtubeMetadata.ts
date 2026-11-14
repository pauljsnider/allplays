export type YouTubeMetadata = {
  videoId: string;
  title: string;
  authorName: string;
  thumbnailUrl: string;
  source: 'youtube_oembed' | 'url_fallback';
};

export function youtubeVideoId(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    const host = url.hostname.toLowerCase();
    const candidate = host === 'youtu.be'
      ? url.pathname.slice(1)
      : ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)
        ? url.searchParams.get('v') || url.pathname.match(/^\/(?:shorts|embed)\/([^/]+)$/)?.[1]
        : '';
    return candidate && /^[A-Za-z0-9_-]{11}$/.test(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export function youtubeMetadataFallback(value: string): YouTubeMetadata | null {
  const videoId = youtubeVideoId(value);
  if (!videoId) return null;
  return {
    videoId,
    title: '',
    authorName: '',
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    source: 'url_fallback'
  };
}
