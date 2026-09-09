import { describe, expect, it } from 'vitest';
import {
  DIAMOND_SCHEMA_VERSION,
  createDiamondCheckpoint,
  createDiamondLedger,
  deriveDiamondPlayerStats,
  executeDiamondCommand,
  executeDiamondCommandFromCheckpoint,
  formatDiamondRate,
  formatInningsPitched,
  getBattingSide,
  getEffectiveDiamondEvents,
  isBattingQualified,
  projectDiamondStats,
  replayDiamondLedger,
  requireDiamondRulesProfile,
  verifyDiamondLedger,
  type DiamondCaptureMode,
  type DiamondBase,
  type DiamondBattingRole,
  type DiamondCommand,
  type DiamondCommandPayloadMap,
  type DiamondCommandType,
  type DiamondCoverageMap,
  type DiamondDestination,
  type DiamondExecution,
  type DiamondLedger,
  type DiamondPlayerRawStats,
  type DiamondPlayerStatLine,
  type DiamondRulesProfile,
  type DiamondSide
} from './index';

const INITIAL_SCORER = 'scorer-1';

const COMMAND_GOLDEN_INVENTORY = {
  activate: 'fixture setup',
  set_lineup: 'fixture setup',
  set_defensive_alignment: 'fixture setup',
  set_dp_flex: 'fastpitch DP/FLEX',
  start: 'fixture setup',
  record_pitch: 'full-capture and illegal-pitch fixtures',
  record_plate_appearance: 'all game fixtures',
  advance_runner: 'courtesy-runner fixture',
  record_fielding: 'pitcher-responsibility fixture',
  record_scoring_judgment: 'pitcher-responsibility fixture',
  advance_half_inning: 'multi-inning fixtures',
  place_tiebreaker_runner: 'fastpitch tiebreaker fixture',
  substitute: 'pitcher-responsibility and re-entry fixtures',
  re_enter: 'fastpitch re-entry fixture',
  add_courtesy_runner: 'fastpitch courtesy-runner fixture',
  scorer_handoff: 'fastpitch lifecycle fixture',
  suspend: 'fastpitch lifecycle fixture',
  resume: 'fastpitch lifecycle fixture',
  cancel: 'manager-authorized cancellation fixture',
  finalize: 'walkoff, mercy, and correction fixtures',
  reopen_for_correction: 'correction fixture',
  private_note: 'correction fixture',
  rules_decision: 'coverage fixture',
  void_event: 'correction fixture',
  supersede_event: 'correction fixture'
} as const satisfies Record<DiamondCommandType, string>;

type RuleBehavior = 'identity' | 'enforced' | 'stats' | 'explicit-decision' | 'advisory' | 'partially-enforced';

const RULE_BEHAVIOR_INVENTORY = {
  id: 'identity',
  version: 'identity',
  name: 'identity',
  sport: 'identity',
  scheduledInnings: 'enforced',
  eraInningsBasis: 'stats',
  timeLimitMinutes: 'explicit-decision',
  inningRunLimit: 'explicit-decision',
  runAheadRules: 'enforced',
  tiebreaker: 'enforced',
  continuousBatting: 'advisory',
  freeSubstitution: 'partially-enforced',
  starterReentryLimit: 'partially-enforced',
  allowsDh: 'partially-enforced',
  allowsEh: 'partially-enforced',
  allowsEp: 'partially-enforced',
  dpFlex: 'partially-enforced',
  courtesyRunner: 'partially-enforced',
  droppedThirdStrike: 'enforced',
  illegalPitchPolicy: 'partially-enforced',
  lookBackRule: 'advisory',
  leavingEarlyRule: 'advisory'
} as const satisfies Record<keyof DiamondRulesProfile, RuleBehavior>;

function uuid(index: number) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function createHarness(profileId = 'baseball-nfhs', captureMode: DiamondCaptureMode = 'quick', seed?: DiamondLedger) {
  let ledger =
    seed ??
    createDiamondLedger({
      teamId: 'golden-team',
      gameId: 'golden-game',
      rulesProfileId: profileId,
      rulesProfileVersion: 1,
      captureMode
    });
  let nextId = ledger.events.length + 1;
  let activeScorer = ledger.state.currentScorerUid ?? INITIAL_SCORER;

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
    options: Readonly<{ actorUid?: string; accept?: boolean; managerAuthorized?: boolean }> = {}
  ): DiamondExecution => {
    const id = nextId;
    const execution = executeDiamondCommand(ledger, command(type, payload), {
      actorUid: options.actorUid ?? activeScorer,
      eventId: `golden-event-${String(id)}`,
      serverTimestampMs: 1_900_000_000_000 + id,
      ...(options.managerAuthorized === undefined ? {} : { managerAuthorized: options.managerAuthorized })
    });
    nextId += 1;
    if (options.accept !== false) {
      expect(execution.result, execution.result.rejection?.message).toMatchObject({ outcome: 'accepted' });
      ledger = execution.ledger;
      if (type === 'scorer_handoff') {
        activeScorer = (payload as DiamondCommandPayloadMap['scorer_handoff']).toUid;
      }
    }
    return execution;
  };

  return {
    get ledger() {
      return ledger;
    },
    command,
    submit
  };
}

type Harness = ReturnType<typeof createHarness>;

function setLineups(
  game: Harness,
  lineupSize = 6,
  options: Readonly<{ dpSide?: DiamondSide; firstBattingRole?: DiamondBattingRole }> = {}
) {
  const entries = (side: DiamondSide) =>
    Array.from({ length: lineupSize }, (_, index) => ({
      slot: index + 1,
      playerId: `${side}-${String(index + 1)}`,
      ...(index === 0 && (options.dpSide === side || options.firstBattingRole)
        ? { battingRole: options.dpSide === side ? ('dp' as const) : options.firstBattingRole }
        : {})
    }));

  game.submit('activate', { initialScorerUid: INITIAL_SCORER, captureMode: game.ledger.captureMode });
  game.submit('set_lineup', { side: 'home', entries: entries('home') });
  game.submit('set_lineup', { side: 'away', entries: entries('away') });
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
}

function configureGame(game: Harness, options: Readonly<{ lineupSize?: number; start?: boolean; dpSide?: DiamondSide }> = {}) {
  setLineups(game, options.lineupSize, { dpSide: options.dpSide });
  if (options.start !== false) game.submit('start', {});
}

function currentMatchup(game: Harness) {
  const battingSide = getBattingSide(game.ledger.state);
  const fieldingSide: DiamondSide = battingSide === 'home' ? 'away' : 'home';
  const lineup = game.ledger.state.lineups[battingSide].battingOrder;
  const batterId = lineup[game.ledger.state.nextBatterSlot[battingSide]]?.activePlayerId;
  const pitcherId = game.ledger.state.lineups[fieldingSide].defense.P;
  if (!batterId || !pitcherId) throw new Error('Golden fixture requires a current batter and pitcher.');
  return { battingSide, fieldingSide, batterId, pitcherId };
}

function previousScheduledBatterId(game: Harness, side: DiamondSide) {
  const order = game.ledger.state.lineups[side].battingOrder;
  const previousIndex = (game.ledger.state.nextBatterSlot[side] - 1 + order.length) % order.length;
  const playerId = order[previousIndex]?.activePlayerId;
  if (!playerId) throw new Error('Golden fixture requires a previous scheduled batter.');
  return playerId;
}

function recordPitch(game: Harness, result: DiamondCommandPayloadMap['record_pitch']['result'] = 'in_play') {
  const { batterId, pitcherId } = currentMatchup(game);
  game.submit('record_pitch', { batterId, pitcherId, result });
}

function recordOut(game: Harness) {
  const matchup = currentMatchup(game);
  if (game.ledger.captureMode === 'full') recordPitch(game);
  const defense = game.ledger.state.lineups[matchup.fieldingSide].defense;
  game.submit('record_plate_appearance', {
    batterId: matchup.batterId,
    pitcherId: matchup.pitcherId,
    result: 'ground_out',
    batterAdvance: { to: 'out', outKind: 'batter_runner' },
    runnerAdvances: [],
    outsOnPlay: 1,
    ...(game.ledger.captureMode === 'full'
      ? {
          fielding: {
            putoutBy: defense.C,
            assists: defense.SS ? [defense.SS] : [],
            battedBall: 'ground' as const
          }
        }
      : {})
  });
}

function placeRunnerOnBase(game: Harness, base: DiamondBase) {
  const { batterId, pitcherId } = currentMatchup(game);
  const result = base === 'first' ? ('single' as const) : base === 'second' ? ('double' as const) : ('triple' as const);
  game.submit('record_plate_appearance', {
    batterId,
    pitcherId,
    result,
    batterAdvance: { to: base },
    runnerAdvances: [],
    outsOnPlay: 0
  });
  return batterId;
}

function finishAndAdvanceHalf(game: Harness) {
  while (game.ledger.state.inning.outs < 3) recordOut(game);
  game.submit('advance_half_inning', {});
}

function halfOrdinal(inning: number, half: 'top' | 'bottom') {
  return (inning - 1) * 2 + (half === 'bottom' ? 1 : 0);
}

function advanceToHalf(game: Harness, inning: number, half: 'top' | 'bottom') {
  const target = halfOrdinal(inning, half);
  while (halfOrdinal(game.ledger.state.inning.number, game.ledger.state.inning.half) < target) {
    finishAndAdvanceHalf(game);
  }
  expect(game.ledger.state.inning).toMatchObject({ number: inning, half });
}

