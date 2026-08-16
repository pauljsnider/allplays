'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildLiveGameShareHtml,
  buildLiveGameShareMetadata,
  formatLiveGameStart,
  resolveTimeZone
} = require('../live-game-share-preview-core.cjs');

test('formats the game start in the team time zone', () => {
  assert.equal(
    formatLiveGameStart('2026-08-16T15:00:00.000Z', 'America/Chicago'),
    'Sun, Aug 16 at 10:00 AM'
  );
  assert.equal(resolveTimeZone('not/a-zone'), 'America/Chicago');
});

test('builds game-specific share metadata with the ALL PLAYS logo', () => {
  assert.deepEqual(buildLiveGameShareMetadata({
    teamName: 'Vipers FC U8B',
    opponent: 'Union KC Navy',
    startsAt: '2026-08-16T15:00:00.000Z',
    timeZone: 'America/Chicago'
  }), {
    title: 'Vipers FC U8B vs Union KC Navy — Sun, Aug 16 at 10:00 AM',
    description: 'Watch the live game on ALL PLAYS.',
    imageUrl: 'https://allplays.ai/img/logo_large.png',
    imageAlt: 'ALL PLAYS logo',
    siteName: 'ALL PLAYS'
  });
});

test('escapes metadata and destinations in the crawler response', () => {
  const html = buildLiveGameShareHtml({
    metadata: {
      title: 'Vipers <script>alert(1)</script>',
      description: 'Watch "live" & cheer',
      imageUrl: 'https://allplays.ai/img/logo_large.png',
      imageAlt: 'ALL PLAYS logo',
      siteName: 'ALL PLAYS'
    },
    redirectUrl: 'https://allplays.ai/live-game.html?teamId=team-1&gameId=game-1',
    shareUrl: 'https://allplays.ai/watch?teamId=team-1&gameId=game-1'
  });

  assert.match(html, /property="og:title" content="Vipers &lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
  assert.match(html, /content="Watch &quot;live&quot; &amp; cheer"/);
  assert.match(html, /property="og:image" content="https:\/\/allplays\.ai\/img\/logo_large\.png"/);
  assert.match(html, /teamId=team-1&amp;gameId=game-1/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});
