import { describe, expect, it } from 'vitest';
import {
  DIAMOND_MAX_COURTESY_RUNNER_IDENTITIES_PER_SIDE,
  DIAMOND_SCHEMA_VERSION,
  createDiamondCheckpoint,
  createDiamondLedger,
  executeDiamondCommand,
  executeDiamondCommandFromCheckpoint,
  getDiamondPlayerIdentityIdsBySide,
  reduceDiamondEvent,
  replayDiamondLedger,
  validateDiamondState,
  verifyDiamondLedger,
  type DiamondCommand,
  type DiamondCommandPayloadMap,
  type DiamondCommandType,
  type DiamondExecution,
  type DiamondGameState,
  type DiamondLedger
} from './index';

const SCORER_UID = 'opposing-lineup-scorer';

function uuid(index: number) {
  return `10000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function harness(profileId = 'baseball-nfhs') {
  let ledger = createDiamondLedger({
    teamId: 'team-opposing-lineup',
    gameId: 'game-opposing-lineup',
    rulesProfileId: profileId,
    rulesProfileVersion: 1,
    captureMode: 'full'
  });
  let nextId = 1;

  const submit = <K extends DiamondCommandType>(
    type: K,
    payload: DiamondCommandPayloadMap[K],
    options: Readonly<{ accept?: boolean }> = {}
  ): DiamondExecution => {
    const id = nextId;
    const command = {
      schemaVersion: DIAMOND_SCHEMA_VERSION,
      commandId: uuid(id),
      teamId: ledger.teamId,
      gameId: ledger.gameId,
      expectedRevision: ledger.state.revision,
      rulesProfileId: ledger.rulesProfileId,
      rulesProfileVersion: ledger.rulesProfileVersion,
      type,
      payload
    } as DiamondCommand;
    const execution = executeDiamondCommand(ledger, command, {
      actorUid: SCORER_UID,
      eventId: `opposing-lineup-event-${String(id)}`,
      serverTimestampMs: 1_800_000_000_000 + id
    });
    nextId += 1;
    if (options.accept !== false) {
      expect(execution.result, execution.result.rejection?.message).toMatchObject({ outcome: 'accepted' });
      ledger = execution.ledger;
    }
    return execution;
  };

  return {
    get ledger(): DiamondLedger {
      return ledger;
    },
    submit
  };
}

function executeAtCheckpoint<K extends DiamondCommandType>(
  ledger: DiamondLedger,
  type: K,
  payload: DiamondCommandPayloadMap[K],
  index: number
) {
  const checkpoint = createDiamondCheckpoint(ledger);
  return {
    checkpoint,
    execution: executeDiamondCommandFromCheckpoint(
      checkpoint,
      {
        schemaVersion: DIAMOND_SCHEMA_VERSION,
        commandId: `51000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
        teamId: checkpoint.teamId,
        gameId: checkpoint.gameId,
        expectedRevision: checkpoint.sequence,
        rulesProfileId: checkpoint.rulesProfileId,
        rulesProfileVersion: checkpoint.rulesProfileVersion,
        type,
        payload
      } as DiamondCommand,
      {
        actorUid: SCORER_UID,
        eventId: `noncanonical-checkpoint-${String(index)}`,
        serverTimestampMs: 1_800_000_050_000 + index
      }
    )
  };
}

function configureReadyGame(game: ReturnType<typeof harness>) {
  game.submit('activate', { initialScorerUid: SCORER_UID, captureMode: 'full' });
  const homeLineup = game.submit('set_lineup', {
    side: 'home',
    entries: [
      { slot: 1, playerId: 'home-1' },
      { slot: 2, playerId: 'home-2' }
    ]
  });
  const awayLineup = game.submit('set_lineup', {
    side: 'away',
    entries: [
      { slot: 1, playerId: 'away-1' },
      { slot: 2, playerId: 'away-2' }
    ]
  });
  game.submit('set_defensive_alignment', {
    side: 'home',
    assignments: [
      { position: 'P', playerId: 'home-1' },
      { position: 'C', playerId: 'home-2' }
    ]
  });
  game.submit('set_defensive_alignment', {
    side: 'away',
    assignments: [
      { position: 'P', playerId: 'away-1' },
      { position: 'C', playerId: 'away-2' }
    ]
  });
  return { homeLineupEventId: homeLineup.event!.eventId, awayLineupEventId: awayLineup.event!.eventId };
}

