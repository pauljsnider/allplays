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
  type DiamondBattingRole,
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
    options: Readonly<{ actorUid?: string; accept?: boolean; managerAuthorized?: boolean }> = {}
  ): DiamondExecution => {
    const id = nextId;
    const execution = executeDiamondCommand(ledger, command(type, payload), {
      actorUid: options.actorUid ?? SCORER,
      eventId: `event-${String(id)}`,
      serverTimestampMs: 1_700_000_000_000 + id,
      ...(options.managerAuthorized === undefined ? {} : { managerAuthorized: options.managerAuthorized })
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

function setBasicLineups(
  game: ReturnType<typeof harness>,
  options: Readonly<{ start?: boolean; homeFirstBattingRole?: DiamondBattingRole }> = {}
) {
  game.submit('activate', { initialScorerUid: SCORER, captureMode: game.ledger.captureMode });
  game.submit('set_lineup', {
    side: 'home',
    entries: [
      { slot: 1, playerId: 'home-1', ...(options.homeFirstBattingRole ? { battingRole: options.homeFirstBattingRole } : {}) },
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
  if (options.start !== false) game.submit('start', {});
}

function recordPitch(game: ReturnType<typeof harness>, batterId: string, pitcherId: string, result: 'ball' | 'in_play' = 'in_play') {
  game.submit('record_pitch', { batterId, pitcherId, result });
}

function currentMatchup(game: ReturnType<typeof harness>) {
  const side = game.ledger.state.inning.half === 'top' ? ('away' as const) : ('home' as const);
  const fieldingSide = side === 'home' ? ('away' as const) : ('home' as const);
  const order = game.ledger.state.lineups[side].battingOrder;
  const batterId = order[game.ledger.state.nextBatterSlot[side]]?.activePlayerId;
  const pitcherId = game.ledger.state.lineups[fieldingSide].defense.P;
  if (!batterId || !pitcherId) throw new Error('Test fixture requires a current batter and pitcher.');
  return { batterId, pitcherId };
}

function recordQuickOut(game: ReturnType<typeof harness>) {
  const { batterId, pitcherId } = currentMatchup(game);
  game.submit('record_plate_appearance', {
    batterId,
    pitcherId,
    result: 'ground_out',
    batterAdvance: { to: 'out', outKind: 'batter_runner' },
    runnerAdvances: [],
    outsOnPlay: 1
  });
}

function finishHalf(game: ReturnType<typeof harness>) {
  while (game.ledger.state.inning.outs < 3) recordQuickOut(game);
}

function advanceToHalf(game: ReturnType<typeof harness>, inning: number, half: 'top' | 'bottom') {
  const ordinal = (number: number, currentHalf: 'top' | 'bottom') => (number - 1) * 2 + (currentHalf === 'bottom' ? 1 : 0);
  const target = ordinal(inning, half);
  while (ordinal(game.ledger.state.inning.number, game.ledger.state.inning.half) < target) {
    finishHalf(game);
    game.submit('advance_half_inning', {});
  }
}

function recordSoloHomeRun(game: ReturnType<typeof harness>) {
  const { batterId, pitcherId } = currentMatchup(game);
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
  game.submit('rules_decision', {
    code: 'end_game_weather',
    description: 'The umpire declared the shortened game official after weather stopped play.'
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

  it('enforces profile-allowed batting roles and bounded role cardinality at lineup admission', () => {
    const obr = harness('baseball-obr', 'quick');
    obr.submit('activate', { initialScorerUid: SCORER, captureMode: 'quick' });
    obr.submit('set_lineup', {
      side: 'home',
      entries: [
        { slot: 1, playerId: 'home-dh', battingRole: 'dh' },
        { slot: 2, playerId: 'home-regular' }
      ]
    });
    const duplicateDh = obr.submit(
      'set_lineup',
      {
        side: 'home',
        entries: [
          { slot: 1, playerId: 'home-dh-1', battingRole: 'dh' },
          { slot: 2, playerId: 'home-dh-2', battingRole: 'dh' }
        ]
      },
      { accept: false }
    );
    expect(duplicateDh.result.rejection?.code).toBe('invalid-lineup-role');
    const obrEh = obr.submit(
      'set_lineup',
      { side: 'home', entries: [{ slot: 1, playerId: 'home-eh', battingRole: 'eh' }] },
      { accept: false }
    );
    expect(obrEh.result.rejection?.code).toBe('rule-not-enabled');

    const fastpitch = harness('fastpitch-nfhs', 'quick');
    fastpitch.submit('activate', { initialScorerUid: SCORER, captureMode: 'quick' });
    const dh = fastpitch.submit(
      'set_lineup',
      { side: 'home', entries: [{ slot: 1, playerId: 'home-dh', battingRole: 'dh' }] },
      { accept: false }
    );
    expect(dh.result.rejection?.code).toBe('rule-not-enabled');
    const flexInOrder = fastpitch.submit(
      'set_lineup',
      { side: 'home', entries: [{ slot: 1, playerId: 'home-flex', battingRole: 'flex' }] },
      { accept: false }
    );
    expect(flexInOrder.result.rejection?.code).toBe('invalid-dp-flex');
    fastpitch.submit('set_lineup', {
      side: 'home',
      entries: [
        { slot: 1, playerId: 'home-dp', battingRole: 'dp' },
        { slot: 2, playerId: 'home-eh', battingRole: 'eh' },
        { slot: 3, playerId: 'home-ep', battingRole: 'ep' }
      ]
    });
    expect(fastpitch.ledger.state.lineups.home.battingOrder.map((entry) => entry.battingRole)).toEqual(['dp', 'eh', 'ep']);
  });

  it('requires a complete DP/FLEX pairing before start and constrains it to its linked slot', () => {
    const game = harness('fastpitch-nfhs', 'quick');
    setBasicLineups(game, { start: false, homeFirstBattingRole: 'dp' });
    const missingPair = game.submit('start', {}, { accept: false });
    expect(missingPair.result.rejection?.code).toBe('missing-dp-flex');

    const pseudoPosition = game.submit(
      'set_dp_flex',
      {
        side: 'home',
        dpPlayerId: 'home-1',
        flexPlayerId: 'home-flex',
        dpBattingSlot: 1,
        flexDefensivePosition: 'FLEX'
      },
      { accept: false }
    );
    expect(pseudoPosition.result.rejection?.code).toBe('invalid-enum');
    const wrongDp = game.submit(
      'set_dp_flex',
      {
        side: 'home',
        dpPlayerId: 'home-2',
        flexPlayerId: 'home-flex',
        dpBattingSlot: 1,
        flexDefensivePosition: 'RF'
      },
      { accept: false }
    );
    expect(wrongDp.result.rejection?.code).toBe('invalid-dp-flex');

    game.submit('set_defensive_alignment', {
      side: 'home',
      assignments: [
        { playerId: 'home-2', position: 'P' },
        { playerId: 'home-3', position: 'C' }
      ]
    });
    game.submit('set_dp_flex', {
      side: 'home',
      dpPlayerId: 'home-1',
      flexPlayerId: 'home-flex',
      dpBattingSlot: 1,
      flexDefensivePosition: 'RF'
    });
    game.submit('start', {});
    const wrongSlot = game.submit(
      'substitute',
      {
        side: 'home',
        battingSlot: 2,
        outgoingPlayerId: 'home-2',
        incomingPlayerId: 'home-flex'
      },
      { accept: false }
    );
    expect(wrongSlot.result.rejection?.code).toBe('unsupported-dp-flex-substitution');
    game.submit('substitute', {
      side: 'home',
      battingSlot: 1,
      outgoingPlayerId: 'home-1',
      incomingPlayerId: 'home-flex'
    });
    expect(game.ledger.state.lineups.home.battingOrder[0]).toMatchObject({
      activePlayerId: 'home-flex',
      battingRole: 'flex'
    });
    expect(game.ledger.state.lineups.home.defense).toMatchObject({ RF: 'home-flex' });
    game.submit('re_enter', {
      side: 'home',
      battingSlot: 1,
      starterPlayerId: 'home-1',
      replacedPlayerId: 'home-flex'
    });
    expect(game.ledger.state.lineups.home.battingOrder[0]).toMatchObject({
      activePlayerId: 'home-1',
      battingRole: 'dp',
      starterReentriesUsed: 1
    });
    expect(game.ledger.state.lineups.home.defense).toMatchObject({ RF: 'home-1' });

    const latePair = harness('fastpitch-nfhs', 'quick');
    setBasicLineups(latePair);
    const afterStart = latePair.submit(
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
    expect(afterStart.result.rejection?.code).toBe('invalid-lifecycle');
  });

  it('transfers an occupied base through substitution and re-entry without rewriting its provenance', () => {
    const game = harness('fastpitch-nfhs', 'quick');
    setBasicLineups(game);
    game.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    const beforeSubstitution = game.ledger.state;
    const originalPlacement = beforeSubstitution.bases.first;
    if (!originalPlacement) throw new Error('Fixture requires the outgoing player on first base.');

    game.submit('substitute', {
      side: 'away',
      battingSlot: 1,
      outgoingPlayerId: 'away-1',
      incomingPlayerId: 'away-sub'
    });
    expect(game.ledger.state.bases.first).toEqual({ ...originalPlacement, runnerId: 'away-sub' });

    game.submit('re_enter', {
      side: 'away',
      battingSlot: 1,
      starterPlayerId: 'away-1',
      replacedPlayerId: 'away-sub'
    });
    expect(game.ledger.state.bases.first).toEqual(originalPlacement);
    expect(verifyDiamondLedger(game.ledger)).toBe(true);
    expect(replayDiamondLedger(game.ledger).state).toEqual(game.ledger.state);

    const provenancePlacement = { ...originalPlacement, courtesyForPlayerId: 'away-catcher' };
    for (const base of ['first', 'second', 'third'] as const) {
      const bases: DiamondGameState['bases'] = { first: null, second: null, third: null, [base]: provenancePlacement };
      const provenanceTransfer = reduceDiamondEvent(
        { ...beforeSubstitution, bases },
        {
          type: 'substitute',
          eventId: `metadata-preserving-${base}-runner-substitution`,
          payload: {
            side: 'away',
            battingSlot: 1,
            outgoingPlayerId: 'away-1',
            incomingPlayerId: 'away-metadata-sub'
          }
        }
      );
      expect(provenanceTransfer.bases[base]).toEqual({ ...provenancePlacement, runnerId: 'away-metadata-sub' });
    }

    const noTransfer = harness('fastpitch-nfhs', 'quick');
    setBasicLineups(noTransfer);
    noTransfer.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    const untouchedPlacement = noTransfer.ledger.state.bases.first;
    if (!untouchedPlacement) throw new Error('Fixture requires the untouched runner on first base.');
    noTransfer.submit('substitute', {
      side: 'away',
      battingSlot: 2,
      outgoingPlayerId: 'away-2',
      incomingPlayerId: 'away-2-sub'
    });
    expect(noTransfer.ledger.state.bases.first).toEqual(untouchedPlacement);

    const endedHalf = {
      ...noTransfer.ledger.state,
      inning: { ...noTransfer.ledger.state.inning, outs: 3 }
    };
    const betweenInnings = reduceDiamondEvent(endedHalf, {
      type: 'substitute',
      eventId: 'between-innings-substitution',
      payload: {
        side: 'away',
        battingSlot: 1,
        outgoingPlayerId: 'away-1',
        incomingPlayerId: 'away-between-innings'
      }
    });
    expect(betweenInnings.bases.first).toEqual(untouchedPlacement);

    const endedHalfIncomingPlacement = { ...untouchedPlacement, runnerId: 'away-ended-half-incoming' };
    const endedHalfIncoming = reduceDiamondEvent(
      {
        ...endedHalf,
        bases: { ...endedHalf.bases, first: endedHalfIncomingPlacement }
      },
      {
        type: 'substitute',
        eventId: 'between-innings-stale-incoming-runner',
        payload: {
          side: 'away',
          battingSlot: 1,
          outgoingPlayerId: 'away-1',
          incomingPlayerId: 'away-ended-half-incoming'
        }
      }
    );
    expect(endedHalfIncoming.bases.first).toEqual(endedHalfIncomingPlacement);
    expect(endedHalfIncoming.lineups.away.battingOrder[0].activePlayerId).toBe('away-ended-half-incoming');

    const pendingRunLimit = harness('baseball-youth', 'quick');
    setBasicLineups(pendingRunLimit);
    pendingRunLimit.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    const pendingRunLimitPlacement = pendingRunLimit.ledger.state.bases.first;
    if (!pendingRunLimitPlacement) throw new Error('Fixture requires the pending run-limit runner on first base.');
    const runLimitPlan = reduceDiamondEvent(
      {
        ...pendingRunLimit.ledger.state,
        score: { ...pendingRunLimit.ledger.state.score, away: 5 },
        inningRuns: { ...pendingRunLimit.ledger.state.inningRuns, T1: 5 }
      },
      {
        type: 'substitute',
        eventId: 'run-limit-pending-substitution',
        payload: {
          side: 'away',
          battingSlot: 1,
          outgoingPlayerId: 'away-1',
          incomingPlayerId: 'away-run-limit-plan'
        }
      }
    );
    expect(runLimitPlan.bases.first).toEqual({ ...pendingRunLimitPlacement, runnerId: 'away-run-limit-plan' });

    const collidingPlacement = {
      runnerId: 'home-1',
      chargedToPitcherId: 'home-1',
      courtesyForPlayerId: 'away-1',
      reachedOnEventId: 'cross-team-id-collision'
    };
    const defensiveChange = reduceDiamondEvent(
      {
        ...beforeSubstitution,
        bases: { ...beforeSubstitution.bases, first: collidingPlacement }
      },
      {
        type: 'substitute',
        eventId: 'defensive-cross-team-id-collision',
        payload: {
          side: 'home',
          battingSlot: 1,
          outgoingPlayerId: 'home-1',
          incomingPlayerId: 'home-reliever',
          defensivePosition: 'P'
        }
      }
    );
    expect(defensiveChange.bases.first).toEqual(collidingPlacement);
  });

  it('rejects no-op substitutions and an incoming player who is already on base', () => {
    const noOp = harness('fastpitch-nfhs', 'quick');
    setBasicLineups(noOp);
    const revision = noOp.ledger.state.revision;
    for (const execution of [
      noOp.submit(
        'substitute',
        { side: 'away', battingSlot: 1, outgoingPlayerId: 'away-1', incomingPlayerId: 'away-1' },
        { accept: false }
      ),
      noOp.submit('re_enter', { side: 'away', battingSlot: 1, starterPlayerId: 'away-1', replacedPlayerId: 'away-1' }, { accept: false })
    ]) {
      expect(execution.result.rejection?.code).toBe('substitution-no-op');
      expect(execution.ledger.state.revision).toBe(revision);
    }
    expect(noOp.ledger.state.lineups.away.battingOrder[0]).toMatchObject({ starterReentriesUsed: 0, substitutions: [] });

    const occupiedIncoming = harness('fastpitch-nfhs', 'quick');
    setBasicLineups(occupiedIncoming);
    occupiedIncoming.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    occupiedIncoming.submit('add_courtesy_runner', {
      side: 'away',
      forPlayerId: 'away-1',
      runnerId: 'away-courtesy',
      base: 'first',
      forRole: 'pitcher'
    });
    const occupied = occupiedIncoming.submit(
      'substitute',
      {
        side: 'away',
        battingSlot: 1,
        outgoingPlayerId: 'away-1',
        incomingPlayerId: 'away-courtesy'
      },
      { accept: false }
    );
    expect(occupied.result.rejection?.code).toBe('incoming-runner-on-base');
    expect(occupiedIncoming.ledger.state.bases.first?.runnerId).toBe('away-courtesy');
  });

  it('requires authoritative pitchers at start and changes active defensive personnel only through substitution history', () => {
    const incomplete = harness('baseball-nfhs', 'quick');
    incomplete.submit('activate', { initialScorerUid: SCORER, captureMode: 'quick' });
    incomplete.submit('set_lineup', { side: 'home', entries: [{ slot: 1, playerId: 'home-1' }] });
    incomplete.submit('set_lineup', { side: 'away', entries: [{ slot: 1, playerId: 'away-1' }] });
    const missingPitcher = incomplete.submit('start', {}, { accept: false });
    expect(missingPitcher.result.rejection?.code).toBe('missing-defensive-pitcher');

    const game = harness('baseball-nfhs', 'quick');
    setBasicLineups(game);
    const noAuthoritativePitcher = {
      ...game.ledger.state,
      lineups: {
        ...game.ledger.state.lineups,
        home: { ...game.ledger.state.lineups.home, defense: {} }
      }
    } satisfies DiamondGameState;
    expect(() =>
      reduceDiamondEvent(noAuthoritativePitcher, {
        type: 'record_pitch',
        eventId: 'pitch-without-defense',
        payload: { batterId: 'away-1', pitcherId: 'unrecorded-pitcher', result: 'ball' }
      })
    ).toThrowError(expect.objectContaining({ code: 'missing-defensive-pitcher' }));
    expect(() =>
      reduceDiamondEvent(noAuthoritativePitcher, {
        type: 'record_plate_appearance',
        eventId: 'pa-without-defense',
        payload: {
          batterId: 'away-1',
          pitcherId: 'unrecorded-pitcher',
          result: 'walk',
          batterAdvance: { to: 'first' },
          runnerAdvances: [],
          outsOnPlay: 0
        }
      })
    ).toThrowError(expect.objectContaining({ code: 'missing-defensive-pitcher' }));
    const arbitraryPitcher = game.submit(
      'set_defensive_alignment',
      {
        side: 'home',
        assignments: [
          { playerId: 'unrecorded-pitcher', position: 'P' },
          { playerId: 'home-2', position: 'C' },
          { playerId: 'home-3', position: 'SS' }
        ]
      },
      { accept: false }
    );
    expect(arbitraryPitcher.result.rejection?.code).toBe('defensive-personnel-change-requires-substitution');

    const missingActivePitcher = game.submit(
      'set_defensive_alignment',
      {
        side: 'home',
        assignments: [
          { playerId: 'home-1', position: '1B' },
          { playerId: 'home-2', position: 'C' },
          { playerId: 'home-3', position: 'SS' }
        ]
      },
      { accept: false }
    );
    expect(missingActivePitcher.result.rejection?.code).toBe('missing-defensive-pitcher');

    game.submit('set_defensive_alignment', {
      side: 'home',
      assignments: [
        { playerId: 'home-2', position: 'P' },
        { playerId: 'home-1', position: 'C' },
        { playerId: 'home-3', position: 'SS' }
      ]
    });
    const stalePitcher = game.submit('record_pitch', { batterId: 'away-1', pitcherId: 'home-1', result: 'ball' }, { accept: false });
    expect(stalePitcher.result.rejection?.code).toBe('unexpected-pitcher');
    game.submit('record_pitch', { batterId: 'away-1', pitcherId: 'home-2', result: 'ball' });
  });

  it('rejects roster and runner mutations after an explicit or automatic game-ending condition', () => {
    const blockedActions: readonly Readonly<{
      label: string;
      action: Parameters<typeof reduceDiamondEvent>[1];
    }>[] = [
      {
        label: 'defensive alignment',
        action: {
          type: 'set_defensive_alignment',
          eventId: 'blocked-alignment',
          payload: {
            side: 'home',
            assignments: [
              { playerId: 'home-2', position: 'P' },
              { playerId: 'home-1', position: 'C' },
              { playerId: 'home-3', position: 'SS' }
            ]
          }
        }
      },
      {
        label: 'substitution',
        action: {
          type: 'substitute',
          eventId: 'blocked-substitution',
          payload: {
            side: 'home',
            battingSlot: 1,
            outgoingPlayerId: 'home-1',
            incomingPlayerId: 'home-reliever',
            defensivePosition: 'P'
          }
        }
      },
      {
        label: 're-entry',
        action: {
          type: 're_enter',
          eventId: 'blocked-reentry',
          payload: {
            side: 'home',
            battingSlot: 1,
            starterPlayerId: 'home-1',
            replacedPlayerId: 'home-reliever',
            defensivePosition: 'P'
          }
        }
      },
      {
        label: 'courtesy runner',
        action: {
          type: 'add_courtesy_runner',
          eventId: 'blocked-courtesy-runner',
          payload: {
            side: 'away',
            forPlayerId: 'away-1',
            runnerId: 'away-courtesy',
            base: 'first',
            forRole: 'pitcher'
          }
        }
      },
      {
        label: 'suspension',
        action: {
          type: 'suspend',
          eventId: 'blocked-suspension',
          payload: { reason: 'Do not suspend a game awaiting finalization.' }
        }
      }
    ];
    const explicit = harness('baseball-nfhs', 'quick');
    setBasicLineups(explicit);
    const officialPlay = explicit.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'ground_out',
      batterAdvance: { to: 'out', outKind: 'batter_runner' },
      runnerAdvances: [],
      outsOnPlay: 1
    });
    explicit.submit('rules_decision', {
      code: 'end_game_weather',
      description: 'The umpire ended the game for weather.'
    });
    blockedActions.forEach(({ label, action }) => {
      expect(() => reduceDiamondEvent(explicit.ledger.state, action), label).toThrowError(
        expect.objectContaining({ code: 'game-end-decision-recorded' })
      );
    });
    explicit.submit('record_fielding', {
      playEventId: officialPlay.event!.eventId,
      fielding: { putoutBy: 'home-2' }
    });

    const explicitlySuspended = harness('baseball-nfhs', 'quick');
    setBasicLineups(explicitlySuspended);
    explicitlySuspended.submit('suspend', { reason: 'Weather delay before the ruling.' });
    explicitlySuspended.submit('rules_decision', {
      code: 'end_game_weather',
      description: 'The suspended game is now final by umpire ruling.'
    });
    expect(() =>
      reduceDiamondEvent(explicitlySuspended.ledger.state, {
        type: 'resume',
        eventId: 'blocked-explicit-resume',
        payload: {}
      })
    ).toThrowError(expect.objectContaining({ code: 'game-end-decision-recorded' }));

    const automatic = harness('baseball-nfhs', 'quick');
    setBasicLineups(automatic);
    recordSoloHomeRun(automatic);
    advanceToHalf(automatic, 7, 'bottom');
    finishHalf(automatic);
    blockedActions.forEach(({ label, action }) => {
      expect(() => reduceDiamondEvent(automatic.ledger.state, action), label).toThrowError(
        expect.objectContaining({ code: 'game-ending-condition-met' })
      );
    });
    expect(() =>
      reduceDiamondEvent(
        {
          ...automatic.ledger.state,
          lifecycle: 'suspended',
          suspendedReason: 'Delay after the final out.'
        },
        {
          type: 'resume',
          eventId: 'blocked-automatic-resume',
          payload: {}
        }
      )
    ).toThrowError(expect.objectContaining({ code: 'game-ending-condition-met' }));
    expect(verifyDiamondLedger(automatic.ledger)).toBe(true);
    expect(replayDiamondLedger(automatic.ledger).state).toEqual(automatic.ledger.state);

    const readyForfeit = harness('fastpitch-nfhs', 'quick');
    readyForfeit.submit('activate', { initialScorerUid: SCORER, captureMode: 'quick' });
    readyForfeit.submit('rules_decision', {
      code: 'end_game_forfeit_away',
      description: 'The umpire awarded the ready game to the away team.'
    });
    const blockedReadyActions: readonly Parameters<typeof reduceDiamondEvent>[1][] = [
      {
        type: 'set_lineup',
        eventId: 'blocked-post-forfeit-lineup',
        payload: { side: 'home', entries: [{ slot: 1, playerId: 'home-1' }] }
      },
      {
        type: 'set_dp_flex',
        eventId: 'blocked-post-forfeit-dp-flex',
        payload: {
          side: 'home',
          dpPlayerId: 'home-1',
          flexPlayerId: 'home-flex',
          dpBattingSlot: 1,
          flexDefensivePosition: 'RF'
        }
      },
      {
        type: 'start',
        eventId: 'blocked-post-forfeit-start',
        payload: {}
      }
    ];
    blockedReadyActions.forEach((action) => {
      expect(() => reduceDiamondEvent(readyForfeit.ledger.state, action)).toThrowError(
        expect.objectContaining({ code: 'game-end-decision-recorded' })
      );
    });
    readyForfeit.submit('finalize', { confirmed: true });
    expect(readyForfeit.ledger.state).toMatchObject({
      lifecycle: 'final',
      finalizationReason: { kind: 'forfeit' }
    });
    expect(verifyDiamondLedger(readyForfeit.ledger)).toBe(true);
    expect(replayDiamondLedger(readyForfeit.ledger).state).toEqual(readyForfeit.ledger.state);
  });

  it('requires the active previous scheduled batter as the tiebreaker runner before any play', () => {
    const game = harness('fastpitch-nfhs', 'quick');
    setBasicLineups(game);
    let extraInningState = {
      ...game.ledger.state,
      inning: { ...game.ledger.state.inning, number: 8 }
    } satisfies DiamondGameState;

    expect(() =>
      reduceDiamondEvent(extraInningState, {
        type: 'add_courtesy_runner',
        eventId: 'courtesy-before-tiebreaker',
        payload: {
          side: 'away',
          forPlayerId: 'away-3',
          runnerId: 'away-courtesy',
          base: 'second',
          forRole: 'pitcher'
        }
      })
    ).toThrowError(expect.objectContaining({ code: 'tiebreaker-runner-required' }));
    expect(() =>
      reduceDiamondEvent(extraInningState, {
        type: 'record_pitch',
        eventId: 'pitch-before-tiebreaker',
        payload: { batterId: 'away-1', pitcherId: 'home-1', result: 'in_play' }
      })
    ).toThrow(/previous-batter tiebreaker runner/i);
    expect(() =>
      reduceDiamondEvent(extraInningState, {
        type: 'place_tiebreaker_runner',
        eventId: 'wrong-tiebreaker-runner',
        payload: { side: 'away', runnerId: 'away-2', base: 'second' }
      })
    ).toThrow(/previous scheduled batter \(away-3\)/i);
    const lateState = {
      ...extraInningState,
      inning: {
        ...extraInningState.inning,
        balls: 1,
        pitchesInPlateAppearance: 1
      }
    } satisfies DiamondGameState;
    expect(() =>
      reduceDiamondEvent(lateState, {
        type: 'place_tiebreaker_runner',
        eventId: 'late-tiebreaker-runner',
        payload: { side: 'away', runnerId: 'away-3', base: 'second' }
      })
    ).toThrow(/before the first play/i);

    extraInningState = reduceDiamondEvent(extraInningState, {
      type: 'substitute',
      eventId: 'previous-batter-substitution',
      payload: {
        side: 'away',
        battingSlot: 3,
        outgoingPlayerId: 'away-3',
        incomingPlayerId: 'away-3-sub'
      }
    });
    expect(() =>
      reduceDiamondEvent(extraInningState, {
        type: 'place_tiebreaker_runner',
        eventId: 'superseded-runner-identity',
        payload: { side: 'away', runnerId: 'away-3', base: 'second' }
      })
    ).toThrow(/away-3-sub/i);
    expect(() =>
      reduceDiamondEvent(extraInningState, {
        type: 'place_tiebreaker_runner',
        eventId: 'wrong-tiebreaker-pitcher',
        payload: { side: 'away', runnerId: 'away-3-sub', base: 'second', chargedToPitcherId: 'home-2' }
      })
    ).toThrowError(expect.objectContaining({ code: 'unexpected-responsible-pitcher' }));
    expect(() =>
      reduceDiamondEvent(extraInningState, {
        type: 'place_tiebreaker_runner',
        eventId: 'empty-tiebreaker-pitcher',
        payload: {
          side: 'away',
          runnerId: 'away-3-sub',
          base: 'second',
          chargedToPitcherId: ''
        }
      })
    ).toThrowError(expect.objectContaining({ code: 'invalid-id' }));
    const placed = reduceDiamondEvent(extraInningState, {
      type: 'place_tiebreaker_runner',
      eventId: 'correct-tiebreaker-runner',
      payload: { side: 'away', runnerId: 'away-3-sub', base: 'second' }
    });
    expect(placed.bases.second).toMatchObject({
      runnerId: 'away-3-sub',
      chargedToPitcherId: 'home-1',
      reachedOnEventId: 'correct-tiebreaker-runner'
    });
    expect(() =>
      reduceDiamondEvent(placed, {
        type: 'advance_runner',
        eventId: 'change-tiebreaker-pitcher',
        payload: {
          runnerId: 'away-3-sub',
          from: 'second',
          to: 'third',
          cause: 'tiebreaker',
          responsiblePitcherId: 'home-2'
        }
      })
    ).toThrowError(expect.objectContaining({ code: 'unexpected-responsible-pitcher' }));
    const advanced = reduceDiamondEvent(placed, {
      type: 'record_plate_appearance',
      eventId: 'advance-unassigned-tiebreaker-runner',
      payload: {
        batterId: 'away-1',
        pitcherId: 'home-1',
        result: 'single',
        batterAdvance: { to: 'first' },
        runnerAdvances: [{ runnerId: 'away-3-sub', from: 'second', to: 'third', cause: 'batted_ball' }],
        outsOnPlay: 0
      }
    });
    expect(advanced.bases).toMatchObject({
      first: { runnerId: 'away-1', chargedToPitcherId: 'home-1' },
      third: { runnerId: 'away-3-sub', chargedToPitcherId: 'home-1' }
    });
    const withoutPitcher = {
      ...extraInningState,
      lineups: {
        ...extraInningState.lineups,
        home: {
          ...extraInningState.lineups.home,
          defense: Object.fromEntries(Object.entries(extraInningState.lineups.home.defense).filter(([position]) => position !== 'P'))
        }
      }
    } satisfies DiamondGameState;
    expect(() =>
      reduceDiamondEvent(withoutPitcher, {
        type: 'place_tiebreaker_runner',
        eventId: 'tiebreaker-without-pitcher',
        payload: { side: 'away', runnerId: 'away-3-sub', base: 'second' }
      })
    ).toThrowError(expect.objectContaining({ code: 'missing-defensive-pitcher' }));
    expect(
      reduceDiamondEvent(placed, {
        type: 'record_pitch',
        eventId: 'pitch-after-tiebreaker',
        payload: { batterId: 'away-1', pitcherId: 'home-1', result: 'in_play' }
      }).inning.pitchesInPlateAppearance
    ).toBe(1);
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

  it('makes cancellation manager-authorized, bounded-path equivalent, terminal, uncorrectable, and hash-audited', () => {
    const game = harness('baseball-youth', 'quick');
    game.submit('activate', { initialScorerUid: SCORER, captureMode: 'quick' });
    const before = game.ledger;
    const checkpoint = createDiamondCheckpoint(before);
    const cancel = game.command('cancel', {
      confirmed: true,
      reason: 'Tournament officials cancelled the game before first pitch.'
    });
    const managerContext = {
      actorUid: 'manager-2',
      eventId: 'cancel-event',
      serverTimestampMs: 1_800_000_000_100,
      managerAuthorized: true
    } as const;

    const unauthorized = executeDiamondCommand(before, cancel, {
      ...managerContext,
      managerAuthorized: false
    });
    expect(unauthorized.result.rejection?.code).toBe('manager-authorization-required');
    expect(unauthorized.ledger).toBe(before);

    const full = executeDiamondCommand(before, cancel, managerContext);
    const bounded = executeDiamondCommandFromCheckpoint(checkpoint, cancel, managerContext);
    expect(full.result, full.result.rejection?.message).toMatchObject({ outcome: 'accepted' });
    expect(bounded.result, bounded.result.rejection?.message).toMatchObject({ outcome: 'accepted' });
    expect(bounded.event).toEqual(full.event);
    expect(bounded.checkpoint.state).toEqual(full.ledger.state);
    expect(full.ledger.state).toMatchObject({
      lifecycle: 'cancelled',
      suspendedReason: null,
      cancellation: {
        reason: 'Tournament officials cancelled the game before first pitch.',
        decisionEventId: 'cancel-event'
      },
      finalizationReason: null,
      finalConfirmedAtRevision: null
    });

    const unauthorizedRetry = executeDiamondCommand(full.ledger, cancel, {
      ...managerContext,
      eventId: 'ignored-unauthorized-retry',
      managerAuthorized: false
    });
    expect(unauthorizedRetry.result.rejection?.code).toBe('manager-authorization-required');
    const duplicate = executeDiamondCommandFromCheckpoint(
      bounded.checkpoint,
      cancel,
      { ...managerContext, eventId: 'ignored-authorized-retry' },
      bounded.receipt
    );
    expect(duplicate.result).toMatchObject({ outcome: 'duplicate', eventId: 'cancel-event' });

    const terminalNote = executeDiamondCommand(
      full.ledger,
      {
        ...cancel,
        commandId: uuid(901),
        expectedRevision: full.ledger.state.revision,
        type: 'private_note',
        payload: { text: 'Must not append after cancellation.' }
      } as DiamondCommand,
      { actorUid: SCORER, eventId: 'post-cancel-note', serverTimestampMs: 1_800_000_000_101 }
    );
    expect(terminalNote.result.rejection?.code).toBe('invalid-lifecycle');

    const terminalFinalize = executeDiamondCommand(
      full.ledger,
      {
        ...cancel,
        commandId: uuid(903),
        expectedRevision: full.ledger.state.revision,
        type: 'finalize',
        payload: { confirmed: true }
      } as DiamondCommand,
      { actorUid: SCORER, eventId: 'post-cancel-finalize', serverTimestampMs: 1_800_000_000_102 }
    );
    expect(terminalFinalize.result.rejection?.code).toBe('invalid-lifecycle');

    const correction = executeDiamondCommand(
      full.ledger,
      {
        ...cancel,
        commandId: uuid(904),
        expectedRevision: full.ledger.state.revision,
        type: 'void_event',
        payload: { targetEventId: 'cancel-event', reason: 'Cancellation is terminal.' }
      } as DiamondCommand,
      { actorUid: SCORER, eventId: 'cancel-correction', serverTimestampMs: 1_800_000_000_103 }
    );
    expect(correction.result.rejection?.code).toBe('uncorrectable-event');

    expect(verifyDiamondLedger(full.ledger)).toBe(true);
    expect(replayDiamondLedger(full.ledger).state).toEqual(full.ledger.state);
    const tampered = {
      ...full.ledger,
      events: [
        full.ledger.events[0],
        {
          ...full.ledger.events[1],
          payload: { confirmed: true, reason: 'Tampered cancellation reason.' }
        }
      ]
    } as DiamondLedger;
    expect(() => replayDiamondLedger(tampered)).toThrow(/failed hash verification/i);
  });

  it('rejects unconfirmed or reasonless cancellation without mutating state', () => {
    const game = harness('baseball-youth', 'quick');
    game.submit('activate', { initialScorerUid: SCORER, captureMode: 'quick' });
    const revision = game.ledger.state.revision;
    const unconfirmed = game.submit('cancel', { confirmed: false, reason: 'Rain.' } as unknown as DiamondCommandPayloadMap['cancel'], {
      accept: false,
      managerAuthorized: true
    });
    expect(unconfirmed.result.rejection?.code).toBe('confirmation-required');
    expect(unconfirmed.ledger.state.revision).toBe(revision);
    const reasonless = game.submit('cancel', { confirmed: true, reason: '   ' }, { accept: false, managerAuthorized: true });
    expect(reasonless.result.rejection?.code).toBe('invalid-text');
    expect(reasonless.ledger.state.revision).toBe(revision);
    const oversized = game.submit('cancel', { confirmed: true, reason: 'x'.repeat(301) }, { accept: false, managerAuthorized: true });
    expect(oversized.result.rejection?.code).toBe('invalid-text');
    expect(oversized.ledger.state.revision).toBe(revision);
  });

  it.each([
    { label: 'active', suspend: false },
    { label: 'suspended', suspend: true }
  ])('permits a verified manager to cancel an $label game', ({ suspend }) => {
    const game = harness('baseball-youth', 'quick');
    setBasicLineups(game);
    if (suspend) game.submit('suspend', { reason: 'Awaiting tournament direction.' });
    game.submit(
      'cancel',
      { confirmed: true, reason: 'Tournament director cancelled the game.' },
      { actorUid: 'manager-2', managerAuthorized: true }
    );
    expect(game.ledger.state).toMatchObject({
      lifecycle: 'cancelled',
      suspendedReason: null,
      cancellation: { reason: 'Tournament director cancelled the game.' }
    });
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
    compare('set_lineup', {
      side: 'home',
      entries: [
        { slot: 1, playerId: 'home-1' },
        { slot: 2, playerId: 'home-2' }
      ]
    });
    compare('set_lineup', {
      side: 'away',
      entries: [
        { slot: 1, playerId: 'away-1' },
        { slot: 2, playerId: 'away-2' }
      ]
    });
    compare('set_defensive_alignment', {
      side: 'home',
      assignments: [
        { playerId: 'home-1', position: 'P' },
        { playerId: 'home-2', position: 'C' }
      ]
    });
    compare('set_defensive_alignment', {
      side: 'away',
      assignments: [
        { playerId: 'away-1', position: 'P' },
        { playerId: 'away-2', position: 'C' }
      ]
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
    compare('set_defensive_alignment', {
      side: 'home',
      assignments: [
        { playerId: 'home-2', position: 'P' },
        { playerId: 'home-1', position: 'C' }
      ]
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

    const attachment = {
      schemaVersion: DIAMOND_SCHEMA_VERSION,
      commandId: uuid(index + 1),
      teamId: checkpoint.teamId,
      gameId: checkpoint.gameId,
      expectedRevision: checkpoint.sequence,
      rulesProfileId: checkpoint.rulesProfileId,
      rulesProfileVersion: checkpoint.rulesProfileVersion,
      type: 'record_fielding',
      payload: { playEventId: receipt!.event.eventId, fielding: { putoutBy: 'home-1' } }
    } as const satisfies DiamondCommand;
    const attachmentResult = executeDiamondCommandFromCheckpoint(checkpoint, attachment, {
      actorUid: SCORER,
      eventId: 'bounded-fielding-event',
      serverTimestampMs: 1_900_000_000_002
    });
    expect(attachmentResult.result.rejection).toMatchObject({ code: 'history-required', retryable: true });
    expect(attachmentResult.checkpoint).toBe(checkpoint);
  });

  it('validates play-linked details against full history and cascades a void into attached stats', () => {
    const game = harness();
    setBasicLineups(game);
    recordPitch(game, 'away-1', 'home-1');
    const play = game.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'ground_out',
      batterAdvance: { to: 'out', outKind: 'batter_runner' },
      runnerAdvances: [],
      outsOnPlay: 1
    });

    const missingTarget = game.submit('record_scoring_judgment', { playEventId: 'missing-play', earned: true }, { accept: false });
    expect(missingTarget.result.rejection?.code).toBe('unknown-play-target');

    const unknownPitcher = game.submit(
      'record_scoring_judgment',
      {
        playEventId: play.event!.eventId,
        pitcherOfRecord: { side: 'home', playerId: 'not-in-lineup', decision: 'win' }
      },
      { accept: false }
    );
    expect(unknownPitcher.result.rejection?.code).toBe('pitcher-not-in-lineup');
    const noCountedRun = game.submit(
      'record_scoring_judgment',
      { playEventId: play.event!.eventId, runnerId: 'away-1', earned: true },
      { accept: false }
    );
    expect(noCountedRun.result.rejection?.code).toBe('invalid-scoring-participant');

    game.submit('record_fielding', {
      playEventId: play.event!.eventId,
      fielding: { putoutBy: 'home-2', assists: ['home-3'], battedBall: 'ground' }
    });
    game.submit('record_scoring_judgment', {
      playEventId: play.event!.eventId,
      pitcherOfRecord: { side: 'home', playerId: 'home-1', decision: 'win' }
    });
    const duplicateDecision = game.submit(
      'record_scoring_judgment',
      {
        playEventId: play.event!.eventId,
        pitcherOfRecord: { side: 'home', playerId: 'home-1', decision: 'win' }
      },
      { accept: false }
    );
    expect(duplicateDecision.result.rejection?.code).toBe('duplicate-pitcher-decision');

    const beforeCorrection = projectDiamondStats(game.ledger);
    expect(beforeCorrection.players['home-2'].raw.fielding.PO).toBe(1);
    expect(beforeCorrection.players['home-1'].raw.pitching.W).toBe(1);

    game.submit('void_event', {
      targetEventId: play.event!.eventId,
      reason: 'The batter was called back before the pitch.'
    });
    const afterCorrection = projectDiamondStats(game.ledger);
    expect(afterCorrection.players['home-2'].raw.fielding.PO).toBe(0);
    expect(afterCorrection.players['home-1'].raw.pitching.W).toBe(0);
    expect(getEffectiveDiamondEvents(game.ledger.events).some((event) => event.type === 'record_fielding')).toBe(false);
    expect(getEffectiveDiamondEvents(game.ledger.events).some((event) => event.type === 'record_scoring_judgment')).toBe(false);
  });

  it('binds fielding attachments to the cited play defense and rejects an invalid correction replacement', () => {
    const game = harness();
    setBasicLineups(game);
    recordPitch(game, 'away-1', 'home-1');
    const play = game.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'ground_out',
      batterAdvance: { to: 'out', outKind: 'batter_runner' },
      runnerAdvances: [],
      outsOnPlay: 1
    });

    const wrongSide = game.submit(
      'record_fielding',
      { playEventId: play.event!.eventId, fielding: { putoutBy: 'away-2' } },
      { accept: false }
    );
    expect(wrongSide.result.rejection?.code).toBe('invalid-fielding-participant');
    const wrongCatcher = game.submit(
      'record_fielding',
      { playEventId: play.event!.eventId, fielding: { passedBallBy: 'home-3' } },
      { accept: false }
    );
    expect(wrongCatcher.result.rejection?.code).toBe('invalid-fielding-participant');

    game.submit('substitute', {
      side: 'home',
      battingSlot: 2,
      outgoingPlayerId: 'home-2',
      incomingPlayerId: 'home-4',
      defensivePosition: 'C'
    });
    const laterDefender = game.submit(
      'record_fielding',
      { playEventId: play.event!.eventId, fielding: { putoutBy: 'home-4' } },
      { accept: false }
    );
    expect(laterDefender.result.rejection?.code).toBe('invalid-fielding-participant');
    const historicalDefense = game.submit('record_fielding', {
      playEventId: play.event!.eventId,
      fielding: { putoutBy: 'home-2', assists: ['home-3'], battedBall: 'ground' }
    });

    const invalidReplacement = game.submit(
      'supersede_event',
      {
        targetEventId: historicalDefense.event!.eventId,
        reason: 'Attempt to replace the credited fielder.',
        replacement: {
          type: 'record_fielding',
          payload: { playEventId: play.event!.eventId, fielding: { putoutBy: 'away-2' } }
        }
      },
      { accept: false }
    );
    expect(invalidReplacement.result.rejection?.code).toBe('invalid-fielding-participant');
    expect(getEffectiveDiamondEvents(game.ledger.events)).toContainEqual(
      expect.objectContaining({ eventId: historicalDefense.event!.eventId, type: 'record_fielding' })
    );
  });

  it('binds runner and pitcher judgments to participants recorded by the cited play', () => {
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
    const twoRunPlay = game.submit('record_plate_appearance', {
      batterId: 'away-2',
      pitcherId: 'home-1',
      result: 'home_run',
      batterAdvance: { to: 'home', countsRun: true },
      runnerAdvances: [{ runnerId: 'away-1', from: 'first', to: 'home', cause: 'batted_ball', countsRun: true }],
      outsOnPlay: 0,
      runsBattedIn: 2
    });

    const unrelatedRunner = game.submit(
      'record_scoring_judgment',
      { playEventId: twoRunPlay.event!.eventId, runnerId: 'away-3', earned: true },
      { accept: false }
    );
    expect(unrelatedRunner.result.rejection?.code).toBe('invalid-scoring-participant');
    const wrongSideRunner = game.submit(
      'record_scoring_judgment',
      { playEventId: twoRunPlay.event!.eventId, runnerId: 'home-2', earned: true },
      { accept: false }
    );
    expect(wrongSideRunner.result.rejection?.code).toBe('invalid-scoring-participant');
    const ambiguousRunner = game.submit(
      'record_scoring_judgment',
      { playEventId: twoRunPlay.event!.eventId, earned: true },
      { accept: false }
    );
    expect(ambiguousRunner.result.rejection?.code).toBe('ambiguous-scoring-participant');
    const nonPitcher = game.submit(
      'record_scoring_judgment',
      {
        playEventId: twoRunPlay.event!.eventId,
        runnerId: 'away-1',
        responsiblePitcherId: 'home-2'
      },
      { accept: false }
    );
    expect(nonPitcher.result.rejection?.code).toBe('responsible-pitcher-role-mismatch');

    game.submit('substitute', {
      side: 'home',
      battingSlot: 1,
      outgoingPlayerId: 'home-1',
      incomingPlayerId: 'home-4',
      defensivePosition: 'P'
    });
    const laterPitcher = game.submit(
      'record_scoring_judgment',
      {
        playEventId: twoRunPlay.event!.eventId,
        runnerId: 'away-1',
        responsiblePitcherId: 'home-4'
      },
      { accept: false }
    );
    expect(laterPitcher.result.rejection?.code).toBe('responsible-pitcher-role-mismatch');
    const laterPitcherDecision = game.submit(
      'record_scoring_judgment',
      {
        playEventId: twoRunPlay.event!.eventId,
        pitcherOfRecord: { side: 'home', playerId: 'home-4', decision: 'loss' }
      },
      { accept: false }
    );
    expect(laterPitcherDecision.result.rejection?.code).toBe('pitcher-not-in-lineup');
    game.submit('record_scoring_judgment', {
      playEventId: twoRunPlay.event!.eventId,
      runnerId: 'away-1',
      earned: true,
      rbi: true,
      responsiblePitcherId: 'home-1',
      pitcherOfRecord: { side: 'home', playerId: 'home-1', decision: 'loss' }
    });
  });

  it('rejects a pitcher identity that is ambiguous across the two recorded teams', () => {
    const game = harness();
    setBasicLineups(game, { start: false });
    game.submit('set_lineup', {
      side: 'away',
      entries: [
        { slot: 1, playerId: 'away-1' },
        { slot: 2, playerId: 'away-2' },
        { slot: 3, playerId: 'home-1' }
      ]
    });
    game.submit('start', {});
    recordPitch(game, 'away-1', 'home-1');
    const play = game.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'home_run',
      batterAdvance: { to: 'home', countsRun: true },
      runnerAdvances: [],
      outsOnPlay: 0,
      runsBattedIn: 1
    });

    const ambiguousPitcher = game.submit(
      'record_scoring_judgment',
      {
        playEventId: play.event!.eventId,
        runnerId: 'away-1',
        responsiblePitcherId: 'home-1'
      },
      { accept: false }
    );
    expect(ambiguousPitcher.result.rejection?.code).toBe('responsible-pitcher-role-mismatch');
    const ambiguousDecision = game.submit(
      'record_scoring_judgment',
      {
        playEventId: play.event!.eventId,
        pitcherOfRecord: { side: 'home', playerId: 'home-1', decision: 'loss' }
      },
      { accept: false }
    );
    expect(ambiguousDecision.result.rejection?.code).toBe('pitcher-not-in-lineup');
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
  }, 60_000);
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

describe('Audited game and half-inning endings', () => {
  it('rejects premature finalization and finalizes a completed regulation game deterministically', () => {
    const premature = harness('baseball-nfhs', 'quick');
    setBasicLineups(premature);
    const revision = premature.ledger.state.revision;
    const rejected = premature.submit('finalize', { confirmed: true }, { accept: false });
    expect(rejected.result.rejection?.code).toBe('finalization-not-eligible');
    expect(rejected.ledger.state.revision).toBe(revision);

    const regulation = harness('baseball-nfhs', 'quick');
    setBasicLineups(regulation);
    recordSoloHomeRun(regulation);
    advanceToHalf(regulation, 7, 'bottom');
    finishHalf(regulation);
    regulation.submit('finalize', { confirmed: true });
    expect(regulation.ledger.state).toMatchObject({
      lifecycle: 'final',
      score: { away: 1, home: 0 },
      inning: { number: 7, half: 'bottom', outs: 3 },
      finalizationReason: { kind: 'regulation', decisionEventId: null }
    });
    expect(replayDiamondLedger(regulation.ledger).state).toEqual(regulation.ledger.state);
  });

  it('counts runners on base at finalization exactly once across correction re-finalization', () => {
    const game = harness('baseball-nfhs', 'quick');
    setBasicLineups(game);
    const matchup = currentMatchup(game);
    game.submit('record_plate_appearance', {
      ...matchup,
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    game.submit('rules_decision', {
      code: 'end_game_weather',
      description: 'The game was called with a runner still on base.'
    });
    game.submit('finalize', { confirmed: true });
    expect(projectDiamondStats(game.ledger).teams.away.LOB).toBe(1);

    game.submit('reopen_for_correction', { reason: 'Confirm the final stat line.' });
    game.submit('finalize', { confirmed: true });
    expect(projectDiamondStats(game.ledger).teams.away.LOB).toBe(1);
  });

  it('records time-limit endings only for configured profiles and blocks later play', () => {
    const noClock = harness('baseball-nfhs', 'quick');
    setBasicLineups(noClock);
    const unsupported = noClock.submit(
      'rules_decision',
      { code: 'end_game_time_limit', description: 'The umpire called time.' },
      { accept: false }
    );
    expect(unsupported.result.rejection?.code).toBe('rule-not-enabled');

    const timed = harness('baseball-youth', 'quick');
    setBasicLineups(timed);
    const decision = timed.submit('rules_decision', {
      code: 'end_game_time_limit',
      description: 'The umpire declared that no new inning may begin under the 90-minute rule.'
    });
    expect(timed.ledger.state.gameEndDecision).toEqual({
      reason: 'time-limit',
      decisionEventId: decision.event!.eventId,
      awardedSide: null
    });
    const matchup = currentMatchup(timed);
    const blockedPlay = timed.submit('record_pitch', { ...matchup, result: 'in_play' }, { accept: false });
    expect(blockedPlay.result.rejection?.code).toBe('game-end-decision-recorded');
    const secondDecision = timed.submit(
      'rules_decision',
      { code: 'end_game_weather', description: 'A second ending may not replace the first.' },
      { accept: false }
    );
    expect(secondDecision.result.rejection?.code).toBe('game-end-decision-exists');
    const cancel = timed.submit(
      'cancel',
      { confirmed: true, reason: 'Must finalize instead.' },
      { accept: false, managerAuthorized: true }
    );
    expect(cancel.result.rejection?.code).toBe('finalization-required');
    timed.submit('finalize', { confirmed: true });
    expect(timed.ledger.state).toMatchObject({
      lifecycle: 'final',
      finalizationReason: { kind: 'time-limit', decisionEventId: decision.event!.eventId }
    });
  });

  it('records weather and ready-state forfeits as distinct replayable ending decisions', () => {
    const weather = harness('fastpitch-nfhs', 'quick');
    setBasicLineups(weather);
    weather.submit('suspend', { reason: 'Lightning delay.' });
    const weatherDecision = weather.submit('rules_decision', {
      code: 'end_game_weather',
      description: 'The umpire declared the suspended game official.'
    });
    weather.submit('finalize', { confirmed: true });
    expect(weather.ledger.state).toMatchObject({
      lifecycle: 'final',
      gameEndDecision: {
        reason: 'weather',
        decisionEventId: weatherDecision.event!.eventId,
        awardedSide: null
      },
      finalizationReason: { kind: 'weather', decisionEventId: weatherDecision.event!.eventId }
    });

    const forfeit = harness('baseball-obr', 'quick');
    forfeit.submit('activate', { initialScorerUid: SCORER, captureMode: 'quick' });
    const forfeitDecision = forfeit.submit('rules_decision', {
      code: 'end_game_forfeit_away',
      description: 'The umpire awarded the game to the away team by forfeit.'
    });
    forfeit.submit('finalize', { confirmed: true });
    expect(forfeit.ledger.state).toMatchObject({
      lifecycle: 'final',
      gameEndDecision: {
        reason: 'forfeit',
        decisionEventId: forfeitDecision.event!.eventId,
        awardedSide: 'away'
      },
      finalizationReason: { kind: 'forfeit', decisionEventId: forfeitDecision.event!.eventId }
    });
    expect(verifyDiamondLedger(forfeit.ledger)).toBe(true);

    const homeForfeit = harness('baseball-obr', 'quick');
    homeForfeit.submit('activate', { initialScorerUid: SCORER, captureMode: 'quick' });
    const homeForfeitDecision = homeForfeit.submit('rules_decision', {
      code: 'end_game_forfeit_home',
      description: 'The umpire awarded the game to the home team by forfeit.'
    });
    homeForfeit.submit('finalize', { confirmed: true });
    expect(homeForfeit.ledger.state).toMatchObject({
      gameEndDecision: {
        reason: 'forfeit',
        decisionEventId: homeForfeitDecision.event!.eventId,
        awardedSide: 'home'
      },
      finalizationReason: { kind: 'forfeit', decisionEventId: homeForfeitDecision.event!.eventId }
    });
  });

  it('corrects a game-ending decision append-only and requires re-finalization against the replacement', () => {
    const game = harness('baseball-youth', 'quick');
    setBasicLineups(game);
    const weather = game.submit('rules_decision', {
      code: 'end_game_weather',
      description: 'Initial on-field ruling.'
    });
    game.submit('finalize', { confirmed: true });
    const immutablePrefix = game.ledger.events;
    game.submit('reopen_for_correction', { reason: 'The tournament director corrected the official ruling.' });
    const correction = game.submit('supersede_event', {
      targetEventId: weather.event!.eventId,
      reason: 'The official result was a home-team forfeit win, not a weather result.',
      replacement: {
        type: 'rules_decision',
        payload: {
          code: 'end_game_forfeit_home',
          description: 'The corrected official ruling awards the game to the home team.'
        }
      }
    });
    expect(game.ledger.state).toMatchObject({
      lifecycle: 'correction',
      gameEndDecision: {
        reason: 'forfeit',
        decisionEventId: correction.event!.eventId,
        awardedSide: 'home'
      },
      finalizationReason: null
    });
    game.submit('finalize', { confirmed: true });
    expect(game.ledger.events.slice(0, immutablePrefix.length)).toEqual(immutablePrefix);
    expect(game.ledger.state.finalizationReason).toEqual({
      kind: 'forfeit',
      decisionEventId: correction.event!.eventId
    });
    expect(verifyDiamondLedger(game.ledger)).toBe(true);
    expect(replayDiamondLedger(game.ledger).state).toEqual(game.ledger.state);
  });

  it('accepts only closed rule-decision codes and requires coverage evidence for coverage changes', () => {
    const game = harness('baseball-youth', 'quick');
    setBasicLineups(game);
    const unknown = game.submit(
      'rules_decision',
      {
        code: 'LOCAL-RULE',
        description: 'Free-form decision codes are not replay-safe.'
      } as unknown as DiamondCommandPayloadMap['rules_decision'],
      { accept: false }
    );
    expect(unknown.result.rejection?.code).toBe('invalid-enum');
    const noFamilies = game.submit(
      'rules_decision',
      { code: 'coverage_adjustment', description: 'A scoring detail was omitted.' },
      { accept: false }
    );
    expect(noFamilies.result.rejection?.code).toBe('invalid-coverage-adjustment');
    game.submit('rules_decision', {
      code: 'coverage_adjustment',
      description: 'A fielding chain was omitted.',
      affectedFamilies: ['fielding']
    });
    expect(game.ledger.state.coverage.fielding).toBe('partial');
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
    setBasicLineups(game, { start: false, homeFirstBattingRole: 'dp' });
    game.submit('set_dp_flex', {
      side: 'home',
      dpPlayerId: 'home-1',
      flexPlayerId: 'home-flex',
      dpBattingSlot: 1,
      flexDefensivePosition: 'RF'
    });
    game.submit('start', {});
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
    setBasicLineups(baseball, { start: false });
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

describe('Diamond stat-integrity evidence', () => {
  it('rejects malformed nested play data and RBI outside the counted-run range without advancing revision', () => {
    const game = harness('baseball-nfhs', 'full');
    setBasicLineups(game);
    const basePayload: DiamondCommandPayloadMap['record_plate_appearance'] = {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'home_run',
      batterAdvance: { to: 'home', countsRun: true, earned: true, rbi: true },
      runnerAdvances: [],
      outsOnPlay: 0,
      runsBattedIn: 1
    };
    const initialRevision = game.ledger.state.revision;
    const invalidPayloads: Array<Readonly<{ payload: DiamondCommandPayloadMap['record_plate_appearance']; code: string }>> = [
      {
        payload: {
          ...basePayload,
          batterAdvance: { ...basePayload.batterAdvance, countsRun: 'true' } as unknown as typeof basePayload.batterAdvance
        },
        code: 'invalid-boolean'
      },
      {
        payload: {
          ...basePayload,
          batterAdvance: { ...basePayload.batterAdvance, inventedCredit: true } as unknown as typeof basePayload.batterAdvance
        },
        code: 'invalid-object'
      },
      {
        payload: {
          ...basePayload,
          fielding: { errors: [{ playerId: 'home-2', kind: 'made-up' }] } as unknown as NonNullable<typeof basePayload.fielding>
        },
        code: 'invalid-enum'
      },
      { payload: { ...basePayload, runsBattedIn: -1 }, code: 'invalid-number' },
      { payload: { ...basePayload, runsBattedIn: 2 }, code: 'invalid-rbi' }
    ];

    invalidPayloads.forEach(({ payload, code }) => {
      const execution = game.submit('record_plate_appearance', payload, { accept: false });
      expect(execution.result).toMatchObject({ outcome: 'rejected', revision: initialRevision, rejection: { code } });
      expect(game.ledger.state.revision).toBe(initialRevision);
    });
  });

  it('requires complete extra-base runner resolution and result-specific out counts', () => {
    (['triple', 'home_run'] as const).forEach((result) => {
      const game = harness('baseball-nfhs', 'quick');
      setBasicLineups(game);
      const firstBatter = currentMatchup(game);
      game.submit('record_plate_appearance', {
        ...firstBatter,
        result: 'single',
        batterAdvance: { to: 'first' },
        runnerAdvances: [],
        outsOnPlay: 0
      });
      const nextBatter = currentMatchup(game);
      const rejected = game.submit(
        'record_plate_appearance',
        {
          ...nextBatter,
          result,
          batterAdvance: { to: result === 'triple' ? 'third' : 'home', countsRun: result === 'home_run' ? true : undefined },
          runnerAdvances: [],
          outsOnPlay: 0,
          ...(result === 'home_run' ? { runsBattedIn: 1 } : {})
        },
        { accept: false }
      );
      expect(rejected.result.rejection?.code).toBe('missing-mandatory-runner-advance');
      expect(game.ledger.state.bases.first?.runnerId).toBe('away-1');
    });

    const invalidDestination = harness('baseball-nfhs', 'quick');
    setBasicLineups(invalidDestination);
    const firstBatter = currentMatchup(invalidDestination);
    invalidDestination.submit('record_plate_appearance', {
      ...firstBatter,
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    const nextBatter = currentMatchup(invalidDestination);
    const rejectedDestination = invalidDestination.submit(
      'record_plate_appearance',
      {
        ...nextBatter,
        result: 'home_run',
        batterAdvance: { to: 'home', countsRun: true },
        runnerAdvances: [{ runnerId: 'away-1', from: 'first', to: 'third', cause: 'batted_ball' }],
        outsOnPlay: 0,
        runsBattedIn: 1
      },
      { accept: false }
    );
    expect(rejectedDestination.result.rejection?.code).toBe('invalid-mandatory-runner-destination');

    for (const [result, outsOnPlay] of [
      ['double_play', 1],
      ['triple_play', 2]
    ] as const) {
      const game = harness('baseball-nfhs', 'quick');
      setBasicLineups(game);
      const matchup = currentMatchup(game);
      const rejected = game.submit(
        'record_plate_appearance',
        {
          ...matchup,
          result,
          batterAdvance: { to: 'out', outKind: 'batter_runner' },
          runnerAdvances: [],
          outsOnPlay
        },
        { accept: false }
      );
      expect(rejected.result.rejection?.code).toBe('invalid-result-out-count');
    }
  });

  it('uses terminal pitch evidence and excludes balks and pickoff attempts from delivered-pitch counts', () => {
    const incomplete = harness('baseball-nfhs', 'full');
    setBasicLineups(incomplete);
    incomplete.submit('record_pitch', { batterId: 'away-1', pitcherId: 'home-1', result: 'ball' });
    incomplete.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'walk',
      batterAdvance: { to: 'first', cause: 'walk' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    expect(incomplete.ledger.state.coverage.pitches).toBe('partial');

    const complete = harness('baseball-nfhs', 'full');
    setBasicLineups(complete);
    complete.submit('record_pitch', { batterId: 'away-1', pitcherId: 'home-1', result: 'balk' });
    complete.submit('record_pitch', { batterId: 'away-1', pitcherId: 'home-1', result: 'pickoff_attempt' });
    expect(complete.ledger.state.inning).toMatchObject({ pitchesInPlateAppearance: 0, lastPitchResult: null });
    for (let index = 0; index < 4; index += 1) {
      complete.submit('record_pitch', { batterId: 'away-1', pitcherId: 'home-1', result: 'ball' });
    }
    complete.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'walk',
      batterAdvance: { to: 'first', cause: 'walk' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    const projection = projectDiamondStats(complete.ledger);
    expect(complete.ledger.state.coverage.pitches).toBe('complete');
    expect(projection.players['home-1'].raw.pitching).toMatchObject({ pitches: 4, strikes: 0, balkIllegalPitch: 1 });
    expect(projection.teams.home).toMatchObject({ firstPitchStrikeOpportunities: 1, firstPitchStrikes: 0 });
  });

  it('recomputes fielding and earned-run coverage from effective attachments and revokes it when voided', () => {
    const fieldingGame = harness('baseball-nfhs', 'full');
    setBasicLineups(fieldingGame);
    recordPitch(fieldingGame, 'away-1', 'home-1');
    const reached = fieldingGame.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'reached_on_error',
      batterAdvance: { to: 'first', cause: 'error' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    expect(fieldingGame.ledger.state.coverage.fielding).toBe('partial');
    const fielding = fieldingGame.submit('record_fielding', {
      playEventId: reached.event!.eventId,
      fielding: { errors: [{ playerId: 'home-2', kind: 'fielding' }] }
    });
    expect(fieldingGame.ledger.state.coverage.fielding).toBe('complete');
    expect(projectDiamondStats(fieldingGame.ledger).players['home-2'].raw.fielding.E).toBe(1);
    fieldingGame.submit('void_event', { targetEventId: fielding.event!.eventId, reason: 'Remove the incorrect error attachment.' });
    expect(fieldingGame.ledger.state.coverage.fielding).toBe('partial');
    expect(projectDiamondStats(fieldingGame.ledger).players['home-2'].raw.fielding.E).toBe(0);

    const earnedGame = harness('baseball-nfhs', 'full');
    setBasicLineups(earnedGame);
    recordPitch(earnedGame, 'away-1', 'home-1');
    const homeRun = earnedGame.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'home_run',
      batterAdvance: { to: 'home', cause: 'batted_ball', countsRun: true, rbi: true },
      runnerAdvances: [],
      outsOnPlay: 0,
      runsBattedIn: 1
    });
    expect(earnedGame.ledger.state.coverage.pitching).toBe('partial');
    const judgment = earnedGame.submit('record_scoring_judgment', {
      playEventId: homeRun.event!.eventId,
      runnerId: 'away-1',
      earned: true
    });
    expect(earnedGame.ledger.state.coverage.pitching).toBe('complete');
    expect(projectDiamondStats(earnedGame.ledger).players['home-1'].raw.pitching.ER).toBe(1);
    earnedGame.submit('void_event', { targetEventId: judgment.event!.eventId, reason: 'Remove the incorrect earned-run judgment.' });
    expect(earnedGame.ledger.state.coverage.pitching).toBe('partial');
    expect(projectDiamondStats(earnedGame.ledger).players['home-1'].raw.pitching.ER).toBe(0);
  });

  it('includes IBB in OBP, ignores stay moves, and recognizes a terminal third strike as two-strike evidence', () => {
    const intentionalWalk = harness('baseball-nfhs', 'full');
    setBasicLineups(intentionalWalk);
    intentionalWalk.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'intentional_walk',
      batterAdvance: { to: 'first', cause: 'walk' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    const walkLine = projectDiamondStats(intentionalWalk.ledger).players['away-1'];
    expect(walkLine.raw.batting).toMatchObject({ PA: 1, IBB: 1 });
    expect(walkLine.derived.OBP).toBe(1);

    intentionalWalk.submit('advance_runner', {
      runnerId: 'away-1',
      from: 'first',
      to: 'stay',
      cause: 'other'
    });
    expect(projectDiamondStats(intentionalWalk.ledger).players['away-1'].raw.baserunning.advances).toBe(0);

    const strikeout = harness('baseball-nfhs', 'full');
    setBasicLineups(strikeout);
    for (let index = 0; index < 3; index += 1) {
      strikeout.submit('record_pitch', { batterId: 'away-1', pitcherId: 'home-1', result: 'swinging_strike' });
    }
    strikeout.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'strikeout',
      batterAdvance: { to: 'out', outKind: 'strikeout' },
      runnerAdvances: [],
      outsOnPlay: 1,
      fielding: { putoutBy: 'home-2' }
    });
    const strikeoutProjection = projectDiamondStats(strikeout.ledger);
    expect(strikeout.ledger.state.coverage.pitches).toBe('complete');
    expect(strikeoutProjection.teams.away.twoStrikePlateAppearances).toBe(1);
    expect(strikeoutProjection.players['home-1'].raw.pitching.pitches).toBe(3);
  });

  it('credits WP, balk or illegal pitch, and PB once for each pitch-anchored physical play', () => {
    const game = harness('baseball-nfhs', 'full');
    setBasicLineups(game);
    recordPitch(game, 'away-1', 'home-1');
    game.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first', cause: 'batted_ball' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    recordPitch(game, 'away-2', 'home-1');
    game.submit('record_plate_appearance', {
      batterId: 'away-2',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first', cause: 'batted_ball' },
      runnerAdvances: [{ runnerId: 'away-1', from: 'first', to: 'second', cause: 'batted_ball' }],
      outsOnPlay: 0
    });

    game.submit('record_pitch', { batterId: 'away-3', pitcherId: 'home-1', result: 'ball' });
    game.submit('advance_runner', { runnerId: 'away-1', from: 'second', to: 'third', cause: 'wild_pitch' });
    game.submit('advance_runner', { runnerId: 'away-2', from: 'first', to: 'second', cause: 'wild_pitch' });

    game.submit('record_pitch', { batterId: 'away-3', pitcherId: 'home-1', result: 'ball' });
    game.submit('advance_runner', {
      runnerId: 'away-1',
      from: 'third',
      to: 'home',
      cause: 'passed_ball',
      earned: true,
      fielding: { passedBallBy: 'home-2' }
    });
    game.submit('advance_runner', {
      runnerId: 'away-2',
      from: 'second',
      to: 'third',
      cause: 'passed_ball',
      fielding: { passedBallBy: 'home-2' }
    });

    game.submit('record_pitch', { batterId: 'away-3', pitcherId: 'home-1', result: 'balk' });
    game.submit('advance_runner', { runnerId: 'away-2', from: 'third', to: 'stay', cause: 'balk' });

    const projection = projectDiamondStats(game.ledger);
    expect(projection.players['home-1'].raw.pitching).toMatchObject({ WP: 1, balkIllegalPitch: 1, pitches: 4 });
    expect(projection.players['home-2'].raw.fielding.PB).toBe(1);
  });

  it('credits one passed ball when inline and attached fielding describe the same plate appearance', () => {
    const game = harness('baseball-nfhs', 'full');
    setBasicLineups(game);
    recordPitch(game, 'away-1', 'home-1');
    const play = game.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first', cause: 'batted_ball' },
      runnerAdvances: [],
      outsOnPlay: 0,
      fielding: { passedBallBy: 'home-2' }
    });
    game.submit('record_fielding', {
      playEventId: play.event!.eventId,
      fielding: { passedBallBy: 'home-2' }
    });

    expect(projectDiamondStats(game.ledger).players['home-2'].raw.fielding.PB).toBe(1);
  });

  it('binds inline fielding and pitcher responsibility to the active play participants', () => {
    const wrongFielder = harness('baseball-nfhs', 'full');
    setBasicLineups(wrongFielder);
    recordPitch(wrongFielder, 'away-1', 'home-1');
    const fieldingResult = wrongFielder.submit(
      'record_plate_appearance',
      {
        batterId: 'away-1',
        pitcherId: 'home-1',
        result: 'ground_out',
        batterAdvance: { to: 'out', outKind: 'batter_runner' },
        runnerAdvances: [],
        outsOnPlay: 1,
        fielding: { putoutBy: 'away-2' }
      },
      { accept: false }
    );
    expect(fieldingResult.result.rejection?.code).toBe('invalid-fielding-participant');

    const wrongCatcher = wrongFielder.submit(
      'record_plate_appearance',
      {
        batterId: 'away-1',
        pitcherId: 'home-1',
        result: 'single',
        batterAdvance: { to: 'first' },
        runnerAdvances: [],
        outsOnPlay: 0,
        fielding: { passedBallBy: 'home-3' }
      },
      { accept: false }
    );
    expect(wrongCatcher.result.rejection?.code).toBe('invalid-fielding-participant');

    const wrongBatterPitcher = wrongFielder.submit(
      'record_plate_appearance',
      {
        batterId: 'away-1',
        pitcherId: 'home-1',
        result: 'single',
        batterAdvance: { to: 'first', responsiblePitcherId: 'home-2' },
        runnerAdvances: [],
        outsOnPlay: 0
      },
      { accept: false }
    );
    expect(wrongBatterPitcher.result.rejection?.code).toBe('unexpected-responsible-pitcher');

    const inheritedRunner = harness('baseball-nfhs', 'full');
    setBasicLineups(inheritedRunner);
    recordPitch(inheritedRunner, 'away-1', 'home-1');
    inheritedRunner.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'single',
      batterAdvance: { to: 'first' },
      runnerAdvances: [],
      outsOnPlay: 0
    });
    inheritedRunner.submit('substitute', {
      side: 'home',
      battingSlot: 1,
      outgoingPlayerId: 'home-1',
      incomingPlayerId: 'home-4',
      defensivePosition: 'P'
    });
    const departedFielder = inheritedRunner.submit(
      'advance_runner',
      {
        runnerId: 'away-1',
        from: 'first',
        to: 'second',
        cause: 'error',
        fielding: { errors: [{ playerId: 'home-1', kind: 'fielding' }] }
      },
      { accept: false }
    );
    expect(departedFielder.result.rejection?.code).toBe('invalid-fielding-participant');
    recordPitch(inheritedRunner, 'away-2', 'home-4');
    const reassignedRunner = inheritedRunner.submit(
      'record_plate_appearance',
      {
        batterId: 'away-2',
        pitcherId: 'home-4',
        result: 'single',
        batterAdvance: { to: 'first' },
        runnerAdvances: [
          {
            runnerId: 'away-1',
            from: 'first',
            to: 'third',
            cause: 'batted_ball',
            responsiblePitcherId: 'home-4'
          }
        ],
        outsOnPlay: 0
      },
      { accept: false }
    );
    expect(reassignedRunner.result.rejection?.code).toBe('unexpected-responsible-pitcher');
    inheritedRunner.submit('record_plate_appearance', {
      batterId: 'away-2',
      pitcherId: 'home-4',
      result: 'single',
      batterAdvance: { to: 'first', responsiblePitcherId: 'home-4' },
      runnerAdvances: [
        {
          runnerId: 'away-1',
          from: 'first',
          to: 'third',
          cause: 'batted_ball',
          responsiblePitcherId: 'home-1'
        }
      ],
      outsOnPlay: 0,
      fielding: {
        assists: ['home-3'],
        errors: [{ playerId: 'home-4', kind: 'throwing' }],
        passedBallBy: 'home-2'
      }
    });
    expect(inheritedRunner.ledger.state.bases).toMatchObject({
      first: { runnerId: 'away-2', chargedToPitcherId: 'home-4' },
      third: { runnerId: 'away-1', chargedToPitcherId: 'home-1' }
    });
    expect(verifyDiamondLedger(inheritedRunner.ledger)).toBe(true);
  });

  it('rejects ambiguous inline credits and validates replacements in historical play context', () => {
    const ambiguous = harness('baseball-nfhs', 'full');
    setBasicLineups(ambiguous, { start: false });
    ambiguous.submit('set_lineup', {
      side: 'away',
      entries: [
        { slot: 1, playerId: 'away-1' },
        { slot: 2, playerId: 'home-1' },
        { slot: 3, playerId: 'home-2' }
      ]
    });
    ambiguous.submit('start', {});
    const ambiguousFielder = ambiguous.submit(
      'record_plate_appearance',
      {
        batterId: 'away-1',
        pitcherId: 'home-1',
        result: 'ground_out',
        batterAdvance: { to: 'out', outKind: 'batter_runner' },
        runnerAdvances: [],
        outsOnPlay: 1,
        fielding: { putoutBy: 'home-2' }
      },
      { accept: false }
    );
    expect(ambiguousFielder.result.rejection?.code).toBe('invalid-fielding-participant');
    const ambiguousPitcher = ambiguous.submit(
      'record_plate_appearance',
      {
        batterId: 'away-1',
        pitcherId: 'home-1',
        result: 'single',
        batterAdvance: { to: 'first', responsiblePitcherId: 'home-1' },
        runnerAdvances: [],
        outsOnPlay: 0
      },
      { accept: false }
    );
    expect(ambiguousPitcher.result.rejection?.code).toBe('responsible-pitcher-role-mismatch');

    const corrected = harness('baseball-nfhs', 'full');
    setBasicLineups(corrected);
    recordPitch(corrected, 'away-1', 'home-1');
    const play = corrected.submit('record_plate_appearance', {
      batterId: 'away-1',
      pitcherId: 'home-1',
      result: 'ground_out',
      batterAdvance: { to: 'out', outKind: 'batter_runner', responsiblePitcherId: 'home-1' },
      runnerAdvances: [],
      outsOnPlay: 1,
      fielding: { putoutBy: 'home-2' }
    });
    const invalidReplacement = corrected.submit(
      'supersede_event',
      {
        targetEventId: play.event!.eventId,
        reason: 'Attempt to move credit across teams.',
        replacement: {
          type: 'record_plate_appearance',
          payload: {
            batterId: 'away-1',
            pitcherId: 'home-1',
            result: 'ground_out',
            batterAdvance: { to: 'out', outKind: 'batter_runner', responsiblePitcherId: 'home-1' },
            runnerAdvances: [],
            outsOnPlay: 1,
            fielding: { putoutBy: 'away-2' }
          }
        }
      },
      { accept: false }
    );
    expect(invalidReplacement.result.rejection?.code).toBe('invalid-fielding-participant');
    expect(corrected.ledger.state.revision).toBe(play.event!.revision);
    const invalidPitcherReplacement = corrected.submit(
      'supersede_event',
      {
        targetEventId: play.event!.eventId,
        reason: 'Attempt to move the batter charge away from the recorded pitcher.',
        replacement: {
          type: 'record_plate_appearance',
          payload: {
            batterId: 'away-1',
            pitcherId: 'home-1',
            result: 'ground_out',
            batterAdvance: { to: 'out', outKind: 'batter_runner', responsiblePitcherId: 'home-2' },
            runnerAdvances: [],
            outsOnPlay: 1,
            fielding: { putoutBy: 'home-2' }
          }
        }
      },
      { accept: false }
    );
    expect(invalidPitcherReplacement.result.rejection?.code).toBe('unexpected-responsible-pitcher');
    expect(corrected.ledger.state.revision).toBe(play.event!.revision);

    corrected.submit('supersede_event', {
      targetEventId: play.event!.eventId,
      reason: 'Correct the putout credit within the recorded defense.',
      replacement: {
        type: 'record_plate_appearance',
        payload: {
          batterId: 'away-1',
          pitcherId: 'home-1',
          result: 'ground_out',
          batterAdvance: { to: 'out', outKind: 'batter_runner', responsiblePitcherId: 'home-1' },
          runnerAdvances: [],
          outsOnPlay: 1,
          fielding: { putoutBy: 'home-3' }
        }
      }
    });
    expect(projectDiamondStats(corrected.ledger).players).toMatchObject({
      'home-2': { raw: { fielding: { PO: 0 } } },
      'home-3': { raw: { fielding: { PO: 1 } } }
    });
    expect(verifyDiamondLedger(corrected.ledger)).toBe(true);
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
