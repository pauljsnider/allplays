import { describe, expect, it } from 'vitest';
import {
  DIAMOND_SCHEMA_VERSION,
  createDiamondLedger,
  deriveDiamondPlayerStats,
  executeDiamondCommand,
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
  type DiamondCommand,
  type DiamondCommandPayloadMap,
  type DiamondCommandType,
  type DiamondCoverageMap,
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
  finalize: 'walkoff, mercy, and correction fixtures',
  reopen_for_correction: 'correction fixture',
  private_note: 'correction fixture',
  rules_decision: 'coverage fixture',
  void_event: 'correction fixture',
  supersede_event: 'correction fixture'
} as const satisfies Record<DiamondCommandType, string>;

type RuleBehavior = 'identity' | 'enforced' | 'stats' | 'metadata-only' | 'partially-enforced';

const RULE_BEHAVIOR_INVENTORY = {
  id: 'identity',
  version: 'identity',
  name: 'identity',
  sport: 'identity',
  scheduledInnings: 'metadata-only',
  eraInningsBasis: 'stats',
  timeLimitMinutes: 'metadata-only',
  inningRunLimit: 'metadata-only',
  runAheadRules: 'metadata-only',
  tiebreaker: 'partially-enforced',
  continuousBatting: 'metadata-only',
  freeSubstitution: 'enforced',
  starterReentryLimit: 'enforced',
  allowsDh: 'metadata-only',
  allowsEh: 'metadata-only',
  allowsEp: 'metadata-only',
  dpFlex: 'partially-enforced',
  courtesyRunner: 'partially-enforced',
  droppedThirdStrike: 'partially-enforced',
  illegalPitchPolicy: 'partially-enforced',
  lookBackRule: 'metadata-only',
  leavingEarlyRule: 'metadata-only'
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
    options: Readonly<{ actorUid?: string; accept?: boolean }> = {}
  ): DiamondExecution => {
    const id = nextId;
    const execution = executeDiamondCommand(ledger, command(type, payload), {
      actorUid: options.actorUid ?? activeScorer,
      eventId: `golden-event-${String(id)}`,
      serverTimestampMs: 1_900_000_000_000 + id
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

function setLineups(game: Harness, lineupSize = 6) {
  const entries = (side: DiamondSide) =>
    Array.from({ length: lineupSize }, (_, index) => ({
      slot: index + 1,
      playerId: `${side}-${String(index + 1)}`
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

function configureGame(game: Harness, options: Readonly<{ lineupSize?: number; start?: boolean }> = {}) {
  setLineups(game, options.lineupSize);
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

  it('documents enforced, partial, and metadata-only rule-profile behavior without skipped claims', () => {
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
        .filter(([, behavior]) => behavior === 'metadata-only')
        .map(([field]) => field)
        .sort()
    ).toEqual([
      'allowsDh',
      'allowsEh',
      'allowsEp',
      'continuousBatting',
      'inningRunLimit',
      'leavingEarlyRule',
      'lookBackRule',
      'runAheadRules',
      'scheduledInnings',
      'timeLimitMinutes'
    ]);

    const baseball = requireDiamondRulesProfile('baseball-nfhs', 1);
    const fastpitch = requireDiamondRulesProfile('fastpitch-nfhs', 1);
    expect(baseball).toMatchObject({ sport: 'baseball', scheduledInnings: 7, starterReentryLimit: 1 });
    expect(fastpitch).toMatchObject({
      sport: 'fastpitch',
      scheduledInnings: 7,
      dpFlex: { enabled: true, flexMayBatForDpOnly: true },
      tiebreaker: { enabled: true, startInning: 8, runnerBase: 'second' }
    });

    // Deliberate gaps in the current public domain contract: there is no clock or
    // automatic end command, batting-role eligibility is metadata, and neither
    // look-back nor leaving-early behavior is reduced. DP/FLEX does not enforce
    // FLEX batting, courtesy runners do not model full participation eligibility,
    // tiebreakers validate a supplied runner rather than select the prior batter,
    // dropped-third-strike is scorer-entered, and ball_and_advance does not move
    // runners automatically. The goldens below assert the supported boundaries.
    expect(Object.values(RULE_BEHAVIOR_INVENTORY)).toContain('partially-enforced');
    expect(Object.values(RULE_BEHAVIOR_INVENTORY)).toContain('metadata-only');
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

  it('keeps mercy, scheduled-inning, clock, and inning-cap rules metadata-only until explicit finalization', () => {
    const mercy = createHarness('baseball-nfhs', 'quick');
    configureGame(mercy);
    for (let run = 0; run < 10; run += 1) recordSoloHomeRun(mercy);
    advanceToHalf(mercy, 6, 'top');

    const nfhs = requireDiamondRulesProfile('baseball-nfhs', 1);
    expect(nfhs.runAheadRules).toEqual([{ afterInning: 5, runDifferential: 10 }]);
    expect(mercy.ledger.state).toMatchObject({
      lifecycle: 'active',
      inning: { number: 6, half: 'top' },
      score: { away: 10, home: 0 }
    });
    mercy.submit('finalize', { confirmed: true });
    expect(mercy.ledger.state.lifecycle).toBe('final');

    const capped = createHarness('baseball-youth', 'quick');
    configureGame(capped);
    for (let run = 0; run < 6; run += 1) recordSoloHomeRun(capped);
    const youth = requireDiamondRulesProfile('baseball-youth', 1);
    expect(youth).toMatchObject({ scheduledInnings: 6, timeLimitMinutes: 90, inningRunLimit: 5 });
    expect(capped.ledger.state).toMatchObject({
      lifecycle: 'active',
      inningRuns: { T1: 6 },
      score: { away: 6, home: 0 }
    });
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
  });
});

describe('Fastpitch golden game', () => {
  it('covers DP/FLEX, scorer lifecycle, courtesy running, one re-entry, and the inning-eight tiebreaker', () => {
    const game = createHarness('fastpitch-nfhs', 'quick');
    configureGame(game, { start: false });
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
    const wrongBaseRevision = game.ledger.state.revision;
    expectRejected(
      game.submit('place_tiebreaker_runner', { side: 'away', runnerId: 'away-tiebreak', base: 'third' }, { accept: false }),
      'invalid-tiebreaker-runner',
      wrongBaseRevision
    );
    game.submit('place_tiebreaker_runner', {
      side: 'away',
      runnerId: 'away-tiebreak',
      base: 'second',
      chargedToPitcherId: 'home-1'
    });

    recordPitch(game, 'illegal_pitch');
    expect(game.ledger.state).toMatchObject({
      inning: { balls: 1 },
      bases: { second: { runnerId: 'away-tiebreak' } }
    });
    const { batterId, pitcherId } = currentMatchup(game);
    game.submit('record_plate_appearance', {
      batterId,
      pitcherId,
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [
        {
          runnerId: 'away-tiebreak',
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
    expect(stats.players['home-1'].raw.pitching).toMatchObject({ R: 1, ER: 1, L: 1 });
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
      code: 'manual-runner-ruling',
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
