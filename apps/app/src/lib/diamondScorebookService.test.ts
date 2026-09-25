import { beforeEach, describe, expect, it, vi } from 'vitest';

const nativeTransportMocks = vi.hoisted(() => ({
  callNativeFirebaseFunction: vi.fn(),
  isNativeRuntime: vi.fn(() => false)
}));

vi.mock('./nativeCallable', () => ({
  callNativeFirebaseFunction: nativeTransportMocks.callNativeFirebaseFunction
}));
vi.mock('./nativeRuntime', () => ({
  isNativeRuntime: nativeTransportMocks.isNativeRuntime
}));

import {
  acquireDiamondScorerLease,
  activateDiamondGame,
  cancelDiamondGame,
  configureDiamondTeam,
  createDiamondCommand,
  createSecureDiamondId,
  enqueueDiamondCommand,
  getDiamondAccess,
  getDiamondPrivateHistoryWindow,
  getDiamondQueueKey,
  getDiamondRecapSource,
  getDiamondState,
  listDiamondScorerCandidates,
  mergeDiamondPrivateHistoryWindows,
  normalizeDiamondSnapshot,
  parseDiamondVoice,
  publishDiamondAiDraft,
  readDiamondCommandQueue,
  reconcileDiamondCommandQueue,
  resolveDiamondAppBuild,
  saveDiamondPrivateNote,
  submitDiamondCommand,
  type DiamondCallableTransport,
  type DiamondCommandEnvelope,
  type DiamondPrivateEvent,
  type DiamondPrivateHistoryWindow,
  type DiamondQueueIdentity
} from './diamondScorebookService';
import type { DiamondAiGameDraft, DiamondAiSourcePacket } from './diamondScorebookAi';

const uuid = '12345678-1234-4234-9234-123456789abc';
const instanceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const replacementInstanceId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const scorerLeaseId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const scorerAuthenticatedUid = 'coach-1';
const checkpointHash = `sha256:${'a'.repeat(64)}`;
const appBuild = 20260905;

function cryptoWithUuid(value = uuid) {
  return { randomUUID: vi.fn(() => value) } as unknown as Crypto;
}

