const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const {
  buildBigMomentLiveEventNotification,
  buildLiveEventNotificationDedupKey,
  classifyBigMomentLiveEvent,
  getLiveEventActorUid
} = require('../live-event-notification-core.cjs');

describe('big-moment live event notifications', () => {
  it('classifies scoring events while rejecting routine and reversal events', () => {
    assert.deepEqual(classifyBigMomentLiveEvent({ type: 'goal' }), { label: 'Goal', kind: 'goal' });
    assert.deepEqual(classifyBigMomentLiveEvent({ type: 'stat', statKey: 'PTS', value: 3 }), { label: '3 points', kind: 'scoring-stat' });
    assert.deepEqual(classifyBigMomentLiveEvent({ type: 'baseball', baseballAction: 'homeRun' }), { label: 'Home run', kind: 'home-run' });
    assert.deepEqual(classifyBigMomentLiveEvent({ type: 'football_score', footballScoringAction: 'touchdown' }), { label: 'Touchdown', kind: 'football-score' });

    for (const type of ['clock_start', 'clock_pause', 'period_change', 'lineup', 'substitution', 'undo', 'note']) {
      assert.equal(classifyBigMomentLiveEvent({ type }), null);
    }
    assert.equal(classifyBigMomentLiveEvent({ type: 'stat', statKey: 'rebounds', value: 1 }), null);
    assert.equal(classifyBigMomentLiveEvent({ type: 'stat', statKey: 'pts', value: -2 }), null);
    assert.equal(classifyBigMomentLiveEvent({ type: 'baseball', baseballAction: 'single' }), null);
  });

  it('builds bounded structured copy without forwarding arbitrary event notes', () => {
    const payload = buildBigMomentLiveEventNotification({
      type: 'goal',
      teamSide: 'home',
      playerName: 'Ava Cole',
      period: 'H2',
      homeScore: 2,
      awayScore: 1,
      description: 'Goal — medical detail that should not be pushed',
      note: 'private sideline note'
    });

    assert.deepEqual(payload, {
      title: 'Goal: Ava Cole',
      body: 'H2 · Score 2–1',
      kind: 'goal'
    });
    assert.equal(payload.title.includes('medical'), false);
    assert.equal(payload.body.includes('private'), false);
    assert.ok(payload.title.length <= 80);
    assert.ok(payload.body.length <= 120);
  });

  it('uses opponent identity and degrades safely when period and score are absent', () => {
    assert.deepEqual(buildBigMomentLiveEventNotification({
      type: 'stat',
      stat: 'goals',
      value: 1,
      isOpponent: true,
      opponentPlayerName: 'Morgan Lee'
    }), {
      title: 'Goal: Morgan Lee',
      body: 'Open the live game for play-by-play.',
      kind: 'scoring-stat'
    });
  });

  it('prefers the canonical document ID for dedup and accepts both actor fields', () => {
    assert.equal(buildLiveEventNotificationDedupKey({ eventId: 'client-event-7' }, 'doc-event-8'), 'live-event:doc-event-8');
    assert.equal(buildLiveEventNotificationDedupKey({ eventId: 'client-event-7' }), 'live-event:client-event-7');
    assert.equal(buildLiveEventNotificationDedupKey({}, 'doc-event-8'), 'live-event:doc-event-8');
    assert.equal(buildLiveEventNotificationDedupKey({}, ''), '');
    assert.equal(getLiveEventActorUid({ actorUid: 'actor-1', createdBy: 'actor-2' }), 'actor-1');
    assert.equal(getLiveEventActorUid({ createdBy: 'actor-2' }), 'actor-2');
  });
});
