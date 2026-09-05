import { describe, expect, it } from 'vitest';
import {
  DIAMOND_SCHEMA_VERSION,
  canonicalDiamondJson,
  createDiamondCheckpoint,
  createDiamondLedger,
  deriveDiamondPlayerStats,
  executeDiamondCommand,
  executeDiamondCommandFromCheckpoint,
  formatDiamondRate,
  formatInningsPitched,
  getEffectiveDiamondEvents,
  getDiamondRulesProfile,
  listDiamondRulesProfiles,
  projectDiamondStats,
  reduceDiamondEvent,
  replayDiamondLedger,
  sha256Hex,
  verifyDiamondLedger,
  type DiamondCommand,
  type DiamondCommandPayloadMap,
  type DiamondCommandType,
  type DiamondCoverageMap,
  type DiamondCheckpoint,
  type DiamondCommandReceipt,
  type DiamondExecution,
  type DiamondGameState,
  type DiamondLedger,
  type DiamondPlayerRawStats
} from './index';

const SCORER = 'scorer-1';

function uuid(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function harness(profileId = 'baseball-nfhs', captureMode: 'quick' | 'full' = 'full') {
  let ledger = createDiamondLedger({
    teamId: 'team-1',
    gameId: 'game-1',
    rulesProfileId: profileId,
    rulesProfileVersion: 1,
    captureMode
  });
  let nextId = 1;

  const command = <K extends DiamondCommandType>(
    type: K,
    payload: DiamondCommandPayloadMap[K],
    overrides: Partial<Pick<DiamondCommand, 'commandId' | 'expectedRevision'>> = {}
  ) =>
    ({
      schemaVersion: DIAMOND_SCHEMA_VERSION,
      commandId: overrides.commandId ?? uuid(nextId),
      teamId: ledger.teamId,
      gameId: ledger.gameId,
      expectedRevision: overrides.expectedRevision ?? ledger.state.revision,
      rulesProfileId: ledger.rulesProfileId,
      rulesProfileVersion: ledger.rulesProfileVersion,
      type,
      payload
    }) as DiamondCommand;

  const submit = <K extends DiamondCommandType>(
    type: K,
    payload: DiamondCommandPayloadMap[K],
    options: Readonly<{ actorUid?: string; accept?: boolean }> = {}
  ): DiamondExecution => {
    const id = nextId;
    const execution = executeDiamondCommand(ledger, command(type, payload), {
      actorUid: options.actorUid ?? SCORER,
      eventId: `event-${String(id)}`,
      serverTimestampMs: 1_700_000_000_000 + id
    });
    nextId += 1;
    if (options.accept !== false) {
      expect(execution.result, execution.result.rejection?.message).toMatchObject({ outcome: 'accepted' });
      ledger = execution.ledger;
    }
    return execution;
  };

  return {
    get ledger() {
      return ledger;
    },
    set ledger(value: DiamondLedger) {
      ledger = value;
    },
    command,
    submit
  };
}

function setBasicLineups(game: ReturnType<typeof harness>) {
  game.submit('activate', { initialScorerUid: SCORER, captureMode: game.ledger.captureMode });
  game.submit('set_lineup', {
    side: 'home',
    entries: [
      { slot: 1, playerId: 'home-1' },
      { slot: 2, playerId: 'home-2' },
      { slot: 3, playerId: 'home-3' }
    ]
  });
  game.submit('set_lineup', {
    side: 'away',
    entries: [
      { slot: 1, playerId: 'away-1' },
      { slot: 2, playerId: 'away-2' },
      { slot: 3, playerId: 'away-3' }
    ]
  });
  game.submit('set_defensive_alignment', {
    side: 'home',
    assignments: [
      { playerId: 'home-1', position: 'P' },
      { playerId: 'home-2', position: 'C' },
      { playerId: 'home-3', position: 'SS' }
    ]
  });
  game.submit('set_defensive_alignment', {
    side: 'away',
    assignments: [
      { playerId: 'away-1', position: 'P' },
      { playerId: 'away-2', position: 'C' },
      { playerId: 'away-3', position: 'SS' }
    ]
  });
  game.submit('start', {});
}

function recordPitch(game: ReturnType<typeof harness>, batterId: string, pitcherId: string, result: 'ball' | 'in_play' = 'in_play') {
  game.submit('record_pitch', { batterId, pitcherId, result });
}

function buildGoldenGame() {
  const game = harness();
  setBasicLineups(game);

  recordPitch(game, 'away-1', 'home-1');
  game.submit('record_plate_appearance', {
    batterId: 'away-1',
    pitcherId: 'home-1',
    result: 'single',
    batterAdvance: { to: 'first' },
    runnerAdvances: [],
    outsOnPlay: 0
  });

  recordPitch(game, 'away-2', 'home-1');
  const doubleEvent = game.submit('record_plate_appearance', {
    batterId: 'away-2',
    pitcherId: 'home-1',
    result: 'double',
    batterAdvance: { to: 'second' },
    runnerAdvances: [
      {
        runnerId: 'away-1',
        from: 'first',
        to: 'home',
        cause: 'batted_ball',
        countsRun: true,
        earned: true,
        rbi: true
      }
    ],
    outsOnPlay: 0,
    runsBattedIn: 1
  });

  recordPitch(game, 'away-3', 'home-1');
  game.submit('record_plate_appearance', {
    batterId: 'away-3',
    pitcherId: 'home-1',
    result: 'ground_out',
    batterAdvance: { to: 'out', outKind: 'batter_runner' },
    runnerAdvances: [
      {
        runnerId: 'away-2',
        from: 'second',
        to: 'third',
        cause: 'batted_ball'
      }
    ],
    outsOnPlay: 1,
    fielding: { putoutBy: 'home-2', assists: ['home-3'], battedBall: 'ground' }
  });

  game.submit('advance_runner', {
    runnerId: 'away-2',
    from: 'third',
    to: 'home',
    cause: 'wild_pitch',
    countsRun: true,
    earned: true,
    rbi: false
  });

  for (let ball = 0; ball < 4; ball += 1) recordPitch(game, 'away-1', 'home-1', 'ball');
  game.submit('record_plate_appearance', {
    batterId: 'away-1',
    pitcherId: 'home-1',
    result: 'walk',
    batterAdvance: { to: 'first' },
    runnerAdvances: [],
    outsOnPlay: 0
  });

  recordPitch(game, 'away-2', 'home-1');
  game.submit('record_plate_appearance', {
    batterId: 'away-2',
    pitcherId: 'home-1',
    result: 'double_play',
    batterAdvance: { to: 'out', outKind: 'batter_runner' },
    runnerAdvances: [
      {
        runnerId: 'away-1',
        from: 'first',
        to: 'out',
        cause: 'force_out',
        outKind: 'force'
      }
    ],
    outsOnPlay: 2,
    fielding: {
      putoutBy: 'home-2',
      assists: ['home-3'],
      doublePlay: true,
      battedBall: 'ground'
    }
  });

  game.submit('advance_half_inning', {});
  recordPitch(game, 'home-1', 'away-1');
  game.submit('record_plate_appearance', {
    batterId: 'home-1',
    pitcherId: 'away-1',
    result: 'home_run',
    batterAdvance: {
      to: 'home',
      cause: 'batted_ball',
      countsRun: true,
      earned: true,
      rbi: true
    },
    runnerAdvances: [],
    outsOnPlay: 0,
    runsBattedIn: 1
  });
  game.submit('finalize', { confirmed: true });
  return { game, doubleEventId: doubleEvent.event!.eventId };
}

describe('Diamond rules and canonical contracts', () => {
  it('publishes exact immutable default youth profile IDs for team setup', () => {
    expect(getDiamondRulesProfile('baseball-youth', 1)).toMatchObject({ sport: 'baseball', version: 1 });
    expect(getDiamondRulesProfile('fastpitch-youth', 1)).toMatchObject({ sport: 'fastpitch', version: 1 });
    expect(getDiamondRulesProfile('baseball-youth', 2)).toBeNull();
    expect(listDiamondRulesProfiles()).toHaveLength(5);
    expect(Object.isFrozen(listDiamondRulesProfiles())).toBe(true);
    expect(Object.isFrozen(getDiamondRulesProfile('fastpitch-nfhs', 1)?.dpFlex)).toBe(true);
  });

  it('canonicalizes object keys and uses stable browser-safe SHA-256', () => {
    expect(canonicalDiamondJson({ z: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"z":1}');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('labels Quick and Full capture without fabricating unavailable sensor data', () => {
    const quick = harness('baseball-youth', 'quick').ledger.state.coverage;
    const full = harness('fastpitch-youth', 'full').ledger.state.coverage;
    expect(quick).toEqual({
      batting: 'complete',
      baserunning: 'complete',
      pitching: 'partial',
      fielding: 'not_collected',
      situational: 'partial',
      pitches: 'not_collected',
      sensors: 'not_collected'
    });
    expect(full).toEqual({
      batting: 'complete',
      baserunning: 'complete',
      pitching: 'complete',
      fielding: 'complete',
      situational: 'complete',
      pitches: 'complete',
      sensors: 'not_collected'
    });
  });
});

describe('Diamond command ledger', () => {
  it('accepts a command once, returns the original result for an identical retry, and rejects conflicts/stale writers', () => {
    const game = harness();
    const activate = game.command('activate', { initialScorerUid: SCORER, captureMode: 'full' });
    const first = executeDiamondCommand(game.ledger, activate, {
      actorUid: SCORER,
      eventId: 'activate-event',
      serverTimestampMs: 1
    });
    expect(first.result.outcome).toBe('accepted');
    expect(first.ledger.state.revision).toBe(1);
    expect(Object.isFrozen(first.ledger.state)).toBe(true);

    const duplicate = executeDiamondCommand(first.ledger, activate, {
      actorUid: SCORER,
      eventId: 'ignored-retry-event',
      serverTimestampMs: 2
    });
    expect(duplicate.result).toMatchObject({ outcome: 'duplicate', revision: 1, eventId: 'activate-event' });
    expect(duplicate.ledger).toBe(first.ledger);

    const conflict = executeDiamondCommand(
      first.ledger,
      {
        ...activate,
        payload: { initialScorerUid: SCORER, captureMode: 'quick' }
      } as DiamondCommand,
      {
        actorUid: SCORER,
        eventId: 'conflict-event',
        serverTimestampMs: 3
      }
    );
    expect(conflict.result.rejection).toMatchObject({ code: 'idempotency-conflict', retryable: false });

    const stale = executeDiamondCommand(
      first.ledger,
      {
        ...game.command('private_note', { text: 'private scorer note' }),
        commandId: uuid(99),
        expectedRevision: 0
      },
      {
        actorUid: SCORER,
        eventId: 'stale-event',
        serverTimestampMs: 4
      }
    );
    expect(stale.result.rejection).toMatchObject({ code: 'stale-revision', retryable: true });
  });

  it('keeps the prior state immutable and enforces scorer handoff', () => {
    const game = harness();
    const before = game.ledger.state;
    game.submit('activate', { initialScorerUid: SCORER, captureMode: 'full' });
    expect(before).toMatchObject({ lifecycle: 'configured', revision: 0, currentScorerUid: null });
    expect(game.ledger.state).toMatchObject({ lifecycle: 'ready', revision: 1, currentScorerUid: SCORER });

    game.submit('scorer_handoff', { toUid: 'scorer-2' });
    const oldScorer = game.submit('private_note', { text: 'must not land' }, { accept: false });
    expect(oldScorer.result.rejection).toMatchObject({ code: 'scorer-lease-lost', retryable: true });
    const newScorer = game.submit('private_note', { text: 'private handoff note' }, { actorUid: 'scorer-2' });
    expect(newScorer.result.outcome).toBe('accepted');
  });

  it('rejects malformed command IDs before state mutation', () => {
    const game = harness();
    const command = { ...game.command('activate', { initialScorerUid: SCORER, captureMode: 'full' }), commandId: 'timestamp-123' };
    const result = executeDiamondCommand(game.ledger, command, {
      actorUid: SCORER,
      eventId: 'event-1',
      serverTimestampMs: 1
    });
    expect(result.result.rejection?.code).toBe('invalid-command-id');
    expect(result.ledger.state.revision).toBe(0);
  });

  it('detects any canonical event mutation through the replay hash chain', () => {
    const game = harness();
    game.submit('activate', { initialScorerUid: SCORER, captureMode: 'full' });
    const original = game.ledger.events[0];
    const tampered = {
      ...game.ledger,
      events: [{ ...original, actorUid: 'different-actor' }]
    } as DiamondLedger;
    expect(() => replayDiamondLedger(tampered)).toThrow(/failed hash verification/i);
  });

  it('produces byte-identical events from bounded checkpoints and refuses history-dependent corrections', () => {
    let fullLedger = createDiamondLedger({
      teamId: 'team-1',
      gameId: 'game-1',
      rulesProfileId: 'baseball-youth',
      rulesProfileVersion: 1,
      captureMode: 'quick'
    });
    let checkpoint: DiamondCheckpoint = createDiamondCheckpoint(fullLedger);
    let receipt: DiamondCommandReceipt | undefined;
    let lastCommand: DiamondCommand | undefined;
    let index = 200;

    const compare = <K extends DiamondCommandType>(type: K, payload: DiamondCommandPayloadMap[K]) => {
      const command = {
        schemaVersion: DIAMOND_SCHEMA_VERSION,
        commandId: uuid(index),
        teamId: checkpoint.teamId,
        gameId: checkpoint.gameId,
        expectedRevision: checkpoint.sequence,
        rulesProfileId: checkpoint.rulesProfileId,
        rulesProfileVersion: checkpoint.rulesProfileVersion,
        type,
        payload
      } as DiamondCommand;
      const context = {
        actorUid: SCORER,
        eventId: `checkpoint-event-${String(index)}`,
        serverTimestampMs: 1_800_000_000_000 + index
      };
      const full = executeDiamondCommand(fullLedger, command, context);
      const bounded = executeDiamondCommandFromCheckpoint(checkpoint, command, context);
      expect(full.result, full.result.rejection?.message).toMatchObject({ outcome: 'accepted' });
      expect(bounded.result, bounded.result.rejection?.message).toMatchObject({ outcome: 'accepted' });
      expect(bounded.event).toEqual(full.event);
      expect(bounded.checkpoint.state).toEqual(full.ledger.state);
      fullLedger = full.ledger;
      checkpoint = bounded.checkpoint;
      receipt = bounded.receipt;
      lastCommand = command;
      index += 1;
    };

    compare('activate', { initialScorerUid: SCORER, captureMode: 'quick' });
    compare('set_lineup', { side: 'home', entries: [{ slot: 1, playerId: 'home-1' }] });
    compare('set_lineup', { side: 'away', entries: [{ slot: 1, playerId: 'away-1' }] });
    compare('set_defensive_alignment', {
      side: 'home',
      assignments: [{ playerId: 'home-1', position: 'P' }]
    });
    compare('set_defensive_alignment', {
      side: 'away',
      assignments: [{ playerId: 'away-1', position: 'P' }]
    });
    compare('start', {});
    compare('record_pitch', { batterId: 'away-1', pitcherId: 'home-1', result: 'in_play' });
    compare('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });

    const duplicate = executeDiamondCommandFromCheckpoint(
      checkpoint,
      lastCommand!,
      { actorUid: SCORER, eventId: 'ignored-duplicate-event', serverTimestampMs: 1_900_000_000_000 },
      receipt
    );
    expect(duplicate.result).toMatchObject({ outcome: 'duplicate', eventId: receipt!.event.eventId });
    expect(duplicate.checkpoint).toBe(checkpoint);

    const correction = {
      schemaVersion: DIAMOND_SCHEMA_VERSION,
      commandId: uuid(index),
      teamId: checkpoint.teamId,
      gameId: checkpoint.gameId,
      expectedRevision: checkpoint.sequence,
      rulesProfileId: checkpoint.rulesProfileId,
      rulesProfileVersion: checkpoint.rulesProfileVersion,
      type: 'void_event',
      payload: { targetEventId: receipt!.event.eventId, reason: 'Requires full replay' }
    } as const satisfies DiamondCommand;
    const correctionResult = executeDiamondCommandFromCheckpoint(checkpoint, correction, {
      actorUid: SCORER,
      eventId: 'bounded-correction-event',
      serverTimestampMs: 1_900_000_000_001
    });
    expect(correctionResult.result.rejection).toMatchObject({ code: 'history-required', retryable: true });
    expect(correctionResult.checkpoint).toBe(checkpoint);
  });

  it('replays more than 1,500 immutable events from zero without a bounded-window shortcut', () => {
    const game = harness('baseball-youth', 'quick');
    setBasicLineups(game);
    for (let index = 0; index < 1_501; index += 1) {
      game.submit('private_note', { text: `Bounded replay fixture ${String(index)}` });
    }
    expect(game.ledger.events.length).toBeGreaterThan(1_500);
    const replay = replayDiamondLedger(game.ledger);
    expect(replay.complete).toBe(true);
    expect(replay.state.revision).toBe(game.ledger.events.length);
    expect(replay.state.checkpointHash).toBe(game.ledger.state.checkpointHash);
  }, 20_000);
});

describe('Diamond reducer and golden stats', () => {
  it('replays a multi-inning complex game byte-for-byte and projects traceable traditional stats', () => {
    const { game } = buildGoldenGame();
    expect(game.ledger.state).toMatchObject({
      lifecycle: 'final',
      score: { away: 2, home: 1 },
      inning: { number: 1, half: 'bottom', outs: 0 },
      coverage: {
        batting: 'complete',
        pitching: 'complete',
        fielding: 'complete',
        pitches: 'complete',
        sensors: 'not_collected'
      }
    });
    expect(game.ledger.state.checkpointHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(verifyDiamondLedger(game.ledger)).toBe(true);
    const replay = replayDiamondLedger(game.ledger);
    expect(replay.state).toEqual(game.ledger.state);
    expect(replay.effectiveEvents).toHaveLength(game.ledger.events.length);

    const stats = projectDiamondStats(game.ledger);
    expect(stats).toMatchObject({
      sourceRevision: game.ledger.state.revision,
      checkpointHash: game.ledger.state.checkpointHash,
      teams: {
        away: { R: 2, H: 2, E: 0, LOB: 0 },
        home: { R: 1, H: 1, E: 0 }
      }
    });
    expect(stats.players['away-2'].raw.batting).toMatchObject({
      PA: 2,
      AB: 2,
      H: 1,
      '2B': 1,
      TB: 2,
      RBI: 1,
      GIDP: 1
    });
    expect(stats.players['home-1'].raw.pitching).toMatchObject({
      BF: 5,
      outs: 3,
      H: 2,
      R: 2,
      ER: 2,
      BB: 1,
      pitches: 8,
      strikes: 4,
      WP: 1
    });
    expect(stats.players['home-1'].derived).toMatchObject({ inningsPitched: '1.0', ERA: 14, WHIP: 3 });
    expect(stats.players['away-2'].sources['batting.H']).toHaveLength(1);
    expect(stats.players['away-2'].sources['batting.GIDP']).toHaveLength(1);
    expect(stats.players['home-1'].raw.batting).toMatchObject({ H: 1, HR: 1, TB: 4 });
    expect(stats.players['home-1'].sources['batting.HR']).toHaveLength(1);
  });

  it('requires explicit run timing on a third-out play', () => {
    const game = harness('baseball-youth', 'quick');
    setBasicLineups(game);
    const active = {
      ...game.ledger.state,
      inning: { ...game.ledger.state.inning, outs: 2 },
      bases: {
        ...game.ledger.state.bases,
        third: {
          runnerId: 'away-2',
          chargedToPitcherId: 'home-1',
          courtesyForPlayerId: null,
          reachedOnEventId: 'seed'
        }
      }
    } satisfies DiamondGameState;
    expect(() =>
      reduceDiamondEvent(active, {
        type: 'record_plate_appearance',
        eventId: 'timing-play',
        payload: {
          batterId: 'away-1',
          pitcherId: 'home-1',
          result: 'ground_out',
          batterAdvance: { to: 'out', outKind: 'batter_runner' },
          runnerAdvances: [{ runnerId: 'away-2', from: 'third', to: 'home', cause: 'batted_ball' }],
          outsOnPlay: 1
        }
      })
    ).toThrow(/explicitly declare whether it counts/i);
  });

  it('enforces dropped-third-strike eligibility', () => {
    const game = harness('baseball-nfhs', 'quick');
    setBasicLineups(game);
    game.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    const rejected = game.submit(
      'record_plate_appearance',
      {
        batterId: 'away-2',
        pitcherId: 'home-1',
        result: 'dropped_third_strike',
        batterAdvance: { to: 'first' },
        runnerAdvances: [],
        outsOnPlay: 0
      },
      { accept: false }
    );
    expect(rejected.result.rejection?.code).toBe('dropped-third-strike-ineligible');
  });

  it('marks silently skipped Full-mode inputs partial instead of converting missing observations to zero', () => {
    const game = harness('baseball-nfhs', 'full');
    setBasicLineups(game);
    game.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'ground_out',
      batterAdvance: { to: 'out' },
      runnerAdvances: [],
      outsOnPlay: 1
    });
    expect(game.ledger.state.coverage).toMatchObject({ pitches: 'partial', fielding: 'partial' });
  });
});

describe('Append-only corrections', () => {
  it('voids an event through a later directive while preserving both canonical records', () => {
    const game = harness('baseball-youth', 'quick');
    setBasicLineups(game);
    const note = game.submit('private_note', { text: 'Temporary scorer-only note' });
    game.submit('void_event', { targetEventId: note.event!.eventId, reason: 'Entered on the wrong play' });
    expect(game.ledger.events.map((event) => event.type).slice(-2)).toEqual(['private_note', 'void_event']);
    expect(getEffectiveDiamondEvents(game.ledger.events).some((event) => event.sourceEventId === note.event!.eventId)).toBe(false);
    expect(verifyDiamondLedger(game.ledger)).toBe(true);
  });

  it('supersedes an event without rewriting history and rebuilds state, stats, and hashes', () => {
    const { game, doubleEventId } = buildGoldenGame();
    const beforeEvents = game.ledger.events;
    const beforeHash = game.ledger.state.checkpointHash;
    game.submit('reopen_for_correction', { reason: 'Official scorer correction' });
    game.submit('supersede_event', {
      targetEventId: doubleEventId,
      reason: 'Reached on a throwing error, not a hit',
      replacement: {
        type: 'record_plate_appearance',
        payload: {
          batterId: 'away-2',
          pitcherId: 'home-1',
          result: 'reached_on_error',
          batterAdvance: { to: 'second' },
          runnerAdvances: [
            {
              runnerId: 'away-1',
              from: 'first',
              to: 'home',
              cause: 'error',
              countsRun: true,
              earned: false,
              rbi: false
            }
          ],
          outsOnPlay: 0,
          runsBattedIn: 0,
          fielding: { errors: [{ playerId: 'home-3', kind: 'throwing' }] }
        }
      }
    });
    game.submit('finalize', { confirmed: true });

    expect(game.ledger.events.slice(0, beforeEvents.length)).toEqual(beforeEvents);
    expect(game.ledger.events.find((event) => event.eventId === doubleEventId)?.type).toBe('record_plate_appearance');
    expect(game.ledger.events.some((event) => event.supersedesEventId === doubleEventId)).toBe(true);
    expect(game.ledger.state.checkpointHash).not.toBe(beforeHash);
    expect(verifyDiamondLedger(game.ledger)).toBe(true);

    const stats = projectDiamondStats(game.ledger);
    expect(stats.players['away-2'].raw.batting).toMatchObject({ H: 0, '2B': 0, ROE: 1, RBI: 0 });
    expect(stats.players['home-3'].raw.fielding.E).toBe(1);
  });

  it('rejects a correction atomically when later canonical plays would no longer replay', () => {
    const { game, doubleEventId } = buildGoldenGame();
    game.submit('reopen_for_correction', { reason: 'Try a conflicting edit' });
    const revision = game.ledger.state.revision;
    const rejected = game.submit(
      'supersede_event',
      {
        targetEventId: doubleEventId,
        reason: 'This would invalidate the next runner source',
        replacement: {
          type: 'record_plate_appearance',
          payload: {
            batterId: 'away-2',
            pitcherId: 'home-1',
            result: 'triple',
            batterAdvance: { to: 'third' },
            runnerAdvances: [
              {
                runnerId: 'away-1',
                from: 'first',
                to: 'home',
                cause: 'batted_ball',
                countsRun: true,
                earned: true,
                rbi: true
              }
            ],
            outsOnPlay: 0,
            runsBattedIn: 1
          }
        }
      },
      { accept: false }
    );
    expect(rejected.result.outcome).toBe('rejected');
    expect(rejected.result.rejection?.code).toBe('runner-not-on-base');
    expect(rejected.ledger.state.revision).toBe(revision);
  });
});

describe('Fastpitch-specific rules', () => {
  it('models DP/FLEX, courtesy runners, and the one-time NFHS starter re-entry', () => {
    const game = harness('fastpitch-nfhs', 'quick');
    setBasicLineups(game);
    // DP/FLEX may be established after start for a scorer correction to the initial alignment.
    game.submit('set_dp_flex', {
      side: 'home',
      dpPlayerId: 'home-1',
      flexPlayerId: 'home-flex',
      dpBattingSlot: 1,
      flexDefensivePosition: 'RF'
    });
    game.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    game.submit('add_courtesy_runner', {
      side: 'away',
      forPlayerId: 'away-1',
      runnerId: 'away-courtesy',
      base: 'first',
      forRole: 'pitcher'
    });
    expect(game.ledger.state.bases.first).toMatchObject({
      runnerId: 'away-courtesy',
      courtesyForPlayerId: 'away-1'
    });

    game.submit('substitute', {
      side: 'away',
      battingSlot: 1,
      outgoingPlayerId: 'away-1',
      incomingPlayerId: 'away-sub'
    });
    game.submit('re_enter', {
      side: 'away',
      battingSlot: 1,
      starterPlayerId: 'away-1',
      replacedPlayerId: 'away-sub'
    });
    game.submit('substitute', {
      side: 'away',
      battingSlot: 1,
      outgoingPlayerId: 'away-1',
      incomingPlayerId: 'away-sub-2'
    });
    const secondReentry = game.submit(
      're_enter',
      {
        side: 'away',
        battingSlot: 1,
        starterPlayerId: 'away-1',
        replacedPlayerId: 'away-sub-2'
      },
      { accept: false }
    );
    expect(secondReentry.result.rejection?.code).toBe('reentry-limit');
  });

  it('rejects DP/FLEX under a baseball profile and validates the configured tiebreaker base', () => {
    const baseball = harness('baseball-nfhs', 'quick');
    setBasicLineups(baseball);
    const rejected = baseball.submit(
      'set_dp_flex',
      {
        side: 'home',
        dpPlayerId: 'home-1',
        flexPlayerId: 'home-flex',
        dpBattingSlot: 1,
        flexDefensivePosition: 'RF'
      },
      { accept: false }
    );
    expect(rejected.result.rejection?.code).toBe('rule-not-enabled');

    const fastpitch = harness('fastpitch-nfhs', 'quick');
    setBasicLineups(fastpitch);
    const extraInningState = {
      ...fastpitch.ledger.state,
      inning: { ...fastpitch.ledger.state.inning, number: 8 }
    } satisfies DiamondGameState;
    const withRunner = reduceDiamondEvent(extraInningState, {
      type: 'place_tiebreaker_runner',
      eventId: 'tiebreaker-event',
      payload: { side: 'away', runnerId: 'away-3', base: 'second' }
    });
    expect(withRunner.bases.second?.runnerId).toBe('away-3');
  });
});

describe('Traditional formula helpers', () => {
  const complete: DiamondCoverageMap = {
    batting: 'complete',
    baserunning: 'complete',
    pitching: 'complete',
    fielding: 'complete',
    situational: 'complete',
    pitches: 'complete',
    sensors: 'not_collected'
  };

  const raw: DiamondPlayerRawStats = {
    batting: {
      G: 1,
      GS: 1,
      PA: 10,
      AB: 8,
      R: 2,
      H: 3,
      '1B': 1,
      '2B': 1,
      '3B': 0,
      HR: 1,
      TB: 7,
      RBI: 3,
      BB: 1,
      IBB: 0,
      HBP: 0,
      SO: 2,
      SF: 1,
      SH: 0,
      ROE: 0,
      FC: 0,
      GIDP: 0
    },
    baserunning: { SB: 3, CS: 1, pickoffs: 0, advances: 4, outs: 1 },
    pitching: {
      APP: 1,
      GS: 1,
      W: 1,
      L: 0,
      SV: 0,
      BF: 12,
      outs: 4,
      H: 2,
      R: 2,
      ER: 2,
      BB: 1,
      IBB: 0,
      HBP: 0,
      SO: 4,
      HR: 0,
      WP: 0,
      balkIllegalPitch: 0,
      inheritedRunners: 0,
      inheritedScored: 0,
      pitches: 20,
      strikes: 13,
      firstPitchStrikes: 8
    },
    fielding: { defensiveOuts: 4, PO: 2, A: 1, E: 1, DP: 0, TP: 0, PB: 0 }
  };

  it('uses unrounded counters, outs-based innings, and the selected ERA innings basis', () => {
    const derived = deriveDiamondPlayerStats(raw, complete, 7);
    expect(derived).toMatchObject({
      AVG: 3 / 8,
      OBP: 4 / 10,
      SLG: 7 / 8,
      OPS: 1.275,
      stolenBaseRate: 3 / 4,
      inningsPitched: '1.1',
      ERA: 10.5,
      WHIP: 2.25,
      strikeoutWalkRatio: 4,
      strikeRate: 13 / 20,
      fieldingPercentage: 3 / 4,
      chances: 4
    });
    expect(formatInningsPitched(14)).toBe('4.2');
    expect(formatDiamondRate(3 / 8)).toBe('.375');
  });

  it('renders zero denominators and incomplete families as unavailable, never numeric zero', () => {
    const empty = deriveDiamondPlayerStats(
      {
        batting: { ...raw.batting, PA: 0, AB: 0, H: 0, TB: 0, BB: 0, IBB: 0, HBP: 0, SF: 0 },
        baserunning: { ...raw.baserunning, SB: 0, CS: 0 },
        pitching: { ...raw.pitching, outs: 0, BB: 0, IBB: 0, H: 0, SO: 0, pitches: 0, BF: 0 },
        fielding: { ...raw.fielding, PO: 0, A: 0, E: 0 }
      },
      complete,
      7
    );
    expect(empty).toMatchObject({ AVG: null, OBP: null, SLG: null, OPS: null, ERA: null, WHIP: null });
    expect(formatDiamondRate(empty.AVG)).toBe('—');

    const partial = deriveDiamondPlayerStats(
      raw,
      {
        ...complete,
        pitching: 'partial',
        fielding: 'not_collected'
      },
      7
    );
    expect(partial).toMatchObject({ ERA: null, WHIP: null, fieldingPercentage: null });
  });
});
