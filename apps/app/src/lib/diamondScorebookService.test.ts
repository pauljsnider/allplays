import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateDiamondGame,
  configureDiamondTeam,
  createDiamondCommand,
  createSecureDiamondId,
  enqueueDiamondCommand,
  getDiamondAccess,
  getDiamondQueueKey,
  normalizeDiamondSnapshot,
  parseDiamondVoice,
  readDiamondCommandQueue,
  reconcileDiamondCommandQueue,
  saveDiamondPrivateNote,
  submitDiamondCommand,
  type DiamondCallableTransport,
  type DiamondCommandEnvelope
} from './diamondScorebookService';

const uuid = '12345678-1234-4234-9234-123456789abc';

function cryptoWithUuid(value = uuid) {
  return { randomUUID: vi.fn(() => value) } as unknown as Crypto;
}

function buildRawSnapshot(revision = 3) {
  return {
    revision,
    state: {
      schemaVersion: 2,
      teamId: 'team-1',
      gameId: 'game-1',
      revision,
      lifecycle: 'active',
      captureMode: 'full',
      rulesProfileId: 'baseball-youth',
      rulesProfileVersion: 1,
      checkpointHash: `sha256:revision-${revision}`,
      currentScorerUid: 'coach-1',
      score: { home: 2, away: 1 },
      inning: { number: 4, half: 'bottom', outs: 1, balls: 2, strikes: 1 },
      bases: {
        first: { runnerId: 'runner-1' },
        second: null,
        third: { runnerId: 'runner-3' }
      },
      lineups: {
        home: {
          battingOrder: [
            { slot: 1, activePlayerId: 'batter-1', displayName: 'Avery Carter', jerseyNumber: '12' },
            { slot: 2, activePlayerId: 'runner-1', displayName: 'Jordan Lee', jerseyNumber: '8' }
          ],
          defense: {}
        },
        away: {
          battingOrder: [{ slot: 1, activePlayerId: 'pitcher-1', displayName: 'Morgan Diaz', jerseyNumber: '7' }],
          defense: { P: 'pitcher-1' }
        }
      },
      nextBatterSlot: { home: 0, away: 0 },
      coverage: {
        batting: 'complete',
        baserunning: 'complete',
        pitching: 'complete',
        fielding: 'partial',
        situational: 'complete',
        pitches: 'complete',
        sensors: 'not_collected'
      }
    },
    presentation: {
      teamName: 'Bears',
      opponentName: 'Wolves',
      homeName: 'Bears',
      awayName: 'Wolves',
      bases: {
        first: { playerId: 'runner-1', name: 'Jordan Lee', number: '8' },
        third: { playerId: 'runner-3', name: 'Casey Kim', number: '4' }
      },
      managedSide: 'home',
      availablePlayers: {
        home: [{ playerId: 'bench-1', name: 'Taylor Gray', number: '15' }],
        away: [{ playerId: 'bench-away', name: 'Sam Ortiz', number: '10' }]
      },
      rulesCapabilities: {
        dpFlex: false,
        courtesyRunner: { pitcher: true, catcher: true }
      }
    },
    lease: {
      status: 'owned',
      canScore: true,
      holderUid: 'coach-1',
      holderName: 'Coach Carter',
      eligibleScorers: [{ playerId: 'coach-2', name: 'Coach Lee' }]
    },
    recentPlays: [{ eventId: 'event-3', revision: 3, label: 'Avery singled', inningLabel: 'Bottom 4' }],
    completeness: {
      status: 'partial',
      authoritativeRevision: revision,
      families: {
        batting: 'complete',
        fielding: 'partial',
        sensors: 'not_collected'
      },
      omissions: ['fielding location']
    }
  };
}

function buildCommand(overrides: Partial<DiamondCommandEnvelope> = {}) {
  return createDiamondCommand(
    {
      teamId: 'team-1',
      gameId: 'game-1',
      expectedRevision: 3,
      rulesProfileId: 'baseball-youth',
      rulesProfileVersion: 1,
      type: 'record_pitch',
      payload: { batterId: 'batter-1', pitcherId: 'pitcher-1', result: 'ball' },
      ...overrides
    },
    cryptoWithUuid()
  );
}

function createStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    })
  };
}

