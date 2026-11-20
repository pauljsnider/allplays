import { describe, expect, it } from 'vitest';
import { youtubeMetadataFallback, youtubeVideoId } from './youtubeMetadata';

describe('YouTube metadata', () => {
  it('recognizes only exact HTTPS YouTube hosts and valid IDs', () => {
    expect(youtubeVideoId('https://youtu.be/abcdefghijk')).toBe('abcdefghijk');
    expect(youtubeVideoId('https://www.youtube.com/shorts/abcdefghijk')).toBe('abcdefghijk');
    expect(youtubeVideoId('https://youtube.com.evil.test/watch?v=abcdefghijk')).toBeNull();
    expect(youtubeVideoId('http://youtube.com/watch?v=abcdefghijk')).toBeNull();
  });

  it('keeps a deterministic thumbnail fallback without inventing metadata', () => {
    expect(youtubeMetadataFallback('https://youtu.be/abcdefghijk')).toEqual({
      videoId: 'abcdefghijk',
      title: '',
      authorName: '',
      thumbnailUrl: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
      source: 'url_fallback'
    });
  });
});
