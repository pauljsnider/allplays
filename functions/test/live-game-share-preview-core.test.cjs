'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildGameReportShareHtml,
  buildGameReportShareMetadata,
  buildLiveGameShareHtml,
  buildLiveGameShareMetadata,
  buildLiveGameShareParams,
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

test('builds report and replay-specific preview metadata', () => {
  const input = {
    teamName: 'Vipers FC U8B',
    opponent: 'Union KC Navy',
    startsAt: '2026-08-16T15:00:00.000Z',
    timeZone: 'America/Chicago'
  };

  assert.equal(buildLiveGameShareMetadata({ ...input, mode: 'replay' }).description, 'Watch the game replay on ALL PLAYS.');
  assert.equal(buildLiveGameShareMetadata({ ...input, mode: 'highlight' }).description, 'Watch this game highlight on ALL PLAYS.');
  assert.equal(buildGameReportShareMetadata(input).description, 'View the game report on ALL PLAYS.');
  assert.equal(buildGameReportShareMetadata({ teamName: 'Vipers', opponent: 'TBD' }).title, 'Vipers game report');
  assert.equal(buildLiveGameShareMetadata({ teamName: 'Vipers', mode: 'replay' }).title, 'Vipers game replay');
});

test('preserves only safe replay and highlight query parameters', () => {
  assert.equal(buildLiveGameShareParams({
    teamId: 'team-1',
    gameId: 'game-1',
    replay: 'true',
    clipStart: '1200',
    clipEnd: '5600'
  }).toString(), 'teamId=team-1&gameId=game-1&replay=true&clipStart=1200&clipEnd=5600');

  assert.equal(buildLiveGameShareParams({
    teamId: 'team-1',
    gameId: 'game-1',
    replay: 'false',
    clipStart: '-1',
    clipEnd: '999999999'
  }).toString(), 'teamId=team-1&gameId=game-1');
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
    shareUrl: 'https://share.allplays.ai/watch?teamId=team-1&gameId=game-1'
  });

  assert.match(html, /property="og:title" content="Vipers &lt;script&gt;alert\(1\)&lt;\/script&gt;"/);
  assert.match(html, /content="Watch &quot;live&quot; &amp; cheer"/);
  assert.match(html, /property="og:image" content="https:\/\/allplays\.ai\/img\/logo_large\.png"/);
  assert.match(html, /teamId=team-1&amp;gameId=game-1/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
});

test('builds a branded report preview that redirects to the direct report', () => {
  const html = buildGameReportShareHtml({
    metadata: buildGameReportShareMetadata({ teamName: 'Vipers', opponent: 'Premier White' }),
    redirectUrl: 'https://allplays.ai/game.html#teamId=team-1&gameId=game-1',
    shareUrl: 'https://share.allplays.ai/report?teamId=team-1&gameId=game-1'
  });

  assert.match(html, /View the game report on ALL PLAYS\./);
  assert.match(html, /Open the game report on ALL PLAYS/);
  assert.match(html, /property="og:url" content="https:\/\/share\.allplays\.ai\/report\?teamId=team-1&amp;gameId=game-1"/);
  assert.match(html, /https:\/\/allplays\.ai\/game\.html#teamId=team-1&amp;gameId=game-1/);
});