describe('diamondScorebookService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates RFC 4122 command IDs only from secure randomness and fails closed without it', () => {
    expect(createSecureDiamondId(cryptoWithUuid())).toBe(uuid);

    const getRandomValues = vi.fn((array: Uint8Array) => {
      array.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
      return array;
    });
    expect(createSecureDiamondId({ getRandomValues } as unknown as Crypto)).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
    expect(() => createSecureDiamondId(null)).toThrowError(
      expect.objectContaining({
        code: 'secure-randomness-unavailable'
      })
    );
  });

  it('builds a schema-v2 command with one expected revision and rejects unsafe identifiers', () => {
    expect(buildCommand()).toEqual({
      schemaVersion: 2,
      commandId: uuid,
      teamId: 'team-1',
      gameId: 'game-1',
      expectedRevision: 3,
      rulesProfileId: 'baseball-youth',
      rulesProfileVersion: 1,
      type: 'record_pitch',
      payload: { batterId: 'batter-1', pitcherId: 'pitcher-1', result: 'ball' }
    });
    expect(() =>
      createDiamondCommand(
        {
          teamId: '../team',
          gameId: 'game-1',
          expectedRevision: 3,
          rulesProfileId: 'baseball-youth',
          rulesProfileVersion: 1,
          type: 'start',
          payload: {}
        },
        cryptoWithUuid()
      )
    ).toThrow('Team ID is missing or invalid');
    expect(() =>
      createDiamondCommand(
        {
          teamId: 'team-1',
          gameId: 'game-1',
          expectedRevision: 3.2,
          rulesProfileId: 'baseball-youth',
          rulesProfileVersion: 1,
          type: 'start',
          payload: {}
        },
        cryptoWithUuid()
      )
    ).toThrow('nonnegative integer');
  });

  it('normalizes authoritative state, lineup context, lease, recent plays, and completeness evidence', () => {
    const snapshot = normalizeDiamondSnapshot(buildRawSnapshot());
    expect(snapshot).toMatchObject({
      teamId: 'team-1',
      gameId: 'game-1',
      revision: 3,
      authoritative: true,
      lifecycle: 'active',
      score: { home: 2, away: 1 },
      inning: { number: 4, half: 'bottom', outs: 1, balls: 2, strikes: 1 },
      currentBatter: { playerId: 'batter-1', name: 'Avery Carter', number: '12' },
      currentPitcher: { playerId: 'pitcher-1', name: 'Morgan Diaz', number: '7' },
      managedSide: 'home',
      ruleCapabilities: { dpFlex: false, courtesyRunner: { pitcher: true, catcher: true } },
      lease: { canScore: true, holderUid: 'coach-1' },
      completeness: { status: 'partial', authoritativeRevision: 3 }
    });
    expect(snapshot.bases.first?.name).toBe('Jordan Lee');
    expect(snapshot.battingLineup.map((player) => player.name)).toEqual(['Avery Carter', 'Jordan Lee']);
    expect(snapshot.lineups.home.map((player) => player.name)).toEqual(['Avery Carter', 'Jordan Lee']);
    expect(snapshot.availablePlayers.home.map((player) => player.name)).toEqual(['Taylor Gray', 'Avery Carter', 'Jordan Lee']);
    expect(snapshot.defensiveLineup.map((player) => player.name)).toEqual(['Morgan Diaz']);
    expect(snapshot.recentPlays[0]?.eventId).toBe('event-3');
  });

  it('bounds private roster candidates and derives only known local rules capabilities when presentation flags are absent', () => {
    const raw = buildRawSnapshot();
    const snapshot = normalizeDiamondSnapshot({
      ...raw,
      state: { ...raw.state, rulesProfileId: 'fastpitch-youth' },
      presentation: {
        ...raw.presentation,
        rulesCapabilities: undefined,
        availablePlayers: {
          home: Array.from({ length: 105 }, (_, index) => ({
            playerId: `candidate-${index + 1}`,
            name: `Candidate ${index + 1}`
          })),
          away: []
        }
      }
    });

    expect(snapshot.availablePlayers.home).toHaveLength(100);
    expect(snapshot.ruleCapabilities).toEqual({
      dpFlex: true,
      courtesyRunner: { pitcher: true, catcher: true }
    });
  });

  it('retries an uncertain callable with the exact same immutable command', async () => {
    const command = buildCommand();
    const call = vi
      .fn()
      .mockRejectedValueOnce({ code: 'functions/unavailable', message: 'connection reset' })
      .mockResolvedValueOnce({
        ...buildRawSnapshot(4),
        outcome: 'accepted',
        revision: 4,
        eventId: 'event-4'
      });

    const result = await submitDiamondCommand(command, { transport: { call }, maxAttempts: 2 });

    expect(result.outcome).toBe('accepted');
    expect(result.revision).toBe(4);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[0]).toEqual(['submitDiamondCommand', command]);
    expect(call.mock.calls[1]).toEqual(['submitDiamondCommand', command]);
    expect(call.mock.calls[1]?.[1]).toEqual(call.mock.calls[0]?.[1]);
  });

  it('returns a typed stale-revision error with authoritative evidence', async () => {
    const transport: DiamondCallableTransport = {
      call: vi.fn().mockRejectedValue({
        code: 'functions/failed-precondition',
        message: 'stale',
        details: { reason: 'stale_revision', authoritativeRevision: 9 }
      })
    };
    await expect(submitDiamondCommand(buildCommand(), { transport, maxAttempts: 1 })).rejects.toMatchObject({
      name: 'DiamondScorebookError',
      code: 'stale-revision',
      retryable: false,
      authoritativeRevision: 9
    });
  });

  it('parses voice into a non-mutating proposal and never calls the submit endpoint', async () => {
    const call = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      type: 'record_plate_appearance',
      payload: {
        batterId: 'batter-1',
        pitcherId: 'pitcher-1',
        result: 'single',
        batterAdvance: { to: 'first' },
        runnerAdvances: [],
        outsOnPlay: 0
      },
      confidence: 0.82,
      unresolvedFields: ['runner from second'],
      requiresConfirmation: true,
      mutatesState: false
    });
    const proposal = await parseDiamondVoice(
      {
        teamId: 'team-1',
        gameId: 'game-1',
        expectedRevision: 3,
        rulesProfileId: 'baseball-youth',
        rulesProfileVersion: 1,
        transcript: 'Single to left, check the runner from second.'
      },
      { transport: { call } }
    );

    expect(proposal).toMatchObject({ requiresConfirmation: true, mutatesState: false, confidence: 0.82 });
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith(
      'parseDiamondVoice',
      expect.objectContaining({ transcript: 'Single to left, check the runner from second.' })
    );
    expect(call).not.toHaveBeenCalledWith('submitDiamondCommand', expect.anything());
    expect(JSON.stringify(call.mock.calls[0]?.[1])).not.toMatch(/audio|recording/i);
  });

  it('rejects an AI response that could mutate without the scoring confirmation boundary', async () => {
    const transport: DiamondCallableTransport = {
      call: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        type: 'finalize',
        payload: { confirmed: true },
        confidence: 1,
        unresolvedFields: [],
        requiresConfirmation: true,
        mutatesState: false
      })
    };
    await expect(
      parseDiamondVoice(
        {
          teamId: 'team-1',
          gameId: 'game-1',
          expectedRevision: 3,
          rulesProfileId: 'baseball-youth',
          rulesProfileVersion: 1,
          transcript: 'Finish the game.'
        },
        { transport }
      )
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('saves a private transcript only through a confirmed private_note command with no audio fields', async () => {
    const call = vi.fn().mockResolvedValue({
      ...buildRawSnapshot(4),
      outcome: 'accepted',
      revision: 4,
      eventId: 'note-4'
    });
    await saveDiamondPrivateNote(
      {
        teamId: 'team-1',
        gameId: 'game-1',
        expectedRevision: 3,
        rulesProfileId: 'baseball-youth',
        rulesProfileVersion: 1,
        text: '  Work on first-pitch timing.  ',
        attachedEventId: 'event-3'
      },
      { transport: { call }, crypto: cryptoWithUuid() }
    );

    expect(call).toHaveBeenCalledWith(
      'submitDiamondCommand',
      expect.objectContaining({
        commandId: uuid,
        type: 'private_note',
        expectedRevision: 3,
        payload: { text: 'Work on first-pitch timing.', attachedEventId: 'event-3' }
      })
    );
    expect(JSON.stringify(call.mock.calls[0]?.[1])).not.toMatch(/audio|recording|visibility/i);

    await expect(
      saveDiamondPrivateNote({
        teamId: 'team-1',
        gameId: 'game-1',
        expectedRevision: 3,
        rulesProfileId: 'baseball-youth',
        rulesProfileVersion: 1,
        text: 'x'.repeat(2001)
      })
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('persists ordinary offline commands, deduplicates IDs, and removes each item only after server confirmation', async () => {
    const storage = createStorage();
    const command = buildCommand();
    expect(enqueueDiamondCommand(command, storage, () => new Date('2026-09-05T12:00:00Z'))).toHaveLength(1);
    expect(enqueueDiamondCommand(command, storage, () => new Date('2026-09-05T12:01:00Z'))).toHaveLength(1);
    expect(readDiamondCommandQueue('team-1', 'game-1', storage)).toEqual([
      {
        command,
        queuedAt: '2026-09-05T12:00:00.000Z'
      }
    ]);

    const call = vi.fn().mockResolvedValue({
      ...buildRawSnapshot(4),
      outcome: 'duplicate',
      revision: 4,
      eventId: 'event-4'
    });
    const result = await reconcileDiamondCommandQueue('team-1', 'game-1', { storage, transport: { call } });
    expect(result).toMatchObject({ accepted: 0, duplicates: 1, remaining: [] });
    expect(storage.values.has(getDiamondQueueKey('team-1', 'game-1'))).toBe(false);
  });

  it('never stores private notes or transcripts in the offline command queue', () => {
    const storage = createStorage();
    const note = createDiamondCommand(
      {
        teamId: 'team-1',
        gameId: 'game-1',
        expectedRevision: 3,
        rulesProfileId: 'baseball-youth',
        rulesProfileVersion: 1,
        type: 'private_note',
        payload: { text: 'private transcript' }
      },
      cryptoWithUuid()
    );
    expect(() => enqueueDiamondCommand(note, storage)).toThrowError(expect.objectContaining({ code: 'storage-unavailable' }));
    expect(storage.setItem).not.toHaveBeenCalled();

    const unsafePlay = buildCommand({ payload: { transcript: 'raw words' } });
    expect(() => enqueueDiamondCommand(unsafePlay, storage)).toThrow('never stored');
  });

  it('fails access closed and sends setup mutations with stable secure request IDs', async () => {
    const accessCall = vi.fn().mockResolvedValue({});
    await expect(getDiamondAccess('team-1', { transport: { call: accessCall } })).resolves.toEqual({
      eligible: false,
      canManage: false,
      canScore: false,
      policyMode: 'disabled',
      sport: null,
      teamOptIn: false,
      trackingEngine: null,
      reason: null
    });

    const configureCall = vi.fn().mockResolvedValue({
      configured: true,
      teamId: 'team-1',
      sport: 'baseball',
      rulesProfileId: 'baseball-youth',
      rulesProfileVersion: 1
    });
    await expect(
      configureDiamondTeam('team-1', 'baseball', null, {
        transport: { call: configureCall },
        crypto: cryptoWithUuid()
      })
    ).resolves.toMatchObject({ configured: true, rulesProfileId: 'baseball-youth' });
    expect(configureCall).toHaveBeenCalledWith('configureDiamondTeam', {
      requestId: uuid,
      teamId: 'team-1',
      enabled: true,
      sport: 'baseball',
      rulesProfileId: 'baseball-youth',
      rulesProfileVersion: 1,
      captureMode: 'quick'
    });

    const activateCall = vi.fn().mockResolvedValue({
      activated: true,
      teamId: 'team-1',
      gameId: 'game-1',
      trackingEngine: 'diamond-v2',
      snapshot: buildRawSnapshot()
    });
    await expect(
      activateDiamondGame(
        { teamId: 'team-1', gameId: 'game-1', captureMode: 'quick' },
        {
          transport: { call: activateCall },
          crypto: cryptoWithUuid()
        }
      )
    ).resolves.toMatchObject({ activated: true, trackingEngine: 'diamond-v2' });
    expect(activateCall).toHaveBeenCalledWith('activateDiamondGame', expect.objectContaining({ requestId: uuid, captureMode: 'quick' }));
  });
});
