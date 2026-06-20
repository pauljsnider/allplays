import { describe, expect, it } from 'vitest';
import { normalizeOptionalHttpUrl, parseTeamLivestreamInput } from './teamLinks';

describe('teamLinks', () => {
  it('accepts league links with whitespace and preserves valid http urls', () => {
    expect(normalizeOptionalHttpUrl('  http://league.example.test/standings  ')).toBe('http://league.example.test/standings');
  });

  it('rejects non-http league links', () => {
    expect(normalizeOptionalHttpUrl('ftp://league.example.test/standings')).toBeNull();
    expect(normalizeOptionalHttpUrl('not-a-url')).toBeNull();
  });

  it('normalizes supported youtube livestream variants to legacy embed urls', () => {
    expect(parseTeamLivestreamInput('https://www.youtube.com/watch?v=LJNfHqRRhBI&t=30s')).toEqual({
      twitchChannel: null,
      streamEmbedUrl: 'https://www.youtube.com/embed/LJNfHqRRhBI?autoplay=1&mute=1',
      youtubeEmbedUrl: null
    });

    expect(parseTeamLivestreamInput('https://youtu.be/LJNfHqRRhBI')).toEqual({
      twitchChannel: null,
      streamEmbedUrl: 'https://www.youtube.com/embed/LJNfHqRRhBI?autoplay=1&mute=1',
      youtubeEmbedUrl: null
    });

    expect(parseTeamLivestreamInput('https://www.youtube.com/live/LJNfHqRRhBI?feature=share')).toEqual({
      twitchChannel: null,
      streamEmbedUrl: 'https://www.youtube.com/embed/LJNfHqRRhBI?autoplay=1&mute=1',
      youtubeEmbedUrl: null
    });

    expect(parseTeamLivestreamInput('UCa9ghvbup6VQmnDOdqwYpqQ')).toEqual({
      twitchChannel: null,
      streamEmbedUrl: 'https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ&autoplay=1&mute=1',
      youtubeEmbedUrl: null
    });
  });

  it('parses twitch urls and rejects garbage', () => {
    expect(parseTeamLivestreamInput('https://www.twitch.tv/MyTeamChannel')).toEqual({
      twitchChannel: 'myteamchannel',
      streamEmbedUrl: null,
      youtubeEmbedUrl: null
    });
    expect(parseTeamLivestreamInput('not a url at all')).toBeNull();
  });
});
