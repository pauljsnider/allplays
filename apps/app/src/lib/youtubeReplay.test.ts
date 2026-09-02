import { describe, expect, it } from 'vitest';
import {
  getReplayArchiveState,
  getReplayTimestampComponents,
  hasReplayArchiveEvidence,
  isCompletedGameForReplay,
  normalizeStoredYouTubeReplay,
  normalizeYouTubeReplayUrl
} from './youtubeReplay';

const videoId = 'PK1HyC37doc';

describe('replay archive state', () => {
  it('preserves every nonempty playback alias for replacement evidence and CAS', () => {
    const replayVideo = { provider: 'youtube', videoId };
    expect(getReplayArchiveState({
      replayVideo,
      recordedVideo: { provider: 'vimeo' },
      videoReplay: 'legacy-recording',
      replayVideoUrl: 'https://example.com/replay',
      recordedVideoUrl: 'https://example.com/recorded',
      videoReplayUrl: 'https://example.com/video-replay',
      archivedVideoUrl: 'https://example.com/archive',
      replayVideoPublicUrl: 'https://example.com/public',
      replayVideoPosterUrl: 'https://example.com/poster.jpg',
      replayVideoTitle: 'Vipers replay',
      replayVideoDurationMs: 0,
      replayStatus: 'ready',
      recordedReplayStatus: 'complete',
      videoReplayStatus: 'archived',
      streamUrl: 'https://example.com/live',
      emptyAlias: null
    })).toEqual({
      replayVideo,
      recordedVideo: { provider: 'vimeo' },
      videoReplay: 'legacy-recording',
      replayVideoUrl: 'https://example.com/replay',
      recordedVideoUrl: 'https://example.com/recorded',
      videoReplayUrl: 'https://example.com/video-replay',
      archivedVideoUrl: 'https://example.com/archive',
      replayVideoPublicUrl: 'https://example.com/public',
      replayVideoPosterUrl: 'https://example.com/poster.jpg',
      replayVideoTitle: 'Vipers replay',
      replayVideoDurationMs: 0,
      replayStatus: 'ready',
      recordedReplayStatus: 'complete',
      videoReplayStatus: 'archived'
    });
  });

  it('treats absent, null, and blank aliases as no stored replay evidence', () => {
    expect(getReplayArchiveState({ replayVideo: null, recordedVideoUrl: '  ' })).toEqual({});
    expect(hasReplayArchiveEvidence({ archivedVideoUrl: 'https://example.com/archive' })).toBe(true);
    expect(hasReplayArchiveEvidence({ replayVideoPublicUrl: 'https://example.com/public' })).toBe(true);
    expect(hasReplayArchiveEvidence({ replayVideo: null })).toBe(false);
  });

  it('recognizes the exact Firestore Timestamp JSON shape produced by browser cache serialization', () => {
    expect(getReplayTimestampComponents({
      type: 'firestore/timestamp/1.0',
      seconds: 1_788_091_200,
      nanoseconds: 123_456_789
    })).toEqual({ seconds: 1_788_091_200, nanoseconds: 123_456_789 });
    expect(getReplayTimestampComponents({
      type: 'firestore/timestamp/1.0',
      seconds: 1_788_091_200,
      nanoseconds: 123_456_789,
      extra: true
    })).toBeNull();
  });
});