function buildRawSnapshot(revision = 3) {
  return {
    revision,
    instanceId,
    canSubmitPrivateMaterial: true,
    state: {
      schemaVersion: 2,
      teamId: 'team-1',
      gameId: 'game-1',
      instanceId,
      revision,
      lifecycle: 'active',
      captureMode: 'full',
      rulesProfileId: 'baseball-youth',
      rulesProfileVersion: 1,
      checkpointHash: `sha256:revision-${revision}`,
      currentScorerUid: 'coach-1',
      score: { home: 2, away: 1 },
      inningRuns: { B4: 0 },
      inning: {
        number: 4,
        half: 'bottom',
        outs: 1,
        balls: 2,
        strikes: 1,
        pitchesInPlateAppearance: 4,
        lastPitchResult: 'called_strike'
      },
      bases: {
        first: {
          runnerId: 'runner-1',
          chargedToPitcherId: 'pitcher-1',
          courtesyForPlayerId: 'catcher-1',
          reachedOnEventId: 'event-2'
        },
        second: null,
        third: { runnerId: 'runner-3', chargedToPitcherId: 'pitcher-1', reachedOnEventId: 'event-1' }
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
      canAcquire: false,
      canRecover: false,
      holderUid: 'coach-1',
      holderName: 'Coach Carter',
      leaseId: scorerLeaseId as string | null,
      epoch: 2 as number | null,
      expiresAt: '2026-09-05T12:15:00.000Z' as string | null,
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

type MutableRawSnapshotFixture = {
  state: Record<string, unknown> & {
    inning: Record<string, unknown>;
    lineups: Record<
      'home' | 'away',
      { battingOrder: Array<Record<string, unknown>>; defense: Record<string, string>; courtesyRunnerIds?: unknown[] }
    >;
    bases: Record<'first' | 'second' | 'third', unknown>;
  };
  presentation: Record<string, unknown>;
  [key: string]: unknown;
};

function buildQueueIdentity(overrides: Partial<DiamondQueueIdentity> = {}): DiamondQueueIdentity {
  return {
    teamId: 'team-1',
    gameId: 'game-1',
    authenticatedUid: 'coach-1',
    scorerUid: 'coach-1',
    instanceId,
    leaseId: scorerLeaseId,
    ...overrides
  };
}

function buildCommand(overrides: Partial<DiamondCommandEnvelope> = {}) {
  return createDiamondCommand(
    {
      teamId: 'team-1',
      gameId: 'game-1',
      appBuild,
      expectedInstanceId: instanceId,
      leaseId: scorerLeaseId,
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

function withPrivatePageByteEvidence<T extends Record<string, unknown>>(page: T) {
  const result = { ...page, responseByteCount: 0, responseByteLimit: 1_000_000 };
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const byteCount = new TextEncoder().encode(JSON.stringify(result)).byteLength;
    if (byteCount === result.responseByteCount) return result;
    result.responseByteCount = byteCount;
  }
  throw new Error('Private event page byte count did not stabilize.');
}

function privateSummary(
  sequence: number,
  overrides: Partial<{
    eventId: string;
    type: DiamondCommandEnvelope['type'];
    payload: DiamondPrivateEvent['payload'];
    createdAt: string | null;
    voidsEventId: string | null;
    supersedesEventId: string | null;
    privateMaterialStatus: 'deleted';
  }> = {}
): DiamondPrivateEvent {
  return {
    eventId: `event-${sequence}`,
    sequence,
    revision: sequence,
    type: 'record_pitch' as const,
    payload: { batterId: 'batter-1', pitcherId: 'pitcher-1', result: 'ball' },
    createdAt: '2026-09-05T12:00:00.000Z',
    voidsEventId: null,
    supersedesEventId: null,
    ...overrides
  };
}

function buildRecapSourcePacket(): DiamondAiSourcePacket {
  return {
    sourceRevision: 8,
    coverage: {
      batting: 'complete',
      baserunning: 'complete',
      pitching: 'complete',
      fielding: 'partial',
      situational: 'complete',
      pitches: 'partial',
      sensors: 'not_collected'
    },
    plays: [
      {
        eventId: 'event-8',
        revision: 8,
        summary: 'The final out completed a 4-2 win.',
        inningLabel: 'Bottom 7',
        voided: false
      }
    ],
    stats: [
      {
        statId: 'team-game',
        subjectType: 'team',
        subjectId: 'team-1',
        label: 'Team game totals',
        values: { R: 4, H: 7, E: null },
        coverage: { R: 'complete', H: 'complete', E: 'partial' }
      }
    ]
  };
}

function buildRecapDraft(): DiamondAiGameDraft {
  return {
    schemaVersion: 1,
    sourceRevision: 8,
    coverage: buildRecapSourcePacket().coverage,
    recap: {
      text: 'The team completed a 4-2 win.',
      citations: [{ eventId: 'event-8', revision: 8 }],
      statRefs: [{ statId: 'team-game', metric: 'R' }]
    },
    insights: [
      {
        text: 'The offense collected 7 hits.',
        citations: [{ eventId: 'event-8', revision: 8 }],
        statRefs: [{ statId: 'team-game', metric: 'H' }]
      }
    ],
    dataQualityNotes: ['Partial data coverage: fielding, pitches.', 'Not collected: sensors.'],
    draft: true,
    published: false,
    requiresPublicationConfirmation: true,
    mutatesState: false
  };
}

describe('diamondScorebookService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeTransportMocks.isNativeRuntime.mockReturnValue(false);
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

  it('resolves explicit web and native app builds and fails closed when build evidence is unreadable', async () => {
    await expect(resolveDiamondAppBuild({ isNative: () => false, webBuild: '0027' })).resolves.toBe(27);
    vi.stubEnv('VITE_ALLPLAYS_APP_BUILD', '2');
    await expect(resolveDiamondAppBuild({ isNative: () => false })).resolves.toBe(2);
    vi.unstubAllEnvs();
    await expect(
      resolveDiamondAppBuild({
        isNative: () => true,
        getNativeInfo: vi.fn(async () => ({ build: '314' }))
      })
    ).resolves.toBe(314);

    await expect(resolveDiamondAppBuild({ isNative: () => false, webBuild: undefined })).rejects.toMatchObject({
      code: 'invalid-input'
    });
    await expect(resolveDiamondAppBuild({ isNative: () => false, webBuild: '1.2.3' })).rejects.toMatchObject({
      code: 'invalid-input'
    });
    await expect(resolveDiamondAppBuild({ isNative: () => false, webBuild: 0 })).rejects.toMatchObject({
      code: 'invalid-input'
    });
    await expect(
      resolveDiamondAppBuild({
        isNative: () => true,
        getNativeInfo: vi.fn(async () => {
          throw new Error('bridge unavailable');
        })
      })
    ).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('builds a schema-v2 command with one expected revision and rejects unsafe identifiers', () => {
    expect(buildCommand()).toEqual({
      schemaVersion: 2,
      commandId: uuid,
      teamId: 'team-1',
      gameId: 'game-1',
      appBuild,
      expectedInstanceId: instanceId,
      leaseId: scorerLeaseId,
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
          appBuild,
          expectedInstanceId: instanceId,
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
          appBuild,
          expectedInstanceId: instanceId,
          expectedRevision: 3.2,
          rulesProfileId: 'baseball-youth',
          rulesProfileVersion: 1,
          type: 'start',
          payload: {}
        },
        cryptoWithUuid()
      )
    ).toThrow('nonnegative integer');
    expect(() => buildCommand({ appBuild: Number.MAX_SAFE_INTEGER + 1 })).toThrow('valid build number');
  });

  it('normalizes authoritative state, lineup context, lease, recent plays, and completeness evidence', () => {
    const snapshot = normalizeDiamondSnapshot(buildRawSnapshot());
    expect(snapshot).toMatchObject({
      teamId: 'team-1',
      gameId: 'game-1',
      revision: 3,
      authoritative: true,
      canSubmitPrivateMaterial: true,
      lifecycle: 'active',
      score: { home: 2, away: 1 },
      currentHalfRuns: 0,
      lastPitchResult: 'called_strike',
      inning: { number: 4, half: 'bottom', outs: 1, balls: 2, strikes: 1 },
      currentBatter: { playerId: 'batter-1', name: 'Avery Carter', number: '12' },
      currentPitcher: { playerId: 'pitcher-1', name: 'Morgan Diaz', number: '7' },
      managedSide: 'home',
      ruleCapabilities: { dpFlex: false, courtesyRunner: { pitcher: true, catcher: true } },
      lease: { canScore: true, holderUid: 'coach-1' },
      completeness: { status: 'partial', authoritativeRevision: 3 }
    });
    expect(snapshot.bases.first?.name).toBe('Jordan Lee');
    expect(snapshot.bases.first).toMatchObject({
      responsiblePitcherId: 'pitcher-1',
      courtesyForPlayerId: 'catcher-1',
      reachedOnEventId: 'event-2'
    });
    expect(snapshot.battingLineup.map((player) => player.name)).toEqual(['Avery Carter', 'Jordan Lee']);
    expect(snapshot.lineups.home.map((player) => player.name)).toEqual(['Avery Carter', 'Jordan Lee']);
    expect(snapshot.availablePlayers.home.map((player) => player.name)).toEqual(['Taylor Gray', 'Avery Carter', 'Jordan Lee']);
    expect(snapshot.defensiveLineup.map((player) => player.name)).toEqual(['Morgan Diaz']);
    expect(snapshot.recentPlays[0]?.eventId).toBe('event-3');
  });

  it('normalizes private-material authority only from a literal true capability', () => {
    const raw = buildRawSnapshot();
    const { canSubmitPrivateMaterial: _capability, ...missingCapability } = raw;

    expect(normalizeDiamondSnapshot(raw).canSubmitPrivateMaterial).toBe(true);
    expect(normalizeDiamondSnapshot(missingCapability).canSubmitPrivateMaterial).toBe(false);
    expect(normalizeDiamondSnapshot({ ...raw, canSubmitPrivateMaterial: 'true' }).canSubmitPrivateMaterial).toBe(false);
    expect(normalizeDiamondSnapshot({ ...raw, canSubmitPrivateMaterial: 1 }).canSubmitPrivateMaterial).toBe(false);
  });

  describe('side-aware Diamond snapshot metadata', () => {
    it.each([
      { managedSide: 'home', opponentSide: 'away', half: 'top' },
      { managedSide: 'away', opponentSide: 'home', half: 'bottom' }
    ] as const)(
      'does not enrich opponent lineup, defense, or courtesy placements from colliding $managedSide managed candidates',
      ({ managedSide, opponentSide, half }) => {
        const raw = buildRawSnapshot() as unknown as MutableRawSnapshotFixture;
        const collisionId = 'shared-collision-id';
        const managedName = `PRIVATE ${managedSide.toUpperCase()} ROSTER NAME`;
        const opponentName = `Public ${opponentSide} player`;
        raw.state.inning.half = half;
        raw.state.lineups = {
          home: {
            battingOrder:
              opponentSide === 'home'
                ? [
                    {
                      slot: 1,
                      starterPlayerId: collisionId,
                      activePlayerId: collisionId,
                      displayName: opponentName,
                      jerseyNumber: '21',
                      substitutions: [collisionId]
                    }
                  ]
                : [{ slot: 1, activePlayerId: 'managed-home', displayName: 'Managed home', jerseyNumber: '1' }],
            defense: opponentSide === 'home' ? { P: collisionId } : { P: 'managed-home' },
            courtesyRunnerIds: opponentSide === 'home' ? [collisionId] : []
          },
          away: {
            battingOrder:
              opponentSide === 'away'
                ? [
                    {
                      slot: 1,
                      starterPlayerId: collisionId,
                      activePlayerId: collisionId,
                      displayName: opponentName,
                      jerseyNumber: '21',
                      substitutions: [collisionId]
                    }
                  ]
                : [{ slot: 1, activePlayerId: 'managed-away', displayName: 'Managed away', jerseyNumber: '2' }],
            defense: opponentSide === 'away' ? { P: collisionId } : { P: 'managed-away' },
            courtesyRunnerIds: opponentSide === 'away' ? [collisionId] : []
          }
        };
        raw.state.bases.first = {
          runnerId: collisionId,
          chargedToPitcherId: managedSide === 'home' ? 'managed-home' : 'managed-away',
          courtesyForPlayerId: collisionId,
          reachedOnEventId: 'event-courtesy'
        };
        raw.presentation = {
          ...raw.presentation,
          managedSide,
          bases: { first: { playerId: collisionId } },
          availablePlayers: {
            home: [
              {
                playerId: collisionId,
                name: managedSide === 'home' ? managedName : opponentName,
                number: managedSide === 'home' ? 'PRIVATE-99' : '21'
              }
            ],
            away: [
              {
                playerId: collisionId,
                name: managedSide === 'away' ? managedName : opponentName,
                number: managedSide === 'away' ? 'PRIVATE-99' : '21'
              }
            ]
          }
        };

        const snapshot = normalizeDiamondSnapshot(raw);

        expect(snapshot.lineups[opponentSide][0]).toMatchObject({
          playerId: collisionId,
          name: opponentName,
          number: '21'
        });
        expect(snapshot.defense[opponentSide].P).toMatchObject({
          playerId: collisionId,
          name: opponentName,
          number: '21'
        });
        expect(snapshot.bases.first).toMatchObject({
          playerId: collisionId,
          name: opponentName,
          number: '21'
        });
        expect(snapshot.currentBatter).toMatchObject({
          playerId: collisionId,
          name: opponentName,
          number: '21'
        });
        expect(snapshot.courtesyRunnerIds?.[opponentSide]).toEqual([collisionId]);
        expect(snapshot.availablePlayers[managedSide][0]).toMatchObject({
          playerId: collisionId,
          name: managedName,
          number: 'PRIVATE-99'
        });
      }
    );

    it('preserves inline current-batter metadata when no same-side directory entry exists', () => {
      const raw = buildRawSnapshot() as unknown as MutableRawSnapshotFixture;
      raw.state.inning.half = 'top';
      raw.state.lineups.away = { battingOrder: [], defense: {} };
      raw.state.currentBatter = {
        playerId: 'inline-away-batter',
        name: 'Inline away batter',
        number: '31'
      };
      raw.presentation = {
        ...raw.presentation,
        battingLineup: [],
        currentBatter: {
          playerId: 'inline-away-batter',
          name: 'Inline away batter',
          number: '31'
        },
        availablePlayers: { home: [], away: [] }
      };

      expect(normalizeDiamondSnapshot(raw).currentBatter).toEqual({
        playerId: 'inline-away-batter',
        name: 'Inline away batter',
        number: '31'
      });
    });
  });

  it('loads the exact authoritative current-half run total from the canonical inning key', async () => {
    const raw = buildRawSnapshot(9);
    const response = {
      ...raw,
      state: {
        ...raw.state,
        inning: {
          number: 8,
          half: 'top',
          outs: 0,
          balls: 0,
          strikes: 0,
          pitchesInPlateAppearance: 0,
          lastPitchResult: null
        },
        inningRuns: { B7: 3, T8: 1 }
      }
    };
    const call = vi.fn().mockResolvedValue(response);

    await expect(
      getDiamondState('team-1', 'game-1', { transport: { call } as unknown as DiamondCallableTransport })
    ).resolves.toMatchObject({ revision: 9, inning: { number: 8, half: 'top' }, currentHalfRuns: 1 });
    expect(call).toHaveBeenCalledWith('getDiamondState', {
      teamId: 'team-1',
      gameId: 'game-1',
      visibility: 'private'
    });
  });

  it('loads only an exact revision-and-lease-bound scorer candidate list', async () => {
    const call = vi.fn().mockResolvedValue({
      schemaVersion: 1,
      complete: true,
      teamId: 'team-1',
      gameId: 'game-1',
      instanceId,
      revision: 3,
      leaseId: scorerLeaseId,
      candidates: [
        { playerId: 'confirmed-1', name: 'Confirmed One' },
        { playerId: 'selected:2', name: 'Selected Two' }
      ]
    });

    await expect(
      listDiamondScorerCandidates(
        {
          authenticatedUid: scorerAuthenticatedUid,
          teamId: 'team-1',
          gameId: 'game-1',
          expectedInstanceId: instanceId,
          expectedRevision: 3,
          leaseId: scorerLeaseId
        },
        { transport: { call }, crypto: cryptoWithUuid() }
      )
    ).resolves.toEqual({
      schemaVersion: 1,
      complete: true,
      teamId: 'team-1',
      gameId: 'game-1',
      instanceId,
      revision: 3,
      leaseId: scorerLeaseId,
      candidates: [
        { playerId: 'confirmed-1', name: 'Confirmed One' },
        { playerId: 'selected:2', name: 'Selected Two' }
      ]
    });
    expect(call).toHaveBeenCalledWith('listDiamondScorerCandidates', {
      requestId: uuid,
      teamId: 'team-1',
      gameId: 'game-1',
      expectedInstanceId: instanceId,
      expectedRevision: 3,
      leaseId: scorerLeaseId
    });
  });

  it('allows the bounded scorer-candidate callable envelope on native transport', async () => {
    nativeTransportMocks.isNativeRuntime.mockReturnValue(true);
    nativeTransportMocks.callNativeFirebaseFunction.mockResolvedValue({
      schemaVersion: 1,
      complete: true,
      teamId: 'team-native',
      gameId: 'game-native',
      instanceId,
      revision: 3,
      leaseId: scorerLeaseId,
      candidates: []
    });

    await expect(
      listDiamondScorerCandidates(
        {
          authenticatedUid: scorerAuthenticatedUid,
          teamId: 'team-native',
          gameId: 'game-native',
          expectedInstanceId: instanceId,
          expectedRevision: 3,
          leaseId: scorerLeaseId
        },
        { crypto: cryptoWithUuid() }
      )
    ).resolves.toMatchObject({ teamId: 'team-native', gameId: 'game-native' });
    expect(nativeTransportMocks.callNativeFirebaseFunction).toHaveBeenCalledWith(
      'listDiamondScorerCandidates',
      expect.objectContaining({ requestId: uuid }),
      { errorLabel: 'Diamond scorebook', timeoutMs: 125_000 }
    );
  });

  it('reuses one secure scorer-candidate request ID across a transport retry', async () => {
    const response = {
      schemaVersion: 1,
      complete: true,
      teamId: 'team-1',
      gameId: 'game-1',
      instanceId,
      revision: 3,
      leaseId: scorerLeaseId,
      candidates: []
    };
    const call = vi.fn().mockRejectedValueOnce({ code: 'functions/unavailable' }).mockResolvedValue(response);
    const crypto = cryptoWithUuid();

    await expect(
      listDiamondScorerCandidates(
        {
          authenticatedUid: scorerAuthenticatedUid,
          teamId: 'team-1',
          gameId: 'game-1',
          expectedInstanceId: instanceId,
          expectedRevision: 3,
          leaseId: scorerLeaseId
        },
        { transport: { call }, crypto }
      )
    ).resolves.toEqual(response);
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[0]?.[1]).toEqual(call.mock.calls[1]?.[1]);
    expect(call.mock.calls[0]?.[1]).toMatchObject({ requestId: uuid });
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it('keeps one scorer-candidate request ID after an overlapping active retry and reuses it for manual recovery', async () => {
    const response = {
      schemaVersion: 1,
      complete: true,
      teamId: 'team-overlap',
      gameId: 'game-overlap',
      instanceId,
      revision: 3,
      leaseId: scorerLeaseId,
      candidates: []
    };
    const call = vi
      .fn()
      .mockRejectedValueOnce(new Error('Native transport timed out while the server remained active.'))
      .mockRejectedValueOnce(
        Object.assign(new Error('This scorer candidate request is already active.'), {
          code: 'functions/resource-exhausted',
          details: { reason: 'scorer-candidate-duplicate-active', retryable: true }
        })
      )
      .mockResolvedValue(response);
    const crypto = cryptoWithUuid();
    const input = {
      authenticatedUid: scorerAuthenticatedUid,
      teamId: response.teamId,
      gameId: response.gameId,
      expectedInstanceId: instanceId,
      expectedRevision: response.revision,
      leaseId: scorerLeaseId
    };

    await expect(listDiamondScorerCandidates(input, { transport: { call }, crypto })).rejects.toMatchObject({
      code: 'rate-limited',
      retryable: true
    });
    await expect(listDiamondScorerCandidates(input, { transport: { call }, crypto })).resolves.toEqual(response);
    expect(call).toHaveBeenCalledTimes(3);
    expect(call.mock.calls.map((entry) => entry[1]?.requestId)).toEqual([uuid, uuid, uuid]);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it('rotates scorer-candidate request IDs after success and when the exact source input changes', async () => {
    const firstId = '11111111-1111-4111-8111-111111111111';
    const secondId = '22222222-2222-4222-8222-222222222222';
    const thirdId = '33333333-3333-4333-8333-333333333333';
    const crypto = {
      randomUUID: vi.fn().mockReturnValueOnce(firstId).mockReturnValueOnce(secondId).mockReturnValueOnce(thirdId)
    } as unknown as Crypto;
    const call = vi.fn(async (_name: string, payload: Record<string, unknown>) => ({
      schemaVersion: 1,
      complete: true,
      teamId: payload.teamId,
      gameId: payload.gameId,
      instanceId: payload.expectedInstanceId,
      revision: payload.expectedRevision,
      leaseId: payload.leaseId,
      candidates: []
    }));
    const transport: DiamondCallableTransport = { call: call as DiamondCallableTransport['call'] };
    const input = {
      authenticatedUid: scorerAuthenticatedUid,
      teamId: 'team-rotation',
      gameId: 'game-rotation',
      expectedInstanceId: instanceId,
      expectedRevision: 3,
      leaseId: scorerLeaseId
    };

    await listDiamondScorerCandidates(input, { transport, crypto });
    await listDiamondScorerCandidates(input, { transport, crypto });
    await listDiamondScorerCandidates({ ...input, expectedRevision: 4 }, { transport, crypto });
    expect(call.mock.calls.map((entry) => entry[1]?.requestId)).toEqual([firstId, secondId, thirdId]);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(3);
  });

  it('clears a terminal scorer-candidate replay ID instead of pinning it as retryable', async () => {
    const firstId = '44444444-4444-4444-8444-444444444444';
    const secondId = '55555555-5555-4555-8555-555555555555';
    const crypto = {
      randomUUID: vi.fn().mockReturnValueOnce(firstId).mockReturnValueOnce(secondId)
    } as unknown as Crypto;
    const input = {
      authenticatedUid: scorerAuthenticatedUid,
      teamId: 'team-terminal',
      gameId: 'game-terminal',
      expectedInstanceId: instanceId,
      expectedRevision: 3,
      leaseId: scorerLeaseId
    };
    const response = {
      schemaVersion: 1,
      complete: true,
      teamId: input.teamId,
      gameId: input.gameId,
      instanceId,
      revision: input.expectedRevision,
      leaseId: scorerLeaseId,
      candidates: []
    };
    const call = vi
      .fn()
      .mockRejectedValueOnce({
        code: 'functions/resource-exhausted',
        details: { reason: 'scorer-candidate-replay-limited', retryable: false }
      })
      .mockResolvedValueOnce(response);

    await expect(listDiamondScorerCandidates(input, { transport: { call }, crypto, maxAttempts: 2 })).rejects.toMatchObject({
      code: 'rate-limited',
      retryable: false
    });
    await expect(listDiamondScorerCandidates(input, { transport: { call }, crypto })).resolves.toEqual(response);
    expect(call.mock.calls.map((entry) => entry[1]?.requestId)).toEqual([firstId, secondId]);
  });

  it('bounds uncertain scorer-candidate retry handles per authenticated principal', async () => {
    let requestIndex = 1;
    let succeed = false;
    const crypto = {
      randomUUID: vi.fn(() => `99999999-9999-4999-8999-${String(requestIndex++).padStart(12, '0')}`)
    } as unknown as Crypto;
    const call = vi.fn(async (_name: string, payload: Record<string, unknown>) => {
      if (!succeed) throw { code: 'functions/unavailable' };
      return {
        schemaVersion: 1,
        complete: true,
        teamId: payload.teamId,
        gameId: payload.gameId,
        instanceId: payload.expectedInstanceId,
        revision: payload.expectedRevision,
        leaseId: payload.leaseId,
        candidates: []
      };
    });
    const transport: DiamondCallableTransport = { call: call as DiamondCallableTransport['call'] };
    const input = (index: number, authenticatedUid = 'coach-cache-a') => ({
      authenticatedUid,
      teamId: 'team-cache-bound',
      gameId: `game-${index}`,
      expectedInstanceId: instanceId,
      expectedRevision: 3,
      leaseId: scorerLeaseId
    });

    for (let index = 0; index < 32; index += 1) {
      await expect(listDiamondScorerCandidates(input(index), { transport, crypto, maxAttempts: 1 })).rejects.toMatchObject({
        code: 'unavailable',
        retryable: true
      });
    }
    await expect(listDiamondScorerCandidates(input(32), { transport, crypto, maxAttempts: 1 })).rejects.toMatchObject({
      code: 'rate-limited',
      retryable: true
    });
    expect(call).toHaveBeenCalledTimes(32);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(32);

    succeed = true;
    await expect(listDiamondScorerCandidates(input(32, 'coach-cache-b'), { transport, crypto })).resolves.toMatchObject({
      gameId: 'game-32'
    });
    expect(call).toHaveBeenCalledTimes(33);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(33);
    expect(call.mock.calls[32]?.[1]).not.toHaveProperty('authenticatedUid');
  });

  it('retains uncertain scorer-candidate request IDs for eight minutes and prunes expired handles', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-09T10:00:00.000Z'));
    const firstId = '66666666-6666-4666-8666-666666666666';
    const secondId = '77777777-7777-4777-8777-777777777777';
    const replacementId = '88888888-8888-4888-8888-888888888888';
    const crypto = {
      randomUUID: vi.fn().mockReturnValueOnce(firstId).mockReturnValueOnce(secondId).mockReturnValueOnce(replacementId)
    } as unknown as Crypto;
    let succeed = false;
    const call = vi.fn(async (_name: string, payload: Record<string, unknown>) => {
      if (!succeed) throw new Error('The web network connection ended before the server result arrived.');
      return {
        schemaVersion: 1,
        complete: true,
        teamId: payload.teamId,
        gameId: payload.gameId,
        instanceId: payload.expectedInstanceId,
        revision: payload.expectedRevision,
        leaseId: payload.leaseId,
        candidates: []
      };
    });
    const transport: DiamondCallableTransport = { call: call as DiamondCallableTransport['call'] };
    const input = (gameId: string) => ({
      authenticatedUid: 'coach-retention',
      teamId: 'team-retention',
      gameId,
      expectedInstanceId: instanceId,
      expectedRevision: 3,
      leaseId: scorerLeaseId
    });

    try {
      await expect(listDiamondScorerCandidates(input('game-before'), { transport, crypto, maxAttempts: 1 })).rejects.toMatchObject({
        retryable: true
      });
      await expect(listDiamondScorerCandidates(input('game-after'), { transport, crypto, maxAttempts: 1 })).rejects.toMatchObject({
        retryable: true
      });

      await vi.advanceTimersByTimeAsync(8 * 60 * 1000 - 1);
      succeed = true;
      await expect(listDiamondScorerCandidates(input('game-before'), { transport, crypto, maxAttempts: 1 })).resolves.toMatchObject({
        gameId: 'game-before'
      });

      await vi.advanceTimersByTimeAsync(2);
      await expect(listDiamondScorerCandidates(input('game-after'), { transport, crypto, maxAttempts: 1 })).resolves.toMatchObject({
        gameId: 'game-after'
      });
      expect(call.mock.calls.map((entry) => entry[1]?.requestId)).toEqual([firstId, secondId, firstId, replacementId]);
      expect(crypto.randomUUID).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('fails scorer-candidate validation and missing secure randomness before transport', async () => {
    const call = vi.fn();
    const crypto = cryptoWithUuid();
    const input = {
      authenticatedUid: scorerAuthenticatedUid,
      teamId: 'team-1',
      gameId: 'game-1',
      expectedInstanceId: instanceId,
      expectedRevision: 3,
      leaseId: scorerLeaseId
    };

    await expect(listDiamondScorerCandidates({ ...input, teamId: '' }, { transport: { call }, crypto })).rejects.toMatchObject({
      code: 'invalid-input'
    });
    await expect(listDiamondScorerCandidates({ ...input, authenticatedUid: '/' }, { transport: { call }, crypto })).rejects.toMatchObject({
      code: 'invalid-input'
    });
    expect(crypto.randomUUID).not.toHaveBeenCalled();
    await expect(listDiamondScorerCandidates(input, { transport: { call }, crypto: null })).rejects.toMatchObject({
      code: 'secure-randomness-unavailable'
    });
    expect(call).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'an incomplete result',
      mutate: (value: Record<string, unknown>) => ({ ...value, complete: false })
    },
    {
      label: 'another team',
      mutate: (value: Record<string, unknown>) => ({ ...value, teamId: 'team-2' })
    },
    {
      label: 'another game',
      mutate: (value: Record<string, unknown>) => ({ ...value, gameId: 'game-2' })
    },
    {
      label: 'another instance',
      mutate: (value: Record<string, unknown>) => ({ ...value, instanceId: replacementInstanceId })
    },
    {
      label: 'another revision',
      mutate: (value: Record<string, unknown>) => ({ ...value, revision: 4 })
    },
    {
      label: 'another lease',
      mutate: (value: Record<string, unknown>) => ({ ...value, leaseId: uuid })
    },
    {
      label: 'an extra private top-level field',
      mutate: (value: Record<string, unknown>) => ({ ...value, email: 'private@example.test' })
    },
    {
      label: 'an extra private candidate field',
      mutate: (value: Record<string, unknown>) => ({
        ...value,
        candidates: [{ playerId: 'confirmed-1', name: 'Confirmed One', email: 'private@example.test' }]
      })
    },
    {
      label: 'a duplicate candidate',
      mutate: (value: Record<string, unknown>) => ({
        ...value,
        candidates: [
          { playerId: 'confirmed-1', name: 'Confirmed One' },
          { playerId: 'confirmed-1', name: 'Duplicate' }
        ]
      })
    },
    {
      label: 'more than 100 candidates',
      mutate: (value: Record<string, unknown>) => ({
        ...value,
        candidates: Array.from({ length: 101 }, (_, index) => ({ playerId: `candidate-${index}`, name: `Candidate ${index}` }))
      })
    }
  ])('rejects a scorer candidate response bound to $label', async ({ mutate }) => {
    const response = {
      schemaVersion: 1,
      complete: true,
      teamId: 'team-1',
      gameId: 'game-1',
      instanceId,
      revision: 3,
      leaseId: scorerLeaseId,
      candidates: [{ playerId: 'confirmed-1', name: 'Confirmed One' }]
    };
    const call = vi.fn().mockResolvedValue(mutate(response));

    await expect(
      listDiamondScorerCandidates(
        {
          authenticatedUid: scorerAuthenticatedUid,
          teamId: 'team-1',
          gameId: 'game-1',
          expectedInstanceId: instanceId,
          expectedRevision: 3,
          leaseId: scorerLeaseId
        },
        { transport: { call } }
      )
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it.each(['scorer-candidate-rsvp-overflow', 'scorer-candidate-overflow'])(
    'does not retry the deterministic %s candidate bound',
    async (reason) => {
      const call = vi.fn().mockRejectedValue({
        code: 'functions/failed-precondition',
        message: 'This game has too many eligible scorers for a bounded handoff lookup.',
        details: { reason }
      });

      await expect(
        listDiamondScorerCandidates(
          {
            authenticatedUid: scorerAuthenticatedUid,
            teamId: 'team-1',
            gameId: 'game-1',
            expectedInstanceId: instanceId,
            expectedRevision: 3,
            leaseId: scorerLeaseId
          },
          { transport: { call } }
        )
      ).rejects.toMatchObject({ code: 'invalid-input', retryable: false });
      expect(call).toHaveBeenCalledTimes(1);
    }
  );

  it('treats a valid sparse inning-runs map as a pristine zero-run current half', () => {
    const raw = buildRawSnapshot();

    expect(
      normalizeDiamondSnapshot({
        ...raw,
        state: {
          ...raw.state,
          inning: {
            number: 8,
            half: 'top',
            outs: 0,
            balls: 0,
            strikes: 0,
            pitchesInPlateAppearance: 0,
            lastPitchResult: null
          },
          inningRuns: { B7: 3 }
        }
      }).currentHalfRuns
    ).toBe(0);
  });

  it.each([
    { inning: { number: '8', half: 'top' }, label: 'a coerced inning number' },
    { inning: { number: 8, half: 'upper' }, label: 'an unsupported half' }
  ])('keeps current-half run evidence unknown for $label', ({ inning, label: _label }) => {
    const raw = buildRawSnapshot();

    expect(
      normalizeDiamondSnapshot({
        ...raw,
        state: {
          ...raw.state,
          inning: { ...raw.state.inning, ...inning },
          inningRuns: { T8: 0 }
        }
      }).currentHalfRuns
    ).toBeNull();
  });

  it.each([
    {
      label: 'missing inning totals',
      inningRuns: undefined
    },
    {
      label: 'a non-object inning total map',
      inningRuns: 'not-a-map'
    },
    {
      label: 'an array inning total map',
      inningRuns: [0]
    },
    {
      label: 'a string-coerced current-half total',
      inningRuns: { B4: '0' }
    },
    {
      label: 'a negative current-half total',
      inningRuns: { B4: -1 }
    }
  ])('keeps current-half run evidence unknown for $label', ({ inningRuns }) => {
    const raw = buildRawSnapshot();
    const { inningRuns: _existingInningRuns, ...stateWithoutInningRuns } = raw.state;

    expect(
      normalizeDiamondSnapshot({
        ...raw,
        state: {
          ...stateWithoutInningRuns,
          ...(inningRuns === undefined ? {} : { inningRuns })
        }
      }).currentHalfRuns
    ).toBeNull();
  });

  it.each(['in_play', 'hit_by_pitch', 'catcher_interference'] as const)(
    'preserves the terminal delivered pitch result %s from the authoritative inning state',
    (lastPitchResult) => {
      const raw = buildRawSnapshot();
      raw.state.inning.lastPitchResult = lastPitchResult;

      expect(normalizeDiamondSnapshot(raw).lastPitchResult).toBe(lastPitchResult);
    }
  );

  it.each(['ball', 'called_strike', 'swinging_strike', 'foul', 'foul_bunt', 'illegal_pitch', null] as const)(
    'preserves the nonterminal delivered pitch result %s',
    (lastPitchResult) => {
      const raw = buildRawSnapshot();

      expect(
        normalizeDiamondSnapshot({
          ...raw,
          state: { ...raw.state, inning: { ...raw.state.inning, lastPitchResult } }
        }).lastPitchResult
      ).toBe(lastPitchResult);
    }
  );

  it.each([
    { label: 'missing', lastPitchResult: undefined },
    { label: 'unsupported', lastPitchResult: 'pickoff_attempt' },
    { label: 'wrong-type', lastPitchResult: 1 }
  ])('rejects a $label authoritative last-pitch result instead of re-enabling pitch entry', ({ lastPitchResult }) => {
    const raw = buildRawSnapshot();
    const { lastPitchResult: _existingLastPitchResult, ...inningWithoutLastPitchResult } = raw.state.inning;

    expect(() =>
      normalizeDiamondSnapshot({
        ...raw,
        state: {
          ...raw.state,
          inning: {
            ...inningWithoutLastPitchResult,
            ...(lastPitchResult === undefined ? {} : { lastPitchResult })
          }
        }
      })
    ).toThrow(/last delivered pitch result/i);
  });

  it('derives the official pitcher only from canonical defense and ignores stale presentation identity', () => {
    const raw = buildRawSnapshot();
    const stalePresentation = {
      ...raw,
      presentation: {
        ...raw.presentation,
        currentPitcher: { playerId: 'wrong-pitcher', name: 'Wrong Pitcher' },
        defensiveLineup: [{ playerId: 'wrong-pitcher', name: 'Wrong Pitcher' }]
      }
    };
    expect(normalizeDiamondSnapshot(stalePresentation).currentPitcher).toMatchObject({ playerId: 'pitcher-1', name: 'Morgan Diaz' });

    const noPitcher = buildRawSnapshot();
    noPitcher.state.lineups.away.defense.P = '';
    const snapshot = normalizeDiamondSnapshot({
      ...noPitcher,
      presentation: {
        ...noPitcher.presentation,
        currentPitcher: { playerId: 'wrong-pitcher', name: 'Wrong Pitcher' },
        defensiveLineup: [{ playerId: 'wrong-pitcher', name: 'Wrong Pitcher' }]
      }
    });
    expect(snapshot.currentPitcher).toBeNull();
    expect(snapshot.defensiveLineup).toEqual([]);
  });

  it('loads only complete contiguous manager-private event summaries with exact byte evidence', async () => {
    const first = withPrivatePageByteEvidence({
      sourceRevision: 2,
      items: [privateSummary(1, { type: 'activate', payload: {} })],
      nextCursor: '1',
      complete: true,
      accessComplete: true,
      collectionComplete: false
    });
    const second = withPrivatePageByteEvidence({
      sourceRevision: 2,
      items: [privateSummary(2, { type: 'private_note', payload: { text: 'Staff note', attachedEventId: 'event-1' } })],
      nextCursor: null,
      complete: true,
      accessComplete: true,
      collectionComplete: true
    });
    const call = vi.fn(async (_name: string, data: Record<string, unknown>) => (data.cursor ? second : first));

    await expect(
      getDiamondPrivateHistoryWindow(
        { teamId: 'team-1', gameId: 'game-1', expectedRevision: 2 },
        { transport: { call } as unknown as DiamondCallableTransport }
      )
    ).resolves.toEqual({
      sourceRevision: 2,
      oldestSequence: 1,
      newestSequence: 2,
      contiguous: true,
      rangeComplete: true,
      headComplete: true,
      historyComplete: true,
      hasOlder: false,
      items: [
        expect.objectContaining({ eventId: 'event-1', sequence: 1, type: 'activate', createdAt: '2026-09-05T12:00:00.000Z' }),
        expect.objectContaining({
          eventId: 'event-2',
          sequence: 2,
          type: 'private_note',
          payload: { text: 'Staff note', attachedEventId: 'event-1' }
        })
      ]
    });
    expect(call.mock.calls).toEqual([
      ['listDiamondEvents', { teamId: 'team-1', gameId: 'game-1', visibility: 'private', limit: 2 }],
      ['listDiamondEvents', { teamId: 'team-1', gameId: 'game-1', visibility: 'private', limit: 1, cursor: '1' }]
    ]);
  });

  it('accepts an exact private-material deletion marker without breaking contiguous range evidence', async () => {
    const deleted = privateSummary(2, {
      type: 'private_note',
      payload: {},
      createdAt: null,
      privateMaterialStatus: 'deleted'
    });
    const page = withPrivatePageByteEvidence({
      sourceRevision: 2,
      items: [privateSummary(1, { type: 'activate', payload: {} }), deleted],
      nextCursor: null,
      complete: true,
      accessComplete: true,
      collectionComplete: true
    });

    await expect(
      getDiamondPrivateHistoryWindow(
        { teamId: 'team-1', gameId: 'game-1', expectedRevision: 2 },
        { transport: { call: vi.fn().mockResolvedValue(page) } }
      )
    ).resolves.toMatchObject({
      sourceRevision: 2,
      oldestSequence: 1,
      newestSequence: 2,
      contiguous: true,
      rangeComplete: true,
      headComplete: true,
      items: [
        { sequence: 1 },
        {
          sequence: 2,
          type: 'private_note',
          payload: {},
          createdAt: null,
          privateMaterialStatus: 'deleted'
        }
      ]
    });
  });

  it('accepts only redaction-safe private correction marker payloads and preserves their target links', async () => {
    const items = [
      privateSummary(1, { type: 'activate', payload: {} }),
      privateSummary(2, {
        type: 'void_event',
        payload: {},
        createdAt: null,
        voidsEventId: 'event-1',
        privateMaterialStatus: 'deleted'
      }),
      privateSummary(3, {
        type: 'supersede_event',
        payload: {},
        createdAt: null,
        supersedesEventId: 'event-1',
        privateMaterialStatus: 'deleted'
      }),
      privateSummary(4, {
        type: 'supersede_event',
        payload: {
          replacement: {
            type: 'record_pitch',
            payload: { batterId: 'batter-1', pitcherId: 'pitcher-1', result: 'ball' }
          }
        },
        createdAt: null,
        supersedesEventId: 'event-1',
        privateMaterialStatus: 'deleted'
      })
    ];
    const page = withPrivatePageByteEvidence({
      sourceRevision: 4,
      items,
      nextCursor: null,
      complete: true,
      accessComplete: true,
      collectionComplete: true
    });

    const result = await getDiamondPrivateHistoryWindow(
      { teamId: 'team-1', gameId: 'game-1', expectedRevision: 4 },
      { transport: { call: vi.fn().mockResolvedValue(page) } }
    );

    expect(result.items.slice(1)).toEqual([
      expect.objectContaining({ type: 'void_event', payload: {}, voidsEventId: 'event-1', privateMaterialStatus: 'deleted' }),
      expect.objectContaining({
        type: 'supersede_event',
        payload: {},
        supersedesEventId: 'event-1',
        privateMaterialStatus: 'deleted'
      }),
      expect.objectContaining({
        type: 'supersede_event',
        payload: { replacement: { type: 'record_pitch', payload: expect.any(Object) } },
        supersedesEventId: 'event-1',
        privateMaterialStatus: 'deleted'
      })
    ]);
  });

  it('loads and combines bounded newest-first windows across a ledger with more than 2,000 summaries', async () => {
    const sourceRevision = 2_405;
    const summaries = Array.from({ length: sourceRevision }, (_, index) => privateSummary(index + 1));
    const call = vi.fn(async (_name: string, data: Record<string, unknown>) => {
      const after = Number(data.cursor || 0);
      const requestedLimit = Number(data.limit);
      // Simulate server byte packing so each logical window spans several
      // callable responses even though every response remains complete.
      const returnedLimit = Math.min(requestedLimit, 73);
      const items = summaries.slice(after, after + returnedLimit);
      const last = items[items.length - 1]?.sequence ?? after;
      const hasMore = last < sourceRevision;
      return withPrivatePageByteEvidence({
        sourceRevision,
        items,
        nextCursor: hasMore ? String(last) : null,
        complete: true,
        accessComplete: true,
        collectionComplete: !hasMore
      });
    });
    const transport = { call } as unknown as DiamondCallableTransport;

    const newest = await getDiamondPrivateHistoryWindow(
      { teamId: 'team-1', gameId: 'game-1', expectedRevision: sourceRevision },
      { transport }
    );
    expect(newest).toMatchObject({
      sourceRevision,
      oldestSequence: 2_206,
      newestSequence: 2_405,
      contiguous: true,
      rangeComplete: true,
      headComplete: true,
      historyComplete: false,
      hasOlder: true
    });
    expect(newest.items).toHaveLength(200);

    const older = await getDiamondPrivateHistoryWindow(
      {
        teamId: 'team-1',
        gameId: 'game-1',
        expectedRevision: sourceRevision,
        beforeSequence: newest.oldestSequence
      },
      { transport }
    );
    expect(older).toMatchObject({
      oldestSequence: 2_006,
      newestSequence: 2_205,
      headComplete: false,
      historyComplete: false,
      hasOlder: true
    });

    const combined = mergeDiamondPrivateHistoryWindows(newest, older);
    expect(combined).toMatchObject({
      oldestSequence: 2_006,
      newestSequence: 2_405,
      headComplete: true,
      historyComplete: false,
      hasOlder: true
    });
    expect(combined.items).toHaveLength(400);
    expect(combined.items[0]?.sequence).toBe(2_006);
    expect(combined.items[combined.items.length - 1]?.sequence).toBe(2_405);
    expect(call.mock.calls.every(([, data]) => data.cursor !== undefined && Number(data.cursor) >= 2_005)).toBe(true);
    expect(call).toHaveBeenCalledTimes(6);
  });

  it('fails bounded private-history windows closed on drift and non-adjacent merges', async () => {
    const drifted = withPrivatePageByteEvidence({
      sourceRevision: 11,
      items: [privateSummary(10)],
      nextCursor: '10',
      complete: true,
      accessComplete: true,
      collectionComplete: false
    });
    await expect(
      getDiamondPrivateHistoryWindow(
        { teamId: 'team-1', gameId: 'game-1', expectedRevision: 10, windowSize: 1 },
        { transport: { call: vi.fn().mockResolvedValue(drifted) } }
      )
    ).rejects.toMatchObject({ code: 'stale-revision', authoritativeRevision: 11 });

    const page = (start: number, end: number, sourceRevision = 10): DiamondPrivateHistoryWindow => ({
      sourceRevision,
      oldestSequence: start,
      newestSequence: end,
      contiguous: true as const,
      rangeComplete: true as const,
      headComplete: end === sourceRevision,
      historyComplete: start === 1 && end === sourceRevision,
      hasOlder: start > 1,
      items: Array.from({ length: end - start + 1 }, (_, index) => {
        const sequence = start + index;
        return {
          ...privateSummary(sequence),
          createdAt: '2026-09-05T12:00:00.000Z'
        };
      })
    });
    expect(() => mergeDiamondPrivateHistoryWindows(page(8, 10), page(4, 6))).toThrowError(/not adjacent/i);
  });

  it('fails private history closed on extra audit fields, forged byte evidence, partial reads, and revision drift', async () => {
    const page = (overrides: Record<string, unknown> = {}) =>
      withPrivatePageByteEvidence({
        sourceRevision: 1,
        items: [privateSummary(1)],
        nextCursor: null,
        complete: true,
        accessComplete: true,
        collectionComplete: true,
        ...overrides
      });
    const unsafe = page({ items: [{ ...privateSummary(1), actorUid: 'manager-private-uid' }] });
    await expect(
      getDiamondPrivateHistoryWindow(
        { teamId: 'team-1', gameId: 'game-1', expectedRevision: 1 },
        { transport: { call: vi.fn().mockResolvedValue(unsafe) } }
      )
    ).rejects.toMatchObject({ code: 'invalid-response' });

    for (const invalidItem of [
      { ...privateSummary(1, { type: 'private_note', payload: {} }), privateMaterialStatus: 'removed' },
      { ...privateSummary(1), privateMaterialStatus: 'deleted' },
      {
        ...privateSummary(1, { type: 'private_note', payload: { text: 'must not survive deletion' } }),
        privateMaterialStatus: 'deleted'
      },
      {
        ...privateSummary(1, {
          type: 'supersede_event',
          payload: { replacement: { type: 'private_note', payload: { text: 'must not survive deletion' } } },
          supersedesEventId: 'event-target'
        }),
        privateMaterialStatus: 'deleted'
      }
    ]) {
      await expect(
        getDiamondPrivateHistoryWindow(
          { teamId: 'team-1', gameId: 'game-1', expectedRevision: 1 },
          { transport: { call: vi.fn().mockResolvedValue(page({ items: [invalidItem] })) } }
        )
      ).rejects.toMatchObject({ code: 'invalid-response' });
    }

    const forgedBytes = page();
    forgedBytes.responseByteCount -= 1;
    await expect(
      getDiamondPrivateHistoryWindow(
        { teamId: 'team-1', gameId: 'game-1', expectedRevision: 1 },
        { transport: { call: vi.fn().mockResolvedValue(forgedBytes) } }
      )
    ).rejects.toMatchObject({ code: 'invalid-response' });

    const partial = page({ complete: false, accessComplete: false, collectionComplete: false });
    await expect(
      getDiamondPrivateHistoryWindow(
        { teamId: 'team-1', gameId: 'game-1', expectedRevision: 1 },
        { transport: { call: vi.fn().mockResolvedValue(partial) } }
      )
    ).rejects.toMatchObject({ code: 'unavailable', retryable: true });

    const drifted = page({ sourceRevision: 2 });
    await expect(
      getDiamondPrivateHistoryWindow(
        { teamId: 'team-1', gameId: 'game-1', expectedRevision: 1 },
        { transport: { call: vi.fn().mockResolvedValue(drifted) } }
      )
    ).rejects.toMatchObject({ code: 'stale-revision', authoritativeRevision: 2 });
  });

  it('preserves the terminal cancelled lifecycle from the authoritative server state', () => {
    const raw = buildRawSnapshot(4);
    raw.state.lifecycle = 'cancelled';

    expect(normalizeDiamondSnapshot(raw).lifecycle).toBe('cancelled');
  });

  it('normalizes only bounded reducer-v2 ending evidence and excludes private cancellation details', () => {
    const raw = buildRawSnapshot(8);
    const snapshot = normalizeDiamondSnapshot({
      ...raw,
      state: {
        ...raw.state,
        lifecycle: 'final',
        halfInningEnd: { reason: 'run-limit', decisionEventId: 'event-6', ignored: 'not projected' },
        gameEndDecision: { reason: 'forfeit', decisionEventId: 'event-7', awardedSide: 'home', ignored: true },
        finalizationReason: { kind: 'forfeit', decisionEventId: 'event-7', ignored: true },
        cancellation: { reason: 'private manager note', decisionEventId: 'event-private' }
      }
    });

    expect(snapshot.halfInningEnd).toEqual({ reason: 'run-limit', decisionEventId: 'event-6' });
    expect(snapshot.gameEndDecision).toEqual({ reason: 'forfeit', decisionEventId: 'event-7', awardedSide: 'home' });
    expect(snapshot.finalizationReason).toEqual({ kind: 'forfeit', decisionEventId: 'event-7' });
    expect(snapshot).not.toHaveProperty('cancellation');

    expect(() =>
      normalizeDiamondSnapshot({
        ...raw,
        state: {
          ...raw.state,
          gameEndDecision: { reason: 'forfeit', decisionEventId: 'event-7', awardedSide: null }
        }
      })
    ).toThrowError(expect.objectContaining({ code: 'invalid-response' }));
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

  it('cancels through one snapshot-bound private command and safely retries the same command id', async () => {
    const cancelledSnapshot = buildRawSnapshot(4);
    cancelledSnapshot.state.lifecycle = 'cancelled';
    const call = vi
      .fn()
      .mockResolvedValueOnce(buildRawSnapshot(3))
      .mockRejectedValueOnce({ code: 'functions/unavailable', message: 'connection reset' })
      .mockResolvedValueOnce({
        ...cancelledSnapshot,
        outcome: 'accepted',
        revision: 4,
        eventId: 'event-4'
      });
    const randomUUID = vi.fn(() => uuid as ReturnType<Crypto['randomUUID']>);

    const result = await cancelDiamondGame(
      {
        teamId: ' team-1 ',
        gameId: 'game-1',
        reason: '  Cancelled   from schedule management.  '
      },
      {
        appBuildResolver: vi.fn(async () => appBuild),
        crypto: { randomUUID },
        transport: { call }
      }
    );

    expect(result).toMatchObject({ outcome: 'accepted', revision: 4, snapshot: { lifecycle: 'cancelled' } });
    expect(result).not.toHaveProperty('reason');
    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(call.mock.calls.map(([name]) => name)).toEqual(['getDiamondState', 'submitDiamondCommand', 'submitDiamondCommand']);
    const expectedCommand = {
      schemaVersion: 2,
      commandId: uuid,
      teamId: 'team-1',
      gameId: 'game-1',
      appBuild,
      expectedInstanceId: instanceId,
      expectedRevision: 3,
      rulesProfileId: 'baseball-youth',
      rulesProfileVersion: 1,
      type: 'cancel',
      payload: { confirmed: true, reason: 'Cancelled from schedule management.' }
    };
    expect(call.mock.calls[1]).toEqual(['submitDiamondCommand', expectedCommand]);
    expect(call.mock.calls[2]).toEqual(['submitDiamondCommand', expectedCommand]);
  });

  it('rejects unbounded cancellation reasons before loading state or creating a command', async () => {
    const call = vi.fn();
    const randomUUID = vi.fn(() => uuid as ReturnType<Crypto['randomUUID']>);

    await expect(
      cancelDiamondGame(
        { teamId: 'team-1', gameId: 'game-1', reason: 'x'.repeat(301), appBuild },
        { crypto: { randomUUID }, transport: { call } }
      )
    ).rejects.toMatchObject({ code: 'invalid-input' });

    expect(call).not.toHaveBeenCalled();
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it('reconciles a fully ambiguous cancellation only from a later authoritative cancelled revision', async () => {
    const cancelledSnapshot = buildRawSnapshot(4);
    cancelledSnapshot.state.lifecycle = 'cancelled';
    const call = vi
      .fn()
      .mockResolvedValueOnce(buildRawSnapshot(3))
      .mockRejectedValueOnce({ code: 'functions/unavailable', message: 'response lost' })
      .mockRejectedValueOnce({ code: 'functions/unavailable', message: 'response still unavailable' })
      .mockResolvedValueOnce(cancelledSnapshot);
    const randomUUID = vi.fn(() => uuid as ReturnType<Crypto['randomUUID']>);

    await expect(
      cancelDiamondGame(
        { teamId: 'team-1', gameId: 'game-1', reason: 'Weather cancellation', appBuild },
        { crypto: { randomUUID }, transport: { call } }
      )
    ).resolves.toMatchObject({ outcome: 'duplicate', revision: 4, snapshot: { lifecycle: 'cancelled' } });

    expect(randomUUID).toHaveBeenCalledTimes(1);
    expect(call.mock.calls.map(([name]) => name)).toEqual([
      'getDiamondState',
      'submitDiamondCommand',
      'submitDiamondCommand',
      'getDiamondState'
    ]);
    expect(call.mock.calls[2]?.[1]).toEqual(call.mock.calls[1]?.[1]);
  });

  it('preserves an ambiguous cancellation error when only another game instance is cancelled', async () => {
    const replacement = buildRawSnapshot(4);
    replacement.instanceId = replacementInstanceId;
    replacement.state.instanceId = replacementInstanceId;
    replacement.state.lifecycle = 'cancelled';
    const call = vi
      .fn()
      .mockResolvedValueOnce(buildRawSnapshot(3))
      .mockRejectedValueOnce({ code: 'functions/unavailable', message: 'response lost' })
      .mockRejectedValueOnce({ code: 'functions/unavailable', message: 'response still unavailable' })
      .mockResolvedValueOnce(replacement);

    await expect(
      cancelDiamondGame(
        { teamId: 'team-1', gameId: 'game-1', reason: 'Weather cancellation', appBuild },
        { crypto: cryptoWithUuid(), transport: { call } }
      )
    ).rejects.toMatchObject({ code: 'unavailable', retryable: true });
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

  it('loads only an exact current, revision-pinned, sanitized recap source', async () => {
    const packet = buildRecapSourcePacket();
    const call = vi.fn().mockResolvedValue({ current: true, sourceRevision: 8, checkpointHash, packet });

    await expect(
      getDiamondRecapSource({ teamId: 'team-1', gameId: 'game-1', sourceRevision: 8 }, { transport: { call } })
    ).resolves.toEqual({ current: true, sourceRevision: 8, checkpointHash, packet });
    expect(call).toHaveBeenCalledWith('getDiamondRecapSource', {
      teamId: 'team-1',
      gameId: 'game-1',
      sourceRevision: 8
    });

    const unsafeCall = vi.fn().mockResolvedValue({
      current: true,
      sourceRevision: 8,
      checkpointHash,
      packet: { ...packet, actorUid: 'staff-private-id' }
    });
    await expect(
      getDiamondRecapSource({ teamId: 'team-1', gameId: 'game-1', sourceRevision: 8 }, { transport: { call: unsafeCall } })
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('rejects stale recap source evidence without treating it as current', async () => {
    const call = vi.fn().mockResolvedValue({ current: false, sourceRevision: 8, currentRevision: 9 });

    await expect(
      getDiamondRecapSource({ teamId: 'team-1', gameId: 'game-1', sourceRevision: 8 }, { transport: { call } })
    ).rejects.toMatchObject({ code: 'stale-revision', authoritativeRevision: 9 });
  });

  it('publishes a safe draft idempotently and requires durable publication evidence', async () => {
    const draft = buildRecapDraft();
    const call = vi.fn().mockRejectedValueOnce({ code: 'functions/unavailable', message: 'connection reset' }).mockResolvedValueOnce({
      published: true,
      current: true,
      sourceRevision: 8,
      checkpointHash,
      publicationId: 'publication-8',
      publishedAt: '2026-09-05T12:00:00.000Z'
    });

    await expect(
      publishDiamondAiDraft(
        { requestId: uuid, teamId: 'team-1', gameId: 'game-1', sourceRevision: 8, checkpointHash, draft },
        { transport: { call } }
      )
    ).resolves.toEqual({
      published: true,
      current: true,
      sourceRevision: 8,
      checkpointHash,
      publicationId: 'publication-8',
      publishedAt: '2026-09-05T12:00:00.000Z'
    });
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[0]).toEqual(call.mock.calls[1]);
    expect(call.mock.calls[0]?.[0]).toBe('publishDiamondAiDraft');
    expect(call.mock.calls[0]?.[1]).toEqual({
      requestId: uuid,
      teamId: 'team-1',
      gameId: 'game-1',
      sourceRevision: 8,
      checkpointHash,
      draft
    });

    const missingEvidence = vi.fn().mockResolvedValue({
      published: true,
      current: true,
      sourceRevision: 8,
      checkpointHash,
      publicationId: '',
      publishedAt: ''
    });
    await expect(
      publishDiamondAiDraft(
        { requestId: uuid, teamId: 'team-1', gameId: 'game-1', sourceRevision: 8, checkpointHash, draft },
        { transport: { call: missingEvidence } }
      )
    ).rejects.toMatchObject({ code: 'invalid-response' });
  });

  it('rejects private draft data before transport and exposes correction races as stale', async () => {
    const draft = buildRecapDraft();
    const noCall = vi.fn();
    await expect(
      publishDiamondAiDraft(
        {
          requestId: uuid,
          teamId: 'team-1',
          gameId: 'game-1',
          sourceRevision: 8,
          checkpointHash,
          draft: { ...draft, transcript: 'private dictation' } as unknown as DiamondAiGameDraft
        },
        { transport: { call: noCall } }
      )
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(noCall).not.toHaveBeenCalled();

    const staleCall = vi.fn().mockResolvedValue({
      published: false,
      current: false,
      stale: true,
      status: 'stale',
      sourceRevision: 8,
      currentRevision: 9
    });
    await expect(
      publishDiamondAiDraft(
        { requestId: uuid, teamId: 'team-1', gameId: 'game-1', sourceRevision: 8, checkpointHash, draft },
        { transport: { call: staleCall } }
      )
    ).rejects.toMatchObject({ code: 'stale-revision', authoritativeRevision: 9 });
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
        authenticatedUid: 'coach-1',
        teamId: 'team-1',
        gameId: 'game-1',
        appBuild,
        expectedInstanceId: instanceId,
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
    expect(call.mock.calls[0]?.[1]).not.toHaveProperty('leaseId');
    expect(JSON.stringify(call.mock.calls[0]?.[1])).not.toMatch(/audio|recording|visibility/i);

    await expect(
      saveDiamondPrivateNote({
        authenticatedUid: 'coach-1',
        teamId: 'team-1',
        gameId: 'game-1',
        appBuild,
        expectedInstanceId: instanceId,
        expectedRevision: 3,
        rulesProfileId: 'baseball-youth',
        rulesProfileVersion: 1,
        text: 'x'.repeat(2001)
      })
    ).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('reuses the exact private-note command after a committed response can be lost', async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce({ code: 'functions/unavailable' })
      .mockRejectedValueOnce({ code: 'functions/unavailable' })
      .mockResolvedValue({
        ...buildRawSnapshot(4),
        outcome: 'duplicate',
        revision: 4,
        eventId: 'note-replayed'
      });
    const crypto = cryptoWithUuid('11111111-1111-4111-8111-111111111111');
    const transport = { call } as unknown as DiamondCallableTransport;
    const input = {
      authenticatedUid: 'coach-private-retry',
      teamId: 'team-private-retry',
      gameId: 'game-private-retry',
      appBuild,
      expectedInstanceId: instanceId,
      leaseId: scorerLeaseId,
      expectedRevision: 3,
      rulesProfileId: 'baseball-youth',
      rulesProfileVersion: 1,
      text: 'Preserve this exact uncertain note command.'
    };

    await expect(saveDiamondPrivateNote(input, { transport, crypto })).rejects.toMatchObject({ code: 'unavailable', retryable: true });
    await expect(saveDiamondPrivateNote({ ...input, expectedRevision: 9 }, { transport, crypto })).resolves.toMatchObject({
      outcome: 'duplicate',
      eventId: 'note-replayed'
    });

    const calls = call.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    expect(call).toHaveBeenCalledTimes(3);
    expect(calls.map((entry) => entry[1])).toEqual([calls[0]?.[1], calls[0]?.[1], calls[0]?.[1]]);
    expect(calls[0]?.[1]).toMatchObject({
      commandId: '11111111-1111-4111-8111-111111111111',
      expectedRevision: 3
    });
    expect(calls[0]?.[1]).not.toHaveProperty('leaseId');
    expect(calls[0]?.[1]).not.toHaveProperty('authenticatedUid');
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it('automatically retires private-note retry material without minting a second command after expiry', async () => {
    vi.useFakeTimers();
    try {
      const commandId = '12121212-1212-4212-8212-121212121212';
      const crypto = cryptoWithUuid(commandId);
      const call = vi
        .fn()
        .mockRejectedValueOnce({ code: 'functions/unavailable' })
        .mockRejectedValueOnce({ code: 'functions/unavailable' })
        .mockResolvedValue({
          ...buildRawSnapshot(4),
          outcome: 'duplicate',
          revision: 4,
          eventId: 'note-after-retry-retirement'
        });
      const input = {
        authenticatedUid: 'coach-private-retirement',
        teamId: 'team-private-retirement',
        gameId: 'game-private-retirement',
        appBuild,
        expectedInstanceId: instanceId,
        expectedRevision: 3,
        rulesProfileId: 'baseball-youth',
        rulesProfileVersion: 1,
        text: 'Do not retain this plaintext in an idle retry handle.'
      };

      await expect(saveDiamondPrivateNote(input, { transport: { call }, crypto })).rejects.toMatchObject({
        code: 'unavailable',
        retryable: true
      });
      expect(vi.getTimerCount()).toBe(1);

      await vi.advanceTimersByTimeAsync(8 * 60 * 1000 + 1);
      expect(vi.getTimerCount()).toBe(0);

      await expect(saveDiamondPrivateNote({ ...input, expectedRevision: 9 }, { transport: { call }, crypto })).resolves.toMatchObject({
        outcome: 'duplicate',
        eventId: 'note-after-retry-retirement'
      });

      const calls = call.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
      expect(calls.map((entry) => entry[1]?.commandId)).toEqual([commandId, commandId, commandId]);
      expect(calls.map((entry) => entry[1]?.expectedRevision)).toEqual([3, 3, 3]);
      expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('coalesces concurrent saves of the same private note behind one exact command', async () => {
    const commandId = '13131313-1313-4313-8313-131313131313';
    const crypto = cryptoWithUuid(commandId);
    let resolveCall!: (value: unknown) => void;
    const call = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveCall = resolve;
        })
    );
    const input = {
      authenticatedUid: 'coach-private-concurrent',
      teamId: 'team-private-concurrent',
      gameId: 'game-private-concurrent',
      appBuild,
      expectedInstanceId: instanceId,
      expectedRevision: 3,
      rulesProfileId: 'baseball-youth',
      rulesProfileVersion: 1,
      text: 'One concurrent private note.'
    };

    const transport = { call: call as unknown as DiamondCallableTransport['call'] };
    const first = saveDiamondPrivateNote(input, { transport, crypto });
    const second = saveDiamondPrivateNote({ ...input, expectedRevision: 9 }, { transport, crypto });
    expect(call).toHaveBeenCalledTimes(1);
    resolveCall({
      ...buildRawSnapshot(4),
      outcome: 'accepted',
      revision: 4,
      eventId: 'note-concurrent'
    });

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ outcome: 'accepted', eventId: 'note-concurrent' }),
      expect.objectContaining({ outcome: 'accepted', eventId: 'note-concurrent' })
    ]);
    const calls = call.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    expect(calls[0]?.[1]).toMatchObject({ commandId, expectedRevision: 3 });
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it('retains the exact command after a malformed response could follow a commit', async () => {
    const commandId = '14141414-1414-4414-8414-141414141414';
    const crypto = cryptoWithUuid(commandId);
    const call = vi
      .fn()
      .mockResolvedValueOnce({
        ...buildRawSnapshot(3),
        outcome: 'accepted',
        revision: 3,
        eventId: 'possibly-committed-note'
      })
      .mockResolvedValueOnce({
        ...buildRawSnapshot(4),
        outcome: 'duplicate',
        revision: 4,
        eventId: 'possibly-committed-note'
      });
    const input = {
      authenticatedUid: 'coach-private-malformed-response',
      teamId: 'team-private-malformed-response',
      gameId: 'game-private-malformed-response',
      appBuild,
      expectedInstanceId: instanceId,
      expectedRevision: 3,
      rulesProfileId: 'baseball-youth',
      rulesProfileVersion: 1,
      text: 'Keep the id after malformed confirmation.'
    };

    await expect(saveDiamondPrivateNote(input, { transport: { call }, crypto })).rejects.toMatchObject({
      code: 'invalid-response',
      retryable: false
    });
    await expect(saveDiamondPrivateNote({ ...input, expectedRevision: 9 }, { transport: { call }, crypto })).resolves.toMatchObject({
      outcome: 'duplicate',
      eventId: 'possibly-committed-note'
    });

    const calls = call.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
    expect(calls.map((entry) => entry[1]?.commandId)).toEqual([commandId, commandId]);
    expect(calls.map((entry) => entry[1]?.expectedRevision)).toEqual([3, 3]);
    expect(crypto.randomUUID).toHaveBeenCalledTimes(1);
  });

  it('partitions uncertain private-note commands by the authenticated principal', async () => {
    vi.useFakeTimers();
    try {
      const firstId = '22222222-2222-4222-8222-222222222222';
      const secondId = '33333333-3333-4333-8333-333333333333';
      const crypto = {
        randomUUID: vi.fn().mockReturnValueOnce(firstId).mockReturnValueOnce(secondId)
      } as unknown as Crypto;
      let succeed = false;
      const call = vi.fn(async () => {
        if (!succeed) throw { code: 'functions/unavailable' };
        return {
          ...buildRawSnapshot(4),
          outcome: 'accepted',
          revision: 4,
          eventId: 'note-second-principal'
        };
      });
      const transport = { call } as unknown as DiamondCallableTransport;
      const input = {
        teamId: 'team-private-principal',
        gameId: 'game-private-principal',
        appBuild,
        expectedInstanceId: instanceId,
        expectedRevision: 3,
        rulesProfileId: 'baseball-youth',
        rulesProfileVersion: 1,
        text: 'Same note body on an account switch.'
      };

      await expect(saveDiamondPrivateNote({ ...input, authenticatedUid: 'coach-private-a' }, { transport, crypto })).rejects.toMatchObject({
        code: 'unavailable',
        retryable: true
      });
      await vi.advanceTimersByTimeAsync(8 * 60 * 1000 + 1);
      succeed = true;
      await expect(saveDiamondPrivateNote({ ...input, authenticatedUid: 'coach-private-b' }, { transport, crypto })).resolves.toMatchObject(
        { outcome: 'accepted' }
      );
      await expect(
        saveDiamondPrivateNote({ ...input, authenticatedUid: 'coach-private-a', expectedRevision: 9 }, { transport, crypto })
      ).resolves.toMatchObject({ outcome: 'accepted' });

      const calls = call.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
      expect(calls.map((entry) => entry[1]?.commandId)).toEqual([firstId, firstId, secondId, firstId]);
      expect(calls.every((entry) => !('authenticatedUid' in (entry[1] || {})))).toBe(true);
      expect(crypto.randomUUID).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds uncertain private-note commands per authenticated principal', async () => {
    vi.useFakeTimers();
    try {
      let commandIndex = 1;
      let succeed = false;
      const crypto = {
        randomUUID: vi.fn(() => `44444444-4444-4444-8444-${String(commandIndex++).padStart(12, '0')}`)
      } as unknown as Crypto;
      const call = vi.fn(async (_name: string, payload: Record<string, unknown>) => {
        if (!succeed) throw { code: 'functions/unavailable' };
        return {
          ...buildRawSnapshot(Number(payload.expectedRevision) + 1),
          outcome: 'accepted',
          revision: Number(payload.expectedRevision) + 1,
          eventId: 'note-cap-recovered'
        };
      });
      const transport = { call } as unknown as DiamondCallableTransport;
      const input = (index: number, authenticatedUid = 'coach-private-cap-a') => ({
        authenticatedUid,
        teamId: 'team-private-cap',
        gameId: `game-private-cap-${index}`,
        appBuild,
        expectedInstanceId: instanceId,
        expectedRevision: 3,
        rulesProfileId: 'baseball-youth',
        rulesProfileVersion: 1,
        text: `Uncertain private note ${index}`
      });

      for (let index = 0; index < 32; index += 1) {
        await expect(saveDiamondPrivateNote(input(index), { transport, crypto })).rejects.toMatchObject({
          code: 'unavailable',
          retryable: true
        });
      }
      await expect(saveDiamondPrivateNote(input(32), { transport, crypto })).rejects.toMatchObject({
        code: 'rate-limited',
        retryable: false
      });
      expect(call).toHaveBeenCalledTimes(64);
      expect(crypto.randomUUID).toHaveBeenCalledTimes(32);

      await vi.advanceTimersByTimeAsync(8 * 60 * 1000 + 1);
      succeed = true;
      await expect(saveDiamondPrivateNote(input(32), { transport, crypto })).resolves.toMatchObject({ outcome: 'accepted' });
      for (let index = 0; index < 32; index += 1) {
        await expect(saveDiamondPrivateNote(input(index), { transport, crypto })).resolves.toMatchObject({ outcome: 'accepted' });
      }
      expect(call).toHaveBeenCalledTimes(97);
      expect(crypto.randomUUID).toHaveBeenCalledTimes(33);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not reactivate an expired private-note receipt above the per-principal cap', async () => {
    vi.useFakeTimers();
    try {
      let commandIndex = 1;
      let succeed = false;
      const crypto = {
        randomUUID: vi.fn(() => `45454545-4545-4545-8545-${String(commandIndex++).padStart(12, '0')}`)
      } as unknown as Crypto;
      const call = vi.fn(async (_name: string, payload: Record<string, unknown>) => {
        if (!succeed) throw { code: 'functions/unavailable' };
        return {
          ...buildRawSnapshot(Number(payload.expectedRevision) + 1),
          outcome: 'accepted',
          revision: Number(payload.expectedRevision) + 1,
          eventId: 'note-expired-cap-recovered'
        };
      });
      const transport = { call } as unknown as DiamondCallableTransport;
      const input = (index: number) => ({
        authenticatedUid: 'coach-private-expired-cap',
        teamId: 'team-private-expired-cap',
        gameId: `game-private-expired-cap-${index}`,
        appBuild,
        expectedInstanceId: instanceId,
        expectedRevision: 3,
        rulesProfileId: 'baseball-youth',
        rulesProfileVersion: 1,
        text: `Expired-cap private note ${index}`
      });

      await expect(saveDiamondPrivateNote(input(-1), { transport, crypto })).rejects.toMatchObject({ code: 'unavailable' });
      const callsAfterExpiredAttempt = call.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
      const expiredCommandId = callsAfterExpiredAttempt[0]?.[1]?.commandId;
      await vi.advanceTimersByTimeAsync(8 * 60 * 1000 + 1);
      for (let index = 0; index < 32; index += 1) {
        await expect(saveDiamondPrivateNote(input(index), { transport, crypto })).rejects.toMatchObject({ code: 'unavailable' });
      }

      await expect(saveDiamondPrivateNote(input(-1), { transport, crypto })).rejects.toMatchObject({
        code: 'rate-limited',
        retryable: false
      });
      expect(call).toHaveBeenCalledTimes(66);

      succeed = true;
      await expect(saveDiamondPrivateNote(input(0), { transport, crypto })).resolves.toMatchObject({ outcome: 'accepted' });
      await expect(saveDiamondPrivateNote(input(-1), { transport, crypto })).resolves.toMatchObject({ outcome: 'accepted' });
      const calls = call.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
      expect(calls[67]?.[1]?.commandId).toBe(expiredCommandId);
      for (let index = 1; index < 32; index += 1) {
        await expect(saveDiamondPrivateNote(input(index), { transport, crypto })).resolves.toMatchObject({ outcome: 'accepted' });
      }
      expect(crypto.randomUUID).toHaveBeenCalledTimes(33);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reserves one active slot before concurrent retries of distinct expired private-note receipts', async () => {
    vi.useFakeTimers();
    try {
      let commandIndex = 1;
      let mode: 'unavailable' | 'deferred' | 'success' = 'unavailable';
      let resolveDeferred!: (value: unknown) => void;
      const crypto = {
        randomUUID: vi.fn(() => `46464646-4646-4646-8646-${String(commandIndex++).padStart(12, '0')}`)
      } as unknown as Crypto;
      const accepted = (payload: Record<string, unknown>) => ({
        ...buildRawSnapshot(Number(payload.expectedRevision) + 1),
        outcome: 'accepted',
        revision: Number(payload.expectedRevision) + 1,
        eventId: 'note-concurrent-expired-cap-recovered'
      });
      const call = vi.fn(async (_name: string, payload: Record<string, unknown>) => {
        if (mode === 'unavailable') throw { code: 'functions/unavailable' };
        if (mode === 'deferred') {
          return new Promise((resolve) => {
            resolveDeferred = resolve;
          });
        }
        return accepted(payload);
      });
      const transport = { call } as unknown as DiamondCallableTransport;
      const input = (index: number) => ({
        authenticatedUid: 'coach-private-concurrent-expired-cap',
        teamId: 'team-private-concurrent-expired-cap',
        gameId: `game-private-concurrent-expired-cap-${index}`,
        appBuild,
        expectedInstanceId: instanceId,
        expectedRevision: 3,
        rulesProfileId: 'baseball-youth',
        rulesProfileVersion: 1,
        text: `Concurrent expired-cap private note ${index}`
      });

      await expect(saveDiamondPrivateNote(input(-2), { transport, crypto })).rejects.toMatchObject({ code: 'unavailable' });
      await expect(saveDiamondPrivateNote(input(-1), { transport, crypto })).rejects.toMatchObject({ code: 'unavailable' });
      const initialCalls = call.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
      const firstExpiredCommandId = initialCalls[0]?.[1]?.commandId;
      const secondExpiredCommandId = initialCalls[2]?.[1]?.commandId;
      await vi.advanceTimersByTimeAsync(8 * 60 * 1000 + 1);
      for (let index = 0; index < 31; index += 1) {
        await expect(saveDiamondPrivateNote(input(index), { transport, crypto })).rejects.toMatchObject({ code: 'unavailable' });
      }
      expect(call).toHaveBeenCalledTimes(66);

      mode = 'deferred';
      const firstRetry = saveDiamondPrivateNote(input(-2), { transport, crypto });
      expect(call).toHaveBeenCalledTimes(67);
      await expect(saveDiamondPrivateNote(input(-1), { transport, crypto })).rejects.toMatchObject({
        code: 'rate-limited',
        retryable: false
      });
      expect(call).toHaveBeenCalledTimes(67);
      const retryCalls = call.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
      expect(retryCalls[66]?.[1]?.commandId).toBe(firstExpiredCommandId);
      resolveDeferred(accepted(retryCalls[66]?.[1] || {}));
      await expect(firstRetry).resolves.toMatchObject({ outcome: 'accepted' });

      mode = 'success';
      await expect(saveDiamondPrivateNote(input(-1), { transport, crypto })).resolves.toMatchObject({ outcome: 'accepted' });
      const calls = call.mock.calls as unknown as Array<[string, Record<string, unknown>]>;
      expect(calls[67]?.[1]?.commandId).toBe(secondExpiredCommandId);
      for (let index = 0; index < 31; index += 1) {
        await expect(saveDiamondPrivateNote(input(index), { transport, crypto })).resolves.toMatchObject({ outcome: 'accepted' });
      }
      expect(crypto.randomUUID).toHaveBeenCalledTimes(33);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('bounds unconfirmed private-note receipts across switched accounts without forgetting their IDs', async () => {
    vi.useFakeTimers();
    try {
      let commandIndex = 1;
      let succeed = false;
      const crypto = {
        randomUUID: vi.fn(() => `55555555-5555-4555-8555-${String(commandIndex++).padStart(12, '0')}`)
      } as unknown as Crypto;
      const call = vi.fn(async (_name: string, payload: Record<string, unknown>) => {
        if (!succeed) throw { code: 'functions/unavailable' };
        return {
          ...buildRawSnapshot(Number(payload.expectedRevision) + 1),
          outcome: 'accepted',
          revision: Number(payload.expectedRevision) + 1,
          eventId: 'bounded-receipt-recovered'
        };
      });
      const transport = { call } as unknown as DiamondCallableTransport;
      const input = (index: number) => ({
        authenticatedUid: `coach-private-global-${Math.floor(index / 32)}`,
        teamId: 'team-private-global-cap',
        gameId: `game-private-global-cap-${index}`,
        appBuild,
        expectedInstanceId: instanceId,
        expectedRevision: 3,
        rulesProfileId: 'baseball-youth',
        rulesProfileVersion: 1,
        text: `Bounded ambiguous note ${index}`
      });

      for (let index = 0; index < 128; index += 1) {
        await expect(saveDiamondPrivateNote(input(index), { transport, crypto })).rejects.toMatchObject({
          code: 'unavailable',
          retryable: true
        });
      }
      await expect(
        saveDiamondPrivateNote({ ...input(128), authenticatedUid: 'coach-private-global-overflow' }, { transport, crypto })
      ).rejects.toMatchObject({ code: 'unavailable', retryable: false });
      expect(call).toHaveBeenCalledTimes(256);
      expect(crypto.randomUUID).toHaveBeenCalledTimes(128);

      succeed = true;
      for (let index = 0; index < 128; index += 1) {
        await expect(saveDiamondPrivateNote(input(index), { transport, crypto })).resolves.toMatchObject({ outcome: 'accepted' });
      }
      expect(call).toHaveBeenCalledTimes(384);
      expect(crypto.randomUUID).toHaveBeenCalledTimes(128);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('persists ordinary offline commands, deduplicates IDs, and removes each item only after server confirmation', async () => {
    const storage = createStorage();
    const command = buildCommand();
    const identity = buildQueueIdentity();
    expect(enqueueDiamondCommand(command, identity, storage, () => new Date('2026-09-05T12:00:00Z'))).toHaveLength(1);
    expect(enqueueDiamondCommand(command, identity, storage, () => new Date('2026-09-05T12:01:00Z'))).toHaveLength(1);
    expect(readDiamondCommandQueue(identity, storage)).toEqual([
      {
        command,
        queuedAt: '2026-09-05T12:00:00.000Z',
        ...identity
      }
    ]);
    expect(JSON.parse(storage.values.get(getDiamondQueueKey(identity)) || 'null')).toMatchObject({
      version: 3,
      identity,
      items: [{ ...identity, command }]
    });

    const call = vi.fn(async (name: string) => {
      if (name === 'getDiamondState') return buildRawSnapshot(3);
      return {
        ...buildRawSnapshot(4),
        outcome: 'duplicate',
        revision: 4,
        eventId: 'event-4'
      };
    });
    const result = await reconcileDiamondCommandQueue(identity, {
      storage,
      transport: { call } as unknown as DiamondCallableTransport
    });
    expect(result).toMatchObject({ accepted: 0, duplicates: 1, remaining: [] });
    expect(storage.values.has(getDiamondQueueKey(identity))).toBe(false);
    expect(call.mock.calls.map(([name]) => name)).toEqual(['getDiamondState', 'submitDiamondCommand']);
  });

  it('retains a rate-limited queue and drains it on a later manual sync', async () => {
    const storage = createStorage();
    const identity = buildQueueIdentity();
    const first = buildCommand({
      type: 'record_fielding',
      payload: {
        playEventId: 'event-3',
        fielding: { putoutBy: 'pitcher-1', battedBall: 'ground' }
      }
    });
    const second = {
      ...buildCommand({
        expectedRevision: 4,
        payload: {
          batterId: 'batter-1',
          pitcherId: 'pitcher-1',
          result: 'called_strike'
        }
      }),
      commandId: replacementInstanceId
    };
    enqueueDiamondCommand(first, identity, storage);
    enqueueDiamondCommand(second, identity, storage);

    const limitedCall = vi.fn(async (name: string, _payload: Record<string, unknown>) => {
      if (name === 'getDiamondState') return buildRawSnapshot(3);
      throw {
        code: 'functions/resource-exhausted',
        message: 'Full-history scorebook verification is temporarily limited.',
        details: { reason: 'command-history-rate-limited', retryable: true }
      };
    });
    await expect(
      reconcileDiamondCommandQueue(identity, {
        storage,
        transport: { call: limitedCall } as unknown as DiamondCallableTransport
      })
    ).rejects.toMatchObject({ code: 'rate-limited', retryable: true });
    expect(limitedCall.mock.calls.map(([name]) => name)).toEqual(['getDiamondState', 'submitDiamondCommand', 'submitDiamondCommand']);
    expect(limitedCall.mock.calls.slice(1).map(([, payload]) => payload.commandId)).toEqual([first.commandId, first.commandId]);
    expect(limitedCall.mock.calls.slice(1).map(([, payload]) => payload.type)).toEqual(['record_fielding', 'record_fielding']);
    expect(readDiamondCommandQueue(identity, storage).map(({ command }) => command)).toEqual([first, second]);

    const recoveredCall = vi.fn(async (name: string, payload: Record<string, unknown>) => {
      if (name === 'getDiamondState') return buildRawSnapshot(3);
      const revision = payload.commandId === first.commandId ? 4 : 5;
      return {
        outcome: 'accepted',
        revision,
        eventId: `event-${revision}`,
        state: buildRawSnapshot(revision)
      };
    });
    await expect(
      reconcileDiamondCommandQueue(identity, {
        storage,
        transport: { call: recoveredCall } as unknown as DiamondCallableTransport
      })
    ).resolves.toMatchObject({ accepted: 2, duplicates: 0, remaining: [] });
    expect(recoveredCall.mock.calls.map(([name]) => name)).toEqual(['getDiamondState', 'submitDiamondCommand', 'submitDiamondCommand']);
    expect(readDiamondCommandQueue(identity, storage)).toEqual([]);
  });

  it('never stores private notes, corrections, or transcripts in the offline command queue', () => {
    const storage = createStorage();
    const note = createDiamondCommand(
      {
        teamId: 'team-1',
        gameId: 'game-1',
        appBuild,
        expectedInstanceId: instanceId,
        leaseId: scorerLeaseId,
        expectedRevision: 3,
        rulesProfileId: 'baseball-youth',
        rulesProfileVersion: 1,
        type: 'private_note',
        payload: { text: 'private transcript' }
      },
      cryptoWithUuid()
    );
    const identity = buildQueueIdentity();
    expect(() => enqueueDiamondCommand(note, identity, storage)).toThrowError(expect.objectContaining({ code: 'storage-unavailable' }));
    expect(storage.setItem).not.toHaveBeenCalled();

    const unsafePlay = buildCommand({ payload: { transcript: 'raw words' } });
    expect(() => enqueueDiamondCommand(unsafePlay, identity, storage)).toThrow('never stored');
    const disguisedTranscript = buildCommand({ payload: { location: 'Transcript from scorer microphone' } });
    expect(() => enqueueDiamondCommand(disguisedTranscript, identity, storage)).toThrow('never stored');

    const privateTargetVoid = buildCommand({
      type: 'void_event',
      payload: { targetEventId: 'private-note-event', reason: 'wrong entry' }
    });
    expect(() => enqueueDiamondCommand(privateTargetVoid, identity, storage)).toThrow('never stored');

    const privateTargetSupersede = buildCommand({
      type: 'supersede_event',
      payload: {
        targetEventId: 'private-note-event',
        reason: 'replace private note',
        replacement: {
          type: 'rules_decision',
          payload: { code: 'local_rule', description: 'Public ruling.' }
        }
      }
    });
    expect(() => enqueueDiamondCommand(privateTargetSupersede, identity, storage)).toThrow('never stored');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('quarantines a previously persisted correction instead of replaying it', () => {
    const storage = createStorage();
    const identity = buildQueueIdentity();
    const correction = buildCommand({
      type: 'void_event',
      payload: { targetEventId: 'private-note-event', reason: 'legacy queued correction' }
    });
    const key = getDiamondQueueKey(identity);
    storage.values.set(
      key,
      JSON.stringify({
        version: 3,
        identity,
        items: [{ command: correction, queuedAt: '2026-09-05T12:00:00.000Z', ...identity }]
      })
    );

    expect(readDiamondCommandQueue(identity, storage)).toEqual([]);
    expect(storage.removeItem).toHaveBeenCalledWith(key);
    expect(storage.values.has(key)).toBe(false);
  });

  it('rejects a command whose expected Diamond instance does not match the queue identity', () => {
    const storage = createStorage();
    const identity = buildQueueIdentity();
    const wrongInstanceCommand = buildCommand({ expectedInstanceId: replacementInstanceId });

    expect(() => enqueueDiamondCommand(wrongInstanceCommand, identity, storage)).toThrowError(
      expect.objectContaining({ code: 'conflict' })
    );
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('quarantines a prior user queue across logout and login instead of submitting it', async () => {
    const storage = createStorage();
    const originalIdentity = buildQueueIdentity();
    const nextUserIdentity = buildQueueIdentity({ authenticatedUid: 'coach-2', scorerUid: 'coach-2' });
    enqueueDiamondCommand(buildCommand(), originalIdentity, storage);

    expect(getDiamondQueueKey(nextUserIdentity)).not.toBe(getDiamondQueueKey(originalIdentity));
    expect(readDiamondCommandQueue(nextUserIdentity, storage)).toEqual([]);
    expect(readDiamondCommandQueue(originalIdentity, storage)).toHaveLength(1);
    const call = vi.fn();
    await expect(reconcileDiamondCommandQueue(nextUserIdentity, { storage, transport: { call } })).resolves.toMatchObject({
      accepted: 0,
      duplicates: 0,
      remaining: []
    });
    expect(call).not.toHaveBeenCalled();
  });

  it('stops reconciliation after a scorer handoff and retains the old scorer queue', async () => {
    const storage = createStorage();
    const identity = buildQueueIdentity();
    enqueueDiamondCommand(buildCommand(), identity, storage);
    const handedOff = buildRawSnapshot(3);
    handedOff.state.currentScorerUid = 'coach-2';
    handedOff.lease = {
      status: 'held-by-other',
      canScore: false,
      canAcquire: false,
      canRecover: false,
      holderUid: 'coach-2',
      holderName: 'Coach Lee',
      leaseId: null,
      epoch: 3,
      expiresAt: '2026-09-05T12:30:00.000Z',
      eligibleScorers: []
    };
    const call = vi.fn().mockResolvedValue(handedOff);

    await expect(reconcileDiamondCommandQueue(identity, { storage, transport: { call } })).rejects.toMatchObject({
      code: 'conflict'
    });
    expect(call.mock.calls.map(([name]) => name)).toEqual(['getDiamondState']);
    expect(readDiamondCommandQueue(identity, storage)).toHaveLength(1);
  });

  it('isolates a deleted and recreated game generation from commands queued for the old instance', async () => {
    const storage = createStorage();
    const originalIdentity = buildQueueIdentity();
    const recreatedIdentity = buildQueueIdentity({ instanceId: replacementInstanceId });
    enqueueDiamondCommand(buildCommand(), originalIdentity, storage);

    expect(readDiamondCommandQueue(recreatedIdentity, storage)).toEqual([]);
    const recreated = { ...buildRawSnapshot(3), instanceId: replacementInstanceId };
    const call = vi.fn().mockResolvedValue(recreated);
    await expect(reconcileDiamondCommandQueue(originalIdentity, { storage, transport: { call } })).rejects.toMatchObject({
      code: 'conflict'
    });
    expect(call.mock.calls.map(([name]) => name)).toEqual(['getDiamondState']);
    expect(readDiamondCommandQueue(originalIdentity, storage)).toHaveLength(1);
  });

  it('isolates queued commands from a replacement scorer lease held by the same user', async () => {
    const storage = createStorage();
    const originalIdentity = buildQueueIdentity();
    const replacementLeaseId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const replacementIdentity = buildQueueIdentity({ leaseId: replacementLeaseId });
    enqueueDiamondCommand(buildCommand(), originalIdentity, storage);

    expect(getDiamondQueueKey(replacementIdentity)).not.toBe(getDiamondQueueKey(originalIdentity));
    expect(readDiamondCommandQueue(replacementIdentity, storage)).toEqual([]);
    const current = buildRawSnapshot(3);
    current.lease.leaseId = replacementLeaseId;
    const call = vi.fn().mockResolvedValue(current);

    await expect(reconcileDiamondCommandQueue(originalIdentity, { storage, transport: { call } })).rejects.toMatchObject({
      code: 'conflict'
    });
    expect(call.mock.calls.map(([name]) => name)).toEqual(['getDiamondState']);
    expect(readDiamondCommandQueue(originalIdentity, storage)).toHaveLength(1);
  });

  it('does not dequeue a command when the submit response reports another game instance', async () => {
    const storage = createStorage();
    const identity = buildQueueIdentity();
    enqueueDiamondCommand(buildCommand(), identity, storage);
    const replacement = buildRawSnapshot(4);
    replacement.instanceId = replacementInstanceId;
    replacement.state.instanceId = replacementInstanceId;
    const call = vi.fn(async (name: string) => {
      if (name === 'getDiamondState') return buildRawSnapshot(3);
      return { ...replacement, outcome: 'accepted', revision: 4, eventId: 'event-4' };
    });

    await expect(
      reconcileDiamondCommandQueue(identity, {
        storage,
        transport: { call } as unknown as DiamondCallableTransport
      })
    ).rejects.toMatchObject({ code: 'invalid-response' });
    expect(readDiamondCommandQueue(identity, storage)).toHaveLength(1);
  });

  it('purges the unscoped v1 queue schema without ever returning or submitting it', async () => {
    const storage = createStorage();
    const identity = buildQueueIdentity();
    const legacyKey = 'allplays:diamond-scorebook:queue:v1:team-1:game-1';
    storage.values.set(
      legacyKey,
      JSON.stringify({ version: 1, items: [{ command: buildCommand(), queuedAt: '2026-09-05T12:00:00.000Z' }] })
    );

    expect(readDiamondCommandQueue(identity, storage)).toEqual([]);
    expect(storage.values.has(legacyKey)).toBe(false);
    const call = vi.fn();
    await expect(reconcileDiamondCommandQueue(identity, { storage, transport: { call } })).resolves.toMatchObject({
      accepted: 0,
      remaining: []
    });
    expect(call).not.toHaveBeenCalled();
  });

  it('purges the v2 queue schema that had no scorer-lease binding', () => {
    const storage = createStorage();
    const identity = buildQueueIdentity();
    const v2Key = `allplays:diamond-scorebook:queue:v2:${[identity.teamId, identity.gameId, identity.instanceId, identity.authenticatedUid]
      .map((part) => encodeURIComponent(part))
      .join(':')}`;
    storage.values.set(
      v2Key,
      JSON.stringify({ version: 2, identity: { ...identity, leaseId: undefined }, items: [{ command: buildCommand() }] })
    );

    expect(readDiamondCommandQueue(identity, storage)).toEqual([]);
    expect(storage.values.has(v2Key)).toBe(false);
  });

  it('fails access closed and sends setup mutations with stable secure request IDs', async () => {
    const accessCall = vi.fn().mockResolvedValue({});
    await expect(getDiamondAccess('team-1', { appBuild, transport: { call: accessCall } })).resolves.toEqual({
      eligible: false,
      canManage: false,
      canScore: false,
      policyMode: 'disabled',
      sport: null,
      teamOptIn: false,
      trackingEngine: null,
      reason: null
    });
    expect(accessCall).toHaveBeenCalledWith('getDiamondAccess', { teamId: 'team-1', appBuild });

    const unreadableBuildCall = vi.fn();
    await expect(
      getDiamondAccess('team-1', {
        appBuildResolver: vi.fn(async () => 0),
        transport: { call: unreadableBuildCall }
      })
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(unreadableBuildCall).not.toHaveBeenCalled();

    const configureCall = vi.fn().mockResolvedValue({
      configured: true,
      enabled: true,
      teamId: 'team-1',
      sport: 'baseball',
      rulesProfileId: 'baseball-youth',
      rulesProfileVersion: 3,
      captureMode: 'full'
    });
    await expect(
      configureDiamondTeam('team-1', 'baseball', null, {
        enabled: true,
        rulesProfileVersion: 3,
        captureMode: 'full',
        appBuild,
        transport: { call: configureCall },
        crypto: cryptoWithUuid()
      })
    ).resolves.toMatchObject({
      configured: true,
      enabled: true,
      rulesProfileId: 'baseball-youth',
      rulesProfileVersion: 3,
      captureMode: 'full'
    });
    expect(configureCall).toHaveBeenCalledWith('configureDiamondTeam', {
      requestId: uuid,
      teamId: 'team-1',
      appBuild,
      enabled: true,
      sport: 'baseball',
      rulesProfileId: 'baseball-youth',
      rulesProfileVersion: 3,
      captureMode: 'full'
    });

    const disabledCall = vi.fn().mockResolvedValue({
      configured: true,
      enabled: false,
      teamId: 'team-1',
      sport: 'baseball',
      rulesProfileId: 'baseball-youth',
      rulesProfileVersion: 1,
      captureMode: 'quick'
    });
    await expect(
      configureDiamondTeam('team-1', 'baseball', null, {
        appBuild,
        transport: { call: disabledCall },
        crypto: cryptoWithUuid()
      })
    ).resolves.toMatchObject({ configured: true, enabled: false });
    expect(disabledCall).toHaveBeenCalledWith('configureDiamondTeam', expect.objectContaining({ enabled: false }));

    const unconfirmedEnableCall = vi.fn().mockResolvedValue({
      configured: true,
      enabled: false,
      teamId: 'team-1',
      sport: 'baseball',
      rulesProfileId: 'baseball-youth',
      rulesProfileVersion: 1,
      captureMode: 'quick'
    });
    await expect(
      configureDiamondTeam('team-1', 'baseball', null, {
        enabled: true,
        appBuild,
        transport: { call: unconfirmedEnableCall },
        crypto: cryptoWithUuid()
      })
    ).rejects.toMatchObject({ code: 'invalid-response' });

    const activateCall = vi.fn().mockResolvedValue({
      activated: true,
      teamId: 'team-1',
      gameId: 'game-1',
      trackingEngine: 'diamond-v2',
      snapshot: buildRawSnapshot()
    });
    await expect(
      activateDiamondGame(
        { teamId: 'team-1', gameId: 'game-1', captureMode: 'quick', appBuild },
        {
          transport: { call: activateCall },
          crypto: cryptoWithUuid()
        }
      )
    ).resolves.toMatchObject({ activated: true, trackingEngine: 'diamond-v2' });
    expect(activateCall).toHaveBeenCalledWith(
      'activateDiamondGame',
      expect.objectContaining({ requestId: uuid, appBuild, captureMode: 'quick' })
    );
  });

  it('acquires or recovers a scorer lease with one stable idempotent request', async () => {
    const base = buildRawSnapshot(4);
    const recovered = {
      ...base,
      state: { ...base.state, currentScorerUid: 'coach-2' },
      lease: {
        status: 'held-by-other',
        canScore: false,
        canAcquire: false,
        canRecover: false,
        holderUid: 'coach-2',
        holderName: 'Coach Lee',
        leaseId: null,
        epoch: 3,
        expiresAt: '2026-09-05T12:30:00.000Z',
        eligibleScorers: [{ playerId: 'coach-2', name: 'Coach Lee' }]
      }
    };
    const call = vi.fn().mockRejectedValueOnce({ code: 'functions/unavailable', message: 'response lost' }).mockResolvedValueOnce({
      outcome: 'accepted',
      operation: 'recover',
      revision: 4,
      eventId: 'event-4',
      state: recovered
    });

    await expect(
      acquireDiamondScorerLease(
        {
          teamId: 'team-1',
          gameId: 'game-1',
          expectedInstanceId: instanceId,
          expectedRevision: 3,
          operation: 'recover',
          targetUid: 'coach-2',
          appBuild
        },
        { transport: { call }, crypto: cryptoWithUuid() }
      )
    ).resolves.toMatchObject({
      outcome: 'accepted',
      operation: 'recover',
      revision: 4,
      snapshot: { lease: { holderUid: 'coach-2', epoch: 3 } }
    });
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[0]).toEqual(call.mock.calls[1]);
    expect(call).toHaveBeenCalledWith('acquireDiamondScorerLease', {
      requestId: uuid,
      teamId: 'team-1',
      gameId: 'game-1',
      appBuild,
      expectedInstanceId: instanceId,
      expectedRevision: 3,
      operation: 'recover',
      targetUid: 'coach-2'
    });
  });
});