function configureCourtesyRunnerReadyGame(game: ReturnType<typeof harness>) {
  game.submit('activate', { initialScorerUid: SCORER_UID, captureMode: 'full' });
  game.submit('set_lineup', {
    side: 'home',
    entries: [
      { slot: 1, playerId: 'home-dp', battingRole: 'dp' },
      { slot: 2, playerId: 'home-pitcher' },
      { slot: 3, playerId: 'home-history' }
    ]
  });
  game.submit('set_lineup', {
    side: 'away',
    entries: [
      { slot: 1, playerId: 'away-1' },
      { slot: 2, playerId: 'away-2' }
    ]
  });
  game.submit('set_defensive_alignment', {
    side: 'home',
    assignments: [
      { position: 'P', playerId: 'home-pitcher' },
      { position: 'C', playerId: 'home-defense-only' }
    ]
  });
  game.submit('set_defensive_alignment', {
    side: 'away',
    assignments: [
      { position: 'P', playerId: 'away-1' },
      { position: 'C', playerId: 'away-2' }
    ]
  });
  game.submit('set_dp_flex', {
    side: 'home',
    dpPlayerId: 'home-dp',
    flexPlayerId: 'home-flex',
    dpBattingSlot: 1,
    flexDefensivePosition: 'RF'
  });
  game.submit('start', {});
  game.submit('substitute', {
    side: 'home',
    battingSlot: 3,
    outgoingPlayerId: 'home-history',
    incomingPlayerId: 'home-history-only'
  });
  game.submit('re_enter', {
    side: 'home',
    battingSlot: 3,
    starterPlayerId: 'home-history',
    replacedPlayerId: 'home-history-only'
  });
  game.submit('record_plate_appearance', {
    batterId: 'away-1',
    pitcherId: 'home-pitcher',
    result: 'single',
    batterAdvance: { to: 'first' },
    runnerAdvances: [],
    outsOnPlay: 0
  });
}