function recordSoloHomeRun(game: Harness) {
  const { batterId, pitcherId } = currentMatchup(game);
  if (game.ledger.captureMode === 'full') recordPitch(game);
  game.submit('record_plate_appearance', {
    batterId,
    pitcherId,
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
}

function expectRejected(execution: DiamondExecution, code: string, revision: number) {
  expect(execution.result).toMatchObject({
    outcome: 'rejected',
    revision,
    rejection: { code }
  });
  expect(execution.ledger.state.revision).toBe(revision);
}

const COMPLETE_COVERAGE: DiamondCoverageMap = {
  batting: 'complete',
  baserunning: 'complete',
  pitching: 'complete',
  fielding: 'complete',
  situational: 'complete',
  pitches: 'complete',
  sensors: 'not_collected'
};

function rawStats(): DiamondPlayerRawStats {
  return {
    batting: {
      G: 1,
      GS: 1,
      PA: 10,
      AB: 9,
      R: 2,
      H: 3,
      '1B': 2,
      '2B': 0,
      '3B': 0,
      HR: 1,
      TB: 6,
      RBI: 3,
      BB: 1,
      IBB: 0,
      HBP: 0,
      SO: 2,
      SF: 0,
      SH: 0,
      ROE: 0,
      FC: 0,
      GIDP: 0
    },
    baserunning: { SB: 2, CS: 1, pickoffs: 0, advances: 3, outs: 1 },
    pitching: {
      APP: 1,
      GS: 1,
      W: 1,
      L: 0,
      SV: 0,
      BF: 10,
      outs: 5,
      H: 2,
      R: 1,
      ER: 1,
      BB: 1,
      IBB: 0,
      HBP: 0,
      SO: 3,
      HR: 0,
      WP: 0,
      balkIllegalPitch: 0,
      inheritedRunners: 0,
      inheritedScored: 0,
      pitches: 15,
      strikes: 10,
      firstPitchStrikes: 6
    },
    fielding: { defensiveOuts: 5, PO: 2, A: 1, E: 1, DP: 0, TP: 0, PB: 0 }
  };
}

describe('Diamond public command and rules inventory', () => {
  it('keeps every public command assigned to a deterministic golden fixture', () => {
    expect(Object.keys(COMMAND_GOLDEN_INVENTORY).sort()).toEqual([
      'activate',
      'add_courtesy_runner',
      'advance_half_inning',
      'advance_runner',
      'cancel',
      'finalize',
      'place_tiebreaker_runner',
      'private_note',
      're_enter',
      'record_fielding',
      'record_pitch',
      'record_plate_appearance',
      'record_scoring_judgment',
      'reopen_for_correction',
      'resume',
      'rules_decision',
      'scorer_handoff',
      'set_defensive_alignment',
      'set_dp_flex',
      'set_lineup',
      'start',
      'substitute',
      'supersede_event',
      'suspend',
      'void_event'
    ]);
  });

  it('documents deterministic, explicit-decision, partial, and advisory rule behavior without skipped claims', () => {
    expect(Object.keys(RULE_BEHAVIOR_INVENTORY).sort()).toEqual([
      'allowsDh',
      'allowsEh',
      'allowsEp',
      'continuousBatting',
      'courtesyRunner',
      'dpFlex',
      'droppedThirdStrike',
      'eraInningsBasis',
      'freeSubstitution',
      'id',
      'illegalPitchPolicy',
      'inningRunLimit',
      'leavingEarlyRule',
      'lookBackRule',
      'name',
      'runAheadRules',
      'scheduledInnings',
      'sport',
      'starterReentryLimit',
      'tiebreaker',
      'timeLimitMinutes',
      'version'
    ]);
    expect(
      Object.entries(RULE_BEHAVIOR_INVENTORY)
        .filter(([, behavior]) => behavior === 'advisory')
        .map(([field]) => field)
        .sort()
    ).toEqual(['continuousBatting', 'leavingEarlyRule', 'lookBackRule']);
    expect(
      Object.entries(RULE_BEHAVIOR_INVENTORY)
        .filter(([, behavior]) => behavior === 'explicit-decision')
        .map(([field]) => field)
        .sort()
    ).toEqual(['inningRunLimit', 'timeLimitMinutes']);

    const baseball = requireDiamondRulesProfile('baseball-nfhs', 1);
    const fastpitch = requireDiamondRulesProfile('fastpitch-nfhs', 1);
    expect(baseball).toMatchObject({ sport: 'baseball', scheduledInnings: 7, starterReentryLimit: 1 });
    expect(fastpitch).toMatchObject({
      sport: 'fastpitch',
      scheduledInnings: 7,
      dpFlex: { enabled: true, flexMayBatForDpOnly: true },
      tiebreaker: { enabled: true, startInning: 8, runnerBase: 'second' }
    });

    // Deliberate boundaries in the public domain contract: wall-clock expiration
    // is never inferred; an authorized scorer records the umpire's time/run-cap
    // decision. Role flags gate lineup admission but do not encode every league's
    // participation rule. Continuous batting, look-back, and leaving-early remain
    // advisory. DP/FLEX supports a bounded linked-slot exchange, courtesy runners
    // do not model every eligibility restriction, and ball_and_advance does not
    // infer runner movement. The goldens below assert only these supported edges.
    expect(Object.values(RULE_BEHAVIOR_INVENTORY)).toContain('partially-enforced');
    expect(Object.values(RULE_BEHAVIOR_INVENTORY)).toContain('advisory');
  });
});

describe('Baseball golden games', () => {
  it('records a bottom-seven walkoff but stays active until an explicitly confirmed finalization', () => {
    const game = createHarness('baseball-nfhs', 'quick');
    configureGame(game);
    advanceToHalf(game, 7, 'bottom');
    expect(game.ledger.state.score).toEqual({ home: 0, away: 0 });

    recordSoloHomeRun(game);
    expect(game.ledger.state).toMatchObject({
      lifecycle: 'active',
      inning: { number: 7, half: 'bottom', outs: 0 },
      score: { home: 1, away: 0 }
    });

    const revision = game.ledger.state.revision;
    const unconfirmed = game.submit('finalize', { confirmed: false } as unknown as DiamondCommandPayloadMap['finalize'], { accept: false });
    expectRejected(unconfirmed, 'confirmation-required', revision);
    expect(game.ledger.state.lifecycle).toBe('active');

    game.submit('finalize', { confirmed: true });
    expect(game.ledger.state).toMatchObject({
      lifecycle: 'final',
      finalConfirmedAtRevision: game.ledger.state.revision
    });
    expect(verifyDiamondLedger(game.ledger)).toBe(true);
    expect(replayDiamondLedger(game.ledger).state).toEqual(game.ledger.state);
  });

  it('enforces run-ahead finalization and an explicit audited inning run-limit ending', () => {
    const mercy = createHarness('baseball-nfhs', 'quick');
    configureGame(mercy);
    for (let run = 0; run < 10; run += 1) recordSoloHomeRun(mercy);
    advanceToHalf(mercy, 5, 'bottom');
    while (mercy.ledger.state.inning.outs < 3) recordOut(mercy);

    const nfhs = requireDiamondRulesProfile('baseball-nfhs', 1);
    expect(nfhs.runAheadRules).toEqual([{ afterInning: 5, runDifferential: 10 }]);
    expect(mercy.ledger.state).toMatchObject({
      lifecycle: 'active',
      inning: { number: 5, half: 'bottom', outs: 3 },
      score: { away: 10, home: 0 }
    });
    const blockedAdvance = mercy.submit('advance_half_inning', {}, { accept: false });
    expectRejected(blockedAdvance, 'game-ending-condition-met', mercy.ledger.state.revision);
    mercy.submit('finalize', { confirmed: true });
    expect(mercy.ledger.state).toMatchObject({
      lifecycle: 'final',
      finalizationReason: { kind: 'run-ahead', decisionEventId: null }
    });

    const capped = createHarness('baseball-youth', 'quick');
    configureGame(capped);
    const earlyDecision = capped.submit(
      'rules_decision',
      {
        code: 'end_half_inning_run_limit',
        description: 'The scorer confirms the inning run limit.'
      },
      { accept: false }
    );
    expectRejected(earlyDecision, 'run-limit-not-reached', capped.ledger.state.revision);
    for (let run = 0; run < 5; run += 1) recordSoloHomeRun(capped);
    const youth = requireDiamondRulesProfile('baseball-youth', 1);
    expect(youth).toMatchObject({ scheduledInnings: 6, timeLimitMinutes: 90, inningRunLimit: 5 });
    const matchup = currentMatchup(capped);
    const blockedPlay = capped.submit(
      'record_pitch',
      { batterId: matchup.batterId, pitcherId: matchup.pitcherId, result: 'in_play' },
      { accept: false }
    );
    expectRejected(blockedPlay, 'run-limit-decision-required', capped.ledger.state.revision);
    const blockedAlignment = capped.submit(
      'set_defensive_alignment',
      {
        side: 'home',
        assignments: [
          { playerId: 'home-2', position: 'P' },
          { playerId: 'home-1', position: 'C' },
          { playerId: 'home-3', position: 'SS' }
        ]
      },
      { accept: false }
    );
    expectRejected(blockedAlignment, 'run-limit-decision-required', capped.ledger.state.revision);
    expect(projectDiamondStats(capped.ledger).players['home-2'].raw.pitching.APP).toBe(0);
    const decision = capped.submit('rules_decision', {
      code: 'end_half_inning_run_limit',
      description: 'The scorer and umpire confirm the five-run half-inning limit.'
    });
    expect(capped.ledger.state).toMatchObject({
      lifecycle: 'active',
      inningRuns: { T1: 5 },
      score: { away: 5, home: 0 },
      halfInningEnd: { reason: 'run-limit', decisionEventId: decision.event!.eventId }
    });
    const endedMatchup = currentMatchup(capped);
    const afterDecision = capped.submit(
      'record_pitch',
      { batterId: endedMatchup.batterId, pitcherId: endedMatchup.pitcherId, result: 'in_play' },
      { accept: false }
    );
    expectRejected(afterDecision, 'half-inning-complete', capped.ledger.state.revision);
    capped.submit('advance_half_inning', {});
    expect(capped.ledger.state).toMatchObject({ inning: { number: 1, half: 'bottom', outs: 0 }, halfInningEnd: null });
  });

  it('enforces dropped-third-strike first-base eligibility and permits it with two outs', () => {
    const game = createHarness('baseball-nfhs', 'quick');
    configureGame(game);
    game.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });

    const revision = game.ledger.state.revision;
    const ineligible = game.submit(
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
    expectRejected(ineligible, 'dropped-third-strike-ineligible', revision);

    recordOut(game);
    recordOut(game);
    const { batterId, pitcherId } = currentMatchup(game);
    expect(batterId).toBe('away-4');
    game.submit('record_plate_appearance', {
      batterId,
      pitcherId,
      result: 'dropped_third_strike',
      batterAdvance: { to: 'first' },
      runnerAdvances: [{ runnerId: 'away-1', from: 'first', to: 'second', cause: 'other' }],
      outsOnPlay: 0
    });

    expect(game.ledger.state).toMatchObject({
      inning: { outs: 2 },
      bases: {
        first: { runnerId: 'away-4' },
        second: { runnerId: 'away-1' }
      }
    });
    const stats = projectDiamondStats(game.ledger);
    expect(stats.players['away-4'].raw.batting.SO).toBe(1);
    expect(stats.players['home-1'].raw.pitching.SO).toBe(1);
  });

  it('applies dropped-third-strike eligibility when an ordinary strikeout reaches first without changing valid old payloads', () => {
    const emptyFirst = createHarness('baseball-nfhs', 'quick');
    configureGame(emptyFirst);
    emptyFirst.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'strikeout',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    expect(emptyFirst.ledger.state.bases.first?.runnerId).toBe('away-1');
    expect(projectDiamondStats(emptyFirst.ledger).players['away-1'].raw.batting.SO).toBe(1);
    expect(replayDiamondLedger(emptyFirst.ledger).state).toEqual(emptyFirst.ledger.state);

    const occupiedFirst = createHarness('baseball-nfhs', 'quick');
    configureGame(occupiedFirst);
    placeRunnerOnBase(occupiedFirst, 'first');
    recordOut(occupiedFirst);
    const blockedRevision = occupiedFirst.ledger.state.revision;
    const blocked = occupiedFirst.submit(
      'record_plate_appearance',
      {
        batterId: 'away-3',
        pitcherId: 'home-1',
        result: 'strikeout',
        batterAdvance: { to: 'first' },
        runnerAdvances: [{ runnerId: 'away-1', from: 'first', to: 'second', cause: 'other' }],
        outsOnPlay: 0
      },
      { accept: false }
    );
    expectRejected(blocked, 'dropped-third-strike-ineligible', blockedRevision);

    recordOut(occupiedFirst);
    occupiedFirst.submit('record_plate_appearance', {
      batterId: 'away-4',
      pitcherId: 'home-1',
      result: 'strikeout',
      batterAdvance: { to: 'first' },
      runnerAdvances: [{ runnerId: 'away-1', from: 'first', to: 'second', cause: 'other' }],
      outsOnPlay: 0
    });
    expect(occupiedFirst.ledger.state.bases).toMatchObject({
      first: { runnerId: 'away-4' },
      second: { runnerId: 'away-1' }
    });
    expect(replayDiamondLedger(occupiedFirst.ledger).state).toEqual(occupiedFirst.ledger.state);

    const legacyDroppedThird = createHarness('baseball-nfhs', 'quick');
    configureGame(legacyDroppedThird);
    legacyDroppedThird.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'dropped_third_strike',
      batterAdvance: { to: 'second', cause: 'error' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    expect(legacyDroppedThird.ledger.state.bases.second?.runnerId).toBe('away-1');
    expect(replayDiamondLedger(legacyDroppedThird.ledger).state).toEqual(legacyDroppedThird.ledger.state);

    const droppedThirdOut = createHarness('baseball-nfhs', 'quick');
    configureGame(droppedThirdOut);
    droppedThirdOut.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'dropped_third_strike',
      batterAdvance: { to: 'out' },
      runnerAdvances: [],
      outsOnPlay: 1
    });
    expect(droppedThirdOut.ledger.state.inning.outs).toBe(1);
    expect(replayDiamondLedger(droppedThirdOut.ledger).state).toEqual(droppedThirdOut.ledger.state);
  });

  it('blocks every further pitch after a terminal pitch result until the plate appearance is resolved', () => {
    const terminalResults = ['in_play', 'hit_by_pitch', 'catcher_interference'] as const;
    const followupResults: readonly DiamondCommandPayloadMap['record_pitch']['result'][] = [
      'ball',
      'called_strike',
      'swinging_strike',
      'foul',
      'foul_bunt',
      'in_play',
      'hit_by_pitch',
      'catcher_interference',
      'illegal_pitch',
      'balk',
      'pickoff_attempt'
    ];

    for (const terminalResult of terminalResults) {
      const game = createHarness('baseball-nfhs', 'full');
      configureGame(game);
      const matchup = currentMatchup(game);
      game.submit('record_pitch', { ...matchup, result: terminalResult });
      const terminalRevision = game.ledger.state.revision;

      for (const result of followupResults) {
        expectRejected(
          game.submit('record_pitch', { ...matchup, result }, { accept: false }),
          'plate-appearance-pending',
          terminalRevision
        );
        expect(game.ledger.state.inning.lastPitchResult).toBe(terminalResult);
      }

      if (terminalResult === 'in_play') {
        game.submit('record_plate_appearance', {
          ...matchup,
          result: 'single',
          batterAdvance: { to: 'first' },
          runnerAdvances: [],
          outsOnPlay: 0
        });
      } else if (terminalResult === 'hit_by_pitch') {
        game.submit('record_plate_appearance', {
          ...matchup,
          result: 'hit_by_pitch',
          batterAdvance: { to: 'first', cause: 'hit_by_pitch' },
          runnerAdvances: [],
          outsOnPlay: 0
        });
      } else {
        game.submit('record_plate_appearance', {
          ...matchup,
          result: 'interference',
          batterAdvance: { to: 'first' },
          runnerAdvances: [],
          outsOnPlay: 0
        });
      }

      expect(game.ledger.state.inning.lastPitchResult).toBeNull();
      const nextMatchup = currentMatchup(game);
      game.submit('record_pitch', { ...nextMatchup, result: 'ball' });
      expect(projectDiamondStats(game.ledger).players['home-1'].raw.pitching.pitches).toBe(2);
      expect(replayDiamondLedger(game.ledger).state).toEqual(game.ledger.state);
    }

    const corrected = createHarness('baseball-nfhs', 'full');
    configureGame(corrected);
    const matchup = currentMatchup(corrected);
    const terminal = corrected.submit('record_pitch', { ...matchup, result: 'in_play' });
    corrected.submit('supersede_event', {
      targetEventId: terminal.event!.eventId,
      reason: 'Correct the terminal pitch result before recording the next pitch.',
      replacement: { type: 'record_pitch', payload: { ...matchup, result: 'ball' } }
    });
    corrected.submit('record_pitch', { ...matchup, result: 'called_strike' });
    expect(corrected.ledger.state.inning).toMatchObject({ balls: 1, strikes: 1, lastPitchResult: 'called_strike' });
    expect(projectDiamondStats(corrected.ledger).players['home-1'].raw.pitching.pitches).toBe(2);
    expect(replayDiamondLedger(corrected.ledger).state).toEqual(corrected.ledger.state);

    for (const terminalResult of terminalResults) {
      const invalidCorrection = createHarness('baseball-nfhs', 'full');
      configureGame(invalidCorrection);
      const correctionMatchup = currentMatchup(invalidCorrection);
      const firstPitch = invalidCorrection.submit('record_pitch', { ...correctionMatchup, result: 'ball' });
      invalidCorrection.submit('record_pitch', { ...correctionMatchup, result: 'called_strike' });
      const beforeCorrection = invalidCorrection.ledger;
      const rejected = invalidCorrection.submit(
        'supersede_event',
        {
          targetEventId: firstPitch.event!.eventId,
          reason: `Do not introduce ${terminalResult} before an already-recorded later pitch.`,
          replacement: { type: 'record_pitch', payload: { ...correctionMatchup, result: terminalResult } }
        },
        { accept: false }
      );
      expectRejected(rejected, 'plate-appearance-pending', beforeCorrection.state.revision);
      expect(invalidCorrection.ledger).toBe(beforeCorrection);
      expect(replayDiamondLedger(invalidCorrection.ledger).state).toEqual(invalidCorrection.ledger.state);
    }
  });

  it('rejects same-base and backward runner moves in standalone, plate-appearance, and correction replay paths', () => {
    const matrix: readonly Readonly<{
      from: DiamondBase;
      allowed: readonly DiamondDestination[];
      rejected: readonly DiamondDestination[];
    }>[] = [
      { from: 'first', allowed: ['stay', 'second', 'third', 'home', 'out'], rejected: ['first'] },
      { from: 'second', allowed: ['stay', 'third', 'home', 'out'], rejected: ['first', 'second'] },
      { from: 'third', allowed: ['stay', 'home', 'out'], rejected: ['first', 'second', 'third'] }
    ];

    for (const { from, allowed, rejected } of matrix) {
      for (const to of allowed) {
        const game = createHarness('baseball-nfhs', 'quick');
        configureGame(game);
        const runnerId = placeRunnerOnBase(game, from);
        game.submit('advance_runner', {
          runnerId,
          from,
          to,
          cause: 'other',
          ...(to === 'out' ? { outKind: 'tag' as const } : {})
        });
        if (to === 'stay') {
          expect(projectDiamondStats(game.ledger).players[runnerId].raw.baserunning.advances).toBe(0);
        }
        expect(replayDiamondLedger(game.ledger).state).toEqual(game.ledger.state);
      }

      for (const to of rejected) {
        const standalone = createHarness('baseball-nfhs', 'quick');
        configureGame(standalone);
        const standaloneRunnerId = placeRunnerOnBase(standalone, from);
        const standaloneRevision = standalone.ledger.state.revision;
        expectRejected(
          standalone.submit('advance_runner', { runnerId: standaloneRunnerId, from, to, cause: 'other' }, { accept: false }),
          'invalid-runner-destination',
          standaloneRevision
        );

        const plateAppearance = createHarness('baseball-nfhs', 'quick');
        configureGame(plateAppearance);
        const plateAppearanceRunnerId = placeRunnerOnBase(plateAppearance, from);
        const { batterId, pitcherId } = currentMatchup(plateAppearance);
        const plateAppearanceRevision = plateAppearance.ledger.state.revision;
        expectRejected(
          plateAppearance.submit(
            'record_plate_appearance',
            {
              batterId,
              pitcherId,
              result: 'ground_out',
              batterAdvance: { to: 'out', outKind: 'batter_runner' },
              runnerAdvances: [{ runnerId: plateAppearanceRunnerId, from, to, cause: 'batted_ball' }],
              outsOnPlay: 1
            },
            { accept: false }
          ),
          'invalid-runner-destination',
          plateAppearanceRevision
        );
      }
    }

    const correction = createHarness('baseball-nfhs', 'quick');
    configureGame(correction);
    const runnerId = placeRunnerOnBase(correction, 'first');
    const advance = correction.submit('advance_runner', {
      runnerId,
      from: 'first',
      to: 'second',
      cause: 'other'
    });
    const correctionRevision = correction.ledger.state.revision;
    expectRejected(
      correction.submit(
        'supersede_event',
        {
          targetEventId: advance.event!.eventId,
          reason: 'Attempt an invalid backward correction.',
          replacement: {
            type: 'advance_runner',
            payload: { runnerId, from: 'first', to: 'first', cause: 'other' }
          }
        },
        { accept: false }
      ),
      'invalid-runner-destination',
      correctionRevision
    );
    expect(verifyDiamondLedger(correction.ledger)).toBe(true);
    expect(replayDiamondLedger(correction.ledger).state).toEqual(correction.ledger.state);
  });

  it('rejects runner-order reversals while preserving simultaneous advances, stays, and replay', () => {
    const standalone = createHarness('baseball-nfhs', 'quick');
    configureGame(standalone);
    const leadingRunnerId = placeRunnerOnBase(standalone, 'second');
    const trailingRunnerId = placeRunnerOnBase(standalone, 'first');
    const standaloneRevision = standalone.ledger.state.revision;
    expectRejected(
      standalone.submit('advance_runner', { runnerId: trailingRunnerId, from: 'first', to: 'third', cause: 'other' }, { accept: false }),
      'runner-order-violation',
      standaloneRevision
    );
    expect(standalone.ledger.state.bases).toMatchObject({
      first: { runnerId: trailingRunnerId },
      second: { runnerId: leadingRunnerId },
      third: null
    });

    const plateAppearance = createHarness('baseball-nfhs', 'quick');
    configureGame(plateAppearance);
    const heldRunnerId = placeRunnerOnBase(plateAppearance, 'first');
    const matchup = currentMatchup(plateAppearance);
    const plateAppearanceRevision = plateAppearance.ledger.state.revision;
    expectRejected(
      plateAppearance.submit(
        'record_plate_appearance',
        {
          ...matchup,
          result: 'double',
          batterAdvance: { to: 'second' },
          runnerAdvances: [{ runnerId: heldRunnerId, from: 'first', to: 'stay', cause: 'batted_ball' }],
          outsOnPlay: 0
        },
        { accept: false }
      ),
      'runner-order-violation',
      plateAppearanceRevision
    );

    const simultaneous = createHarness('baseball-nfhs', 'quick');
    configureGame(simultaneous);
    const runnerFromSecond = placeRunnerOnBase(simultaneous, 'second');
    const runnerFromFirst = placeRunnerOnBase(simultaneous, 'first');
    const simultaneousMatchup = currentMatchup(simultaneous);
    simultaneous.submit('record_plate_appearance', {
      ...simultaneousMatchup,
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [
        { runnerId: runnerFromSecond, from: 'second', to: 'third', cause: 'batted_ball' },
        { runnerId: runnerFromFirst, from: 'first', to: 'second', cause: 'batted_ball' }
      ],
      outsOnPlay: 0
    });
    expect(simultaneous.ledger.state.bases).toMatchObject({
      first: { runnerId: simultaneousMatchup.batterId },
      second: { runnerId: runnerFromFirst },
      third: { runnerId: runnerFromSecond }
    });
    expect(replayDiamondLedger(simultaneous.ledger).state).toEqual(simultaneous.ledger.state);

    const correction = createHarness('baseball-nfhs', 'quick');
    configureGame(correction);
    placeRunnerOnBase(correction, 'second');
    const correctionRunnerId = placeRunnerOnBase(correction, 'first');
    const stay = correction.submit('advance_runner', {
      runnerId: correctionRunnerId,
      from: 'first',
      to: 'stay',
      cause: 'other'
    });
    const correctionRevision = correction.ledger.state.revision;
    expectRejected(
      correction.submit(
        'supersede_event',
        {
          targetEventId: stay.event!.eventId,
          reason: 'Do not let the trailing runner pass the historical preceding runner.',
          replacement: {
            type: 'advance_runner',
            payload: { runnerId: correctionRunnerId, from: 'first', to: 'third', cause: 'other' }
          }
        },
        { accept: false }
      ),
      'runner-order-violation',
      correctionRevision
    );
    expect(verifyDiamondLedger(correction.ledger)).toBe(true);
    expect(replayDiamondLedger(correction.ledger).state).toEqual(correction.ledger.state);
  });

  it('requires a third-out run decision, cancels a force-out run, and counts an earlier tag-play run', () => {
    const seed = createHarness('baseball-nfhs', 'quick');
    configureGame(seed);
    seed.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'triple',
      batterAdvance: { to: 'third' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    seed.submit('record_plate_appearance', {
      batterId: 'away-2',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    recordOut(seed);
    recordOut(seed);
    expect(seed.ledger.state.inning.outs).toBe(2);

    const thirdOutPayload = (outKind: 'force' | 'tag', countsRun?: boolean): DiamondCommandPayloadMap['record_plate_appearance'] => ({
      batterId: 'away-5',
      pitcherId: 'home-1',
      result: 'fielders_choice',
      batterAdvance: { to: 'first' },
      runnerAdvances: [
        {
          runnerId: 'away-1',
          from: 'third',
          to: 'home',
          cause: 'batted_ball',
          ...(countsRun === undefined ? {} : { countsRun }),
          earned: true,
          rbi: false
        },
        {
          runnerId: 'away-2',
          from: 'first',
          to: 'out',
          cause: outKind === 'force' ? 'force_out' : 'tag_out',
          outKind
        }
      ],
      outsOnPlay: 1
    });

    const missingDecision = createHarness('baseball-nfhs', 'quick', seed.ledger);
    const missingRevision = missingDecision.ledger.state.revision;
    expectRejected(
      missingDecision.submit('record_plate_appearance', thirdOutPayload('tag'), { accept: false }),
      'run-timing-required',
      missingRevision
    );

    const invalidForce = createHarness('baseball-nfhs', 'quick', seed.ledger);
    const forceRevision = invalidForce.ledger.state.revision;
    expectRejected(
      invalidForce.submit('record_plate_appearance', thirdOutPayload('force', true), { accept: false }),
      'run-cannot-count',
      forceRevision
    );

    for (const [result, batterAdvance] of [
      ['fly_out', { to: 'out', outKind: 'catch' }],
      ['strikeout', { to: 'out', outKind: 'strikeout' }],
      ['fielders_choice', { to: 'out', outKind: 'tag' }]
    ] as const) {
      const batterThirdOut = createHarness('baseball-nfhs', 'quick', seed.ledger);
      const revision = batterThirdOut.ledger.state.revision;
      expectRejected(
        batterThirdOut.submit(
          'record_plate_appearance',
          {
            batterId: 'away-5',
            pitcherId: 'home-1',
            result,
            batterAdvance,
            runnerAdvances: [
              {
                runnerId: 'away-1',
                from: 'third',
                to: 'home',
                cause: 'batted_ball',
                countsRun: true,
                earned: true,
                rbi: false
              }
            ],
            outsOnPlay: 1
          },
          { accept: false }
        ),
        'run-cannot-count',
        revision
      );
    }

    const force = createHarness('baseball-nfhs', 'quick', seed.ledger);
    force.submit('record_plate_appearance', thirdOutPayload('force', false));
    expect(force.ledger.state).toMatchObject({ inning: { outs: 3 }, score: { away: 0, home: 0 } });

    const tag = createHarness('baseball-nfhs', 'quick', seed.ledger);
    tag.submit('record_plate_appearance', thirdOutPayload('tag', true));
    expect(tag.ledger.state).toMatchObject({ inning: { outs: 3 }, score: { away: 1, home: 0 } });
    const tagStats = projectDiamondStats(tag.ledger);
    expect(tagStats.players['away-1'].raw.batting.R).toBe(1);
    expect(tagStats.players['home-1'].raw.pitching).toMatchObject({ R: 1, ER: 1 });
    expect(tagStats.teams.away.twoOutRuns).toBe(1);

    const multiOutSeed = createHarness('baseball-nfhs', 'quick');
    configureGame(multiOutSeed);
    multiOutSeed.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'triple',
      batterAdvance: { to: 'third' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    multiOutSeed.submit('record_plate_appearance', {
      batterId: 'away-2',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    recordOut(multiOutSeed);
    expect(multiOutSeed.ledger.state).toMatchObject({ inning: { outs: 1 }, bases: { first: {}, third: {} } });

    const mixedOutPayload = (
      countsRun: boolean | undefined,
      taggedRunnerFirst = false
    ): DiamondCommandPayloadMap['record_plate_appearance'] => {
      const scoringAdvance = {
        runnerId: 'away-1',
        from: 'third' as const,
        to: 'home' as const,
        cause: 'batted_ball' as const,
        ...(countsRun === undefined ? {} : { countsRun }),
        earned: true,
        rbi: false
      };
      const taggedRunner = {
        runnerId: 'away-2',
        from: 'first' as const,
        to: 'out' as const,
        cause: 'tag_out' as const,
        outKind: 'tag' as const
      };
      return {
        batterId: 'away-4',
        pitcherId: 'home-1',
        result: 'ground_out',
        batterAdvance: { to: 'out', outKind: 'batter_runner' },
        runnerAdvances: taggedRunnerFirst ? [taggedRunner, scoringAdvance] : [scoringAdvance, taggedRunner],
        outsOnPlay: 2
      };
    };

    const missingMultiOutDecision = createHarness('baseball-nfhs', 'quick', multiOutSeed.ledger);
    expectRejected(
      missingMultiOutDecision.submit('record_plate_appearance', mixedOutPayload(undefined), { accept: false }),
      'run-timing-required',
      missingMultiOutDecision.ledger.state.revision
    );
    const malformedMultiOutDecision = createHarness('baseball-nfhs', 'quick', multiOutSeed.ledger);
    const malformedPayload = mixedOutPayload(true);
    expectRejected(
      malformedMultiOutDecision.submit(
        'record_plate_appearance',
        {
          ...malformedPayload,
          runnerAdvances: malformedPayload.runnerAdvances.map((advance) =>
            advance.to === 'home' ? { ...advance, countsRun: 'yes' as unknown as boolean } : advance
          )
        },
        { accept: false }
      ),
      'invalid-boolean',
      malformedMultiOutDecision.ledger.state.revision
    );

    for (const taggedRunnerFirst of [false, true]) {
      const mixedTag = createHarness('baseball-nfhs', 'quick', multiOutSeed.ledger);
      mixedTag.submit('record_plate_appearance', mixedOutPayload(true, taggedRunnerFirst));
      expect(mixedTag.ledger.state).toMatchObject({ inning: { outs: 3 }, score: { away: 1, home: 0 } });
      expect(projectDiamondStats(mixedTag.ledger).players['away-1'].raw.batting.R).toBe(1);
      expect(verifyDiamondLedger(mixedTag.ledger)).toBe(true);
      expect(replayDiamondLedger(mixedTag.ledger).state).toEqual(mixedTag.ledger.state);
    }

    const mixedNoRun = createHarness('baseball-nfhs', 'quick', multiOutSeed.ledger);
    mixedNoRun.submit('record_plate_appearance', mixedOutPayload(false));
    expect(mixedNoRun.ledger.state.score.away).toBe(0);

    const nonCancellingSeed = createHarness('baseball-nfhs', 'quick');
    configureGame(nonCancellingSeed);
    nonCancellingSeed.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    nonCancellingSeed.submit('record_plate_appearance', {
      batterId: 'away-2',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [{ runnerId: 'away-1', from: 'first', to: 'second', cause: 'batted_ball' }],
      outsOnPlay: 0
    });
    nonCancellingSeed.submit('record_plate_appearance', {
      batterId: 'away-3',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [
        { runnerId: 'away-1', from: 'second', to: 'third', cause: 'batted_ball' },
        { runnerId: 'away-2', from: 'first', to: 'second', cause: 'batted_ball' }
      ],
      outsOnPlay: 0
    });
    recordOut(nonCancellingSeed);
    const allTagAppeal = createHarness('baseball-nfhs', 'quick', nonCancellingSeed.ledger);
    allTagAppeal.submit('record_plate_appearance', {
      batterId: 'away-5',
      pitcherId: 'home-1',
      result: 'fielders_choice',
      batterAdvance: { to: 'first' },
      runnerAdvances: [
        {
          runnerId: 'away-1',
          from: 'third',
          to: 'home',
          cause: 'batted_ball',
          countsRun: true,
          earned: true,
          rbi: false
        },
        { runnerId: 'away-2', from: 'second', to: 'out', cause: 'appeal_out', outKind: 'appeal' },
        { runnerId: 'away-3', from: 'first', to: 'out', cause: 'tag_out', outKind: 'tag' }
      ],
      outsOnPlay: 2
    });
    expect(allTagAppeal.ledger.state).toMatchObject({ inning: { outs: 3 }, score: { away: 1, home: 0 } });

    const unavoidableForce = createHarness('baseball-nfhs', 'quick', multiOutSeed.ledger);
    const allCancellingOuts = mixedOutPayload(true);
    expectRejected(
      unavoidableForce.submit(
        'record_plate_appearance',
        {
          ...allCancellingOuts,
          runnerAdvances: allCancellingOuts.runnerAdvances.map((advance) =>
            advance.to === 'out' ? { ...advance, cause: 'force_out' as const, outKind: 'force' as const } : advance
          )
        },
        { accept: false }
      ),
      'run-cannot-count',
      unavoidableForce.ledger.state.revision
    );
  });

  it('resolves every pre-play base runner on triples and home runs without losing identity or responsibility', () => {
    const loadBases = () => {
      const game = createHarness('baseball-nfhs', 'quick');
      configureGame(game);
      game.submit('record_plate_appearance', {
        batterId: 'away-1',
        pitcherId: 'home-1',
        result: 'single',
        batterAdvance: { to: 'first' },
        runnerAdvances: [],
        outsOnPlay: 0
      });
      game.submit('record_plate_appearance', {
        batterId: 'away-2',
        pitcherId: 'home-1',
        result: 'single',
        batterAdvance: { to: 'first' },
        runnerAdvances: [{ runnerId: 'away-1', from: 'first', to: 'second', cause: 'batted_ball' }],
        outsOnPlay: 0
      });
      game.submit('record_plate_appearance', {
        batterId: 'away-3',
        pitcherId: 'home-1',
        result: 'single',
        batterAdvance: { to: 'first' },
        runnerAdvances: [
          { runnerId: 'away-1', from: 'second', to: 'third', cause: 'batted_ball' },
          { runnerId: 'away-2', from: 'first', to: 'second', cause: 'batted_ball' }
        ],
        outsOnPlay: 0
      });
      return game;
    };

    const incomplete = loadBases();
    expectRejected(
      incomplete.submit(
        'record_plate_appearance',
        {
          batterId: 'away-4',
          pitcherId: 'home-1',
          result: 'home_run',
          batterAdvance: { to: 'home', countsRun: true },
          runnerAdvances: [
            { runnerId: 'away-2', from: 'second', to: 'home', cause: 'batted_ball', countsRun: true },
            { runnerId: 'away-3', from: 'first', to: 'home', cause: 'batted_ball', countsRun: true }
          ],
          outsOnPlay: 0,
          runsBattedIn: 3
        },
        { accept: false }
      ),
      'incomplete-hit-runner-resolution',
      incomplete.ledger.state.revision
    );

    const triple = loadBases();
    triple.submit('record_plate_appearance', {
      batterId: 'away-4',
      pitcherId: 'home-1',
      result: 'triple',
      batterAdvance: { to: 'third' },
      runnerAdvances: [
        { runnerId: 'away-1', from: 'third', to: 'home', cause: 'batted_ball', countsRun: true, earned: true, rbi: true },
        { runnerId: 'away-2', from: 'second', to: 'out', cause: 'tag_out', outKind: 'tag' },
        { runnerId: 'away-3', from: 'first', to: 'home', cause: 'batted_ball', countsRun: true, earned: true, rbi: true }
      ],
      outsOnPlay: 1,
      runsBattedIn: 2
    });
    expect(triple.ledger.state).toMatchObject({
      inning: { outs: 1 },
      score: { away: 2 },
      bases: { first: null, second: null, third: { runnerId: 'away-4', chargedToPitcherId: 'home-1' } }
    });
    const tripleStats = projectDiamondStats(triple.ledger);
    expect(tripleStats.players['away-1'].raw.batting.R).toBe(1);
    expect(tripleStats.players['away-2'].raw.baserunning.outs).toBe(1);
    expect(tripleStats.players['away-3'].raw.batting.R).toBe(1);
    expect(tripleStats.players['home-1'].raw.pitching).toMatchObject({ R: 2, ER: 2 });

    const homeRun = loadBases();
    homeRun.submit('record_plate_appearance', {
      batterId: 'away-4',
      pitcherId: 'home-1',
      result: 'home_run',
      batterAdvance: { to: 'home', countsRun: true, earned: true, rbi: true },
      runnerAdvances: [
        { runnerId: 'away-1', from: 'third', to: 'home', cause: 'batted_ball', countsRun: true, earned: true, rbi: true },
        { runnerId: 'away-2', from: 'second', to: 'home', cause: 'batted_ball', countsRun: true, earned: true, rbi: true },
        { runnerId: 'away-3', from: 'first', to: 'home', cause: 'batted_ball', countsRun: true, earned: true, rbi: true }
      ],
      outsOnPlay: 0,
      runsBattedIn: 4
    });
    expect(homeRun.ledger.state).toMatchObject({
      score: { away: 4 },
      bases: { first: null, second: null, third: null }
    });
    expect(verifyDiamondLedger(homeRun.ledger)).toBe(true);
    expect(replayDiamondLedger(homeRun.ledger).state).toEqual(homeRun.ledger.state);
  });
});

describe('Fastpitch golden game', () => {
  it('covers DP/FLEX, scorer lifecycle, courtesy running, one re-entry, and the inning-eight tiebreaker', () => {
    const game = createHarness('fastpitch-nfhs', 'quick');
    configureGame(game, { start: false, dpSide: 'home' });
    game.submit('set_dp_flex', {
      side: 'home',
      dpPlayerId: 'home-1',
      flexPlayerId: 'home-flex',
      dpBattingSlot: 1,
      flexDefensivePosition: 'RF'
    });
    game.submit('start', {});
    game.submit('suspend', { reason: 'Weather delay' });
    game.submit('resume', {});
    game.submit('scorer_handoff', { toUid: 'scorer-2' });

    const earlyRevision = game.ledger.state.revision;
    expectRejected(
      game.submit('place_tiebreaker_runner', { side: 'away', runnerId: 'away-tiebreak', base: 'second' }, { accept: false }),
      'rule-not-enabled',
      earlyRevision
    );

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
    game.submit('advance_runner', {
      runnerId: 'away-courtesy',
      from: 'first',
      to: 'out',
      cause: 'caught_stealing',
      outKind: 'tag'
    });

    game.submit('substitute', {
      side: 'away',
      battingSlot: 1,
      outgoingPlayerId: 'away-1',
      incomingPlayerId: 'away-sub',
      defensivePosition: 'P'
    });
    game.submit('re_enter', {
      side: 'away',
      battingSlot: 1,
      starterPlayerId: 'away-1',
      replacedPlayerId: 'away-sub',
      defensivePosition: 'P'
    });
    game.submit('substitute', {
      side: 'away',
      battingSlot: 1,
      outgoingPlayerId: 'away-1',
      incomingPlayerId: 'away-sub-2',
      defensivePosition: 'P'
    });
    const reentryRevision = game.ledger.state.revision;
    expectRejected(
      game.submit(
        're_enter',
        {
          side: 'away',
          battingSlot: 1,
          starterPlayerId: 'away-1',
          replacedPlayerId: 'away-sub-2',
          defensivePosition: 'P'
        },
        { accept: false }
      ),
      'reentry-limit',
      reentryRevision
    );
    expect(game.ledger.state.lineups.away.battingOrder[0]).toMatchObject({
      activePlayerId: 'away-sub-2',
      starterReentriesUsed: 1
    });

    advanceToHalf(game, 8, 'top');
    const tiebreakerRunnerId = previousScheduledBatterId(game, 'away');
    const wrongBaseRevision = game.ledger.state.revision;
    expectRejected(
      game.submit('place_tiebreaker_runner', { side: 'away', runnerId: tiebreakerRunnerId, base: 'third' }, { accept: false }),
      'invalid-tiebreaker-runner',
      wrongBaseRevision
    );
    game.submit('place_tiebreaker_runner', {
      side: 'away',
      runnerId: tiebreakerRunnerId,
      base: 'second',
      chargedToPitcherId: 'home-1'
    });

    recordPitch(game, 'illegal_pitch');
    expect(game.ledger.state).toMatchObject({
      inning: { balls: 1 },
      bases: { second: { runnerId: tiebreakerRunnerId } }
    });
    const { batterId, pitcherId } = currentMatchup(game);
    game.submit('record_plate_appearance', {
      batterId,
      pitcherId,
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [
        {
          runnerId: tiebreakerRunnerId,
          from: 'second',
          to: 'home',
          cause: 'batted_ball',
          countsRun: true,
          earned: false,
          rbi: true
        }
      ],
      outsOnPlay: 0,
      runsBattedIn: 1
    });

    expect(game.ledger.state).toMatchObject({
      lifecycle: 'active',
      currentScorerUid: 'scorer-2',
      inning: { number: 8, half: 'top' },
      score: { away: 1, home: 0 },
      lineups: {
        home: {
          dpFlex: {
            dpPlayerId: 'home-1',
            flexPlayerId: 'home-flex',
            dpBattingSlot: 1,
            flexDefensivePosition: 'RF'
          }
        }
      }
    });
    const stats = projectDiamondStats(game.ledger);
    expect(stats.players['away-courtesy'].raw.baserunning.CS).toBe(1);
    expect(stats.players[batterId].raw.batting.RBI).toBe(1);
    expect(stats.players['home-1'].raw.pitching).toMatchObject({ R: 1, ER: 0, balkIllegalPitch: 1 });
    expect(verifyDiamondLedger(game.ledger)).toBe(true);
    expect(replayDiamondLedger(game.ledger).state).toEqual(game.ledger.state);
  });
});

describe('Scoring decisions and correction reconciliation', () => {
  it('canonicalizes old-client tiebreaker responsibility while keeping earned-run judgment explicit', () => {
    const seed = createHarness('fastpitch-nfhs', 'quick');
    configureGame(seed);
    advanceToHalf(seed, 8, 'top');
    const tiebreakerRunnerId = previousScheduledBatterId(seed, 'away');

    const scoreTwoRunHomer = (options: Readonly<{ chargedToPitcherId?: string; tiebreakerEarned?: boolean }> = {}) => {
      const game = createHarness('fastpitch-nfhs', 'quick', seed.ledger);
      game.submit('place_tiebreaker_runner', {
        side: 'away',
        runnerId: tiebreakerRunnerId,
        base: 'second',
        ...(options.chargedToPitcherId ? { chargedToPitcherId: options.chargedToPitcherId } : {})
      });
      expect(game.ledger.state.bases.second?.chargedToPitcherId).toBe('home-1');
      game.submit('substitute', {
        side: 'home',
        battingSlot: 1,
        outgoingPlayerId: 'home-1',
        incomingPlayerId: 'home-reliever',
        defensivePosition: 'P'
      });
      const { batterId, pitcherId } = currentMatchup(game);
      expect(pitcherId).toBe('home-reliever');
      game.submit('record_plate_appearance', {
        batterId,
        pitcherId,
        result: 'home_run',
        batterAdvance: { to: 'home', cause: 'batted_ball', countsRun: true, earned: true, rbi: true },
        runnerAdvances: [
          {
            runnerId: tiebreakerRunnerId,
            from: 'second',
            to: 'home',
            cause: 'batted_ball',
            countsRun: true,
            ...(options.tiebreakerEarned === undefined ? {} : { earned: options.tiebreakerEarned }),
            rbi: true
          }
        ],
        outsOnPlay: 0,
        runsBattedIn: 2
      });
      expect(verifyDiamondLedger(game.ledger)).toBe(true);
      expect(replayDiamondLedger(game.ledger).state).toEqual(game.ledger.state);
      return { ledger: game.ledger, stats: projectDiamondStats(game.ledger) };
    };

    const oldClient = scoreTwoRunHomer();
    expect(oldClient.stats.teams.away.R).toBe(2);
    expect(oldClient.stats.coverage.pitching).toBe('partial');
    expect(oldClient.stats.players['home-1'].raw.pitching).toMatchObject({ APP: 1, R: 1, ER: 0 });
    expect(oldClient.stats.players['home-reliever'].raw.pitching).toMatchObject({
      APP: 1,
      R: 1,
      ER: 1,
      inheritedRunners: 1,
      inheritedScored: 1
    });

    const explicit = scoreTwoRunHomer({ chargedToPitcherId: 'home-1', tiebreakerEarned: true });
    expect(explicit.stats.players['home-1'].raw.pitching).toMatchObject({ APP: 1, R: 1, ER: 1 });
    expect(explicit.stats.players['home-reliever'].raw.pitching).toMatchObject({
      APP: 1,
      R: 1,
      ER: 1,
      inheritedRunners: 1,
      inheritedScored: 1
    });
  });

  it('projects active same-personnel pitcher alignments exactly once per entry and preserves later responsibility', () => {
    const game = createHarness('baseball-nfhs', 'quick');
    configureGame(game);
    game.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    game.submit('record_plate_appearance', {
      batterId: 'away-2',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [{ runnerId: 'away-1', from: 'first', to: 'second', cause: 'batted_ball' }],
      outsOnPlay: 0
    });

    const swapToCatcher = () =>
      game.submit('set_defensive_alignment', {
        side: 'home',
        assignments: [
          { playerId: 'home-2', position: 'P' },
          { playerId: 'home-1', position: 'C' },
          { playerId: 'home-3', position: 'SS' }
        ]
      });
    const swapBackToStarter = () =>
      game.submit('set_defensive_alignment', {
        side: 'home',
        assignments: [
          { playerId: 'home-1', position: 'P' },
          { playerId: 'home-2', position: 'C' },
          { playerId: 'home-3', position: 'SS' }
        ]
      });

    swapToCatcher();
    swapToCatcher();
    swapBackToStarter();
    swapToCatcher();
    game.submit('advance_runner', {
      runnerId: 'away-1',
      from: 'second',
      to: 'home',
      cause: 'batted_ball',
      countsRun: true,
      earned: false
    });
    game.submit('advance_runner', {
      runnerId: 'away-2',
      from: 'first',
      to: 'out',
      cause: 'pickoff',
      outKind: 'tag',
      fielding: { putoutBy: 'home-1' }
    });

    const stats = projectDiamondStats(game.ledger);
    expect(stats.players['home-1'].raw.pitching).toMatchObject({ APP: 1, GS: 1, R: 1, ER: 0, inheritedRunners: 2 });
    expect(stats.players['home-2'].raw.pitching).toMatchObject({
      APP: 1,
      GS: 0,
      outs: 1,
      inheritedRunners: 4,
      inheritedScored: 1
    });
    expect(stats.players['home-2'].sources['pitching.APP']).toHaveLength(1);
    expect(stats.players['home-2'].sources['pitching.inheritedRunners']).toHaveLength(2);
    expect(stats.players['home-1'].raw.fielding.defensiveOuts).toBe(1);
    expect(stats.players['home-2'].raw.fielding.defensiveOuts).toBe(1);
    expect(stats.players['home-3'].raw.fielding.defensiveOuts).toBe(1);
    expect(verifyDiamondLedger(game.ledger)).toBe(true);
    expect(replayDiamondLedger(game.ledger).state).toEqual(game.ledger.state);
    expect(projectDiamondStats(game.ledger)).toEqual(stats);
  });

  it('does not count planned offensive or closed-half pitcher assignments as pitching entries', () => {
    const ready = createHarness('baseball-nfhs', 'quick');
    configureGame(ready, { start: false });
    ready.submit('set_defensive_alignment', {
      side: 'home',
      assignments: [
        { playerId: 'home-2', position: 'P' },
        { playerId: 'home-1', position: 'C' },
        { playerId: 'home-3', position: 'SS' }
      ]
    });
    expect(projectDiamondStats(ready.ledger).players['home-2']).toBeUndefined();
    ready.submit('start', {});
    expect(projectDiamondStats(ready.ledger).players['home-2'].raw.pitching).toMatchObject({ APP: 1, GS: 1 });

    const offensive = createHarness('baseball-nfhs', 'quick');
    configureGame(offensive);
    offensive.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    offensive.submit('set_defensive_alignment', {
      side: 'away',
      assignments: [
        { playerId: 'away-2', position: 'P' },
        { playerId: 'away-1', position: 'C' },
        { playerId: 'away-3', position: 'SS' }
      ]
    });
    offensive.submit('substitute', {
      side: 'away',
      battingSlot: 2,
      outgoingPlayerId: 'away-2',
      incomingPlayerId: 'away-planned-pitcher',
      defensivePosition: 'P'
    });
    offensive.submit('re_enter', {
      side: 'away',
      battingSlot: 2,
      starterPlayerId: 'away-2',
      replacedPlayerId: 'away-planned-pitcher',
      defensivePosition: 'P'
    });
    offensive.submit('rules_decision', {
      code: 'end_game_weather',
      description: 'The game ended before the batting team returned to the field.'
    });
    offensive.submit('finalize', { confirmed: true });

    const offensiveStats = projectDiamondStats(offensive.ledger);
    expect(offensiveStats.players['away-planned-pitcher'].raw.batting.G).toBe(1);
    expect(offensiveStats.players['away-planned-pitcher'].raw.pitching).toMatchObject({ APP: 0, inheritedRunners: 0 });
    expect(offensiveStats.players['away-1'].raw.pitching).toMatchObject({ APP: 1, GS: 1, inheritedRunners: 0 });
    expect(offensiveStats.players['away-2'].raw.pitching).toMatchObject({ APP: 0, GS: 0, inheritedRunners: 0 });

    const closedHalf = createHarness('baseball-nfhs', 'quick');
    configureGame(closedHalf);
    closedHalf.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    recordOut(closedHalf);
    recordOut(closedHalf);
    recordOut(closedHalf);
    expect(closedHalf.ledger.state).toMatchObject({ inning: { half: 'top', outs: 3 }, bases: { first: { runnerId: 'away-1' } } });
    closedHalf.submit('set_defensive_alignment', {
      side: 'home',
      assignments: [
        { playerId: 'home-2', position: 'P' },
        { playerId: 'home-1', position: 'C' },
        { playerId: 'home-3', position: 'SS' }
      ]
    });
    const closedCourtesyRunner = closedHalf.submit(
      'add_courtesy_runner',
      {
        side: 'away',
        forPlayerId: 'away-1',
        runnerId: 'away-courtesy',
        base: 'first',
        forRole: 'pitcher'
      },
      { accept: false }
    );
    expect(closedCourtesyRunner.result.rejection?.code).toBe('half-inning-complete');
    closedHalf.submit('substitute', {
      side: 'away',
      battingSlot: 2,
      outgoingPlayerId: 'away-2',
      incomingPlayerId: 'away-between-innings',
      defensivePosition: 'C'
    });
    closedHalf.submit('suspend', { reason: 'Weather delay between half innings.' });
    closedHalf.submit('resume', {});
    expect(closedHalf.ledger.state).toMatchObject({
      lifecycle: 'active',
      inning: { half: 'top', outs: 3 },
      lineups: { away: { defense: { C: 'away-between-innings' } } }
    });
    expect(projectDiamondStats(closedHalf.ledger).players['home-2'].raw.pitching).toMatchObject({ APP: 0, inheritedRunners: 0 });
  });

  it('credits defensive pitcher substitutions and re-entries, but never the batting-side base inventory', () => {
    const game = createHarness('baseball-nfhs', 'quick');
    configureGame(game);
    finishAndAdvanceHalf(game);
    game.submit('record_plate_appearance', {
      batterId: 'home-1',
      pitcherId: 'away-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    game.submit('substitute', {
      side: 'away',
      battingSlot: 1,
      outgoingPlayerId: 'away-1',
      incomingPlayerId: 'away-reliever',
      defensivePosition: 'P'
    });
    game.submit('re_enter', {
      side: 'away',
      battingSlot: 1,
      starterPlayerId: 'away-1',
      replacedPlayerId: 'away-reliever',
      defensivePosition: 'P'
    });

    const stats = projectDiamondStats(game.ledger);
    expect(stats.players['away-reliever'].raw.pitching).toMatchObject({ APP: 1, GS: 0, inheritedRunners: 1 });
    expect(stats.players['away-1'].raw.pitching).toMatchObject({ APP: 1, GS: 1, inheritedRunners: 1 });
  });

  it('carries a substituted runner and the original pitcher responsibility through scoring and replay', () => {
    const game = createHarness('fastpitch-nfhs', 'quick');
    configureGame(game);
    game.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    const reachedOnEventId = game.ledger.state.bases.first?.reachedOnEventId;
    game.submit('substitute', {
      side: 'away',
      battingSlot: 1,
      outgoingPlayerId: 'away-1',
      incomingPlayerId: 'away-pinch-runner'
    });
    expect(game.ledger.state.bases.first).toEqual({
      runnerId: 'away-pinch-runner',
      chargedToPitcherId: 'home-1',
      courtesyForPlayerId: null,
      reachedOnEventId
    });
    game.submit('advance_runner', {
      runnerId: 'away-pinch-runner',
      from: 'first',
      to: 'home',
      cause: 'batted_ball',
      countsRun: true,
      earned: true,
      rbi: false
    });

    const stats = projectDiamondStats(game.ledger);
    expect(stats.players['away-pinch-runner'].raw).toMatchObject({ batting: { G: 1, R: 1 }, baserunning: { advances: 1 } });
    expect(stats.players['home-1'].raw.pitching).toMatchObject({ R: 1, ER: 1 });
    expect(verifyDiamondLedger(game.ledger)).toBe(true);
    expect(replayDiamondLedger(game.ledger).state).toEqual(game.ledger.state);
    expect(projectDiamondStats(game.ledger)).toEqual(stats);
  });

  it('pins an inherited runner to the responsible pitcher and applies explicit earned-run and RBI decisions', () => {
    const game = createHarness('baseball-nfhs', 'full');
    configureGame(game);
    recordPitch(game);
    game.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    game.submit('substitute', {
      side: 'home',
      battingSlot: 1,
      outgoingPlayerId: 'home-1',
      incomingPlayerId: 'home-reliever',
      defensivePosition: 'P'
    });

    recordPitch(game);
    const scoringPlay = game.submit('record_plate_appearance', {
      batterId: 'away-2',
      pitcherId: 'home-reliever',
      result: 'double',
      batterAdvance: { to: 'second' },
      runnerAdvances: [
        {
          runnerId: 'away-1',
          from: 'first',
          to: 'home',
          cause: 'batted_ball',
          countsRun: true,
          earned: false,
          rbi: false
        }
      ],
      outsOnPlay: 0
    });
    game.submit('record_fielding', {
      playEventId: scoringPlay.event!.eventId,
      fielding: { errors: [{ playerId: 'home-3', kind: 'throwing' }] }
    });
    game.submit('record_scoring_judgment', {
      playEventId: scoringPlay.event!.eventId,
      runnerId: 'away-1',
      responsiblePitcherId: 'home-1',
      earned: true,
      rbi: true,
      pitcherOfRecord: { side: 'home', playerId: 'home-1', decision: 'loss' }
    });

    const stats = projectDiamondStats(game.ledger);
    expect(stats.players['home-1'].raw.pitching).toMatchObject({ R: 1, ER: 1, L: 0 });
    expect(stats.players['home-reliever'].raw.pitching).toMatchObject({
      R: 0,
      ER: 0,
      inheritedRunners: 1,
      inheritedScored: 1
    });
    expect(stats.players['away-2'].raw.batting.RBI).toBe(1);
    expect(stats.players['home-3'].raw.fielding.E).toBe(1);
    expect(stats.teams.home.E).toBe(1);
    expect(stats.coverage).toEqual(COMPLETE_COVERAGE);
  });

  it('applies aggregate RBI judgments across corrected play identities and voids', () => {
    const plateAppearance = createHarness('baseball-nfhs', 'quick');
    configureGame(plateAppearance);
    plateAppearance.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    plateAppearance.submit('substitute', {
      side: 'home',
      battingSlot: 1,
      outgoingPlayerId: 'home-1',
      incomingPlayerId: 'home-reliever',
      defensivePosition: 'P'
    });
    const scoringPayload = {
      batterId: 'away-2',
      pitcherId: 'home-reliever',
      result: 'double' as const,
      batterAdvance: { to: 'second' as const },
      runnerAdvances: [
        {
          runnerId: 'away-1',
          from: 'first' as const,
          to: 'home' as const,
          cause: 'batted_ball' as const,
          countsRun: true,
          earned: false,
          rbi: false
        }
      ],
      outsOnPlay: 0,
      runsBattedIn: 0
    };
    const scoringPlay = plateAppearance.submit('record_plate_appearance', scoringPayload);
    plateAppearance.submit('record_scoring_judgment', {
      playEventId: scoringPlay.event!.eventId,
      runnerId: 'away-1',
      responsiblePitcherId: 'home-1',
      earned: false,
      rbi: false
    });
    const correction = plateAppearance.submit('supersede_event', {
      targetEventId: scoringPlay.event!.eventId,
      reason: 'Re-enter the official double while preserving the corrected play identity.',
      replacement: { type: 'record_plate_appearance', payload: scoringPayload }
    });
    plateAppearance.submit('record_scoring_judgment', {
      playEventId: correction.event!.eventId,
      runnerId: 'away-1',
      responsiblePitcherId: 'home-reliever',
      earned: true,
      rbi: true
    });

    let projected = projectDiamondStats(plateAppearance.ledger);
    expect(projected.players['home-1'].raw.pitching).toMatchObject({ R: 0, ER: 0 });
    expect(projected.players['home-reliever'].raw.pitching).toMatchObject({ R: 1, ER: 1, inheritedScored: 0 });
    expect(projected.players['away-2'].raw.batting.RBI).toBe(1);
    expect(projected.checkpointHash).toBe(createDiamondCheckpoint(plateAppearance.ledger).previousHash);

    const latestOriginal = plateAppearance.submit('record_scoring_judgment', {
      playEventId: scoringPlay.event!.eventId,
      runnerId: 'away-1',
      responsiblePitcherId: 'home-1',
      earned: false,
      rbi: false
    });
    projected = projectDiamondStats(plateAppearance.ledger);
    expect(projected.players['home-1'].raw.pitching).toMatchObject({ R: 1, ER: 0 });
    expect(projected.players['home-reliever'].raw.pitching).toMatchObject({ R: 0, ER: 0, inheritedScored: 1 });
    expect(projected.players['away-2'].raw.batting.RBI).toBe(0);
    expect(projected.checkpointHash).toBe(createDiamondCheckpoint(plateAppearance.ledger).previousHash);

    plateAppearance.submit('void_event', {
      targetEventId: latestOriginal.event!.eventId,
      reason: 'Restore the later effective-play scoring judgment.'
    });
    projected = projectDiamondStats(plateAppearance.ledger);
    expect(projected.players['home-reliever'].raw.pitching).toMatchObject({ R: 1, ER: 1, inheritedScored: 0 });
    expect(projected.players['away-2'].raw.batting.RBI).toBe(1);
    expect(projected.checkpointHash).toBe(createDiamondCheckpoint(plateAppearance.ledger).previousHash);
    expect(projectDiamondStats(plateAppearance.ledger)).toEqual(projected);
    expect(replayDiamondLedger(plateAppearance.ledger).state).toEqual(plateAppearance.ledger.state);

    const standalone = createHarness('baseball-nfhs', 'quick');
    configureGame(standalone);
    const runnerId = placeRunnerOnBase(standalone, 'third');
    const advancePayload = {
      runnerId,
      from: 'third' as const,
      to: 'home' as const,
      cause: 'batted_ball' as const,
      countsRun: true,
      earned: false,
      rbi: false
    };
    const advance = standalone.submit('advance_runner', advancePayload);
    standalone.submit('record_scoring_judgment', {
      playEventId: advance.event!.eventId,
      runnerId,
      earned: false
    });
    const advanceCorrection = standalone.submit('supersede_event', {
      targetEventId: advance.event!.eventId,
      reason: 'Re-enter the scoring advance under the corrected event identity.',
      replacement: { type: 'advance_runner', payload: advancePayload }
    });
    standalone.submit('record_scoring_judgment', {
      playEventId: advanceCorrection.event!.eventId,
      runnerId,
      earned: true
    });
    expect(projectDiamondStats(standalone.ledger).players['home-1'].raw.pitching.ER).toBe(1);
    expect(replayDiamondLedger(standalone.ledger).state).toEqual(standalone.ledger.state);
  });

  it('replays parent-valid single-run aggregate RBI judgments when the baseline is forced', () => {
    const cases = [
      { name: 'credited baseline', aggregate: 1, judgment: false, adjusted: 0 },
      { name: 'uncredited baseline', aggregate: 0, judgment: true, adjusted: 1 }
    ] as const;

    cases.forEach(({ name, aggregate, judgment, adjusted }) => {
      const game = createHarness('baseball-nfhs', 'quick');
      configureGame(game);
      const { batterId, pitcherId } = currentMatchup(game);
      const play = game.submit('record_plate_appearance', {
        batterId,
        pitcherId,
        result: 'home_run',
        batterAdvance: { to: 'home', cause: 'batted_ball', countsRun: true, earned: true },
        runnerAdvances: [],
        outsOnPlay: 0,
        runsBattedIn: aggregate
      });
      const judgmentEvent = game.submit('record_scoring_judgment', {
        playEventId: play.event!.eventId,
        runnerId: batterId,
        rbi: judgment
      });

      expect(projectDiamondStats(game.ledger).players[batterId].raw.batting.RBI, name).toBe(adjusted);
      expect(verifyDiamondLedger(game.ledger), name).toBe(true);
      expect(replayDiamondLedger(game.ledger).state, name).toEqual(game.ledger.state);

      game.submit('void_event', {
        targetEventId: judgmentEvent.event!.eventId,
        reason: `Restore the ${name} aggregate RBI baseline forced by the only scoring runner.`
      });
      const restored = projectDiamondStats(game.ledger);
      expect(restored.players[batterId].raw.batting.RBI, name).toBe(aggregate);
      expect(restored.checkpointHash, name).toBe(createDiamondCheckpoint(game.ledger).previousHash);
      expect(verifyDiamondLedger(game.ledger), name).toBe(true);
      expect(replayDiamondLedger(game.ledger).state, name).toEqual(game.ledger.state);
    });
  });

  it('derives forced all-or-none aggregate RBI values for unattributed runners', () => {
    const cases = [
      { name: 'all unattributed runners forced false', explicitRbi: true, aggregate: 1, judgment: true, adjusted: 2 },
      { name: 'all unattributed runners forced true', explicitRbi: false, aggregate: 2, judgment: false, adjusted: 1 }
    ] as const;

    cases.forEach(({ name, explicitRbi, aggregate, judgment, adjusted }) => {
      const game = createHarness('baseball-nfhs', 'quick');
      configureGame(game);
      const explicitRunnerId = placeRunnerOnBase(game, 'third');
      const judgedRunnerId = placeRunnerOnBase(game, 'second');
      const { batterId, pitcherId } = currentMatchup(game);
      const play = game.submit('record_plate_appearance', {
        batterId,
        pitcherId,
        result: 'home_run',
        batterAdvance: { to: 'home', cause: 'batted_ball', countsRun: true, earned: true },
        runnerAdvances: [
          {
            runnerId: explicitRunnerId,
            from: 'third',
            to: 'home',
            cause: 'batted_ball',
            countsRun: true,
            earned: true,
            rbi: explicitRbi
          },
          {
            runnerId: judgedRunnerId,
            from: 'second',
            to: 'home',
            cause: 'batted_ball',
            countsRun: true,
            earned: true
          }
        ],
        outsOnPlay: 0,
        runsBattedIn: aggregate
      });
      const baseline = projectDiamondStats(game.ledger);
      expect(baseline.players[batterId].raw.batting.RBI, name).toBe(aggregate);
      const judgmentEvent = game.submit('record_scoring_judgment', {
        playEventId: play.event!.eventId,
        runnerId: judgedRunnerId,
        rbi: judgment
      });

      expect(projectDiamondStats(game.ledger).players[batterId].raw.batting.RBI, name).toBe(adjusted);
      expect(verifyDiamondLedger(game.ledger), name).toBe(true);
      expect(replayDiamondLedger(game.ledger).state, name).toEqual(game.ledger.state);

      game.submit('void_event', {
        targetEventId: judgmentEvent.event!.eventId,
        reason: `Restore the ${name} aggregate RBI baseline.`
      });
      const restored = projectDiamondStats(game.ledger);
      expect(restored.players[batterId].raw.batting.RBI, name).toBe(aggregate);
      expect(restored.checkpointHash, name).toBe(createDiamondCheckpoint(game.ledger).previousHash);
      expect(verifyDiamondLedger(game.ledger), name).toBe(true);
      expect(replayDiamondLedger(game.ledger).state, name).toEqual(game.ledger.state);
    });
  });

  it('preserves exact-parent interior aggregate RBI constraints through order, correction, void, replay, and checkpoints', () => {
    const game = createHarness('baseball-nfhs', 'quick');
    configureGame(game);
    const leadRunnerId = placeRunnerOnBase(game, 'third');
    const trailRunnerId = placeRunnerOnBase(game, 'second');
    const { batterId, pitcherId } = currentMatchup(game);
    const scoringPayload = {
      batterId,
      pitcherId,
      result: 'double' as const,
      batterAdvance: { to: 'second' as const },
      runnerAdvances: [
        {
          runnerId: leadRunnerId,
          from: 'third' as const,
          to: 'home' as const,
          cause: 'batted_ball' as const,
          countsRun: true,
          earned: true
        },
        {
          runnerId: trailRunnerId,
          from: 'second' as const,
          to: 'home' as const,
          cause: 'batted_ball' as const,
          countsRun: true,
          earned: true
        }
      ],
      outsOnPlay: 0,
      runsBattedIn: 1
    };
    const play = game.submit('record_plate_appearance', scoringPayload);
    const expectStableRbi = (expected: number, label: string) => {
      const projected = projectDiamondStats(game.ledger);
      const checkpoint = createDiamondCheckpoint(game.ledger);
      expect(projected.players[batterId].raw.batting.RBI, label).toBe(expected);
      expect(projected.checkpointHash, label).toBe(checkpoint.previousHash);
      expect(verifyDiamondLedger(game.ledger), label).toBe(true);
      expect(replayDiamondLedger(game.ledger).state, label).toEqual(game.ledger.state);
      expect(projectDiamondStats(game.ledger), label).toEqual(projected);
    };
    expectStableRbi(1, 'unattributed baseline');

    game.submit('record_scoring_judgment', {
      playEventId: play.event!.eventId,
      runnerId: leadRunnerId,
      rbi: true
    });
    expectStableRbi(1, 'one true leaves the original one-of-two allocation feasible');

    game.submit('record_scoring_judgment', {
      playEventId: play.event!.eventId,
      runnerId: leadRunnerId,
      rbi: false
    });
    expectStableRbi(1, 'later false wins while the other runner can retain the aggregate credit');

    const correctedPlay = game.submit('supersede_event', {
      targetEventId: play.event!.eventId,
      reason: 'Preserve the official play under its corrected event identity.',
      replacement: { type: 'record_plate_appearance', payload: scoringPayload }
    });
    expectStableRbi(1, 'source identity judgment survives a play correction');

    const trailFalse = game.submit('record_scoring_judgment', {
      playEventId: correctedPlay.event!.eventId,
      runnerId: trailRunnerId,
      rbi: false
    });
    expectStableRbi(0, 'both runners resolved false force the feasible allocation to zero');

    const leadTrue = game.submit('record_scoring_judgment', {
      playEventId: play.event!.eventId,
      runnerId: leadRunnerId,
      rbi: true
    });
    expectStableRbi(1, 'latest source-identity judgment wins across correction identities');

    const trailTrue = game.submit('record_scoring_judgment', {
      playEventId: correctedPlay.event!.eventId,
      runnerId: trailRunnerId,
      rbi: true
    });
    expectStableRbi(2, 'both runners resolved true force the feasible allocation to two');

    game.submit('void_event', {
      targetEventId: trailTrue.event!.eventId,
      reason: 'Restore the earlier false judgment for the trailing runner.'
    });
    expectStableRbi(1, 'voiding the latest trailing judgment restores the prior value');

    game.submit('void_event', {
      targetEventId: leadTrue.event!.eventId,
      reason: 'Restore the earlier false judgment for the lead runner.'
    });
    expectStableRbi(0, 'voiding both latest true judgments restores both false values');

    game.submit('void_event', {
      targetEventId: trailFalse.event!.eventId,
      reason: 'Leave the trailing runner unattributed again.'
    });
    expectStableRbi(1, 'one false and one unattributed runner preserve the parent aggregate');
  });

  it('combines explicit RBI deltas with an interior unattributed allocation', () => {
    const game = createHarness('baseball-nfhs', 'quick');
    configureGame(game);
    const leadRunnerId = placeRunnerOnBase(game, 'third');
    const trailRunnerId = placeRunnerOnBase(game, 'second');
    const { batterId, pitcherId } = currentMatchup(game);
    const play = game.submit('record_plate_appearance', {
      batterId,
      pitcherId,
      result: 'home_run',
      batterAdvance: { to: 'home', countsRun: true, earned: true, rbi: true },
      runnerAdvances: [
        {
          runnerId: leadRunnerId,
          from: 'third',
          to: 'home',
          cause: 'batted_ball',
          countsRun: true,
          earned: true
        },
        {
          runnerId: trailRunnerId,
          from: 'second',
          to: 'home',
          cause: 'batted_ball',
          countsRun: true,
          earned: true
        }
      ],
      outsOnPlay: 0,
      runsBattedIn: 2
    });
    const rbi = () => projectDiamondStats(game.ledger).players[batterId].raw.batting.RBI;
    expect(rbi()).toBe(2);

    game.submit('record_scoring_judgment', { playEventId: play.event!.eventId, runnerId: batterId, rbi: false });
    expect(rbi()).toBe(1);
    game.submit('record_scoring_judgment', { playEventId: play.event!.eventId, runnerId: leadRunnerId, rbi: false });
    expect(rbi()).toBe(1);
    game.submit('record_scoring_judgment', { playEventId: play.event!.eventId, runnerId: trailRunnerId, rbi: false });
    expect(rbi()).toBe(0);
    game.submit('record_scoring_judgment', { playEventId: play.event!.eventId, runnerId: leadRunnerId, rbi: true });
    expect(rbi()).toBe(1);
    game.submit('record_scoring_judgment', { playEventId: play.event!.eventId, runnerId: batterId, rbi: true });
    expect(rbi()).toBe(2);
    expect(verifyDiamondLedger(game.ledger)).toBe(true);
    expect(replayDiamondLedger(game.ledger).state).toEqual(game.ledger.state);
  });

  it('rejects aggregate RBI totals outside the explicit and unattributed runner range', () => {
    const cases = [
      { name: 'below explicit credit', aggregate: 0, rbis: [true, undefined] },
      { name: 'above possible credit', aggregate: 2, rbis: [false, undefined] },
      { name: 'different from complete attribution', aggregate: 1, rbis: [true, true] }
    ] as const;

    cases.forEach(({ name, aggregate, rbis }) => {
      const game = createHarness('baseball-nfhs', 'quick');
      configureGame(game);
      const leadRunnerId = placeRunnerOnBase(game, 'third');
      const trailRunnerId = placeRunnerOnBase(game, 'second');
      const { batterId, pitcherId } = currentMatchup(game);
      const baselineCheckpoint = createDiamondCheckpoint(game.ledger);
      const rejected = game.submit(
        'record_plate_appearance',
        {
          batterId,
          pitcherId,
          result: 'double',
          batterAdvance: { to: 'second' },
          runnerAdvances: [
            {
              runnerId: leadRunnerId,
              from: 'third',
              to: 'home',
              cause: 'batted_ball',
              countsRun: true,
              earned: true,
              ...(rbis[0] === undefined ? {} : { rbi: rbis[0] })
            },
            {
              runnerId: trailRunnerId,
              from: 'second',
              to: 'home',
              cause: 'batted_ball',
              countsRun: true,
              earned: true,
              ...(rbis[1] === undefined ? {} : { rbi: rbis[1] })
            }
          ],
          outsOnPlay: 0,
          runsBattedIn: aggregate
        },
        { accept: false }
      );

      expect(rejected.result, name).toMatchObject({
        outcome: 'rejected',
        revision: baselineCheckpoint.sequence,
        rejection: { code: 'invalid-rbi' }
      });
      expect(createDiamondCheckpoint(game.ledger), name).toEqual(baselineCheckpoint);
      expect(replayDiamondLedger(game.ledger).state, name).toEqual(game.ledger.state);
    });
  });

  it('merges inline and detached fielding evidence without duplicate per-play credit', () => {
    const doublePlay = createHarness('baseball-nfhs', 'quick');
    configureGame(doublePlay);
    placeRunnerOnBase(doublePlay, 'first');
    const playPayload = {
      batterId: 'away-2',
      pitcherId: 'home-1',
      result: 'double_play' as const,
      batterAdvance: { to: 'out' as const, outKind: 'batter_runner' as const },
      runnerAdvances: [
        {
          runnerId: 'away-1',
          from: 'first' as const,
          to: 'out' as const,
          cause: 'force_out' as const,
          outKind: 'force' as const
        }
      ],
      outsOnPlay: 2,
      fielding: {
        putoutBy: 'home-2',
        assists: ['home-3'],
        errors: [{ playerId: 'home-3' }],
        passedBallBy: 'home-2',
        doublePlay: true
      }
    };
    const play = doublePlay.submit('record_plate_appearance', playPayload);
    const duplicateAttachment = doublePlay.submit('record_fielding', {
      playEventId: play.event!.eventId,
      fielding: {
        putoutBy: 'home-2',
        assists: ['home-3'],
        errors: [{ playerId: 'home-3', kind: 'throwing' }],
        passedBallBy: 'home-2',
        doublePlay: true
      }
    });
    const correction = doublePlay.submit('supersede_event', {
      targetEventId: play.event!.eventId,
      reason: 'Preserve the same official double play under its corrected event identity.',
      replacement: { type: 'record_plate_appearance', payload: playPayload }
    });
    doublePlay.submit('record_fielding', {
      playEventId: correction.event!.eventId,
      fielding: {
        putoutBy: 'home-1',
        assists: ['home-1'],
        errors: [{ playerId: 'home-1', kind: 'fielding' }],
        doublePlay: true
      }
    });

    let projected = projectDiamondStats(doublePlay.ledger);
    expect(projected.players['home-2'].raw.fielding).toMatchObject({ PO: 1, PB: 1, DP: 1 });
    expect(projected.players['home-3'].raw.fielding).toMatchObject({ A: 1, E: 1, DP: 1 });
    expect(projected.players['home-1'].raw.fielding).toMatchObject({ PO: 1, A: 1, E: 1, DP: 1 });
    expect(projected.teams.home.E).toBe(2);

    doublePlay.submit('void_event', {
      targetEventId: duplicateAttachment.event!.eventId,
      reason: 'Remove redundant fielding detail without changing the merged result.'
    });
    projected = projectDiamondStats(doublePlay.ledger);
    expect(projected.players['home-2'].raw.fielding).toMatchObject({ PO: 1, PB: 1, DP: 1 });
    expect(projected.players['home-3'].raw.fielding).toMatchObject({ A: 1, E: 1, DP: 1 });
    expect(projected.players['home-1'].raw.fielding).toMatchObject({ PO: 1, A: 1, E: 1, DP: 1 });
    expect(projected.teams.home.E).toBe(2);
    expect(projectDiamondStats(doublePlay.ledger)).toEqual(projected);
    expect(replayDiamondLedger(doublePlay.ledger).state).toEqual(doublePlay.ledger.state);

    const triplePlay = createHarness('baseball-nfhs', 'quick');
    configureGame(triplePlay);
    placeRunnerOnBase(triplePlay, 'first');
    triplePlay.submit('record_plate_appearance', {
      batterId: 'away-2',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [{ runnerId: 'away-1', from: 'first', to: 'second', cause: 'batted_ball' }],
      outsOnPlay: 0
    });
    const triple = triplePlay.submit('record_plate_appearance', {
      batterId: 'away-3',
      pitcherId: 'home-1',
      result: 'triple_play',
      batterAdvance: { to: 'out', outKind: 'batter_runner' },
      runnerAdvances: [
        { runnerId: 'away-1', from: 'second', to: 'out', cause: 'force_out', outKind: 'force' },
        { runnerId: 'away-2', from: 'first', to: 'out', cause: 'force_out', outKind: 'force' }
      ],
      outsOnPlay: 3,
      fielding: { putoutBy: 'home-2', assists: ['home-3'], triplePlay: true }
    });
    triplePlay.submit('record_fielding', {
      playEventId: triple.event!.eventId,
      fielding: { putoutBy: 'home-2', assists: ['home-3'], triplePlay: true }
    });
    const tripleStats = projectDiamondStats(triplePlay.ledger);
    expect(tripleStats.players['home-2'].raw.fielding).toMatchObject({ PO: 1, TP: 1 });
    expect(tripleStats.players['home-3'].raw.fielding).toMatchObject({ A: 1, TP: 1 });

    const standalone = createHarness('baseball-nfhs', 'quick');
    configureGame(standalone);
    const runnerId = placeRunnerOnBase(standalone, 'first');
    const runnerOut = standalone.submit('advance_runner', {
      runnerId,
      from: 'first',
      to: 'out',
      cause: 'tag_out',
      outKind: 'tag',
      fielding: {
        putoutBy: 'home-2',
        assists: ['home-3'],
        errors: [
          { playerId: 'home-3', kind: 'throwing' },
          { playerId: 'home-3', kind: 'throwing' }
        ]
      }
    });
    const extraDetail = standalone.submit('record_fielding', {
      playEventId: runnerOut.event!.eventId,
      fielding: {
        putoutBy: 'home-2',
        assists: ['home-3', 'home-1'],
        errors: [
          { playerId: 'home-3', kind: 'throwing' },
          { playerId: 'home-3', kind: 'fielding' },
          { playerId: 'home-1', kind: 'fielding' }
        ]
      }
    });
    let standaloneStats = projectDiamondStats(standalone.ledger);
    expect(standaloneStats.players['home-2'].raw.fielding.PO).toBe(1);
    expect(standaloneStats.players['home-3'].raw.fielding).toMatchObject({ A: 1, E: 3 });
    expect(standaloneStats.players['home-1'].raw.fielding).toMatchObject({ A: 1, E: 1 });
    expect(standaloneStats.teams.home.E).toBe(4);
    standalone.submit('void_event', {
      targetEventId: extraDetail.event!.eventId,
      reason: 'Remove the added detached fielding detail.'
    });
    standaloneStats = projectDiamondStats(standalone.ledger);
    expect(standaloneStats.players['home-2'].raw.fielding.PO).toBe(1);
    expect(standaloneStats.players['home-3'].raw.fielding).toMatchObject({ A: 1, E: 2 });
    expect(standaloneStats.players['home-1'].raw.fielding).toMatchObject({ A: 0, E: 0 });
    expect(standaloneStats.teams.home.E).toBe(2);
    expect(replayDiamondLedger(standalone.ledger).state).toEqual(standalone.ledger.state);

    const sharedPitch = createHarness('baseball-nfhs', 'quick');
    configureGame(sharedPitch);
    placeRunnerOnBase(sharedPitch, 'first');
    sharedPitch.submit('record_plate_appearance', {
      batterId: 'away-2',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [{ runnerId: 'away-1', from: 'first', to: 'second', cause: 'batted_ball' }],
      outsOnPlay: 0
    });
    sharedPitch.submit('record_pitch', { batterId: 'away-3', pitcherId: 'home-1', result: 'ball' });
    const firstAdvance = sharedPitch.submit('advance_runner', {
      runnerId: 'away-1',
      from: 'second',
      to: 'third',
      cause: 'passed_ball',
      fielding: { passedBallBy: 'home-2' }
    });
    sharedPitch.submit('advance_runner', {
      runnerId: 'away-2',
      from: 'first',
      to: 'second',
      cause: 'passed_ball',
      fielding: { passedBallBy: 'home-2' }
    });
    sharedPitch.submit('record_fielding', {
      playEventId: firstAdvance.event!.eventId,
      fielding: { passedBallBy: 'home-2' }
    });
    expect(projectDiamondStats(sharedPitch.ledger).players['home-2'].raw.fielding.PB).toBe(1);
  });

  it('preserves one-fielder putout multiplicity on unassisted multi-out plays without counting duplicate evidence', () => {
    for (const outsOnPlay of [2, 3] as const) {
      const game = createHarness('baseball-nfhs', 'full');
      configureGame(game);
      placeRunnerOnBase(game, 'first');
      if (outsOnPlay === 3) {
        game.submit('record_plate_appearance', {
          batterId: 'away-2',
          pitcherId: 'home-1',
          result: 'single',
          batterAdvance: { to: 'first' },
          runnerAdvances: [{ runnerId: 'away-1', from: 'first', to: 'second', cause: 'batted_ball' }],
          outsOnPlay: 0
        });
      }
      recordPitch(game, 'in_play');
      const matchup = currentMatchup(game);
      const play = game.submit('record_plate_appearance', {
        ...matchup,
        result: outsOnPlay === 2 ? 'double_play' : 'triple_play',
        batterAdvance: { to: 'out', outKind: 'batter_runner' },
        runnerAdvances:
          outsOnPlay === 2
            ? [{ runnerId: 'away-1', from: 'first', to: 'out', cause: 'appeal_out', outKind: 'appeal' }]
            : [
                { runnerId: 'away-1', from: 'second', to: 'out', cause: 'appeal_out', outKind: 'appeal' },
                { runnerId: 'away-2', from: 'first', to: 'out', cause: 'appeal_out', outKind: 'appeal' }
              ],
        outsOnPlay,
        fielding: {
          putoutBy: 'home-3',
          ...(outsOnPlay === 2 ? { doublePlay: true } : { triplePlay: true })
        }
      });
      const duplicate = game.submit('record_fielding', {
        playEventId: play.event!.eventId,
        fielding: {
          putoutBy: 'home-3',
          ...(outsOnPlay === 2 ? { doublePlay: true } : { triplePlay: true })
        }
      });
      const extra = game.submit('record_fielding', {
        playEventId: play.event!.eventId,
        fielding: {
          putoutBy: 'home-3',
          ...(outsOnPlay === 2 ? { doublePlay: true } : { triplePlay: true })
        }
      });

      let projected = projectDiamondStats(game.ledger);
      expect(projected.players['home-3'].raw.fielding).toMatchObject({
        PO: outsOnPlay,
        [outsOnPlay === 2 ? 'DP' : 'TP']: 1
      });
      expect(projected.coverage.fielding).toBe('complete');
      game.submit('void_event', {
        targetEventId: duplicate.event!.eventId,
        reason: 'Remove duplicate fielding evidence without changing the canonical unassisted outs.'
      });
      projected = projectDiamondStats(game.ledger);
      expect(projected.players['home-3'].raw.fielding).toMatchObject({
        PO: outsOnPlay,
        [outsOnPlay === 2 ? 'DP' : 'TP']: 1
      });
      game.submit('void_event', {
        targetEventId: extra.event!.eventId,
        reason: 'Leave only the inline unassisted fielding chain as canonical out evidence.'
      });
      projected = projectDiamondStats(game.ledger);
      expect(projected.players['home-3'].raw.fielding).toMatchObject({
        PO: outsOnPlay,
        [outsOnPlay === 2 ? 'DP' : 'TP']: 1
      });
      expect(projected.coverage.fielding).toBe('complete');
      expect(replayDiamondLedger(game.ledger).state).toEqual(game.ledger.state);
    }

    const assistedIncomplete = createHarness('baseball-nfhs', 'full');
    configureGame(assistedIncomplete);
    placeRunnerOnBase(assistedIncomplete, 'first');
    recordPitch(assistedIncomplete, 'in_play');
    assistedIncomplete.submit('record_plate_appearance', {
      batterId: 'away-2',
      pitcherId: 'home-1',
      result: 'double_play',
      batterAdvance: { to: 'out', outKind: 'batter_runner' },
      runnerAdvances: [{ runnerId: 'away-1', from: 'first', to: 'out', cause: 'force_out', outKind: 'force' }],
      outsOnPlay: 2,
      fielding: { putoutBy: 'home-2', assists: ['home-3'], doublePlay: true }
    });
    const assistedStats = projectDiamondStats(assistedIncomplete.ledger);
    expect(assistedStats.players['home-2'].raw.fielding.PO).toBe(1);
    expect(assistedStats.coverage.fielding).toBe('partial');

    const twoOfThreeIncomplete = createHarness('baseball-nfhs', 'full');
    configureGame(twoOfThreeIncomplete);
    placeRunnerOnBase(twoOfThreeIncomplete, 'first');
    twoOfThreeIncomplete.submit('record_plate_appearance', {
      batterId: 'away-2',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [{ runnerId: 'away-1', from: 'first', to: 'second', cause: 'batted_ball' }],
      outsOnPlay: 0
    });
    recordPitch(twoOfThreeIncomplete, 'in_play');
    const partialTriple = twoOfThreeIncomplete.submit('record_plate_appearance', {
      batterId: 'away-3',
      pitcherId: 'home-1',
      result: 'triple_play',
      batterAdvance: { to: 'out', outKind: 'batter_runner' },
      runnerAdvances: [
        { runnerId: 'away-1', from: 'second', to: 'out', cause: 'force_out', outKind: 'force' },
        { runnerId: 'away-2', from: 'first', to: 'out', cause: 'force_out', outKind: 'force' }
      ],
      outsOnPlay: 3,
      fielding: { putoutBy: 'home-2', triplePlay: true }
    });
    twoOfThreeIncomplete.submit('record_fielding', {
      playEventId: partialTriple.event!.eventId,
      fielding: { putoutBy: 'home-3', triplePlay: true }
    });
    const partialTripleStats = projectDiamondStats(twoOfThreeIncomplete.ledger);
    expect(partialTripleStats.players['home-2'].raw.fielding.PO).toBe(1);
    expect(partialTripleStats.players['home-3'].raw.fielding.PO).toBe(1);
    expect(partialTripleStats.coverage.fielding).toBe('partial');

    const overcreditedOneOut = createHarness('baseball-nfhs', 'quick');
    configureGame(overcreditedOneOut);
    recordPitch(overcreditedOneOut, 'in_play');
    const oneOutMatchup = currentMatchup(overcreditedOneOut);
    const oneOutPlay = overcreditedOneOut.submit('record_plate_appearance', {
      ...oneOutMatchup,
      result: 'ground_out',
      batterAdvance: { to: 'out', outKind: 'batter_runner' },
      runnerAdvances: [],
      outsOnPlay: 1,
      fielding: { putoutBy: 'home-2' }
    });
    expectRejected(
      overcreditedOneOut.submit(
        'record_fielding',
        { playEventId: oneOutPlay.event!.eventId, fielding: { putoutBy: 'home-3' } },
        { accept: false }
      ),
      'fielding-outs-mismatch',
      overcreditedOneOut.ledger.state.revision
    );
    expect(projectDiamondStats(overcreditedOneOut.ledger).players['home-2'].raw.fielding.PO).toBe(1);

    const overcreditedCorrection = createHarness('baseball-nfhs', 'quick');
    configureGame(overcreditedCorrection);
    recordPitch(overcreditedCorrection, 'in_play');
    const correctionMatchup = currentMatchup(overcreditedCorrection);
    const correctionSource = overcreditedCorrection.submit('record_plate_appearance', {
      ...correctionMatchup,
      result: 'ground_out',
      batterAdvance: { to: 'out', outKind: 'batter_runner' },
      runnerAdvances: [],
      outsOnPlay: 1
    });
    overcreditedCorrection.submit('record_fielding', {
      playEventId: correctionSource.event!.eventId,
      fielding: { putoutBy: 'home-2' }
    });
    expectRejected(
      overcreditedCorrection.submit(
        'supersede_event',
        {
          targetEventId: correctionSource.event!.eventId,
          reason: 'A correction cannot introduce a second putout identity for one canonical out.',
          replacement: {
            type: 'record_plate_appearance',
            payload: {
              ...correctionMatchup,
              result: 'ground_out',
              batterAdvance: { to: 'out', outKind: 'batter_runner' },
              runnerAdvances: [],
              outsOnPlay: 1,
              fielding: { putoutBy: 'home-3' }
            }
          }
        },
        { accept: false }
      ),
      'fielding-outs-mismatch',
      overcreditedCorrection.ledger.state.revision
    );
    expect(replayDiamondLedger(overcreditedCorrection.ledger).state).toEqual(overcreditedCorrection.ledger.state);

    const boundedMultiOut = createHarness('baseball-nfhs', 'full');
    configureGame(boundedMultiOut);
    placeRunnerOnBase(boundedMultiOut, 'first');
    recordPitch(boundedMultiOut, 'in_play');
    const doubleMatchup = currentMatchup(boundedMultiOut);
    const doublePlay = boundedMultiOut.submit('record_plate_appearance', {
      ...doubleMatchup,
      result: 'double_play',
      batterAdvance: { to: 'out', outKind: 'batter_runner' },
      runnerAdvances: [{ runnerId: 'away-1', from: 'first', to: 'out', cause: 'force_out', outKind: 'force' }],
      outsOnPlay: 2,
      fielding: { putoutBy: 'home-2', doublePlay: true }
    });
    boundedMultiOut.submit('record_fielding', {
      playEventId: doublePlay.event!.eventId,
      fielding: { putoutBy: 'home-3' }
    });
    expectRejected(
      boundedMultiOut.submit(
        'record_fielding',
        { playEventId: doublePlay.event!.eventId, fielding: { putoutBy: 'home-1' } },
        { accept: false }
      ),
      'fielding-outs-mismatch',
      boundedMultiOut.ledger.state.revision
    );
    const boundedStats = projectDiamondStats(boundedMultiOut.ledger);
    expect(boundedStats.players['home-2'].raw.fielding.PO + boundedStats.players['home-3'].raw.fielding.PO).toBe(2);
    expect(boundedStats.coverage.fielding).toBe('complete');

    const noOut = createHarness('baseball-nfhs', 'quick');
    configureGame(noOut);
    const noOutMatchup = currentMatchup(noOut);
    const inlinePutout = noOut.submit(
      'record_plate_appearance',
      {
        ...noOutMatchup,
        result: 'single',
        batterAdvance: { to: 'first' },
        runnerAdvances: [],
        outsOnPlay: 0,
        fielding: { putoutBy: 'home-2' }
      },
      { accept: false }
    );
    expectRejected(inlinePutout, 'fielding-outs-mismatch', noOut.ledger.state.revision);
    const noOutPlay = noOut.submit('record_plate_appearance', {
      ...noOutMatchup,
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    expectRejected(
      noOut.submit(
        'advance_runner',
        {
          runnerId: noOutMatchup.batterId,
          from: 'first',
          to: 'second',
          cause: 'stolen_base',
          fielding: { putoutBy: 'home-2' }
        },
        { accept: false }
      ),
      'fielding-outs-mismatch',
      noOut.ledger.state.revision
    );
    const noOutAdvance = noOut.submit('advance_runner', {
      runnerId: noOutMatchup.batterId,
      from: 'first',
      to: 'second',
      cause: 'stolen_base'
    });
    expectRejected(
      noOut.submit('record_fielding', { playEventId: noOutAdvance.event!.eventId, fielding: { putoutBy: 'home-2' } }, { accept: false }),
      'fielding-outs-mismatch',
      noOut.ledger.state.revision
    );
    expectRejected(
      noOut.submit('record_fielding', { playEventId: noOutPlay.event!.eventId, fielding: { putoutBy: 'home-2' } }, { accept: false }),
      'fielding-outs-mismatch',
      noOut.ledger.state.revision
    );
    expectRejected(
      noOut.submit(
        'supersede_event',
        {
          targetEventId: noOutPlay.event!.eventId,
          reason: 'A correction cannot add a putout to a play with no actual out.',
          replacement: {
            type: 'record_plate_appearance',
            payload: {
              ...noOutMatchup,
              result: 'single',
              batterAdvance: { to: 'first' },
              runnerAdvances: [],
              outsOnPlay: 0,
              fielding: { putoutBy: 'home-2' }
            }
          }
        },
        { accept: false }
      ),
      'fielding-outs-mismatch',
      noOut.ledger.state.revision
    );
    noOut.submit('record_fielding', {
      playEventId: noOutPlay.event!.eventId,
      fielding: { assists: ['home-1'], errors: [{ playerId: 'home-2', kind: 'fielding' }] }
    });
    const noOutStats = projectDiamondStats(noOut.ledger);
    expect(noOutStats.players['home-2'].raw.fielding).toMatchObject({ PO: 0, E: 1 });
    expect(noOutStats.players['home-1'].raw.fielding.A).toBe(1);
  });

  it('keeps bounded checkpoint fielding completeness byte-identical to full replay', () => {
    const matrix = [
      { captureMode: 'full', assists: [] as string[], expectedCoverage: 'complete' },
      { captureMode: 'full', assists: ['home-3'], expectedCoverage: 'partial' },
      { captureMode: 'quick', assists: [] as string[], expectedCoverage: 'partial' },
      { captureMode: 'quick', assists: ['home-3'], expectedCoverage: 'partial' }
    ] as const;

    matrix.forEach(({ captureMode, assists, expectedCoverage }, index) => {
      const game = createHarness('baseball-nfhs', captureMode);
      configureGame(game);
      recordPitch(game, 'in_play');
      const reachMatchup = currentMatchup(game);
      game.submit('record_plate_appearance', {
        ...reachMatchup,
        result: 'single',
        batterAdvance: { to: 'first' },
        runnerAdvances: [],
        outsOnPlay: 0
      });
      recordPitch(game, 'in_play');
      const doubleMatchup = currentMatchup(game);
      const command = game.command('record_plate_appearance', {
        ...doubleMatchup,
        result: 'double_play',
        batterAdvance: { to: 'out', outKind: 'batter_runner' },
        runnerAdvances: [{ runnerId: reachMatchup.batterId, from: 'first', to: 'out', cause: 'force_out', outKind: 'force' }],
        outsOnPlay: 2,
        fielding: { putoutBy: 'home-2', ...(assists.length ? { assists } : {}), doublePlay: true }
      });
      const context = {
        actorUid: INITIAL_SCORER,
        eventId: `checkpoint-double-play-${captureMode}-${String(index)}`,
        serverTimestampMs: 1_900_000_100_000 + index
      } as const;
      const checkpoint = createDiamondCheckpoint(game.ledger);
      const full = executeDiamondCommand(game.ledger, command, context);
      const bounded = executeDiamondCommandFromCheckpoint(checkpoint, command, context);

      expect(full.result, full.result.rejection?.message).toMatchObject({ outcome: 'accepted' });
      expect(bounded.result, bounded.result.rejection?.message).toMatchObject({ outcome: 'accepted' });
      expect(full.ledger.state.coverage.fielding).toBe(expectedCoverage);
      expect(bounded.checkpoint.state.coverage.fielding).toBe(expectedCoverage);
      expect(bounded.checkpoint.sequence).toBe(checkpoint.sequence + 1);
      expect(bounded.checkpoint.previousHash).toBe(bounded.event?.hash);
      expect(bounded.event).toEqual(full.event);
      expect(replayDiamondLedger(full.ledger).state).toEqual(full.ledger.state);

      const duplicate = executeDiamondCommandFromCheckpoint(checkpoint, command, context, bounded.receipt);
      expect(duplicate.result).toMatchObject({ outcome: 'duplicate', revision: full.ledger.state.revision });
      expect(duplicate.event).toEqual(full.event);
    });
  });

  it('credits GIDP only for explicit ground-ball double plays through checkpoints and final corrections', () => {
    const matrix = [
      { battedBall: 'fly', runnerCause: 'appeal_out', runnerOutKind: 'appeal', expectedGidp: 0 },
      { battedBall: 'line', runnerCause: 'appeal_out', runnerOutKind: 'appeal', expectedGidp: 0 },
      { battedBall: 'ground', runnerCause: 'force_out', runnerOutKind: 'force', expectedGidp: 1 }
    ] as const;

    matrix.forEach(({ battedBall, runnerCause, runnerOutKind, expectedGidp }, index) => {
      const game = createHarness('baseball-nfhs', 'full');
      configureGame(game);
      recordPitch(game, 'in_play');
      const reachMatchup = currentMatchup(game);
      game.submit('record_plate_appearance', {
        ...reachMatchup,
        result: 'single',
        batterAdvance: { to: 'first' },
        runnerAdvances: [],
        outsOnPlay: 0
      });
      recordPitch(game, 'in_play');
      const doubleMatchup = currentMatchup(game);
      const command = game.command('record_plate_appearance', {
        ...doubleMatchup,
        result: 'double_play',
        batterAdvance: { to: 'out', outKind: 'batter_runner' },
        runnerAdvances: [
          {
            runnerId: reachMatchup.batterId,
            from: 'first',
            to: 'out',
            cause: runnerCause,
            outKind: runnerOutKind
          }
        ],
        outsOnPlay: 2,
        fielding: { putoutBy: 'home-2', doublePlay: true, battedBall }
      });
      const context = {
        actorUid: INITIAL_SCORER,
        eventId: `checkpoint-gidp-${battedBall}-${String(index)}`,
        serverTimestampMs: 1_900_000_110_000 + index
      } as const;
      const checkpoint = createDiamondCheckpoint(game.ledger);
      const full = executeDiamondCommand(game.ledger, command, context);
      const bounded = executeDiamondCommandFromCheckpoint(checkpoint, command, context);

      expect(full.result, full.result.rejection?.message).toMatchObject({ outcome: 'accepted' });
      expect(bounded.result, bounded.result.rejection?.message).toMatchObject({ outcome: 'accepted' });
      expect(bounded.checkpoint.state).toEqual(full.ledger.state);
      expect(bounded.event).toEqual(full.event);
      const stats = projectDiamondStats(full.ledger);
      expect(stats.players[doubleMatchup.batterId].raw.batting.GIDP).toBe(expectedGidp);
      expect(stats.players[doubleMatchup.batterId].sources['batting.GIDP'] ?? []).toEqual(expectedGidp === 1 ? [full.event!.eventId] : []);
      expect(replayDiamondLedger(full.ledger).state).toEqual(full.ledger.state);
    });

    const corrected = createHarness('baseball-nfhs', 'full');
    configureGame(corrected);
    recordPitch(corrected, 'in_play');
    const reachMatchup = currentMatchup(corrected);
    corrected.submit('record_plate_appearance', {
      ...reachMatchup,
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    recordPitch(corrected, 'in_play');
    const doubleMatchup = currentMatchup(corrected);
    const groundPayload = {
      ...doubleMatchup,
      result: 'double_play' as const,
      batterAdvance: { to: 'out' as const, outKind: 'batter_runner' as const },
      runnerAdvances: [
        {
          runnerId: reachMatchup.batterId,
          from: 'first' as const,
          to: 'out' as const,
          cause: 'force_out' as const,
          outKind: 'force' as const
        }
      ],
      outsOnPlay: 2,
      fielding: { putoutBy: 'home-2', doublePlay: true, battedBall: 'ground' as const }
    };
    const doublePlay = corrected.submit('record_plate_appearance', groundPayload);
    corrected.submit('rules_decision', {
      code: 'end_game_weather',
      description: 'Weather made the current score official.'
    });
    corrected.submit('finalize', { confirmed: true });
    expect(projectDiamondStats(corrected.ledger).players[doubleMatchup.batterId].raw.batting.GIDP).toBe(1);

    corrected.submit('reopen_for_correction', { reason: 'Official scorer changed the ground ball to a line-drive double play.' });
    const correction = corrected.submit('supersede_event', {
      targetEventId: doublePlay.event!.eventId,
      reason: 'The runner was doubled off after a caught line drive.',
      replacement: {
        type: 'record_plate_appearance',
        payload: {
          ...groundPayload,
          runnerAdvances: [
            {
              runnerId: reachMatchup.batterId,
              from: 'first',
              to: 'out',
              cause: 'appeal_out',
              outKind: 'appeal'
            }
          ],
          fielding: { ...groundPayload.fielding, battedBall: 'line' }
        }
      }
    });
    corrected.submit('finalize', { confirmed: true });

    const correctedStats = projectDiamondStats(corrected.ledger);
    expect(corrected.ledger.state.lifecycle).toBe('final');
    expect(correctedStats.players[doubleMatchup.batterId].raw.batting.GIDP).toBe(0);
    expect(correctedStats.players[doubleMatchup.batterId].sources['batting.GIDP'] ?? []).toEqual([]);
    expect(correction.event?.supersedesEventId).toBe(doublePlay.event!.eventId);
    expect(correctedStats).toEqual(projectDiamondStats(corrected.ledger));
    expect(replayDiamondLedger(corrected.ledger).state).toEqual(corrected.ledger.state);
    expect(verifyDiamondLedger(corrected.ledger)).toBe(true);
  });

  it('exposes pitcher decisions only for the coherent effective official result', () => {
    const prepareDecisionGame = () => {
      const game = createHarness('baseball-nfhs', 'quick');
      configureGame(game);
      recordSoloHomeRun(game);
      while (game.ledger.state.inning.outs < 3) recordOut(game);
      game.submit('advance_half_inning', {});
      recordOut(game);
      game.submit('substitute', {
        side: 'away',
        battingSlot: 1,
        outgoingPlayerId: 'away-1',
        incomingPlayerId: 'away-reliever',
        defensivePosition: 'P'
      });
      const { batterId, pitcherId } = currentMatchup(game);
      const decisionPlay = game.submit('record_plate_appearance', {
        batterId,
        pitcherId,
        result: 'ground_out',
        batterAdvance: { to: 'out', outKind: 'batter_runner' },
        runnerAdvances: [],
        outsOnPlay: 1
      });
      return { game, playEventId: decisionPlay.event!.eventId };
    };

    const scored = prepareDecisionGame();
    scored.game.submit('record_scoring_judgment', {
      playEventId: scored.playEventId,
      pitcherOfRecord: { side: 'away', playerId: 'away-1', decision: 'win' }
    });
    scored.game.submit('record_scoring_judgment', {
      playEventId: scored.playEventId,
      pitcherOfRecord: { side: 'home', playerId: 'home-1', decision: 'loss' }
    });
    scored.game.submit('record_scoring_judgment', {
      playEventId: scored.playEventId,
      pitcherOfRecord: { side: 'away', playerId: 'away-reliever', decision: 'save' }
    });
    expect(projectDiamondStats(scored.game.ledger).players['away-1'].raw.pitching.W).toBe(0);
    expect(projectDiamondStats(scored.game.ledger).players['home-1'].raw.pitching.L).toBe(0);
    expect(projectDiamondStats(scored.game.ledger).players['away-reliever'].raw.pitching.SV).toBe(0);
    scored.game.submit('suspend', { reason: 'Weather delay before the official ending.' });
    expect(projectDiamondStats(scored.game.ledger).players['away-1'].raw.pitching.W).toBe(0);
    scored.game.submit('resume', {});

    scored.game.submit('rules_decision', {
      code: 'end_game_weather',
      description: 'The umpire declared the current scored result official.'
    });
    scored.game.submit('finalize', { confirmed: true });
    let stats = projectDiamondStats(scored.game.ledger);
    expect(stats.players['away-1'].raw.pitching.W).toBe(1);
    expect(stats.players['home-1'].raw.pitching.L).toBe(1);
    expect(stats.players['away-reliever'].raw.pitching.SV).toBe(1);
    scored.game.submit('private_note', { text: 'Post-final audit note.' });
    expect(projectDiamondStats(scored.game.ledger).players['away-1'].raw.pitching.W).toBe(1);
    scored.game.submit('reopen_for_correction', { reason: 'Review the official decision set.' });
    stats = projectDiamondStats(scored.game.ledger);
    expect(stats.players['away-1'].raw.pitching.W).toBe(0);
    expect(stats.players['home-1'].raw.pitching.L).toBe(0);
    expect(stats.players['away-reliever'].raw.pitching.SV).toBe(0);
    scored.game.submit('finalize', { confirmed: true });
    expect(projectDiamondStats(scored.game.ledger).players['away-1'].raw.pitching.W).toBe(1);

    const cancelled = prepareDecisionGame();
    cancelled.game.submit('record_scoring_judgment', {
      playEventId: cancelled.playEventId,
      pitcherOfRecord: { side: 'away', playerId: 'away-1', decision: 'win' }
    });
    cancelled.game.submit(
      'cancel',
      { confirmed: true, reason: 'The exhibition ended without an official result.' },
      { managerAuthorized: true }
    );
    expect(projectDiamondStats(cancelled.game.ledger).players['away-1'].raw.pitching.W).toBe(0);

    const forfeit = prepareDecisionGame();
    forfeit.game.submit('record_scoring_judgment', {
      playEventId: forfeit.playEventId,
      pitcherOfRecord: { side: 'home', playerId: 'home-1', decision: 'win' }
    });
    forfeit.game.submit('record_scoring_judgment', {
      playEventId: forfeit.playEventId,
      pitcherOfRecord: { side: 'away', playerId: 'away-reliever', decision: 'loss' }
    });
    forfeit.game.submit('rules_decision', {
      code: 'end_game_forfeit_home',
      description: 'The umpire awarded the game to home despite the away lead.'
    });
    forfeit.game.submit('finalize', { confirmed: true });
    const forfeitStats = projectDiamondStats(forfeit.game.ledger);
    expect(forfeit.game.ledger.state.score).toEqual({ home: 0, away: 1 });
    expect(forfeitStats.players['home-1'].raw.pitching.W).toBe(1);
    expect(forfeitStats.players['away-reliever'].raw.pitching.L).toBe(1);
  });

  it('preserves canonical history while a correction rebuilds state, hash, replay, and every affected stat', () => {
    const game = createHarness('baseball-nfhs', 'full');
    configureGame(game);
    recordPitch(game);
    const double = game.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'double',
      batterAdvance: { to: 'second' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    const note = game.submit('private_note', {
      text: 'Check hit versus error after the game.',
      attachedEventId: double.event!.eventId,
      visibility: 'staff-private'
    });
    game.submit('void_event', { targetEventId: note.event!.eventId, reason: 'Note resolved by scorer.' });
    const endingDecision = game.submit('rules_decision', {
      code: 'end_game_weather',
      description: 'The umpire declared the shortened game official after weather stopped play.'
    });
    game.submit('finalize', { confirmed: true });

    const canonicalPrefix = game.ledger.events;
    const preCorrectionHash = game.ledger.state.checkpointHash;
    const before = projectDiamondStats(game.ledger);
    expect(before.players['away-1'].raw.batting).toMatchObject({ H: 1, '2B': 1, ROE: 0 });

    game.submit('reopen_for_correction', { reason: 'Official scorer changed the hit to an error.' });
    const correction = game.submit('supersede_event', {
      targetEventId: double.event!.eventId,
      reason: 'Throwing error allowed the batter to reach second.',
      replacement: {
        type: 'record_plate_appearance',
        payload: {
          batterId: 'away-1',
          pitcherId: 'home-1',
          result: 'reached_on_error',
          batterAdvance: { to: 'second' },
          runnerAdvances: [],
          outsOnPlay: 0,
          fielding: { errors: [{ playerId: 'home-3', kind: 'throwing' }] }
        }
      }
    });
    game.submit('finalize', { confirmed: true });
    expect(game.ledger.state.finalizationReason).toEqual({
      kind: 'weather',
      decisionEventId: endingDecision.event!.eventId
    });

    expect(game.ledger.events.slice(0, canonicalPrefix.length)).toEqual(canonicalPrefix);
    expect(game.ledger.events.find((event) => event.eventId === double.event!.eventId)?.type).toBe('record_plate_appearance');
    expect(correction.event?.supersedesEventId).toBe(double.event!.eventId);
    expect(game.ledger.state.checkpointHash).not.toBe(preCorrectionHash);
    expect(verifyDiamondLedger(game.ledger)).toBe(true);

    const effective = getEffectiveDiamondEvents(game.ledger.events);
    const replacement = effective.find((event) => event.sourceEventId === double.event!.eventId);
    expect(replacement).toMatchObject({
      eventId: correction.event!.eventId,
      sourceEventId: double.event!.eventId,
      correctionEventId: correction.event!.eventId,
      type: 'record_plate_appearance'
    });
    expect(effective.some((event) => event.sourceEventId === note.event!.eventId)).toBe(false);

    const after = projectDiamondStats(game.ledger);
    expect(after).toMatchObject({
      sourceRevision: game.ledger.state.revision,
      checkpointHash: game.ledger.state.checkpointHash,
      complete: true
    });
    expect(after.players['away-1'].raw.batting).toMatchObject({ H: 0, '2B': 0, ROE: 1 });
    expect(after.players['home-3'].raw.fielding.E).toBe(1);
    expect(after.teams).toMatchObject({ away: { H: 0 }, home: { E: 1 } });
    const replay = replayDiamondLedger(game.ledger);
    expect(replay.state).toEqual(game.ledger.state);
    expect(replay.checkpointHash).toBe(after.checkpointHash);
  });

  it('credits final-half LOB for every explicit ending reason and excludes cancellation', () => {
    const leaveRunnerOnFirst = (game: Harness) => {
      const { batterId, pitcherId } = currentMatchup(game);
      return game.submit('record_plate_appearance', {
        batterId,
        pitcherId,
        result: 'single',
        batterAdvance: { to: 'first' },
        runnerAdvances: [],
        outsOnPlay: 0
      });
    };
    const explicitEndings = [
      {
        profileId: 'baseball-youth',
        code: 'end_game_time_limit',
        kind: 'time-limit'
      },
      {
        profileId: 'baseball-nfhs',
        code: 'end_game_weather',
        kind: 'weather'
      },
      {
        profileId: 'baseball-nfhs',
        code: 'end_game_forfeit_home',
        kind: 'forfeit'
      }
    ] as const;

    for (const ending of explicitEndings) {
      const game = createHarness(ending.profileId, 'quick');
      configureGame(game);
      leaveRunnerOnFirst(game);
      game.submit('rules_decision', {
        code: ending.code,
        description: `The umpire recorded the supported ${ending.kind} ending.`
      });
      game.submit('finalize', { confirmed: true });
      game.submit('private_note', { text: 'Post-final audit note keeps the finalization revision stable.' });
      expect(game.ledger.state.finalizationReason?.kind).toBe(ending.kind);
      expect(projectDiamondStats(game.ledger).teams.away.LOB).toBe(1);
      expect(replayDiamondLedger(game.ledger).state).toEqual(game.ledger.state);
    }

    const cancelled = createHarness('baseball-nfhs', 'quick');
    configureGame(cancelled);
    leaveRunnerOnFirst(cancelled);
    cancelled.submit('cancel', { confirmed: true, reason: 'The non-official exhibition was cancelled.' }, { managerAuthorized: true });
    expect(cancelled.ledger.state.lifecycle).toBe('cancelled');
    expect(projectDiamondStats(cancelled.ledger).teams.away.LOB).toBe(0);
  });

  it('counts a nullified run in LOB on an inning-ending force and rebuilds it through checkpoints and corrections', () => {
    const setup = createHarness('baseball-nfhs', 'quick');
    configureGame(setup);
    const runnerOnThird = placeRunnerOnBase(setup, 'third');
    const runnerOnFirst = placeRunnerOnBase(setup, 'first');
    recordOut(setup);
    recordOut(setup);
    expect(setup.ledger.state).toMatchObject({
      inning: { number: 1, half: 'top', outs: 2 },
      bases: {
        first: { runnerId: runnerOnFirst },
        third: { runnerId: runnerOnThird }
      }
    });

    const matchup = currentMatchup(setup);
    const forcePayload = {
      batterId: matchup.batterId,
      pitcherId: matchup.pitcherId,
      result: 'fielders_choice' as const,
      batterAdvance: { to: 'first' as const },
      runnerAdvances: [
        {
          runnerId: runnerOnFirst,
          from: 'first' as const,
          to: 'out' as const,
          cause: 'force_out' as const,
          outKind: 'force' as const
        },
        {
          runnerId: runnerOnThird,
          from: 'third' as const,
          to: 'home' as const,
          cause: 'batted_ball' as const,
          countsRun: false
        }
      ],
      outsOnPlay: 1,
      runsBattedIn: 0
    };
    const command = setup.command('record_plate_appearance', forcePayload);
    const context = {
      actorUid: INITIAL_SCORER,
      eventId: 'golden-nullified-force-third-out',
      serverTimestampMs: 1_900_000_200_000
    } as const;
    const checkpoint = createDiamondCheckpoint(setup.ledger);
    const full = executeDiamondCommand(setup.ledger, command, context);
    const bounded = executeDiamondCommandFromCheckpoint(checkpoint, command, context);

    expect(full.result, full.result.rejection?.message).toMatchObject({ outcome: 'accepted' });
    expect(bounded.result, bounded.result.rejection?.message).toMatchObject({ outcome: 'accepted' });
    expect(bounded.checkpoint.state).toEqual(full.ledger.state);
    expect(bounded.checkpoint.sequence).toBe(checkpoint.sequence + 1);
    expect(bounded.checkpoint.previousHash).toBe(bounded.event?.hash);
    expect(bounded.event).toEqual(full.event);
    expect(full.ledger.state).toMatchObject({
      inning: { outs: 3 },
      score: { away: 0 },
      bases: { first: { runnerId: matchup.batterId }, third: null }
    });

    const game = createHarness('baseball-nfhs', 'quick', full.ledger);
    game.submit('rules_decision', {
      code: 'end_game_weather',
      description: 'Weather made the force-ending score official.'
    });
    game.submit('finalize', { confirmed: true });
    const originalStats = projectDiamondStats(game.ledger);
    expect(originalStats.teams.away).toMatchObject({ R: 0, LOB: 2 });
    expect(replayDiamondLedger(game.ledger).state).toEqual(game.ledger.state);
    expect(projectDiamondStats(game.ledger)).toEqual(originalStats);

    const advanced = createHarness('baseball-nfhs', 'quick');
    configureGame(advanced);
    const advancedRunnerOnThird = placeRunnerOnBase(advanced, 'third');
    const advancedRunnerOnFirst = placeRunnerOnBase(advanced, 'first');
    recordOut(advanced);
    recordOut(advanced);
    const advancedMatchup = currentMatchup(advanced);
    advanced.submit('record_plate_appearance', {
      batterId: advancedMatchup.batterId,
      pitcherId: advancedMatchup.pitcherId,
      result: 'fielders_choice',
      batterAdvance: { to: 'first' },
      runnerAdvances: [
        {
          runnerId: advancedRunnerOnFirst,
          from: 'first',
          to: 'out',
          cause: 'force_out',
          outKind: 'force'
        },
        {
          runnerId: advancedRunnerOnThird,
          from: 'third',
          to: 'home',
          cause: 'batted_ball',
          countsRun: false
        }
      ],
      outsOnPlay: 1,
      runsBattedIn: 0
    });
    advanced.submit('advance_half_inning', {});
    const advancedStats = projectDiamondStats(advanced.ledger);
    expect(advancedStats.teams.away).toMatchObject({ R: 0, LOB: 2 });
    expect(projectDiamondStats(advanced.ledger)).toEqual(advancedStats);
    expect(replayDiamondLedger(advanced.ledger).state).toEqual(advanced.ledger.state);

    const preCorrectionHash = game.ledger.state.checkpointHash;
    game.submit('reopen_for_correction', { reason: 'The scorer reviewed whether the force was a timing play.' });
    expect(projectDiamondStats(game.ledger).teams.away.LOB).toBe(0);
    game.submit('supersede_event', {
      targetEventId: full.event!.eventId,
      reason: 'The runner was tagged after the run crossed home rather than forced out.',
      replacement: {
        type: 'record_plate_appearance',
        payload: {
          ...forcePayload,
          runnerAdvances: [
            {
              runnerId: runnerOnFirst,
              from: 'first',
              to: 'out',
              cause: 'batted_ball',
              outKind: 'tag'
            },
            {
              runnerId: runnerOnThird,
              from: 'third',
              to: 'home',
              cause: 'batted_ball',
              countsRun: true,
              earned: true,
              rbi: true
            }
          ],
          runsBattedIn: 1
        }
      }
    });
    game.submit('finalize', { confirmed: true });
    const correctedStats = projectDiamondStats(game.ledger);
    expect(correctedStats.teams.away).toMatchObject({ R: 1, LOB: 1 });
    expect(game.ledger.state.checkpointHash).not.toBe(preCorrectionHash);
    expect(correctedStats.checkpointHash).toBe(game.ledger.state.checkpointHash);
    expect(replayDiamondLedger(game.ledger).state).toEqual(game.ledger.state);
    expect(projectDiamondStats(game.ledger)).toEqual(correctedStats);
    expect(verifyDiamondLedger(game.ledger)).toBe(true);
  });

  it('rejects a nullified run before a third-out play through live, checkpoint, replay, and correction paths', () => {
    const homeRun = createHarness('baseball-nfhs', 'quick');
    configureGame(homeRun);
    const homeRunMatchup = currentMatchup(homeRun);
    const homeRunRevision = homeRun.ledger.state.revision;
    expectRejected(
      homeRun.submit(
        'record_plate_appearance',
        {
          batterId: homeRunMatchup.batterId,
          pitcherId: homeRunMatchup.pitcherId,
          result: 'home_run',
          batterAdvance: { to: 'home', countsRun: false },
          runnerAdvances: [],
          outsOnPlay: 0,
          runsBattedIn: 0
        },
        { accept: false }
      ),
      'run-nullification-requires-third-out',
      homeRunRevision
    );
    expect(homeRun.ledger.state).toMatchObject({
      inning: { outs: 0 },
      score: { away: 0 },
      bases: { first: null, second: null, third: null }
    });
    expect(replayDiamondLedger(homeRun.ledger).state).toEqual(homeRun.ledger.state);

    const standalone = createHarness('baseball-nfhs', 'quick');
    configureGame(standalone);
    const runnerId = placeRunnerOnBase(standalone, 'third');
    const command = standalone.command('advance_runner', {
      runnerId,
      from: 'third',
      to: 'home',
      cause: 'batted_ball',
      countsRun: false
    });
    const context = {
      actorUid: INITIAL_SCORER,
      eventId: 'golden-pre-third-out-nullified-run',
      serverTimestampMs: 1_900_000_300_000
    } as const;
    const checkpoint = createDiamondCheckpoint(standalone.ledger);
    const full = executeDiamondCommand(standalone.ledger, command, context);
    const bounded = executeDiamondCommandFromCheckpoint(checkpoint, command, context);
    expectRejected(full, 'run-nullification-requires-third-out', standalone.ledger.state.revision);
    expect(bounded.result).toMatchObject({
      outcome: 'rejected',
      revision: checkpoint.sequence,
      rejection: { code: 'run-nullification-requires-third-out' }
    });
    expect(bounded.checkpoint).toBe(checkpoint);
    expect(replayDiamondLedger(standalone.ledger).state).toEqual(standalone.ledger.state);
    expect(verifyDiamondLedger(standalone.ledger)).toBe(true);

    const correction = createHarness('baseball-nfhs', 'quick');
    configureGame(correction);
    const correctionRunnerId = placeRunnerOnBase(correction, 'third');
    const scoringAdvance = correction.submit('advance_runner', {
      runnerId: correctionRunnerId,
      from: 'third',
      to: 'home',
      cause: 'batted_ball',
      countsRun: true,
      earned: true
    });
    const correctionRevision = correction.ledger.state.revision;
    expectRejected(
      correction.submit(
        'supersede_event',
        {
          targetEventId: scoringAdvance.event!.eventId,
          reason: 'Attempt to nullify a run before the inning-ending play.',
          replacement: {
            type: 'advance_runner',
            payload: {
              runnerId: correctionRunnerId,
              from: 'third',
              to: 'home',
              cause: 'batted_ball',
              countsRun: false
            }
          }
        },
        { accept: false }
      ),
      'run-nullification-requires-third-out',
      correctionRevision
    );
    expect(correction.ledger.state.score.away).toBe(1);
    expect(replayDiamondLedger(correction.ledger).state).toEqual(correction.ledger.state);
    expect(verifyDiamondLedger(correction.ledger)).toBe(true);
  });

  it('adds completed and final-half LOB for automatic endings without double-counting correction re-finalization', () => {
    const leaveRunnerOnFirst = (game: Harness) => {
      const { batterId, pitcherId } = currentMatchup(game);
      return game.submit('record_plate_appearance', {
        batterId,
        pitcherId,
        result: 'single',
        batterAdvance: { to: 'first' },
        runnerAdvances: [],
        outsOnPlay: 0
      });
    };

    const regulation = createHarness('baseball-nfhs', 'quick');
    configureGame(regulation);
    recordSoloHomeRun(regulation);
    leaveRunnerOnFirst(regulation);
    while (regulation.ledger.state.inning.outs < 3) recordOut(regulation);
    regulation.submit('advance_half_inning', {});
    advanceToHalf(regulation, 7, 'bottom');
    leaveRunnerOnFirst(regulation);
    while (regulation.ledger.state.inning.outs < 3) recordOut(regulation);
    regulation.submit('finalize', { confirmed: true });
    expect(regulation.ledger.state.finalizationReason?.kind).toBe('regulation');
    expect(projectDiamondStats(regulation.ledger).teams).toMatchObject({ away: { LOB: 1 }, home: { LOB: 1 } });

    const walkoff = createHarness('baseball-nfhs', 'quick');
    configureGame(walkoff);
    advanceToHalf(walkoff, 7, 'bottom');
    leaveRunnerOnFirst(walkoff);
    walkoff.submit('record_plate_appearance', {
      batterId: 'home-2',
      pitcherId: 'away-1',
      result: 'double',
      batterAdvance: { to: 'second' },
      runnerAdvances: [
        {
          runnerId: 'home-1',
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
    walkoff.submit('finalize', { confirmed: true });
    expect(walkoff.ledger.state.finalizationReason?.kind).toBe('walkoff');
    expect(projectDiamondStats(walkoff.ledger).teams.home.LOB).toBe(1);

    const runAhead = createHarness('baseball-nfhs', 'quick');
    configureGame(runAhead);
    for (let run = 0; run < 10; run += 1) recordSoloHomeRun(runAhead);
    advanceToHalf(runAhead, 5, 'bottom');
    leaveRunnerOnFirst(runAhead);
    while (runAhead.ledger.state.inning.outs < 3) recordOut(runAhead);
    runAhead.submit('finalize', { confirmed: true });
    expect(runAhead.ledger.state.finalizationReason?.kind).toBe('run-ahead');
    expect(projectDiamondStats(runAhead.ledger).teams.home.LOB).toBe(1);

    const corrected = createHarness('baseball-nfhs', 'quick');
    configureGame(corrected);
    const originalReach = leaveRunnerOnFirst(corrected);
    corrected.submit('rules_decision', {
      code: 'end_game_weather',
      description: 'Weather made the current score official.'
    });
    corrected.submit('finalize', { confirmed: true });
    expect(projectDiamondStats(corrected.ledger).teams.away.LOB).toBe(1);
    corrected.submit('reopen_for_correction', { reason: 'Correct the base reached on the final half.' });
    expect(projectDiamondStats(corrected.ledger).teams.away.LOB).toBe(0);
    corrected.submit('finalize', { confirmed: true });
    expect(projectDiamondStats(corrected.ledger).teams.away.LOB).toBe(1);
    corrected.submit('reopen_for_correction', { reason: 'Apply the official hit correction.' });
    corrected.submit('supersede_event', {
      targetEventId: originalReach.event!.eventId,
      reason: 'Official scorer changed the single to a home run.',
      replacement: {
        type: 'record_plate_appearance',
        payload: {
          batterId: 'away-1',
          pitcherId: 'home-1',
          result: 'home_run',
          batterAdvance: { to: 'home', countsRun: true, earned: true, rbi: true },
          runnerAdvances: [],
          outsOnPlay: 0,
          runsBattedIn: 1
        }
      }
    });
    corrected.submit('finalize', { confirmed: true });
    const correctedStats = projectDiamondStats(corrected.ledger);
    expect(correctedStats.teams.away.LOB).toBe(0);
    expect(replayDiamondLedger(corrected.ledger).state).toEqual(corrected.ledger.state);
    expect(projectDiamondStats(corrected.ledger)).toEqual(correctedStats);
    expect(verifyDiamondLedger(corrected.ledger)).toBe(true);
  });
});

describe('Formula and capture-coverage goldens', () => {
  it('uses unrounded values, outs-based innings, profile ERA basis, and stable display rounding', () => {
    const raw = rawStats();
    const derived = deriveDiamondPlayerStats(raw, COMPLETE_COVERAGE, 7);
    expect(derived).toMatchObject({
      AVG: 1 / 3,
      OBP: 4 / 10,
      SLG: 2 / 3,
      OPS: 16 / 15,
      bbRate: 1 / 10,
      strikeoutRate: 2 / 10,
      stolenBaseRate: 2 / 3,
      inningsPitched: '1.2',
      ERA: 4.2,
      WHIP: 1.8,
      strikeoutWalkRatio: 3,
      strikeRate: 2 / 3,
      firstPitchStrikeRate: 6 / 10,
      fieldingPercentage: 3 / 4,
      chances: 4
    });
    expect(formatInningsPitched(14)).toBe('4.2');
    expect(formatInningsPitched(-1)).toBe('0.0');
    expect(formatDiamondRate(1 / 3)).toBe('.333');
    expect(formatDiamondRate(1.23456, 2)).toBe('1.23');

    const line: DiamondPlayerStatLine = {
      playerId: 'qualified-player',
      side: 'away',
      raw,
      derived,
      coverage: COMPLETE_COVERAGE,
      sources: {}
    };
    expect(isBattingQualified(line, 4, 2.5)).toBe(true);
    expect(isBattingQualified({ ...line, coverage: { ...COMPLETE_COVERAGE, batting: 'partial' } }, 4, 2.5)).toBe(false);
  });

  it('returns unavailable—not zero—for zero denominators and incomplete stat families', () => {
    const raw = rawStats();
    const zero = deriveDiamondPlayerStats(
      {
        batting: { ...raw.batting, PA: 0, AB: 0, H: 0, TB: 0, BB: 0, IBB: 0, HBP: 0, SF: 0 },
        baserunning: { ...raw.baserunning, SB: 0, CS: 0 },
        pitching: {
          ...raw.pitching,
          BF: 0,
          outs: 0,
          H: 0,
          BB: 0,
          IBB: 0,
          SO: 0,
          pitches: 0,
          strikes: 0,
          firstPitchStrikes: 0
        },
        fielding: { ...raw.fielding, PO: 0, A: 0, E: 0 }
      },
      COMPLETE_COVERAGE,
      7
    );
    expect(zero).toMatchObject({
      AVG: null,
      OBP: null,
      SLG: null,
      OPS: null,
      stolenBaseRate: null,
      ERA: null,
      WHIP: null,
      strikeoutWalkRatio: null,
      strikeRate: null,
      firstPitchStrikeRate: null,
      fieldingPercentage: null
    });
    expect(formatDiamondRate(zero.AVG)).toBe('—');

    const incomplete = deriveDiamondPlayerStats(
      raw,
      { ...COMPLETE_COVERAGE, pitching: 'partial', fielding: 'not_collected', pitches: 'partial' },
      7
    );
    expect(incomplete).toMatchObject({
      ERA: null,
      WHIP: null,
      strikeoutWalkRatio: null,
      strikeRate: null,
      firstPitchStrikeRate: null,
      fieldingPercentage: null
    });
  });

  it('keeps complete, partial, and not_collected coverage explicit as observations are omitted', () => {
    const untouchedFull = createHarness('baseball-nfhs', 'full');
    const untouchedQuick = createHarness('fastpitch-youth', 'quick');
    expect(untouchedFull.ledger.state.coverage).toEqual(COMPLETE_COVERAGE);
    expect(untouchedQuick.ledger.state.coverage).toEqual({
      batting: 'complete',
      baserunning: 'complete',
      pitching: 'partial',
      fielding: 'not_collected',
      situational: 'partial',
      pitches: 'not_collected',
      sensors: 'not_collected'
    });

    configureGame(untouchedFull);
    untouchedFull.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'ground_out',
      batterAdvance: { to: 'out', outKind: 'batter_runner' },
      runnerAdvances: [],
      outsOnPlay: 1,
      omissions: ['situational']
    });
    untouchedFull.submit('rules_decision', {
      code: 'coverage_adjustment',
      description: 'The scorer did not collect enough detail to classify the runner advance.',
      affectedFamilies: ['baserunning']
    });
    expect(untouchedFull.ledger.state.coverage).toEqual({
      batting: 'complete',
      baserunning: 'partial',
      pitching: 'complete',
      fielding: 'partial',
      situational: 'partial',
      pitches: 'partial',
      sensors: 'not_collected'
    });
    expect(projectDiamondStats(untouchedFull.ledger).coverage).toEqual(untouchedFull.ledger.state.coverage);
  });
});