describe('normalizeYouTubeReplayUrl', () => {
  it.each([
    `https://youtube.com/watch?v=${videoId}`,
    `https://www.youtube.com/watch?v=${videoId}&si=share-token#details`,
    `https://m.youtube.com/watch?v=${videoId}`,
    `https://youtube.com/live/${videoId}?feature=share`,
    `https://www.youtube.com/embed/${videoId}?autoplay=1`,
    `https://youtube.com/shorts/${videoId}`,
    `https://youtu.be/${videoId}?t=120`,
    `https://youtube-nocookie.com/embed/${videoId}`,
    `https://www.youtube-nocookie.com/embed/${videoId}?controls=0`
  ])('canonicalizes %s', (input) => {
    expect(normalizeYouTubeReplayUrl(input)).toEqual({
      provider: 'youtube',
      videoId,
      embedUrl: `https://www.youtube.com/embed/${videoId}`,
      publicUrl: `https://www.youtube.com/watch?v=${videoId}`
    });
  });

  it.each([
    '',
    `http://www.youtube.com/watch?v=${videoId}`,
    `https://user@www.youtube.com/watch?v=${videoId}`,
    `https://www.youtube.com:8443/watch?v=${videoId}`,
    `https://www.youtube.com:443/watch?v=${videoId}`,
    `https://www%2eyoutube%2ecom/watch?v=${videoId}`,
    `https://youtube.example/watch?v=${videoId}`,
    `https://evil.example/youtube.com/watch?v=${videoId}`,
    `https://www.youtube.com/channel/UCa9ghvbup6VQmnDOdqwYpqQ`,
    'https://www.youtube.com/embed/live_stream?channel=UCa9ghvbup6VQmnDOdqwYpqQ',
    'https://www.youtube.com/watch?v=too-short',
    `https://www.youtube.com/playlist?list=${videoId}`,
    `https://youtu.be/${videoId}/extra`,
    `https://vimeo.com/${videoId}`,
    `javascript:location='https://youtu.be/${videoId}'`
  ])('rejects %s', (input) => {
    expect(normalizeYouTubeReplayUrl(input)).toBeNull();
  });

  it('canonicalizes consistent stored replay metadata', () => {
    const linkedAt = new Date('2026-08-30T12:00:00.000Z');
    expect(normalizeStoredYouTubeReplay({
      provider: 'youtube',
      videoId,
      embedUrl: `https://youtube.com/embed/${videoId}?autoplay=1`,
      publicUrl: `https://youtu.be/${videoId}?si=share-token`,
      title: '  Vipers   final  ',
      status: 'ready',
      linkedBy: 'coach-1',
      linkedAt
    })).toEqual({
      provider: 'youtube',
      videoId,
      embedUrl: `https://www.youtube.com/embed/${videoId}`,
      publicUrl: `https://www.youtube.com/watch?v=${videoId}`,
      title: 'Vipers final',
      status: 'ready',
      linkedBy: 'coach-1',
      linkedAt
    });
  });

  it('fails closed when present stored replay fields identify different videos', () => {
    expect(normalizeStoredYouTubeReplay({
      provider: 'youtube',
      videoId,
      embedUrl: `https://www.youtube.com/embed/${videoId}`,
      publicUrl: 'https://www.youtube.com/watch?v=AaBbCcDdEeF',
      status: 'ready'
    })).toBeNull();
  });

  it.each([
    { embedUrl: 'https://evil.example/embed' },
    { publicUrl: null },
    { videoId: 'too-short' }
  ])('fails closed when a present stored field is malformed: %o', (malformedField) => {
    expect(normalizeStoredYouTubeReplay({
      provider: 'youtube',
      videoId,
      embedUrl: `https://www.youtube.com/embed/${videoId}`,
      publicUrl: `https://www.youtube.com/watch?v=${videoId}`,
      status: 'ready',
      ...malformedField
    })).toBeNull();
  });
});

describe('isCompletedGameForReplay', () => {
  it('accepts only exact lower-case completed and final game states without contradictions', () => {
    expect(isCompletedGameForReplay({ status: 'completed' })).toBe(true);
    expect(isCompletedGameForReplay({ status: 'completed', liveStatus: '' })).toBe(true);
    expect(isCompletedGameForReplay({ status: 'completed', liveStatus: 'final' })).toBe(true);
    expect(isCompletedGameForReplay({ liveStatus: 'FINAL' })).toBe(false);
    expect(isCompletedGameForReplay({ status: ' final ' })).toBe(false);
    expect(isCompletedGameForReplay({ status: 'scheduled', liveStatus: 'live' })).toBe(false);
    expect(isCompletedGameForReplay({ status: 'completed', liveStatus: 'live' })).toBe(false);
    expect(isCompletedGameForReplay({ status: 'final', liveStatus: 'cancelled' })).toBe(false);
  });
});
