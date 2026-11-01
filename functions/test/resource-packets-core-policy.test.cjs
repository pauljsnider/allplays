'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveCompletionPolicy, youtubeMetadata, youtubeVideoId } = require('../resource-packets-core.cjs');

test('new clients opt in to explicit practice acknowledgment', () => {
  assert.equal(resolveCompletionPolicy('practice_ack'), 'practice_ack');
});

test('missing policy keeps legacy records compatible', () => {
  assert.equal(resolveCompletionPolicy(undefined, undefined), 'link_opened_legacy');
  assert.equal(resolveCompletionPolicy('link_opened_legacy', undefined), 'link_opened_legacy');
});

test('an existing practice acknowledgment cannot be silently downgraded', () => {
  assert.equal(resolveCompletionPolicy(undefined, 'practice_ack'), 'practice_ack');
  assert.equal(resolveCompletionPolicy('link_opened_legacy', 'practice_ack'), 'practice_ack');
});

test('unknown policy values fail closed', () => {
  assert.throws(
    () => resolveCompletionPolicy('watched'),
    (error) => error.code === 'invalid-argument' && /completion policy/i.test(error.message)
  );
});

test('YouTube parsing accepts only exact HTTPS hosts', () => {
  assert.equal(youtubeVideoId('https://youtu.be/abcdefghijk'), 'abcdefghijk');
  assert.equal(youtubeVideoId('https://www.youtube.com/shorts/abcdefghijk'), 'abcdefghijk');
  assert.equal(youtubeVideoId('https://youtube.com.evil.test/watch?v=abcdefghijk'), null);
  assert.equal(youtubeVideoId('http://youtube.com/watch?v=abcdefghijk'), null);
});

test('official oEmbed metadata is normalized without generating coaching advice', async () => {
  let endpoint;
  const result = await youtubeMetadata(async (url) => {
    endpoint = url;
    return {
      ok: true,
      json: async () => ({
        title: 'First touch drill',
        author_name: 'Example Coach',
        thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg'
      })
    };
  }, 'https://youtu.be/abcdefghijk');
  assert.equal(endpoint.hostname, 'www.youtube.com');
  assert.deepEqual(result, {
    videoId: 'abcdefghijk',
    title: 'First touch drill',
    authorName: 'Example Coach',
    thumbnailUrl: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
    source: 'youtube_oembed'
  });
});

test('metadata failure keeps a deterministic manual-entry fallback', async () => {
  assert.deepEqual(await youtubeMetadata(async () => { throw new Error('offline'); }, 'https://youtu.be/abcdefghijk'), {
    videoId: 'abcdefghijk',
    title: '',
    authorName: '',
    thumbnailUrl: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
    source: 'url_fallback'
  });
});