describe('opposing Diamond lineup identities', () => {
  it('rejects a batting player identity already saved for the opposing side', () => {
    const game = harness();
    game.submit('activate', { initialScorerUid: SCORER_UID, captureMode: 'full' });
    game.submit('set_lineup', {
      side: 'home',
      entries: [
        { slot: 1, playerId: 'shared-player-id' },
        { slot: 2, playerId: 'home-2' }
      ]
    });
    const before = game.ledger;

    const collision = game.submit(
      'set_lineup',
      {
        side: 'away',
        entries: [
          { slot: 1, playerId: 'shared-player-id' },
          { slot: 2, playerId: 'away-2' }
        ]
      },
      { accept: false }
    );

    expect(collision.result.rejection).toMatchObject({ code: 'opposing-lineup-player' });
    expect(collision.ledger).toBe(before);
    expect(collision.ledger.state.revision).toBe(before.state.revision);
    expect(collision.ledger.events).toHaveLength(before.events.length);
    expect(game.ledger.state.lineups.away.battingOrder).toEqual([]);
  });

  it('rejects opposing identities in defensive-only assignments and at the start boundary', () => {
    const defenseGame = harness();
    defenseGame.submit('activate', { initialScorerUid: SCORER_UID, captureMode: 'full' });
    defenseGame.submit('set_lineup', { side: 'home', entries: [{ slot: 1, playerId: 'home-1' }] });
    defenseGame.submit('set_lineup', { side: 'away', entries: [{ slot: 1, playerId: 'away-1' }] });
    defenseGame.submit('set_defensive_alignment', {
      side: 'home',
      assignments: [{ position: 'P', playerId: 'home-1' }]
    });
    const beforeDefenseCollision = defenseGame.ledger;
    const defensiveCollision = defenseGame.submit(
      'set_defensive_alignment',
      { side: 'away', assignments: [{ position: 'P', playerId: 'home-1' }] },
      { accept: false }
    );
    expect(defensiveCollision.result.rejection).toMatchObject({ code: 'opposing-lineup-player' });
    expect(defensiveCollision.ledger).toBe(beforeDefenseCollision);
    expect(defensiveCollision.ledger.state.revision).toBe(beforeDefenseCollision.state.revision);

    const startGame = harness();
    configureReadyGame(startGame);
    const ready = startGame.ledger.state;
    const craftedDuplicate = {
      ...ready,
      lineups: {
        ...ready.lineups,
        away: {
          ...ready.lineups.away,
          battingOrder: ready.lineups.away.battingOrder.map((entry, index) =>
            index === 0 ? { ...entry, activePlayerId: 'home-1', starterPlayerId: 'home-1' } : entry
          )
        }
      }
    } as DiamondGameState;

    expect(() => reduceDiamondEvent(craftedDuplicate, { type: 'start', payload: {}, eventId: 'crafted-start' })).toThrowError(
      expect.objectContaining({ code: 'opposing-lineup-player' })
    );
  });

  it('includes DP/FLEX identities in the opposing-side collision boundary', () => {
    const game = harness('fastpitch-nfhs');
    game.submit('activate', { initialScorerUid: SCORER_UID, captureMode: 'full' });
    game.submit('set_lineup', {
      side: 'home',
      entries: [
        { slot: 1, playerId: 'home-dp', battingRole: 'dp' },
        { slot: 2, playerId: 'home-pitcher' }
      ]
    });
    game.submit('set_lineup', {
      side: 'away',
      entries: [
        { slot: 1, playerId: 'away-1' },
        { slot: 2, playerId: 'away-flex-collision' }
      ]
    });
    game.submit('set_defensive_alignment', {
      side: 'home',
      assignments: [{ position: 'P', playerId: 'home-pitcher' }]
    });
    game.submit('set_defensive_alignment', {
      side: 'away',
      assignments: [{ position: 'P', playerId: 'away-1' }]
    });
    const before = game.ledger;

    const collision = game.submit(
      'set_dp_flex',
      {
        side: 'home',
        dpPlayerId: 'home-dp',
        flexPlayerId: 'away-flex-collision',
        dpBattingSlot: 1,
        flexDefensivePosition: 'RF'
      },
      { accept: false }
    );

    expect(collision.result.rejection).toMatchObject({ code: 'opposing-lineup-player' });
    expect(collision.ledger).toBe(before);
    expect(collision.ledger.state.revision).toBe(before.state.revision);
    expect(collision.ledger.events).toHaveLength(before.events.length);
  });

  it('rejects a substitution that reuses even a historical opposing player identity', () => {
    const game = harness();
    configureReadyGame(game);
    game.submit('start', {});
    game.submit('substitute', {
      side: 'away',
      battingSlot: 1,
      outgoingPlayerId: 'away-1',
      incomingPlayerId: 'away-reliever',
      defensivePosition: 'P'
    });
    const before = game.ledger;

    const collision = game.submit(
      'substitute',
      {
        side: 'home',
        battingSlot: 1,
        outgoingPlayerId: 'home-1',
        incomingPlayerId: 'away-1',
        defensivePosition: 'P'
      },
      { accept: false }
    );

    expect(collision.result.rejection).toMatchObject({ code: 'opposing-lineup-player' });
    expect(collision.ledger).toBe(before);
    expect(collision.ledger.state.revision).toBe(before.state.revision);
    expect(collision.ledger.events).toHaveLength(before.events.length);
    expect(replayDiamondLedger(game.ledger).state).toEqual(before.state);
  });

  it('rejects noncanonical player IDs across lineup, defense, substitution, and play ingress', () => {
    const lineup = harness();
    lineup.submit('activate', { initialScorerUid: SCORER_UID, captureMode: 'full' });
    lineup.submit('set_lineup', { side: 'home', entries: [{ slot: 1, playerId: 'shared-player' }] });
    const lineupPayload = { side: 'away', entries: [{ slot: 1, playerId: ' shared-player ' }] } as const;
    const lineupDirect = lineup.submit('set_lineup', lineupPayload, { accept: false });
    expect(lineupDirect.result.rejection).toMatchObject({ code: 'invalid-id' });
    const lineupCheckpoint = executeAtCheckpoint(lineup.ledger, 'set_lineup', lineupPayload, 1);
    expect(lineupCheckpoint.execution.result.rejection).toMatchObject({ code: 'invalid-id' });
    expect(lineupCheckpoint.execution.checkpoint).toBe(lineupCheckpoint.checkpoint);

    const defense = harness('fastpitch-nfhs');
    configureCourtesyRunnerReadyGame(defense);
    const defensePayload = {
      side: 'away',
      assignments: [{ position: 'P', playerId: ' home-pitcher ' }]
    } as const;
    const defenseDirect = defense.submit('set_defensive_alignment', defensePayload, { accept: false });
    expect(defenseDirect.result.rejection).toMatchObject({ code: 'invalid-id' });
    const defenseCheckpoint = executeAtCheckpoint(defense.ledger, 'set_defensive_alignment', defensePayload, 2);
    expect(defenseCheckpoint.execution.result.rejection).toMatchObject({ code: 'invalid-id' });
    expect(defenseCheckpoint.execution.checkpoint).toBe(defenseCheckpoint.checkpoint);

    const substitutionPayload = {
      side: 'away',
      battingSlot: 2,
      outgoingPlayerId: 'away-2',
      incomingPlayerId: ' home-history '
    } as const;
    const substitutionDirect = defense.submit('substitute', substitutionPayload, { accept: false });
    expect(substitutionDirect.result.rejection).toMatchObject({ code: 'invalid-id' });
    const substitutionCheckpoint = executeAtCheckpoint(defense.ledger, 'substitute', substitutionPayload, 3);
    expect(substitutionCheckpoint.execution.result.rejection).toMatchObject({ code: 'invalid-id' });
    expect(substitutionCheckpoint.execution.checkpoint).toBe(substitutionCheckpoint.checkpoint);

    for (const [index, batterId] of [' away-2 ', 'away-2\u0000'].entries()) {
      const playPayload = {
        batterId,
        pitcherId: 'home-pitcher',
        result: 'ground_out',
        batterAdvance: { to: 'out', outKind: 'batter_runner' },
        runnerAdvances: [],
        outsOnPlay: 1
      } as const;
      const playDirect = defense.submit('record_plate_appearance', playPayload, { accept: false });
      expect(playDirect.result.rejection).toMatchObject({ code: 'invalid-id' });
      const playCheckpoint = executeAtCheckpoint(defense.ledger, 'record_plate_appearance', playPayload, 4 + index);
      expect(playCheckpoint.execution.result.rejection).toMatchObject({ code: 'invalid-id' });
      expect(playCheckpoint.execution.checkpoint).toBe(playCheckpoint.checkpoint);
    }
  });

  it('rejects a colliding lineup correction atomically and keeps canonical replay valid', () => {
    const game = harness();
    const { awayLineupEventId } = configureReadyGame(game);
    game.submit('start', {});
    const before = game.ledger;

    const correction = game.submit(
      'supersede_event',
      {
        targetEventId: awayLineupEventId,
        reason: 'Correct the opponent lineup without merging identities.',
        replacement: {
          type: 'set_lineup',
          payload: {
            side: 'away',
            entries: [
              { slot: 1, playerId: 'home-1' },
              { slot: 2, playerId: 'away-2' }
            ]
          }
        }
      },
      { accept: false }
    );

    expect(correction.result.rejection).toMatchObject({ code: 'opposing-lineup-player' });
    expect(correction.ledger).toBe(before);
    expect(game.ledger.events).toHaveLength(before.events.length);
    expect(replayDiamondLedger(game.ledger).state).toEqual(before.state);
  });

  it('keeps matching legacy display metadata compatible when player IDs are explicitly namespaced', () => {
    const game = harness();
    game.submit('activate', { initialScorerUid: SCORER_UID, captureMode: 'full' });
    game.submit('set_lineup', {
      side: 'home',
      entries: [{ slot: 1, playerId: 'managed:player-1', displayName: 'Alex Lee', jerseyNumber: '7' }]
    });
    game.submit('set_lineup', {
      side: 'away',
      entries: [{ slot: 1, playerId: 'opponent:player-1', displayName: 'Alex Lee', jerseyNumber: '7' }]
    });
    game.submit('set_defensive_alignment', {
      side: 'home',
      assignments: [{ position: 'P', playerId: 'managed:player-1' }]
    });
    game.submit('set_defensive_alignment', {
      side: 'away',
      assignments: [{ position: 'P', playerId: 'opponent:player-1' }]
    });
    game.submit('start', {});

    expect(replayDiamondLedger(game.ledger).state).toEqual(game.ledger.state);
    expect(game.ledger.state.lineups.home.battingOrder[0]).toMatchObject({ displayName: 'Alex Lee', jerseyNumber: '7' });
    expect(game.ledger.state.lineups.away.battingOrder[0]).toMatchObject({ displayName: 'Alex Lee', jerseyNumber: '7' });

    const checkpoint = createDiamondCheckpoint(game.ledger);
    const rejected = executeDiamondCommandFromCheckpoint(
      checkpoint,
      {
        schemaVersion: DIAMOND_SCHEMA_VERSION,
        commandId: uuid(99),
        teamId: checkpoint.teamId,
        gameId: checkpoint.gameId,
        expectedRevision: checkpoint.sequence,
        rulesProfileId: checkpoint.rulesProfileId,
        rulesProfileVersion: checkpoint.rulesProfileVersion,
        type: 'substitute',
        payload: {
          side: 'home',
          battingSlot: 1,
          outgoingPlayerId: 'managed:player-1',
          incomingPlayerId: 'opponent:player-1',
          defensivePosition: 'P'
        }
      },
      {
        actorUid: SCORER_UID,
        eventId: 'checkpoint-opposing-lineup-collision',
        serverTimestampMs: 1_800_000_001_000
      }
    );
    expect(rejected.result.rejection).toMatchObject({ code: 'opposing-lineup-player' });
    expect(rejected.checkpoint).toBe(checkpoint);
    expect(rejected.checkpoint.sequence).toBe(game.ledger.state.revision);
  });

  it('rejects every known opposing identity at courtesy-runner ingress without mutating ledger or checkpoint state', () => {
    const game = harness('fastpitch-nfhs');
    configureCourtesyRunnerReadyGame(game);
    const before = game.ledger;
    const checkpoint = createDiamondCheckpoint(before);
    const opposingPlayerIds = [
      ['active starter', 'home-dp'],
      ['defense-only player', 'home-defense-only'],
      ['DP/FLEX player', 'home-flex'],
      ['historical substitute', 'home-history-only']
    ] as const;

    opposingPlayerIds.forEach(([category, runnerId], index) => {
      const collision = game.submit(
        'add_courtesy_runner',
        {
          side: 'away',
          forPlayerId: 'away-1',
          runnerId,
          base: 'first',
          forRole: 'pitcher'
        },
        { accept: false }
      );
      expect(collision.result.rejection, category).toMatchObject({ code: 'opposing-lineup-player' });
      expect(collision.ledger, category).toBe(before);
      expect(collision.ledger.state.revision, category).toBe(before.state.revision);
      expect(collision.ledger.events, category).toHaveLength(before.events.length);

      const boundedCollision = executeDiamondCommandFromCheckpoint(
        checkpoint,
        {
          schemaVersion: DIAMOND_SCHEMA_VERSION,
          commandId: uuid(200 + index),
          teamId: checkpoint.teamId,
          gameId: checkpoint.gameId,
          expectedRevision: checkpoint.sequence,
          rulesProfileId: checkpoint.rulesProfileId,
          rulesProfileVersion: checkpoint.rulesProfileVersion,
          type: 'add_courtesy_runner',
          payload: {
            side: 'away',
            forPlayerId: 'away-1',
            runnerId,
            base: 'first',
            forRole: 'pitcher'
          }
        },
        {
          actorUid: SCORER_UID,
          eventId: `checkpoint-courtesy-collision-${String(index)}`,
          serverTimestampMs: 1_800_000_002_000 + index
        }
      );
      expect(boundedCollision.result.rejection, category).toMatchObject({ code: 'opposing-lineup-player' });
      expect(boundedCollision.checkpoint, category).toBe(checkpoint);
      expect(boundedCollision.result.state, category).toBe(checkpoint.state);
      expect(boundedCollision.checkpoint.sequence, category).toBe(before.state.revision);
    });

    expect(game.ledger).toBe(before);
    expect(replayDiamondLedger(game.ledger).state).toEqual(before.state);
  });

  it('preserves same-side courtesy runners and rejects a cross-side correction atomically', () => {
    const game = harness('fastpitch-nfhs');
    configureCourtesyRunnerReadyGame(game);
    const courtesyRunner = game.submit('add_courtesy_runner', {
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
    const beforeCorrection = game.ledger;

    const correction = game.submit(
      'supersede_event',
      {
        targetEventId: courtesyRunner.event!.eventId,
        reason: 'Correct the courtesy runner without crossing team identities.',
        replacement: {
          type: 'add_courtesy_runner',
          payload: {
            side: 'away',
            forPlayerId: 'away-1',
            runnerId: 'home-dp',
            base: 'first',
            forRole: 'pitcher'
          }
        }
      },
      { accept: false }
    );

    expect(correction.result.rejection).toMatchObject({ code: 'opposing-lineup-player' });
    expect(correction.ledger).toBe(beforeCorrection);
    expect(correction.ledger.state.revision).toBe(beforeCorrection.state.revision);
    expect(correction.ledger.events).toHaveLength(beforeCorrection.events.length);
    expect(replayDiamondLedger(game.ledger).state).toEqual(beforeCorrection.state);

    game.submit('advance_runner', {
      runnerId: 'away-courtesy',
      from: 'first',
      to: 'home',
      cause: 'other',
      countsRun: true,
      earned: true
    });
    expect(game.ledger.state.score.away).toBe(1);
    expect(game.ledger.state.bases.first).toBeNull();
    for (let out = 0; out < 3; out += 1) {
      const slot = game.ledger.state.nextBatterSlot.away;
      const batterId = game.ledger.state.lineups.away.battingOrder[slot].activePlayerId;
      game.submit('record_plate_appearance', {
        batterId,
        pitcherId: 'home-pitcher',
        result: 'ground_out',
        batterAdvance: { to: 'out', outKind: 'batter_runner' },
        runnerAdvances: [],
        outsOnPlay: 1
      });
    }
    game.submit('advance_half_inning', {});
    expect(game.ledger.state.inning.half).toBe('bottom');
    expect(game.ledger.state.lineups.away.courtesyRunnerIds).toEqual(['away-courtesy']);
    expect(getDiamondPlayerIdentityIdsBySide(game.ledger).away).toContain('away-courtesy');
    expect(replayDiamondLedger(game.ledger).state).toEqual(game.ledger.state);
    expect(verifyDiamondLedger(game.ledger)).toBe(true);

    const checkpoint = createDiamondCheckpoint(game.ledger);
    const departedCollision = executeDiamondCommandFromCheckpoint(
      checkpoint,
      {
        schemaVersion: DIAMOND_SCHEMA_VERSION,
        commandId: '50000000-0000-4000-8000-000000000001',
        teamId: checkpoint.teamId,
        gameId: checkpoint.gameId,
        expectedRevision: checkpoint.sequence,
        rulesProfileId: checkpoint.rulesProfileId,
        rulesProfileVersion: checkpoint.rulesProfileVersion,
        type: 'substitute',
        payload: {
          side: 'home',
          battingSlot: 3,
          outgoingPlayerId: 'home-history',
          incomingPlayerId: 'away-courtesy'
        }
      },
      {
        actorUid: SCORER_UID,
        eventId: 'departed-courtesy-opposing-collision',
        serverTimestampMs: 1_800_000_003_000
      }
    );
    expect(departedCollision.result.rejection).toMatchObject({ code: 'opposing-lineup-player' });
    expect(departedCollision.checkpoint).toBe(checkpoint);
  });

  it('releases voided courtesy identities and replaces superseded identities canonically', () => {
    const voided = harness('fastpitch-nfhs');
    configureCourtesyRunnerReadyGame(voided);
    const voidedCourtesy = voided.submit('add_courtesy_runner', {
      side: 'away',
      forPlayerId: 'away-1',
      runnerId: 'released-courtesy',
      base: 'first',
      forRole: 'pitcher'
    });
    voided.submit('void_event', {
      targetEventId: voidedCourtesy.event!.eventId,
      reason: 'Remove the incorrect courtesy-runner event.'
    });
    expect(voided.ledger.state.lineups.away.courtesyRunnerIds).toEqual([]);
    voided.submit('substitute', {
      side: 'home',
      battingSlot: 3,
      outgoingPlayerId: 'home-history',
      incomingPlayerId: 'released-courtesy'
    });
    expect(verifyDiamondLedger(voided.ledger)).toBe(true);
    expect(replayDiamondLedger(voided.ledger).state).toEqual(voided.ledger.state);

    const superseded = harness('fastpitch-nfhs');
    configureCourtesyRunnerReadyGame(superseded);
    const original = superseded.submit('add_courtesy_runner', {
      side: 'away',
      forPlayerId: 'away-1',
      runnerId: 'replaced-courtesy-a',
      base: 'first',
      forRole: 'pitcher'
    });
    superseded.submit('supersede_event', {
      targetEventId: original.event!.eventId,
      reason: 'Correct the recorded courtesy-runner identity.',
      replacement: {
        type: 'add_courtesy_runner',
        payload: {
          side: 'away',
          forPlayerId: 'away-1',
          runnerId: 'replacement-courtesy-b',
          base: 'first',
          forRole: 'pitcher'
        }
      }
    });
    expect(superseded.ledger.state.bases.first?.runnerId).toBe('replacement-courtesy-b');
    expect(superseded.ledger.state.lineups.away.courtesyRunnerIds).toEqual(['replacement-courtesy-b']);
    const beforeCollision = superseded.ledger;
    const replacementCollision = superseded.submit(
      'substitute',
      {
        side: 'home',
        battingSlot: 3,
        outgoingPlayerId: 'home-history',
        incomingPlayerId: 'replacement-courtesy-b'
      },
      { accept: false }
    );
    expect(replacementCollision.result.rejection).toMatchObject({ code: 'opposing-lineup-player' });
    expect(replacementCollision.ledger).toBe(beforeCollision);
    superseded.submit('substitute', {
      side: 'home',
      battingSlot: 3,
      outgoingPlayerId: 'home-history',
      incomingPlayerId: 'replaced-courtesy-a'
    });
    expect(verifyDiamondLedger(superseded.ledger)).toBe(true);
    expect(replayDiamondLedger(superseded.ledger).state).toEqual(superseded.ledger.state);
  });

  it('requires canonical bounded courtesy history before accepting any mutation', () => {
    const game = harness('fastpitch-nfhs');
    configureCourtesyRunnerReadyGame(game);
    const maximum = DIAMOND_MAX_COURTESY_RUNNER_IDENTITIES_PER_SIDE;
    const registeredIds = Array.from({ length: maximum }, (_, index) => `bounded-courtesy-${String(index)}`);
    const boundedState: DiamondGameState = {
      ...game.ledger.state,
      lineups: {
        ...game.ledger.state.lineups,
        away: { ...game.ledger.state.lineups.away, courtesyRunnerIds: registeredIds }
      }
    };
    expect(
      reduceDiamondEvent(boundedState, {
        type: 'add_courtesy_runner',
        payload: {
          side: 'away',
          forPlayerId: 'away-1',
          runnerId: registeredIds[0],
          base: 'first',
          forRole: 'pitcher'
        }
      }).lineups.away.courtesyRunnerIds
    ).toHaveLength(maximum);
    expect(() =>
      reduceDiamondEvent(boundedState, {
        type: 'add_courtesy_runner',
        payload: {
          side: 'away',
          forPlayerId: 'away-1',
          runnerId: 'overflow-courtesy',
          base: 'first',
          forRole: 'pitcher'
        }
      })
    ).toThrowError(expect.objectContaining({ code: 'courtesy-runner-identity-limit' }));
    expect(() =>
      validateDiamondState({
        ...game.ledger.state,
        lineups: {
          ...game.ledger.state.lineups,
          away: { ...game.ledger.state.lineups.away, courtesyRunnerIds: [' noncanonical-courtesy '] }
        }
      })
    ).toThrowError(expect.objectContaining({ code: 'invalid-id' }));

    const command: DiamondCommand = {
      schemaVersion: DIAMOND_SCHEMA_VERSION,
      commandId: '70000000-0000-4000-8000-000000000001',
      teamId: game.ledger.teamId,
      gameId: game.ledger.gameId,
      expectedRevision: game.ledger.state.revision,
      rulesProfileId: game.ledger.rulesProfileId,
      rulesProfileVersion: game.ledger.rulesProfileVersion,
      type: 'private_note',
      payload: { text: 'Must not mutate an unmarked ledger.' }
    };
    const unmarked = {
      ...game.ledger,
      initialState: structuredClone(game.ledger.initialState),
      state: structuredClone(game.ledger.state),
      events: structuredClone(game.ledger.events)
    } as DiamondLedger;
    delete (unmarked.initialState.lineups.home as { courtesyRunnerIds?: readonly string[] }).courtesyRunnerIds;
    delete (unmarked.initialState.lineups.away as { courtesyRunnerIds?: readonly string[] }).courtesyRunnerIds;
    delete (unmarked.state.lineups.home as { courtesyRunnerIds?: readonly string[] }).courtesyRunnerIds;
    delete (unmarked.state.lineups.away as { courtesyRunnerIds?: readonly string[] }).courtesyRunnerIds;
    expect(() => replayDiamondLedger(unmarked)).toThrowError(expect.objectContaining({ code: 'history-required' }));
    const blockedLedger = executeDiamondCommand(unmarked, command, {
      actorUid: SCORER_UID,
      eventId: 'unmarked-ledger-command',
      serverTimestampMs: 1_800_000_004_000
    });
    expect(blockedLedger.result.rejection).toMatchObject({ code: 'history-required' });
    expect(blockedLedger.ledger).toBe(unmarked);

    const unmarkedCheckpoint = structuredClone(createDiamondCheckpoint(game.ledger));
    delete (unmarkedCheckpoint.state.lineups.home as { courtesyRunnerIds?: readonly string[] }).courtesyRunnerIds;
    delete (unmarkedCheckpoint.state.lineups.away as { courtesyRunnerIds?: readonly string[] }).courtesyRunnerIds;
    const blockedCheckpoint = executeDiamondCommandFromCheckpoint(
      unmarkedCheckpoint,
      command,
      {
        actorUid: SCORER_UID,
        eventId: 'unmarked-checkpoint-command',
        serverTimestampMs: 1_800_000_004_001
      }
    );
    expect(blockedCheckpoint.result.rejection).toMatchObject({ code: 'history-required' });
    expect(blockedCheckpoint.checkpoint).toBe(unmarkedCheckpoint);
  });
});
