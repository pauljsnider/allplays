const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const test = require('node:test');

const { createPublicCalendarFeedHandler } = require('../public-calendar-feed-handler.cjs');
const { createInMemoryRateLimiter } = require('../rate-limit.cjs');

function createMockResponse() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    set(name, value) {
      this.headers[name] = value;
      return this;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    }
  };
}

function createHarness({ maxRequests = 2, maxKeys = 10 } = {}) {
  let now = 1_000;
  let teamReads = 0;
  let gameReads = 0;
  const limiter = createInMemoryRateLimiter({ windowMs: 1_000, maxRequests, maxKeys });
  const games = [
    {
      id: 'game-1',
      data: () => ({
        type: 'game',
        date: '2026-10-01T18:00:00Z',
        opponent: 'Tigers',
        notes: 'Member-only scouting note'
      })
    },
    {
      id: 'practice-1',
      data: () => ({
        type: 'practice',
        date: '2026-10-02T18:00:00Z',
        opponent: 'Practice Squad'
      })
    },
    {
      id: 'private-1',
      data: () => ({
        type: 'game',
        visibility: 'private',
        date: '2026-10-03T18:00:00Z',
        opponent: 'Secret Opponent'
      })
    }
  ];
  const handler = createPublicCalendarFeedHandler({
    checkRateLimit: (req) => limiter(req, now),
    async getTeamSnapshot() {
      teamReads += 1;
      return {
        exists: true,
        data: () => ({ name: 'Wildcats', isPublic: true, active: true })
      };
    },
    async getGamesSnapshot() {
      gameReads += 1;
      return { forEach: (callback) => games.forEach(callback) };
    }
  });

  async function request({ method = 'GET', ip = '203.0.113.10', teamId = 'team-1' } = {}) {
    const res = createMockResponse();
    await handler({ method, ip, query: { teamId } }, res);
    return res;
  }

  return {
    request,
    advanceTime(milliseconds) {
      now += milliseconds;
    },
    get teamReads() {
      return teamReads;
    },
    get gameReads() {
      return gameReads;
    }
  };
}

test('rate limits GET and HEAD before Firestore reads and resets after the window', async () => {
  const harness = createHarness();

  const getResponse = await harness.request();
  const headResponse = await harness.request({ method: 'HEAD' });
  const rejected = await harness.request({ teamId: 'rotated-team-id' });

  assert.equal(getResponse.statusCode, 200);
  assert.equal(getResponse.headers['X-RateLimit-Remaining'], '1');
  assert.equal(getResponse.headers['Content-Type'], 'text/calendar; charset=utf-8');
  assert.equal(getResponse.headers['Cache-Control'], 'public, max-age=300');
  assert.match(getResponse.body, /BEGIN:VCALENDAR/);
  assert.match(getResponse.body, /Tigers/);
  assert.doesNotMatch(getResponse.body, /Practice Squad|Secret Opponent|Member-only scouting note/);

  assert.equal(headResponse.statusCode, 200);
  assert.equal(headResponse.headers['X-RateLimit-Remaining'], '0');
  assert.equal(headResponse.headers['Content-Type'], 'text/calendar; charset=utf-8');
  assert.equal(headResponse.headers['Cache-Control'], 'public, max-age=300');
  assert.equal(headResponse.body, '');

  assert.equal(rejected.statusCode, 429);
  assert.equal(rejected.headers['X-RateLimit-Remaining'], '0');
  assert.equal(rejected.headers['Retry-After'], '1');
  assert.equal(rejected.headers['Cache-Control'], 'no-store');
  assert.equal(harness.teamReads, 2);
  assert.equal(harness.gameReads, 2);

  harness.advanceTime(1_000);
  const recovered = await harness.request({ teamId: 'team-2' });
  assert.equal(recovered.statusCode, 200);
  assert.equal(harness.teamReads, 3);
  assert.equal(harness.gameReads, 3);
});

test('uses a dedicated shared limiter rather than the public JSON API budget', () => {
  const source = readFileSync(join(__dirname, '..', 'index.js'), 'utf8');
  const limiterStart = source.indexOf('const checkPublicCalendarFeedRateLimit');
  const limiterEnd = source.indexOf('const checkReplayPlaybackRateLimit', limiterStart);
  const handlerStart = source.indexOf('exports.publicTeamGamesIcs = functions');
  const handlerEnd = source.indexOf('async function getCalendarTokenSnapshot', handlerStart);
  const limiterSource = source.slice(limiterStart, limiterEnd);
  const handlerSource = source.slice(handlerStart, handlerEnd);

  assert.notEqual(limiterStart, -1);
  assert.match(limiterSource, /createFirestoreFixedWindowRateLimiter/);
  assert.match(limiterSource, /collectionName: 'publicCalendarFeedRateLimits'/);
  assert.match(limiterSource, /getRequestIp\(req\)/);
  assert.doesNotMatch(limiterSource, /createInMemoryRateLimiter/);
  assert.match(handlerSource, /checkRateLimit: checkPublicCalendarFeedRateLimit/);
  assert.doesNotMatch(handlerSource, /checkPublicTeamApiRateLimit/);
});
