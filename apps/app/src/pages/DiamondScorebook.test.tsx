// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AuthState } from '../lib/types';
import {
  DIAMOND_SCHEMA_VERSION,
  createDiamondLedger,
  executeDiamondCommand,
  reduceDiamondEvent,
  type DiamondCommand as DomainDiamondCommand,
  type DiamondCommandPayloadMap,
  type DiamondCommandType as DomainDiamondCommandType,
  type DiamondGameState
} from '../lib/diamondScorebook';
import type { DiamondAiDependencies, DiamondAiModelRequest, DiamondAiSourcePacket } from '../lib/diamondScorebookAi';
import { DiamondScorebookError } from '../lib/diamondScorebookService';
import type {
  DiamondCommandEnvelope,
  DiamondCommandOutcome,
  DiamondPrivateEvent,
  DiamondScorebookClient,
  DiamondScorebookSnapshot
} from '../lib/diamondScorebookService';

const dictationMocks = vi.hoisted(() => ({
  startNativeSpeechDictation: vi.fn()
}));

vi.mock('../lib/dictation', () => ({
  appendDictationTranscript: (current: string, transcript: string) => `${current.trim()} ${transcript.trim()}`.trim(),
  collectFinalDictationTranscript: vi.fn(() => ''),
  getDictationErrorMessage: vi.fn(() => 'Dictation failed.'),
  getSpeechRecognitionConstructor: vi.fn(() => null),
  isCapacitorNativeRuntime: vi.fn(() => true),
  startNativeSpeechDictation: dictationMocks.startNativeSpeechDictation
}));

import { DiamondScorebook } from './DiamondScorebook';

const auth: AuthState = {
  user: {
    uid: 'coach-1',
    email: 'coach@example.com',
    displayName: 'Coach Carter',
    roles: ['coach']
  },
  profile: null,
  loading: false,
  error: null,
  roles: ['coach'],
  isParent: false,
  isCoach: true,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn()
};
const appBuild = 20260905;
const scorerLeaseId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const replacementScorerLeaseId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function checkpointForRevision(revision: number) {
  return `sha256:${revision.toString(16).padStart(64, '0')}`;
}

function buildSnapshot(overrides: Partial<DiamondScorebookSnapshot> = {}): DiamondScorebookSnapshot {
  return {
    schemaVersion: 2,
    teamId: 'team-1',
    gameId: 'game-1',
    instanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    revision: 7,
    checkpointHash: checkpointForRevision(7),
    authoritative: true,
    lifecycle: 'active',
    captureMode: 'full',
    rulesProfileId: 'baseball-youth@1',
    rulesProfileVersion: 1,
    teamName: 'Bears',
    opponentName: 'Wolves',
    homeName: 'Bears',
    awayName: 'Wolves',
    score: { home: 3, away: 2 },
    inning: {
      number: 4,
      half: 'bottom',
      outs: 1,
      balls: 2,
      strikes: 1,
      pitchesInPlateAppearance: 4
    },
    bases: {
      first: {
        playerId: 'runner-1',
        name: 'Jordan Lee',
        number: '8',
        responsiblePitcherId: 'pitcher-1',
        courtesyForPlayerId: null,
        reachedOnEventId: 'event-6'
      },
      second: null,
      third: {
        playerId: 'runner-3',
        name: 'Casey Kim',
        number: '4',
        responsiblePitcherId: 'pitcher-1',
        courtesyForPlayerId: null,
        reachedOnEventId: 'event-5'
      }
    },
    currentBatter: { playerId: 'batter-1', name: 'Avery Carter', number: '12' },
    currentPitcher: { playerId: 'pitcher-1', name: 'Morgan Diaz', number: '7' },
    lineups: {
      home: [
        { playerId: 'batter-1', name: 'Avery Carter', number: '12', slot: 1 },
        { playerId: 'runner-1', name: 'Jordan Lee', number: '8', slot: 2 }
      ],
      away: [{ playerId: 'pitcher-1', name: 'Morgan Diaz', number: '7', slot: 1 }]
    },
    defense: {
      home: { P: { playerId: 'batter-1', name: 'Avery Carter', number: '12' } },
      away: {
        P: { playerId: 'pitcher-1', name: 'Morgan Diaz', number: '7' },
        C: { playerId: 'fielder-2', name: 'Riley Chen', number: '2' }
      }
    },
    nextBatterSlot: { home: 0, away: 0 },
    battingLineup: [
      { playerId: 'batter-1', name: 'Avery Carter', number: '12', slot: 1 },
      { playerId: 'runner-1', name: 'Jordan Lee', number: '8', slot: 2 }
    ],
    defensiveLineup: [
      { playerId: 'pitcher-1', name: 'Morgan Diaz', number: '7' },
      { playerId: 'fielder-2', name: 'Riley Chen', number: '2' }
    ],
    availablePlayers: {
      home: [
        { playerId: 'batter-1', name: 'Avery Carter', number: '12' },
        { playerId: 'runner-1', name: 'Jordan Lee', number: '8' },
        { playerId: 'bench-home', name: 'Taylor Gray', number: '15' }
      ],
      away: [
        { playerId: 'pitcher-1', name: 'Morgan Diaz', number: '7' },
        { playerId: 'bench-away', name: 'Sam Ortiz', number: '10' }
      ]
    },
    managedSide: 'home',
    ruleCapabilities: { dpFlex: false, courtesyRunner: { pitcher: true, catcher: true } },
    halfInningEnd: null,
    gameEndDecision: null,
    finalizationReason: null,
    recentPlays: [
      {
        eventId: 'event-7',
        revision: 7,
        label: 'Avery doubled',
        inningLabel: 'Bottom 4',
        voided: false
      }
    ],
    lease: {
      status: 'owned',
      canScore: true,
      canAcquire: false,
      canRecover: false,
      holderUid: 'coach-1',
      holderName: 'Coach Carter',
      leaseId: scorerLeaseId,
      epoch: 1,
      expiresAt: '2026-09-05T18:00:00.000Z',
      eligibleScorers: [{ playerId: 'coach-2', name: 'Coach Lee', number: null }]
    },
    completeness: {
      status: 'partial',
      authoritativeRevision: 7,
      families: {
        batting: 'complete',
        baserunning: 'complete',
        pitching: 'complete',
        fielding: 'partial',
        sensors: 'not_collected'
      },
      omissions: ['fielding location']
    },
    readOnlyReason: null,
    ...overrides
  };
}

function buildRecapSourcePacket(sourceRevision = 7): DiamondAiSourcePacket {
  return {
    sourceRevision,
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
        eventId: `event-${sourceRevision}`,
        revision: sourceRevision,
        summary: 'The final out completed a 3-2 Bears win.',
        inningLabel: 'Bottom 7',
        voided: false
      }
    ],
    stats: [
      {
        statId: 'team-game',
        subjectType: 'team',
        subjectId: 'team-1',
        label: 'Bears game totals',
        values: { R: 3, H: 8, E: null },
        coverage: { R: 'complete', H: 'complete', E: 'partial' }
      }
    ]
  };
}

function buildRecapModelResponse(sourceRevision = 7) {
  return {
    schemaVersion: 1,
    sourceRevision,
    recap: 'The Bears completed a 3-2 win.',
    recapCitations: [{ eventId: `event-${sourceRevision}`, revision: sourceRevision }],
    recapStatRefs: [{ statId: 'team-game', metric: 'R' }],
    insights: [
      {
        text: 'The offense collected 8 hits.',
        citations: [{ eventId: `event-${sourceRevision}`, revision: sourceRevision }],
        statRefs: [{ statId: 'team-game', metric: 'H' }]
      }
    ],
    dataQualityNotes: [],
    draft: true,
    published: false,
    requiresPublicationConfirmation: true,
    mutatesState: false
  };
}

function buildPrivateEvent(eventId = 'event-7', revision = 7, overrides: Partial<DiamondPrivateEvent> = {}): DiamondPrivateEvent {
  return {
    eventId,
    sequence: revision,
    revision,
    type: 'record_plate_appearance',
    payload: {
      batterId: 'batter-1',
      pitcherId: 'pitcher-1',
      result: 'double',
      batterAdvance: { to: 'second', cause: 'batted_ball', responsiblePitcherId: 'pitcher-1' },
      runnerAdvances: [],
      outsOnPlay: 0,
      runsBattedIn: 0
    },
    createdAt: '2026-09-05T12:00:00.000Z',
    voidsEventId: null,
    supersedesEventId: null,
    ...overrides
  };
}

function buildPrivateHistoryItems(revision = 7): DiamondPrivateEvent[] {
  return Array.from({ length: revision }, (_, index) => {
    const sequence = index + 1;
    if (sequence === 1) return buildPrivateEvent('event-1', sequence, { type: 'activate', payload: {} });
    if (sequence === 2 || sequence === 3) {
      return buildPrivateEvent(`event-${sequence}`, sequence, {
        type: 'set_lineup',
        payload: { side: sequence === 2 ? 'away' : 'home', entries: [] }
      });
    }
    if (sequence === 4 || sequence === 5) {
      return buildPrivateEvent(`event-${sequence}`, sequence, {
        type: 'set_defensive_alignment',
        payload: { side: sequence === 4 ? 'away' : 'home', assignments: [] }
      });
    }
    if (sequence === 6) return buildPrivateEvent('event-6', sequence, { type: 'start', payload: {} });
    if (sequence === 7) return buildPrivateEvent();
    return buildPrivateEvent(`event-${sequence}`, sequence, {
      type: 'substitute',
      payload: {
        side: 'home',
        battingSlot: 1,
        outgoingPlayerId: 'batter-1',
        incomingPlayerId: 'bench-home'
      }
    });
  });
}

function buildPrivateHistoryWindow(items: DiamondPrivateEvent[], sourceRevision: number) {
  const oldestSequence = items[0]?.sequence ?? null;
  const newestSequence = items[items.length - 1]?.sequence ?? null;
  const headComplete = newestSequence === sourceRevision || (sourceRevision === 0 && newestSequence === null);
  return {
    sourceRevision,
    oldestSequence,
    newestSequence,
    contiguous: true as const,
    rangeComplete: true as const,
    headComplete,
    historyComplete: headComplete && (oldestSequence === 1 || sourceRevision === 0),
    hasOlder: oldestSequence !== null && oldestSequence > 1,
    items
  };
}

function buildReducerStateForUiSnapshot(): DiamondGameState {
  let ledger = createDiamondLedger({
    teamId: 'team-1',
    gameId: 'game-1',
    rulesProfileId: 'baseball-youth',
    rulesProfileVersion: 1,
    captureMode: 'full'
  });
  let commandIndex = 1;
  const submit = <K extends DomainDiamondCommandType>(type: K, payload: DiamondCommandPayloadMap[K]) => {
    const command = {
      schemaVersion: DIAMOND_SCHEMA_VERSION,
      commandId: `10000000-0000-4000-8000-${String(commandIndex).padStart(12, '0')}`,
      teamId: 'team-1',
      gameId: 'game-1',
      expectedRevision: ledger.state.revision,
      rulesProfileId: 'baseball-youth',
      rulesProfileVersion: 1,
      type,
      payload
    } as DomainDiamondCommand;
    const execution = executeDiamondCommand(ledger, command, {
      actorUid: 'coach-1',
      eventId: `setup-${commandIndex}`,
      serverTimestampMs: 1_788_000_000_000 + commandIndex
    });
    if (execution.result.outcome !== 'accepted') throw new Error(execution.result.rejection?.message || 'UI reducer fixture failed.');
    ledger = execution.ledger;
    commandIndex += 1;
  };
  submit('activate', { initialScorerUid: 'coach-1', captureMode: 'full' });
  submit('set_lineup', {
    side: 'home',
    entries: [
      { slot: 1, playerId: 'batter-1' },
      { slot: 2, playerId: 'runner-1' },
      { slot: 3, playerId: 'runner-3' }
    ]
  });
  submit('set_lineup', {
    side: 'away',
    entries: [
      { slot: 1, playerId: 'pitcher-1' },
      { slot: 2, playerId: 'fielder-2' }
    ]
  });
  submit('set_defensive_alignment', { side: 'home', assignments: [{ position: 'P', playerId: 'batter-1' }] });
  submit('set_defensive_alignment', {
    side: 'away',
    assignments: [
      { position: 'P', playerId: 'pitcher-1' },
      { position: 'C', playerId: 'fielder-2' }
    ]
  });
  submit('start', {});
  return {
    ...ledger.state,
    inning: { ...ledger.state.inning, number: 4, half: 'bottom', outs: 1, balls: 2, strikes: 1, pitchesInPlateAppearance: 4 },
    bases: {
      first: {
        runnerId: 'runner-1',
        chargedToPitcherId: 'pitcher-1',
        courtesyForPlayerId: null,
        reachedOnEventId: 'event-6'
      },
      second: null,
      third: {
        runnerId: 'runner-3',
        chargedToPitcherId: 'pitcher-1',
        courtesyForPlayerId: null,
        reachedOnEventId: 'event-5'
      }
    },
    nextBatterSlot: { home: 0, away: 0 }
  };
}

function createClient(initialSnapshot = buildSnapshot()) {
  let loadedSnapshot = initialSnapshot;
  let commandNumber = 0;
  const createCommand = vi.fn((input: Omit<DiamondCommandEnvelope, 'schemaVersion' | 'commandId'>) => {
    commandNumber += 1;
    return {
      schemaVersion: 2 as const,
      commandId: `00000000-0000-4000-8000-${String(commandNumber).padStart(12, '0')}`,
      ...input
    };
  });
  const accepted = (command: DiamondCommandEnvelope): DiamondCommandOutcome => {
    if (command.type === 'set_lineup') {
      const side = command.payload.side as 'home' | 'away';
      const entries = command.payload.entries as Array<{
        slot: number;
        playerId: string;
        displayName?: string;
        jerseyNumber?: string;
        battingRole?: string;
      }>;
      loadedSnapshot = {
        ...loadedSnapshot,
        lineups: {
          ...loadedSnapshot.lineups,
          [side]: entries.map((entry) => ({
            playerId: entry.playerId,
            name: entry.displayName || entry.playerId,
            number: entry.jerseyNumber || null,
            slot: entry.slot,
            battingRole: entry.battingRole || 'regular'
          }))
        }
      };
    }
    if (command.type === 'set_defensive_alignment') {
      const side = command.payload.side as 'home' | 'away';
      const assignments = command.payload.assignments as Array<{ position: string; playerId: string }>;
      const candidates = [...loadedSnapshot.availablePlayers[side], ...loadedSnapshot.lineups[side]];
      loadedSnapshot = {
        ...loadedSnapshot,
        defense: {
          ...loadedSnapshot.defense,
          [side]: Object.fromEntries(
            assignments.map((assignment) => [
              assignment.position,
              candidates.find((player) => player.playerId === assignment.playerId) || {
                playerId: assignment.playerId,
                name: assignment.playerId
              }
            ])
          )
        }
      };
    }
    if (command.type === 'start') loadedSnapshot = { ...loadedSnapshot, lifecycle: 'active' };
    if (command.type === 'suspend') loadedSnapshot = { ...loadedSnapshot, lifecycle: 'suspended' };
    if (command.type === 'rules_decision') {
      const code = command.payload.code;
      if (code === 'end_half_inning_run_limit') {
        loadedSnapshot = {
          ...loadedSnapshot,
          halfInningEnd: { reason: 'run-limit', decisionEventId: `event-${command.expectedRevision + 1}` }
        };
      } else if (code === 'end_game_time_limit' || code === 'end_game_weather') {
        loadedSnapshot = {
          ...loadedSnapshot,
          gameEndDecision: {
            reason: code === 'end_game_time_limit' ? 'time-limit' : 'weather',
            decisionEventId: `event-${command.expectedRevision + 1}`,
            awardedSide: null
          }
        };
      } else if (code === 'end_game_forfeit_home' || code === 'end_game_forfeit_away') {
        loadedSnapshot = {
          ...loadedSnapshot,
          gameEndDecision: {
            reason: 'forfeit',
            decisionEventId: `event-${command.expectedRevision + 1}`,
            awardedSide: code === 'end_game_forfeit_home' ? 'home' : 'away'
          }
        };
      }
    }
    if (command.type === 'advance_half_inning') {
      loadedSnapshot = {
        ...loadedSnapshot,
        halfInningEnd: null,
        inning: {
          ...loadedSnapshot.inning,
          number: loadedSnapshot.inning.half === 'bottom' ? loadedSnapshot.inning.number + 1 : loadedSnapshot.inning.number,
          half: loadedSnapshot.inning.half === 'top' ? 'bottom' : 'top',
          outs: 0,
          balls: 0,
          strikes: 0,
          pitchesInPlateAppearance: 0
        }
      };
    }
    if (command.type === 'finalize') {
      loadedSnapshot = {
        ...loadedSnapshot,
        lifecycle: 'final',
        finalizationReason: loadedSnapshot.gameEndDecision
          ? {
              kind: loadedSnapshot.gameEndDecision.reason,
              decisionEventId: loadedSnapshot.gameEndDecision.decisionEventId
            }
          : { kind: 'regulation', decisionEventId: null }
      };
    }
    if (command.type === 'reopen_for_correction') loadedSnapshot = { ...loadedSnapshot, lifecycle: 'correction' };
    loadedSnapshot = {
      ...loadedSnapshot,
      revision: command.expectedRevision + 1,
      checkpointHash: checkpointForRevision(command.expectedRevision + 1),
      completeness: {
        ...loadedSnapshot.completeness,
        authoritativeRevision: command.expectedRevision + 1
      }
    };
    return {
      outcome: 'accepted',
      revision: loadedSnapshot.revision,
      eventId: `event-${loadedSnapshot.revision}`,
      snapshot: loadedSnapshot,
      completeness: loadedSnapshot.completeness
    };
  };
  const submitCommand = vi.fn(async (command: DiamondCommandEnvelope) => accepted(command));
  const savePrivateNote = vi.fn(async (input: Parameters<DiamondScorebookClient['savePrivateNote']>[0]) =>
    accepted(
      createCommand({
        teamId: input.teamId,
        gameId: input.gameId,
        appBuild: input.appBuild,
        expectedInstanceId: input.expectedInstanceId,
        ...(input.leaseId ? { leaseId: input.leaseId } : {}),
        expectedRevision: input.expectedRevision,
        rulesProfileId: input.rulesProfileId,
        rulesProfileVersion: input.rulesProfileVersion,
        type: 'private_note',
        payload: { text: input.text }
      })
    )
  );
  const requestHandoff = vi.fn(async (input: Parameters<DiamondScorebookClient['requestHandoff']>[0]) =>
    accepted(
      createCommand({
        teamId: input.teamId,
        gameId: input.gameId,
        appBuild: input.appBuild,
        expectedInstanceId: input.expectedInstanceId,
        ...(input.leaseId ? { leaseId: input.leaseId } : {}),
        expectedRevision: input.expectedRevision,
        rulesProfileId: input.rulesProfileId,
        rulesProfileVersion: input.rulesProfileVersion,
        type: 'scorer_handoff',
        payload: { toUid: input.toUid }
      })
    )
  );
  const getRecapSource = vi.fn();
  const publishAiDraft = vi.fn();
  const acquireLease = vi.fn(async (input: Parameters<DiamondScorebookClient['acquireLease']>[0]) => {
    const revision = input.expectedRevision + 1;
    loadedSnapshot = {
      ...loadedSnapshot,
      revision,
      checkpointHash: checkpointForRevision(revision),
      readOnlyReason: null,
      lease: {
        status: 'owned',
        canScore: true,
        canAcquire: false,
        canRecover: false,
        holderUid: auth.user!.uid,
        holderName: auth.user!.displayName,
        leaseId: replacementScorerLeaseId,
        epoch: (loadedSnapshot.lease.epoch || 0) + 1,
        expiresAt: '2026-09-05T18:15:00.000Z',
        eligibleScorers: loadedSnapshot.lease.eligibleScorers
      },
      completeness: { ...loadedSnapshot.completeness, authoritativeRevision: revision }
    };
    return {
      outcome: 'accepted' as const,
      operation: input.operation,
      revision,
      eventId: `event-${revision}`,
      snapshot: loadedSnapshot
    };
  });
  const loadPrivateHistory = vi.fn(async ({ expectedRevision }: Parameters<DiamondScorebookClient['loadPrivateHistoryWindow']>[0]) =>
    buildPrivateHistoryWindow(buildPrivateHistoryItems(expectedRevision), expectedRevision)
  );
  const client = {
    load: vi.fn(async () => loadedSnapshot),
    loadPrivateHistoryWindow: loadPrivateHistory,
    resolveAppBuild: vi.fn(async () => appBuild),
    getRecapSource,
    publishAiDraft,
    createSecureId: vi.fn(() => '12345678-1234-4234-9234-123456789abc'),
    createCommand,
    acquireLease,
    submitCommand,
    parseVoice: vi.fn(),
    savePrivateNote,
    requestHandoff,
    readQueue: vi.fn(() => []),
    enqueue: vi.fn((command: DiamondCommandEnvelope) => [{ command, queuedAt: '2026-09-05T12:00:00.000Z' }]),
    reconcileQueue: vi.fn(async () => ({ accepted: 0, duplicates: 0, remaining: [], lastSnapshot: null }))
  } as unknown as DiamondScorebookClient;
  return {
    client,
    createCommand,
    acquireLease,
    submitCommand,
    savePrivateNote,
    requestHandoff,
    getRecapSource,
    publishAiDraft,
    loadPrivateHistory
  };
}

function renderScorebook(snapshot = buildSnapshot(), clientFixture = createClient(snapshot), aiDependencies?: DiamondAiDependencies) {
  const rendered = render(
    <MemoryRouter>
      <DiamondScorebook
        auth={auth}
        teamId="team-1"
        gameId="game-1"
        initialSnapshot={snapshot}
        client={clientFixture.client}
        aiDependencies={aiDependencies}
      />
    </MemoryRouter>
  );
  return { ...rendered, ...clientFixture };
}

describe('DiamondScorebook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
    dictationMocks.startNativeSpeechDictation.mockImplementation(
      async (options: { onTranscript: (value: string) => void; onEnd: () => void }) => {
        options.onTranscript('Single to left, Casey scored.');
        options.onEnd();
        return { stop: vi.fn(async () => {}) };
      }
    );
  });

  afterEach(() => cleanup());

  it('shows authoritative game, player, base, lineup, lease, and stat-coverage context', () => {
    renderScorebook();

    expect(screen.getByTestId('diamond-scorebook-header')).toHaveClass(
      'border-primary-900',
      'from-primary-700',
      'to-primary-900'
    );
    expect(screen.getByText('Bears vs Wolves')).toBeInTheDocument();
    expect(screen.getByText('Live · revision 7')).toBeInTheDocument();
    expect(screen.getByText('Bottom 4')).toBeInTheDocument();
    expect(screen.getByText('2–1')).toBeInTheDocument();
    expect(screen.getAllByText('#12 Avery Carter').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('First base: #8 Jordan Lee')).toBeInTheDocument();
    expect(screen.getByText('You have the scorebook')).toBeInTheDocument();
    expect(screen.getByText('fielding · partial')).toBeInTheDocument();
    expect(screen.getByText(/never converted to zero/i)).toBeInTheDocument();
  });

  it('opens an asynchronously loaded Full-capture game with pitch controls selected', async () => {
    const snapshot = buildSnapshot({ captureMode: 'full' });
    const fixture = createClient(snapshot);
    render(
      <MemoryRouter>
        <DiamondScorebook auth={auth} teamId="team-1" gameId="game-1" client={fixture.client} />
      </MemoryRouter>
    );

    expect(await screen.findByRole('group', { name: 'Pitch' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'full' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText(/Quick controls cannot satisfy this game/i)).not.toBeInTheDocument();
  });

  it('acquires an available scorebook through the revision-bound server lease API', async () => {
    const snapshot = buildSnapshot({
      lease: {
        status: 'available',
        canScore: false,
        canAcquire: true,
        canRecover: false,
        holderUid: null,
        holderName: null,
        leaseId: null,
        epoch: null,
        expiresAt: null,
        eligibleScorers: []
      },
      readOnlyReason: 'Acquire the scorebook before scoring.'
    });
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);

    fireEvent.click(screen.getByRole('button', { name: 'Acquire scorebook' }));

    await waitFor(() =>
      expect(fixture.acquireLease).toHaveBeenCalledWith({
        teamId: 'team-1',
        gameId: 'game-1',
        appBuild,
        expectedInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        expectedRevision: 7,
        operation: 'acquire'
      })
    );
    expect(await screen.findByText('You have the scorebook')).toBeInTheDocument();
    expect(screen.getByText(/acquired the scoring lease at revision 8/i)).toBeInTheDocument();
  });

  it('reconciles an interrupted lease response before enabling scoring', async () => {
    const available = buildSnapshot({
      lease: {
        status: 'available',
        canScore: false,
        canAcquire: true,
        canRecover: false,
        holderUid: null,
        holderName: null,
        leaseId: null,
        epoch: null,
        expiresAt: null,
        eligibleScorers: []
      }
    });
    const acquired = buildSnapshot({
      revision: 8,
      checkpointHash: checkpointForRevision(8),
      lease: {
        ...buildSnapshot().lease,
        leaseId: replacementScorerLeaseId,
        epoch: 2
      },
      completeness: { ...buildSnapshot().completeness, authoritativeRevision: 8 }
    });
    const fixture = createClient(available);
    fixture.acquireLease.mockRejectedValueOnce(
      new DiamondScorebookError('unavailable', 'The callable response was interrupted.', { retryable: true })
    );
    (fixture.client.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce(acquired);
    renderScorebook(available, fixture);

    fireEvent.click(screen.getByRole('button', { name: 'Acquire scorebook' }));

    expect(await screen.findByText(/response was interrupted, but your scoring lease is authoritative at revision 8/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Single' })).toBeEnabled();
  });

  it('lets a manager recover an expired lease and binds subsequent plays to the replacement token', async () => {
    const snapshot = buildSnapshot({
      lease: {
        status: 'expired',
        canScore: false,
        canAcquire: true,
        canRecover: true,
        holderUid: 'coach-2',
        holderName: 'Coach Lee',
        leaseId: null,
        epoch: 2,
        expiresAt: '2026-09-05T12:00:00.000Z',
        eligibleScorers: []
      },
      readOnlyReason: 'The previous scoring lease expired.'
    });
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);

    fireEvent.click(screen.getByRole('button', { name: 'Recover scoring' }));
    await waitFor(() => expect(fixture.acquireLease).toHaveBeenCalledWith(expect.objectContaining({ operation: 'recover' })));
    expect(await screen.findByText(/expired lease can no longer submit plays/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Single' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Review Single' })).getByRole('button', { name: 'Confirm play' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));
    expect(fixture.createCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({
        leaseId: replacementScorerLeaseId,
        expectedRevision: 8,
        type: 'record_plate_appearance'
      })
    );
  });

  it('records a plate appearance only after one atomic runner review', async () => {
    const { createCommand, submitCommand } = renderScorebook();

    fireEvent.click(screen.getByRole('button', { name: 'Single' }));
    const dialog = screen.getByRole('dialog', { name: 'Review Single' });
    expect(submitCommand).not.toHaveBeenCalled();
    expect(within(dialog).getByLabelText(/Batter .* destination/)).toHaveValue('first');
    expect(within(dialog).getByLabelText(/Third .* destination/)).toHaveValue('home');
    expect(within(dialog).getByLabelText(/First .* destination/)).toHaveValue('second');

    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm play' }));

    await waitFor(() => expect(submitCommand).toHaveBeenCalledTimes(1));
    expect(createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        appBuild,
        expectedInstanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        leaseId: scorerLeaseId,
        expectedRevision: 7,
        type: 'record_plate_appearance',
        payload: expect.objectContaining({
          batterId: 'batter-1',
          pitcherId: 'pitcher-1',
          result: 'single',
          batterAdvance: expect.objectContaining({ to: 'first' }),
          runnerAdvances: expect.arrayContaining([
            expect.objectContaining({ runnerId: 'runner-1', from: 'first', to: 'second' }),
            expect.objectContaining({ runnerId: 'runner-3', from: 'third', to: 'home' })
          ]),
          outsOnPlay: 0,
          runsBattedIn: 1
        })
      })
    );
    const uiPayload = createCommand.mock.calls.find(([input]) => input.type === 'record_plate_appearance')?.[0]
      .payload as unknown as DiamondCommandPayloadMap['record_plate_appearance'];
    const reduced = reduceDiamondEvent(buildReducerStateForUiSnapshot(), {
      type: 'record_plate_appearance',
      eventId: 'ui-confirmed-play',
      payload: uiPayload
    });
    expect(reduced).toMatchObject({
      score: { home: 1, away: 0 },
      inning: { outs: 1, balls: 0, strikes: 0 },
      bases: {
        first: { runnerId: 'batter-1' },
        second: { runnerId: 'runner-1' },
        third: null
      }
    });
  });

  it('captures an explicit earned-run judgment in Full mode and discloses partial pitching when omitted', async () => {
    const { createCommand, submitCommand } = renderScorebook();

    fireEvent.click(screen.getByRole('button', { name: 'Single' }));
    const dialog = screen.getByRole('dialog', { name: 'Review Single' });
    expect(within(dialog).getByText(/Leaving it unentered records the play but marks pitching stats partial/i)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Third .* run charge/), { target: { value: 'earned' } });
    expect(within(dialog).queryByText(/marks pitching stats partial/i)).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm play' }));

    await waitFor(() => expect(submitCommand).toHaveBeenCalledTimes(1));
    expect(createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'record_plate_appearance',
        payload: expect.objectContaining({
          runnerAdvances: expect.arrayContaining([
            expect.objectContaining({ runnerId: 'runner-3', from: 'third', to: 'home', countsRun: true, earned: true, rbi: true })
          ])
        })
      })
    );
  });

  it('requires an explicit non-counting run on a force third out and submits reducer-accepted timing detail', async () => {
    const baseSnapshot = buildSnapshot();
    const snapshot = buildSnapshot({
      inning: { ...baseSnapshot.inning, outs: 2 },
      bases: { first: null, second: null, third: baseSnapshot.bases.third }
    });
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);

    fireEvent.click(screen.getByRole('button', { name: 'Ground out' }));
    const dialog = screen.getByRole('dialog', { name: 'Review Ground out' });
    fireEvent.change(within(dialog).getByLabelText(/Third .* destination/), { target: { value: 'home' } });
    expect(within(dialog).getByRole('alert')).toHaveTextContent(/run cannot count.*every possible third out/i);
    expect(within(dialog).getByRole('button', { name: 'Confirm play' })).toBeDisabled();
    fireEvent.click(within(dialog).getByLabelText('Run counts'));
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm play' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));

    const uiPayload = fixture.createCommand.mock.calls[0]![0].payload as unknown as DiamondCommandPayloadMap['record_plate_appearance'];
    expect(uiPayload).toMatchObject({
      result: 'ground_out',
      outsOnPlay: 1,
      runsBattedIn: 0,
      batterAdvance: { to: 'out', outKind: 'batter_runner' },
      runnerAdvances: [{ runnerId: 'runner-3', from: 'third', to: 'home', countsRun: false, rbi: false }]
    });
    const startingState = buildReducerStateForUiSnapshot();
    const reduced = reduceDiamondEvent(
      {
        ...startingState,
        inning: { ...startingState.inning, outs: 2 },
        bases: { first: null, second: null, third: startingState.bases.third }
      },
      { type: 'record_plate_appearance', eventId: 'ui-third-out', payload: uiPayload }
    );
    expect(reduced.score).toEqual({ home: 0, away: 0 });
    expect(reduced.inning.outs).toBe(3);
  });

  it('allows an explicit counted run when a mixed multi-out play has a possible tag third out', async () => {
    const snapshot = buildSnapshot();
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);

    fireEvent.click(screen.getByRole('button', { name: 'Double play' }));
    const dialog = screen.getByRole('dialog', { name: 'Review Double play' });
    fireEvent.change(within(dialog).getByLabelText(/Third .* destination/), { target: { value: 'home' } });
    fireEvent.change(within(dialog).getByLabelText(/First .* out kind/), { target: { value: 'tag' } });

    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Confirm play' })).toBeEnabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm play' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));

    expect(fixture.createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'record_plate_appearance',
        payload: expect.objectContaining({
          outsOnPlay: 2,
          runnerAdvances: expect.arrayContaining([
            expect.objectContaining({ runnerId: 'runner-3', from: 'third', to: 'home', countsRun: true }),
            expect.objectContaining({ runnerId: 'runner-1', from: 'first', to: 'out', outKind: 'tag' })
          ])
        })
      })
    );
  });

  it('rejects a counted run when every possible third out on a multi-out play cancels it', () => {
    renderScorebook();

    fireEvent.click(screen.getByRole('button', { name: 'Double play' }));
    const dialog = screen.getByRole('dialog', { name: 'Review Double play' });
    fireEvent.change(within(dialog).getByLabelText(/Third .* destination/), { target: { value: 'home' } });

    expect(within(dialog).getByRole('alert')).toHaveTextContent(/run cannot count/i);
    expect(within(dialog).getByRole('button', { name: 'Confirm play' })).toBeDisabled();
  });

  it.each(['Fly out', 'Strikeout'])('treats the batter-origin %s third out as a provable run cancellation', (outcome) => {
    const baseSnapshot = buildSnapshot();
    const snapshot = buildSnapshot({
      inning: { ...baseSnapshot.inning, outs: 2 },
      bases: { first: null, second: null, third: baseSnapshot.bases.third }
    });
    renderScorebook(snapshot, createClient(snapshot));

    fireEvent.click(screen.getByRole('button', { name: outcome }));
    const dialog = screen.getByRole('dialog', { name: `Review ${outcome}` });
    fireEvent.change(within(dialog).getByLabelText(/Third .* destination/), { target: { value: 'home' } });

    expect(within(dialog).getByRole('alert')).toHaveTextContent(/run cannot count/i);
    expect(within(dialog).getByRole('button', { name: 'Confirm play' })).toBeDisabled();
  });

  it('blocks an impossible duplicate-base review without writing a command', () => {
    const { submitCommand } = renderScorebook();
    fireEvent.click(screen.getByRole('button', { name: 'Single' }));
    const dialog = screen.getByRole('dialog', { name: 'Review Single' });

    fireEvent.change(within(dialog).getByLabelText(/Batter .* destination/), { target: { value: 'third' } });
    fireEvent.change(within(dialog).getByLabelText(/First .* destination/), { target: { value: 'third' } });

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Two runners cannot finish on the same base');
    expect(within(dialog).getByRole('button', { name: 'Confirm play' })).toBeDisabled();
    expect(submitCommand).not.toHaveBeenCalled();
  });

  it('implements undo as a confirmed append-only void_event', async () => {
    const fixture = createClient();
    fixture.loadPrivateHistory.mockResolvedValue(buildPrivateHistoryWindow(buildPrivateHistoryItems(), 7));
    const { createCommand, submitCommand } = renderScorebook(buildSnapshot(), fixture);
    fireEvent.click(screen.getByRole('button', { name: 'Load recent private history' }));
    await screen.findByText(/Complete private history: 7 canonical events/);
    fireEvent.change(screen.getByLabelText('Correction reason'), { target: { value: 'Official scorer changed the ruling.' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Void effect' })[0]!);

    const dialog = screen.getByRole('dialog', { name: 'Append this correction?' });
    expect(dialog).toHaveTextContent('remains in canonical history');
    expect(submitCommand).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(submitCommand).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('diamond-private-history')).not.toBeInTheDocument());
    expect(createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'void_event',
        payload: { targetEventId: 'event-7', reason: 'Official scorer changed the ruling.' }
      })
    );
  });

  it('renders newest plays first and targets the latest confirmed event', async () => {
    const snapshot = buildSnapshot({
      recentPlays: [
        {
          eventId: 'event-6',
          revision: 6,
          label: 'Jordan walked',
          inningLabel: 'Bottom 4',
          voided: false
        },
        {
          eventId: 'event-7',
          revision: 7,
          label: 'Avery doubled',
          inningLabel: 'Bottom 4',
          voided: false
        }
      ]
    });
    const fixture = createClient(snapshot);
    fixture.loadPrivateHistory.mockResolvedValue(buildPrivateHistoryWindow(buildPrivateHistoryItems(), 7));
    renderScorebook(snapshot, fixture);

    const items = within(screen.getByRole('list', { name: 'Recent scorebook plays' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Avery doubled');
    expect(items[1]).toHaveTextContent('Jordan walked');

    fireEvent.click(screen.getByRole('button', { name: 'Load recent private history' }));
    await screen.findByText(/Complete private history: 7 canonical events/);
    fireEvent.change(screen.getByLabelText('Correction reason'), { target: { value: 'Latest play was entered incorrectly.' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Void effect' })[0]!);
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Append this correction?' })).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));
    expect(fixture.createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'void_event',
        payload: { targetEventId: 'event-7', reason: 'Latest play was entered incorrectly.' }
      })
    );
  });

  it('progressively searches older corrections in a 2,405-event ledger while applying newer directives', async () => {
    const sourceRevision = 2_405;
    const snapshot = buildSnapshot({
      revision: sourceRevision,
      checkpointHash: checkpointForRevision(sourceRevision),
      completeness: { ...buildSnapshot().completeness, authoritativeRevision: sourceRevision }
    });
    const events = Array.from({ length: 400 }, (_, index) => {
      const sequence = 2_006 + index;
      if (sequence === 2_300) {
        return buildPrivateEvent(`event-${sequence}`, sequence, {
          type: 'void_event',
          payload: { targetEventId: 'event-2050', reason: 'Official scorer corrected the earlier ruling.' },
          voidsEventId: 'event-2050'
        });
      }
      return buildPrivateEvent(`event-${sequence}`, sequence);
    });
    const olderItems = events.slice(0, 200);
    const newestItems = events.slice(200);
    const fixture = createClient(snapshot);
    fixture.loadPrivateHistory.mockImplementation(
      async ({ beforeSequence }: Parameters<DiamondScorebookClient['loadPrivateHistoryWindow']>[0]) =>
        beforeSequence ? buildPrivateHistoryWindow(olderItems, sourceRevision) : buildPrivateHistoryWindow(newestItems, sourceRevision)
    );
    renderScorebook(snapshot, fixture);

    fireEvent.click(screen.getByRole('button', { name: 'Load recent private history' }));
    expect(await screen.findByText(/events 2206–2405 of 2405/i)).toBeInTheDocument();
    expect(fixture.loadPrivateHistory).toHaveBeenLastCalledWith(expect.objectContaining({ expectedRevision: sourceRevision }));
    expect(fixture.loadPrivateHistory.mock.calls[0]?.[0]).not.toHaveProperty('beforeSequence');

    fireEvent.click(screen.getByRole('button', { name: 'Load 200 older events' }));
    expect(await screen.findByText(/events 2006–2405 of 2405/i)).toBeInTheDocument();
    expect(fixture.loadPrivateHistory).toHaveBeenLastCalledWith(
      expect.objectContaining({ expectedRevision: sourceRevision, beforeSequence: 2_206 })
    );

    const search = screen.getByLabelText('Search loaded correction candidates');
    fireEvent.change(search, { target: { value: 'event-2050' } });
    expect(screen.getByText(/No loaded correction candidate matches “event-2050”/)).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'event-2051' } });
    expect(screen.getByText(/double · revision 2051/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Correction reason'), { target: { value: 'Change the older hit ruling.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Void effect' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Append this correction?' })).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));
    expect(fixture.createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'void_event',
        payload: { targetEventId: 'event-2051', reason: 'Change the older hit ruling.' }
      })
    );
  });

  it('preserves a verified current suffix when an older private-history block fails', async () => {
    const sourceRevision = 2_405;
    const snapshot = buildSnapshot({
      revision: sourceRevision,
      checkpointHash: checkpointForRevision(sourceRevision),
      completeness: { ...buildSnapshot().completeness, authoritativeRevision: sourceRevision }
    });
    const newestItems = Array.from({ length: 200 }, (_, index) => {
      const sequence = 2_206 + index;
      return buildPrivateEvent(`event-${sequence}`, sequence);
    });
    const fixture = createClient(snapshot);
    fixture.loadPrivateHistory.mockImplementation(
      async ({ beforeSequence }: Parameters<DiamondScorebookClient['loadPrivateHistoryWindow']>[0]) => {
        if (beforeSequence) throw new Error('Older page unavailable');
        return buildPrivateHistoryWindow(newestItems, sourceRevision);
      }
    );
    renderScorebook(snapshot, fixture);

    fireEvent.click(screen.getByRole('button', { name: 'Load recent private history' }));
    expect(await screen.findByText(/events 2206–2405 of 2405/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load 200 older events' }));

    expect(await screen.findByText(/Older page unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/events 2206–2405 of 2405/i)).toBeInTheDocument();
    expect(screen.getByTestId('diamond-private-history')).toBeInTheDocument();
  });

  it('requires a final-score confirmation before finalizing', async () => {
    const { createCommand, submitCommand } = renderScorebook();
    fireEvent.click(screen.getByRole('button', { name: 'Review final score' }));

    const dialog = screen.getByRole('dialog', { name: 'Confirm final score' });
    expect(dialog).toHaveTextContent('Wolves 2, Bears 3');
    expect(submitCommand).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(submitCommand).toHaveBeenCalledTimes(1));
    expect(createCommand).toHaveBeenCalledWith(expect.objectContaining({ type: 'finalize', payload: { confirmed: true } }));
  });

  it('renders a cancelled game as a terminal audit record with every scorer mutation closed', () => {
    renderScorebook(
      buildSnapshot({
        lifecycle: 'cancelled',
        readOnlyReason: null
      })
    );

    expect(screen.getByText('Cancelled · revision 7')).toBeInTheDocument();
    expect(screen.getByText('Cancelled game · scorebook closed')).toBeInTheDocument();
    expect(screen.getByText(/no plays, notes, corrections, handoffs, or AI publication can be added/i)).toBeInTheDocument();
    expect(screen.getByText('Scorebook closed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Single' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Private note' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Confirm handoff' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Review final score' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Official rules decision' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Post-game AI draft' })).not.toBeInTheDocument();
  });

  it('requires an accessible audited forfeit decision before finalizing a ready game', async () => {
    const snapshot = buildSnapshot({
      lifecycle: 'ready',
      rulesProfileId: 'baseball-obr@1',
      ruleCapabilities: { dpFlex: false, courtesyRunner: { pitcher: false, catcher: false } }
    });
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);

    const decisionPanel = screen.getByRole('region', { name: 'Official rules decision' });
    const ruling = within(decisionPanel).getByLabelText('Ruling');
    expect(Array.from((ruling as HTMLSelectElement).options).map((option) => option.value)).toEqual([
      'end_game_forfeit_home',
      'end_game_forfeit_away'
    ]);
    expect(screen.getByRole('button', { name: 'Review final score' })).toBeDisabled();
    fireEvent.change(ruling, { target: { value: 'end_game_forfeit_away' } });
    fireEvent.change(within(decisionPanel).getByLabelText('Official ruling description'), {
      target: { value: '  Tournament director awarded the game to the away side.  ' }
    });
    fireEvent.click(within(decisionPanel).getByRole('button', { name: 'Review rule decision' }));

    const decisionDialog = screen.getByRole('dialog', { name: /Confirm Forfeit.*award Wolves/i });
    expect(decisionDialog).toHaveAttribute('aria-modal', 'true');
    expect(decisionDialog).toHaveTextContent('does not finalize by itself');
    expect(fixture.submitCommand).not.toHaveBeenCalled();
    fireEvent.click(within(decisionDialog).getByRole('button', { name: 'Confirm' }));

    const finalDialog = await screen.findByRole('dialog', { name: 'Confirm final score' });
    expect(fixture.createCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'rules_decision',
        payload: {
          code: 'end_game_forfeit_away',
          description: 'Tournament director awarded the game to the away side.'
        }
      })
    );
    expect(finalDialog).toHaveTextContent('Wolves 2, Bears 3');
    fireEvent.click(within(finalDialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(2));
    expect(fixture.createCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'finalize', expectedRevision: 8, payload: { confirmed: true } })
    );
    expect(await screen.findByText(/Finalized by forfeit evidence/i)).toBeInTheDocument();
  });

  it('offers only profile-supported suspended endings and bounds the audited description', () => {
    const snapshot = buildSnapshot({ lifecycle: 'suspended', rulesProfileId: 'baseball-youth@1' });
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);

    const decisionPanel = screen.getByRole('region', { name: 'Official rules decision' });
    const ruling = within(decisionPanel).getByLabelText('Ruling') as HTMLSelectElement;
    expect(Array.from(ruling.options).map((option) => option.value)).toEqual([
      'end_game_time_limit',
      'end_game_weather',
      'end_game_forfeit_home',
      'end_game_forfeit_away'
    ]);
    expect(within(decisionPanel).getByText(/does not infer elapsed time/i)).toBeInTheDocument();
    expect(within(decisionPanel).getByText(/do not infer missing facts or automate advisory look-back/i)).toBeInTheDocument();
    const description = within(decisionPanel).getByLabelText('Official ruling description');
    fireEvent.change(description, { target: { value: 'x'.repeat(501) } });
    expect(within(decisionPanel).getByRole('button', { name: 'Review rule decision' })).toBeDisabled();
    expect(description).toHaveAttribute('maxlength', '500');
    expect(fixture.submitCommand).not.toHaveBeenCalled();
  });

  it('restores an accepted suspended ending from authoritative evidence and enables finalization after reload', () => {
    const snapshot = buildSnapshot({
      lifecycle: 'suspended',
      gameEndDecision: {
        reason: 'weather',
        decisionEventId: 'event-weather-ending',
        awardedSide: null
      }
    });
    renderScorebook(snapshot, createClient(snapshot));

    expect(screen.getByText(/Game ended for weather.*event-weather-ending/i)).toBeInTheDocument();
    expect(screen.getByText(/Audited weather ending recorded at.*event-weather-ending/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review final score' })).toBeEnabled();
  });

  it('records a run-cap ending without finalizing and exposes authoritative half-inning advance', async () => {
    const snapshot = buildSnapshot({ lifecycle: 'active', rulesProfileId: 'baseball-youth@1' });
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);

    const decisionPanel = screen.getByRole('region', { name: 'Official rules decision' });
    fireEvent.change(within(decisionPanel).getByLabelText('Ruling'), { target: { value: 'end_half_inning_run_limit' } });
    fireEvent.change(within(decisionPanel).getByLabelText('Official ruling description'), {
      target: { value: 'The umpire ended the half after the fifth run.' }
    });
    fireEvent.click(within(decisionPanel).getByRole('button', { name: 'Review rule decision' }));
    const dialog = screen.getByRole('dialog', { name: 'Confirm End half at 5-run cap?' });
    expect(dialog).toHaveTextContent('ends only the current half inning');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    const advance = await screen.findByRole('button', { name: 'Advance ended half inning to top 5' });
    expect(screen.queryByRole('dialog', { name: 'Confirm final score' })).not.toBeInTheDocument();
    expect(fixture.createCommand).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'rules_decision',
        payload: {
          code: 'end_half_inning_run_limit',
          description: 'The umpire ended the half after the fifth run.'
        }
      })
    );
    fireEvent.click(advance);
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(2));
    expect(fixture.createCommand).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: 'advance_half_inning', expectedRevision: 8, payload: {} })
    );
  });

  it('keeps a rejected rules decision visible and creates no follow-up finalization', async () => {
    const snapshot = buildSnapshot({ lifecycle: 'active', rulesProfileId: 'baseball-youth@1' });
    const fixture = createClient(snapshot);
    fixture.submitCommand.mockRejectedValueOnce(
      new DiamondScorebookError('invalid-input', 'The current half inning has not reached its 5-run limit.')
    );
    renderScorebook(snapshot, fixture);

    const decisionPanel = screen.getByRole('region', { name: 'Official rules decision' });
    fireEvent.change(within(decisionPanel).getByLabelText('Official ruling description'), {
      target: { value: 'Scorer attempted the run-cap ending.' }
    });
    fireEvent.click(within(decisionPanel).getByRole('button', { name: 'Review rule decision' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Confirm End half at 5-run cap?' })).getByRole('button', { name: 'Confirm' })
    );

    expect(await screen.findByText('The current half inning has not reached its 5-run limit.')).toBeInTheDocument();
    expect(fixture.submitCommand).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Confirm final score' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Advance ended half inning/ })).not.toBeInTheDocument();
  });

  it('queues an interrupted game-ending decision without opening a premature final confirmation', async () => {
    const snapshot = buildSnapshot({ lifecycle: 'active', rulesProfileId: 'baseball-youth@1' });
    const fixture = createClient(snapshot);
    vi.mocked(fixture.client.reconcileQueue).mockImplementation(() => new Promise(() => {}));
    fixture.submitCommand.mockRejectedValueOnce(
      new DiamondScorebookError('unavailable', 'The scorebook could not confirm this request.', { retryable: true })
    );
    renderScorebook(snapshot, fixture);

    const decisionPanel = screen.getByRole('region', { name: 'Official rules decision' });
    fireEvent.change(within(decisionPanel).getByLabelText('Ruling'), { target: { value: 'end_game_weather' } });
    fireEvent.change(within(decisionPanel).getByLabelText('Official ruling description'), {
      target: { value: 'Officials stopped the game for lightning.' }
    });
    fireEvent.click(within(decisionPanel).getByRole('button', { name: 'Review rule decision' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Confirm End game for weather or field conditions?' })).getByRole('button', {
        name: 'Confirm'
      })
    );

    await waitFor(() => expect(fixture.client.enqueue).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('diamond-connection-state')).toHaveTextContent(/Reconciling 1|Sync now/);
    expect(screen.queryByRole('dialog', { name: 'Confirm final score' })).not.toBeInTheDocument();
    expect(fixture.createCommand).toHaveBeenCalledTimes(1);
  });

  it('lets keyboard users dismiss an audited-decision confirmation without a write', () => {
    const fixture = createClient();
    renderScorebook(buildSnapshot(), fixture);
    const decisionPanel = screen.getByRole('region', { name: 'Official rules decision' });
    fireEvent.change(within(decisionPanel).getByLabelText('Ruling'), { target: { value: 'end_game_weather' } });
    fireEvent.change(within(decisionPanel).getByLabelText('Official ruling description'), {
      target: { value: 'Lightning ended play.' }
    });
    fireEvent.click(within(decisionPanel).getByRole('button', { name: 'Review rule decision' }));

    const dialog = screen.getByRole('dialog', { name: 'Confirm End game for weather or field conditions?' });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Confirm End game for weather or field conditions?' })).not.toBeInTheDocument();
    expect(fixture.submitCommand).not.toHaveBeenCalled();
  });

  it('requires a reason and a second confirmation to reopen a final game for append-only corrections', async () => {
    const snapshot = buildSnapshot({ lifecycle: 'final' });
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);

    expect(screen.getByRole('button', { name: 'Review correction reopening' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Correction reason'), {
      target: { value: '  Official scorer changed the hit to an error.  ' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Review correction reopening' }));

    const dialog = screen.getByRole('dialog', { name: 'Reopen for correction?' });
    expect(dialog).toHaveTextContent('Official scorer changed the hit to an error.');
    expect(dialog).toHaveTextContent('append-only');
    expect(fixture.submitCommand).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));
    expect(fixture.createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 7,
        type: 'reopen_for_correction',
        payload: { reason: 'Official scorer changed the hit to an error.' }
      })
    );
    expect(await screen.findByText('Correction · revision 8')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load recent private history' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Review final score' })).toBeEnabled();
  });

  it('shows post-game AI only for a final game and keeps generated drafts unpublished', async () => {
    const active = renderScorebook();
    expect(screen.queryByRole('heading', { name: 'Post-game AI draft' })).not.toBeInTheDocument();
    active.unmount();

    const snapshot = buildSnapshot({ lifecycle: 'final' });
    const fixture = createClient(snapshot);
    const packet = buildRecapSourcePacket();
    fixture.getRecapSource.mockResolvedValue({
      current: true,
      sourceRevision: 7,
      checkpointHash: checkpointForRevision(7),
      packet
    });
    const generateContent = vi.fn(async (_request: DiamondAiModelRequest) => JSON.stringify(buildRecapModelResponse()));
    renderScorebook(snapshot, fixture, { generateContent });

    fireEvent.click(screen.getByRole('button', { name: 'Generate AI draft' }));

    expect(await screen.findByText('The Bears completed a 3-2 win.')).toBeInTheDocument();
    expect(screen.getAllByText('event-7')[0]?.closest('li')).toHaveTextContent('event-7 · rev 7 · Bottom 7');
    expect(screen.getAllByText('fielding · partial').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('sensors · not collected').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Draft · unpublished/i)).toBeInTheDocument();
    expect(fixture.publishAiDraft).not.toHaveBeenCalled();
    expect(fixture.client.enqueue).not.toHaveBeenCalled();
    expect(generateContent.mock.calls[0]?.[0].prompt).not.toMatch(/actorUid|Coach Carter|Check Avery’s timing/i);
  });

  it('publishes a revision-pinned AI draft only after a separate explicit confirmation', async () => {
    const snapshot = buildSnapshot({ lifecycle: 'final' });
    const fixture = createClient(snapshot);
    const packet = buildRecapSourcePacket();
    fixture.getRecapSource.mockResolvedValue({
      current: true,
      sourceRevision: 7,
      checkpointHash: checkpointForRevision(7),
      packet
    });
    fixture.publishAiDraft.mockResolvedValue({
      published: true,
      current: true,
      sourceRevision: 7,
      checkpointHash: checkpointForRevision(7),
      publicationId: 'publication-7',
      publishedAt: '2026-09-05T12:00:00.000Z'
    });
    renderScorebook(snapshot, fixture, { generateContent: vi.fn(async () => JSON.stringify(buildRecapModelResponse())) });

    fireEvent.click(screen.getByRole('button', { name: 'Generate AI draft' }));
    await screen.findByText('The Bears completed a 3-2 win.');
    fireEvent.click(screen.getByRole('button', { name: 'Review publication' }));

    const dialog = screen.getByRole('dialog', { name: 'Publish AI recap?' });
    expect(dialog).toHaveTextContent('AI can be wrong');
    expect(dialog).toHaveTextContent('final revision 7');
    expect(fixture.publishAiDraft).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish recap' }));

    await waitFor(() => expect(fixture.publishAiDraft).toHaveBeenCalledTimes(1));
    expect(fixture.publishAiDraft).toHaveBeenCalledWith({
      requestId: '12345678-1234-4234-9234-123456789abc',
      teamId: 'team-1',
      gameId: 'game-1',
      sourceRevision: 7,
      checkpointHash: checkpointForRevision(7),
      draft: expect.objectContaining({
        sourceRevision: 7,
        draft: true,
        published: false,
        requiresPublicationConfirmation: true,
        mutatesState: false
      })
    });
    expect(await screen.findByText('Publication confirmed')).toBeInTheDocument();
    expect(screen.getByText(/publication-7 · revision 7/)).toBeInTheDocument();
  });

  it('discards a recap draft when the scorebook advances during generation', async () => {
    const snapshot = buildSnapshot({ lifecycle: 'final' });
    const fixture = createClient(snapshot);
    fixture.getRecapSource.mockResolvedValue({
      current: true,
      sourceRevision: 7,
      checkpointHash: checkpointForRevision(7),
      packet: buildRecapSourcePacket()
    });
    let resolveGeneration: (value: unknown) => void = () => {};
    const generateContent = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveGeneration = resolve;
        })
    );
    renderScorebook(snapshot, fixture, { generateContent });

    fireEvent.click(screen.getByRole('button', { name: 'Generate AI draft' }));
    await waitFor(() => expect(generateContent).toHaveBeenCalledTimes(1));
    (fixture.client.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      buildSnapshot({
        lifecycle: 'final',
        revision: 8,
        checkpointHash: checkpointForRevision(8),
        inning: { ...buildSnapshot().inning, number: 8 },
        completeness: { ...buildSnapshot().completeness, authoritativeRevision: 8 }
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh authoritative scorebook' }));
    await screen.findByText('Bottom 8');

    await act(async () => {
      resolveGeneration(JSON.stringify(buildRecapModelResponse()));
    });

    expect(await screen.findByText(/changed while AI was drafting revision 7/i)).toBeInTheDocument();
    expect(screen.queryByText('The Bears completed a 3-2 win.')).not.toBeInTheDocument();
    expect(fixture.publishAiDraft).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Generate AI draft' })).toBeEnabled();
  });

  it('leaves correction controls usable when post-game AI is unavailable', async () => {
    const snapshot = buildSnapshot({ lifecycle: 'final' });
    const fixture = createClient(snapshot);
    fixture.getRecapSource.mockResolvedValue({
      current: true,
      sourceRevision: 7,
      checkpointHash: checkpointForRevision(7),
      packet: buildRecapSourcePacket()
    });
    renderScorebook(snapshot, fixture, {
      generateContent: vi.fn(async () => {
        throw new Error('model unavailable');
      })
    });

    fireEvent.click(screen.getByRole('button', { name: 'Generate AI draft' }));

    expect(await screen.findByText(/correction controls remain available/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Correction reason')).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Generate AI draft' })).toBeEnabled();
    expect(fixture.publishAiDraft).not.toHaveBeenCalled();
  });

  it('rejects stale publication after a correction race without blocking correction controls', async () => {
    const snapshot = buildSnapshot({ lifecycle: 'final' });
    const fixture = createClient(snapshot);
    fixture.getRecapSource.mockResolvedValue({
      current: true,
      sourceRevision: 7,
      checkpointHash: checkpointForRevision(7),
      packet: buildRecapSourcePacket()
    });
    fixture.publishAiDraft.mockRejectedValue(
      new DiamondScorebookError('stale-revision', 'The game changed after this draft was prepared.', {
        authoritativeRevision: 8
      })
    );
    (fixture.client.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      buildSnapshot({
        lifecycle: 'correction',
        revision: 8,
        checkpointHash: checkpointForRevision(8),
        completeness: { ...buildSnapshot().completeness, authoritativeRevision: 8 }
      })
    );
    renderScorebook(snapshot, fixture, { generateContent: vi.fn(async () => JSON.stringify(buildRecapModelResponse())) });

    fireEvent.click(screen.getByRole('button', { name: 'Generate AI draft' }));
    await screen.findByText('The Bears completed a 3-2 win.');
    fireEvent.click(screen.getByRole('button', { name: 'Review publication' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Publish AI recap?' })).getByRole('button', { name: 'Publish recap' }));

    expect(await screen.findByText(/game changed after this draft was prepared/i)).toBeInTheDocument();
    expect(screen.queryByText('Publication confirmed')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Post-game AI draft' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load recent private history' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Review final score' })).toBeEnabled();
  });

  it('durably queues one offline command and keeps the displayed field authoritative', async () => {
    const fixture = createClient();
    renderScorebook(buildSnapshot(), fixture);
    fireEvent(window, new Event('offline'));
    await screen.findByText('Offline · 0 queued');

    fireEvent.click(screen.getByRole('button', { name: 'Walk' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Review Walk' })).getByRole('button', { name: 'Confirm play' }));

    await waitFor(() => expect(fixture.client.enqueue).toHaveBeenCalledTimes(1));
    expect(fixture.submitCommand).not.toHaveBeenCalled();
    expect(screen.getByText('Offline · 1 queued')).toBeInTheDocument();
    expect(screen.getByText(/Reconnect before entering another play/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Single' })).toBeDisabled();
  });

  it('fails a mutation closed when the current app build cannot be verified', async () => {
    const fixture = createClient();
    (fixture.client.resolveAppBuild as ReturnType<typeof vi.fn>).mockRejectedValue(
      new DiamondScorebookError('invalid-input', 'The hosted web build is unavailable.')
    );
    renderScorebook(buildSnapshot(), fixture);

    fireEvent.click(screen.getByRole('button', { name: 'Walk' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Review Walk' })).getByRole('button', { name: 'Confirm play' }));

    expect(await screen.findByText('The hosted web build is unavailable.')).toBeInTheDocument();
    expect(fixture.createCommand).not.toHaveBeenCalled();
    expect(fixture.submitCommand).not.toHaveBeenCalled();
    expect(fixture.client.enqueue).not.toHaveBeenCalled();
  });

  it('rejects a prepared mutation when the Diamond game instance changes during build verification', async () => {
    let finishBuild: ((value: number) => void) | null = null;
    const buildPending = new Promise<number>((resolve) => {
      finishBuild = resolve;
    });
    const fixture = createClient();
    (fixture.client.resolveAppBuild as ReturnType<typeof vi.fn>).mockReturnValue(buildPending);
    (fixture.client.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      buildSnapshot({ instanceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })
    );
    renderScorebook(buildSnapshot(), fixture);

    fireEvent.click(screen.getByRole('button', { name: 'Walk' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Review Walk' })).getByRole('button', { name: 'Confirm play' }));
    await waitFor(() => expect(fixture.client.resolveAppBuild).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh authoritative scorebook' }));
    await waitFor(() =>
      expect(fixture.client.readQueue).toHaveBeenLastCalledWith(
        expect.objectContaining({ instanceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })
      )
    );
    await act(async () => finishBuild?.(appBuild));

    expect(await screen.findByText(/game instance.*changed while preparing this command/i)).toBeInTheDocument();
    expect(fixture.createCommand).not.toHaveBeenCalled();
    expect(fixture.submitCommand).not.toHaveBeenCalled();
    expect(fixture.client.enqueue).not.toHaveBeenCalled();
  });

  it('turns dictation into an editable AI draft that cannot submit before confirmation', async () => {
    const fixture = createClient();
    const generateContent = vi.fn(async (_request: DiamondAiModelRequest) =>
      JSON.stringify({
        schemaVersion: 1,
        sourceRevision: 7,
        type: 'record_plate_appearance',
        payloadJson: JSON.stringify({
          batterId: 'batter-1',
          pitcherId: 'pitcher-1',
          result: 'single',
          batterAdvance: { to: 'first' },
          runnerAdvances: [{ runnerId: 'runner-3', from: 'third', to: 'home', cause: 'batted_ball' }],
          outsOnPlay: 0,
          runsBattedIn: 1
        }),
        confidence: 0.92,
        unresolvedQuestions: [],
        requiresConfirmation: true,
        mutatesState: false
      })
    );
    renderScorebook(buildSnapshot(), fixture, { generateContent });

    fireEvent.click(screen.getByRole('button', { name: /Dictate play/ }));
    fireEvent.click(screen.getByRole('button', { name: /Start dictation/ }));
    await waitFor(() => expect(screen.getByLabelText('Editable transcript')).toHaveValue('Single to left, Casey scored.'));
    fireEvent.change(screen.getByLabelText('Editable transcript'), { target: { value: 'Single to left. Casey scored; Jordan held.' } });
    fireEvent.click(screen.getByRole('button', { name: /Interpret play/ }));

    const review = await screen.findByRole('dialog', { name: 'Review Single' });
    expect(review).toHaveTextContent('AI can be wrong');
    expect(review).toHaveTextContent('AI confidence: 92%');
    expect(fixture.submitCommand).not.toHaveBeenCalled();
    expect(fixture.client.parseVoice).not.toHaveBeenCalled();
    fireEvent.click(within(review).getByRole('button', { name: 'Confirm play' }));

    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));
    const request = generateContent.mock.calls[0]?.[0];
    expect(request?.prompt).toContain('"sourceRevision":7');
    expect(request?.prompt).toContain('"currentBatterId":"batter-1"');
    expect(request?.prompt).toContain('"inning":4');
    expect(request?.prompt).toContain('"half":"bottom"');
    expect(request?.prompt).toContain('"outs":1');
    expect(request?.prompt).toContain('"balls":2');
    expect(request?.prompt).toContain('"strikes":1');
    expect(request?.prompt).toContain('"first":"runner-1"');
    expect(request?.prompt).toContain('"third":"runner-3"');
    expect(request?.prompt).toContain('"knownPlayerIds"');
    expect(request?.prompt).toContain('"event-7"');
    expect(request?.prompt).not.toContain('Avery Carter');
    expect(request?.prompt).not.toContain('Morgan Diaz');
    expect(request?.prompt).not.toContain('Coach Carter');
    expect(JSON.stringify(fixture.submitCommand.mock.calls[0]?.[0])).not.toMatch(/audio|transcript/i);
  });

  it('allows a voice-proposed counted run when a mixed multi-out play includes a possible tag third out', async () => {
    const fixture = createClient();
    const generateContent = vi.fn(async () =>
      JSON.stringify({
        schemaVersion: 1,
        sourceRevision: 7,
        type: 'record_plate_appearance',
        payloadJson: JSON.stringify({
          batterId: 'batter-1',
          pitcherId: 'pitcher-1',
          result: 'double_play',
          batterAdvance: { to: 'out', cause: 'batted_ball', outKind: 'batter_runner' },
          runnerAdvances: [
            { runnerId: 'runner-3', from: 'third', to: 'home', cause: 'batted_ball', countsRun: true, rbi: false },
            { runnerId: 'runner-1', from: 'first', to: 'out', cause: 'tag_out', outKind: 'tag' }
          ],
          outsOnPlay: 2,
          runsBattedIn: 0
        }),
        confidence: 0.96,
        unresolvedQuestions: [],
        requiresConfirmation: true,
        mutatesState: false
      })
    );
    renderScorebook(buildSnapshot(), fixture, { generateContent });

    fireEvent.click(screen.getByRole('button', { name: /Dictate play/ }));
    fireEvent.change(screen.getByLabelText('Editable transcript'), { target: { value: 'Double play, Casey scored before the tag.' } });
    fireEvent.click(screen.getByRole('button', { name: /Interpret play/ }));

    const review = await screen.findByRole('dialog', { name: 'Review Double play' });
    expect(within(review).queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(within(review).getByRole('button', { name: 'Confirm play' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));
    expect(fixture.createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'record_plate_appearance',
        payload: expect.objectContaining({
          runnerAdvances: expect.arrayContaining([
            expect.objectContaining({ runnerId: 'runner-3', to: 'home', countsRun: true }),
            expect.objectContaining({ runnerId: 'runner-1', to: 'out', outKind: 'tag' })
          ])
        })
      })
    );
  });

  it('binds a voice-proposed substitution to the same disclosed live-base transfer review', async () => {
    const snapshot = buildSnapshot({
      bases: {
        first: {
          playerId: 'batter-1',
          name: 'Avery Carter',
          number: '12',
          responsiblePitcherId: 'pitcher-1',
          courtesyForPlayerId: null,
          reachedOnEventId: 'event-6'
        },
        second: null,
        third: null
      }
    });
    const fixture = createClient(snapshot);
    const generateContent = vi.fn(async () =>
      JSON.stringify({
        schemaVersion: 1,
        sourceRevision: 7,
        type: 'substitute',
        payloadJson: JSON.stringify({
          side: 'home',
          battingSlot: 1,
          outgoingPlayerId: 'batter-1',
          incomingPlayerId: 'bench-home'
        }),
        confidence: 0.96,
        unresolvedQuestions: [],
        requiresConfirmation: true,
        mutatesState: false
      })
    );
    renderScorebook(snapshot, fixture, { generateContent });

    fireEvent.click(screen.getByRole('button', { name: /Dictate play/ }));
    fireEvent.change(screen.getByLabelText('Editable transcript'), { target: { value: 'Taylor runs for Avery.' } });
    fireEvent.click(screen.getByRole('button', { name: /Interpret play/ }));

    const review = await screen.findByRole('dialog', { name: 'Review substitute' });
    expect(review).toHaveTextContent(/first base transfer/i);
    expect(review).toHaveTextContent(/#12 Avery Carter.*#15 Taylor Gray/i);
    fireEvent.click(within(review).getByRole('button', { name: 'Confirm action' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));
    expect(fixture.createCommand.mock.calls[0]![0].payload).toEqual({
      side: 'home',
      battingSlot: 1,
      outgoingPlayerId: 'batter-1',
      incomingPlayerId: 'bench-home'
    });
  });

  it('rejects a voice-proposed substitute who already occupies a live batting-side base', async () => {
    const baseSnapshot = buildSnapshot();
    const snapshot = buildSnapshot({
      bases: {
        ...baseSnapshot.bases,
        second: {
          playerId: 'bench-home',
          name: 'Taylor Gray',
          number: '15',
          responsiblePitcherId: 'pitcher-1',
          courtesyForPlayerId: null,
          reachedOnEventId: 'event-6'
        }
      }
    });
    const fixture = createClient(snapshot);
    const generateContent = vi.fn(async () =>
      JSON.stringify({
        schemaVersion: 1,
        sourceRevision: 7,
        type: 'substitute',
        payloadJson: JSON.stringify({
          side: 'home',
          battingSlot: 1,
          outgoingPlayerId: 'batter-1',
          incomingPlayerId: 'bench-home'
        }),
        confidence: 0.96,
        unresolvedQuestions: [],
        requiresConfirmation: true,
        mutatesState: false
      })
    );
    renderScorebook(snapshot, fixture, { generateContent });

    fireEvent.click(screen.getByRole('button', { name: /Dictate play/ }));
    fireEvent.change(screen.getByLabelText('Editable transcript'), { target: { value: 'Taylor runs for Avery.' } });
    fireEvent.click(screen.getByRole('button', { name: /Interpret play/ }));

    expect(await screen.findByText(/proposed substitution does not match.*live bases/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Review substitute' })).not.toBeInTheDocument();
    expect(fixture.createCommand).not.toHaveBeenCalled();
    expect(fixture.submitCommand).not.toHaveBeenCalled();
  });

  it('keeps low-confidence AI interpretation in the transcript dialog with questions and no command', async () => {
    const fixture = createClient();
    const generateContent = vi.fn(async () =>
      JSON.stringify({
        schemaVersion: 1,
        sourceRevision: 7,
        type: 'record_plate_appearance',
        payloadJson: JSON.stringify({
          batterId: 'batter-1',
          pitcherId: 'pitcher-1',
          result: 'single',
          batterAdvance: { to: 'first' },
          runnerAdvances: [],
          outsOnPlay: 0
        }),
        confidence: 0.54,
        unresolvedQuestions: ['Did the runner from third score?'],
        requiresConfirmation: true,
        mutatesState: false
      })
    );
    renderScorebook(buildSnapshot(), fixture, { generateContent });

    fireEvent.click(screen.getByRole('button', { name: /Dictate play/ }));
    fireEvent.change(screen.getByLabelText('Editable transcript'), { target: { value: 'Avery singled and Casey moved.' } });
    fireEvent.click(screen.getByRole('button', { name: /Interpret play/ }));

    const dialog = await screen.findByRole('dialog', { name: /Speak, edit, then choose/i });
    expect(dialog).toHaveTextContent('Clarification needed · AI confidence 54%');
    expect(dialog).toHaveTextContent('Did the runner from third score?');
    expect(dialog).toHaveTextContent('No command has been created');
    expect(fixture.submitCommand).not.toHaveBeenCalled();
    expect(fixture.client.parseVoice).not.toHaveBeenCalled();
  });

  it('uses the confirmation-only server parser only when the AI model is unavailable', async () => {
    const fixture = createClient();
    (fixture.client.parseVoice as ReturnType<typeof vi.fn>).mockResolvedValue({
      schemaVersion: 1,
      type: 'record_pitch',
      payload: {
        batterId: 'batter-1',
        pitcherId: 'pitcher-1',
        result: 'called_strike'
      },
      confidence: 0.9,
      unresolvedFields: [],
      requiresConfirmation: true,
      mutatesState: false
    });
    const generateContent = vi.fn(async () => {
      throw new Error('model unavailable');
    });
    renderScorebook(buildSnapshot(), fixture, { generateContent });

    fireEvent.click(screen.getByRole('button', { name: /Dictate play/ }));
    fireEvent.change(screen.getByLabelText('Editable transcript'), { target: { value: 'Called strike.' } });
    fireEvent.click(screen.getByRole('button', { name: /Interpret play/ }));

    const review = await screen.findByRole('dialog', { name: /Review record pitch/i });
    expect(review).toHaveTextContent('AI confidence: 90%');
    expect(fixture.submitCommand).not.toHaveBeenCalled();
    expect(screen.getByText(/safe server parser prepared a draft/i)).toBeInTheDocument();
    fireEvent.click(within(review).getByRole('button', { name: 'Confirm action' }));

    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));
    expect(fixture.client.parseVoice).toHaveBeenCalledWith(
      expect.objectContaining({
        transcript: 'Called strike.',
        expectedRevision: 7
      })
    );
  });

  it('rejects an AI proposal when the authoritative scorebook advances during interpretation', async () => {
    const fixture = createClient();
    let resolveGeneration: (value: unknown) => void = () => {};
    const generateContent = vi.fn(
      () =>
        new Promise<unknown>((resolve) => {
          resolveGeneration = resolve;
        })
    );
    renderScorebook(buildSnapshot(), fixture, { generateContent });

    fireEvent.click(screen.getByRole('button', { name: /Dictate play/ }));
    fireEvent.change(screen.getByLabelText('Editable transcript'), { target: { value: 'Avery singled.' } });
    fireEvent.click(screen.getByRole('button', { name: /Interpret play/ }));
    await waitFor(() => expect(generateContent).toHaveBeenCalledTimes(1));

    (fixture.client.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      buildSnapshot({
        revision: 8,
        checkpointHash: checkpointForRevision(8),
        completeness: { ...buildSnapshot().completeness, authoritativeRevision: 8 }
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh authoritative scorebook' }));
    await screen.findByText('Live · revision 8');

    await act(async () => {
      resolveGeneration(
        JSON.stringify({
          schemaVersion: 1,
          sourceRevision: 7,
          type: 'record_plate_appearance',
          payloadJson: JSON.stringify({
            batterId: 'batter-1',
            pitcherId: 'pitcher-1',
            result: 'single',
            batterAdvance: { to: 'first' },
            runnerAdvances: [],
            outsOnPlay: 0
          }),
          confidence: 0.94,
          unresolvedQuestions: [],
          requiresConfirmation: true,
          mutatesState: false
        })
      );
    });

    expect(await screen.findByText(/scorebook advanced beyond revision 7/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Review Single' })).not.toBeInTheDocument();
    expect(fixture.submitCommand).not.toHaveBeenCalled();
    expect(fixture.client.parseVoice).not.toHaveBeenCalled();
  });

  it('keeps ordinary scoring controls usable when both interpretation helpers fail', async () => {
    const fixture = createClient();
    (fixture.client.parseVoice as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('parser unavailable'));
    const generateContent = vi.fn(async () => {
      throw new Error('model unavailable');
    });
    renderScorebook(buildSnapshot(), fixture, { generateContent });

    fireEvent.click(screen.getByRole('button', { name: /Dictate play/ }));
    fireEvent.change(screen.getByLabelText('Editable transcript'), { target: { value: 'Called strike.' } });
    fireEvent.click(screen.getByRole('button', { name: /Interpret play/ }));

    expect(await screen.findByText(/ordinary scoring controls are still available/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Single' })).toBeEnabled();
    expect(fixture.submitCommand).not.toHaveBeenCalled();
  });

  it('keeps private notes on a separate confirmed path and out of the public play list', async () => {
    const fixture = createClient();
    fixture.loadPrivateHistory.mockResolvedValue(buildPrivateHistoryWindow(buildPrivateHistoryItems(), 7));
    renderScorebook(buildSnapshot(), fixture);

    fireEvent.click(screen.getByRole('button', { name: 'Load recent private history' }));
    await screen.findByText(/Complete private history: 7 canonical events/);
    fireEvent.click(screen.getByRole('button', { name: 'Private note' }));
    fireEvent.change(screen.getByLabelText('Editable transcript'), { target: { value: 'Check Avery’s timing after the game.' } });
    fireEvent.click(screen.getByLabelText('Attach to the latest confirmed play'));
    fireEvent.click(screen.getByRole('button', { name: /Save privately/ }));

    await waitFor(() =>
      expect(fixture.savePrivateNote).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Check Avery’s timing after the game.',
          attachedEventId: 'event-7',
          leaseId: scorerLeaseId,
          expectedRevision: 7
        })
      )
    );
    expect(fixture.client.enqueue).not.toHaveBeenCalled();
    expect(screen.queryByText('Check Avery’s timing after the game.')).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Recent scorebook plays' })).queryByText(/timing after/i)).not.toBeInTheDocument();
  });

  it('presents the current scorer lease token when confirming a handoff', async () => {
    const fixture = createClient();
    renderScorebook(buildSnapshot(), fixture);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm handoff' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Hand off the scorebook?' })).getByRole('button', { name: 'Confirm' }));

    await waitFor(() =>
      expect(fixture.requestHandoff).toHaveBeenCalledWith(
        expect.objectContaining({
          leaseId: scorerLeaseId,
          expectedRevision: 7,
          toUid: 'coach-2'
        })
      )
    );
  });

  it('is fail-closed when another scorer owns the lease', () => {
    renderScorebook(
      buildSnapshot({
        lease: {
          status: 'held-by-other',
          canScore: false,
          canAcquire: false,
          canRecover: false,
          holderUid: 'coach-2',
          holderName: 'Coach Lee',
          leaseId: replacementScorerLeaseId,
          epoch: 2,
          expiresAt: null,
          eligibleScorers: []
        },
        readOnlyReason: 'Coach Lee has the active scoring lease.'
      })
    );

    expect(screen.getByText('Read only')).toBeInTheDocument();
    expect(screen.getByText('Coach Lee has the active scoring lease.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Single' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Private note' })).toBeDisabled();
    const liveDefense = screen.getByRole('group', { name: 'Live Wolves defense' });
    within(liveDefense)
      .getAllByRole('combobox')
      .forEach((control) => expect(control).toBeDisabled());
    expect(within(liveDefense).getByRole('button', { name: 'Review away defense change' })).toBeDisabled();

    const advancedPanel = screen.getByText('Full-mode advanced plays').closest('details');
    expect(advancedPanel).not.toBeNull();
    const historyButton = within(advancedPanel as HTMLElement).getByRole('button', { name: 'Load exact play targets' });
    expect(historyButton).toBeEnabled();
    const mutationControls = Array.from(
      (advancedPanel as HTMLElement).querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('button, input, select')
    ).filter((control) => control !== historyButton);
    expect(mutationControls.length).toBeGreaterThan(10);
    mutationControls.forEach((control) => expect(control).toBeDisabled());
  });

  it('starts a ready game explicitly while ordinary play controls stay locked', async () => {
    const snapshot = buildSnapshot({ lifecycle: 'ready' });
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);

    expect(screen.getByRole('button', { name: 'Single' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));

    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));
    expect(fixture.createCommand).toHaveBeenCalledWith(expect.objectContaining({ type: 'start', payload: {} }));
  });

  it('builds empty home and away lineups, preserves a secure manual ID through reorder, then unlocks Start', async () => {
    const snapshot = buildSnapshot({
      lifecycle: 'ready',
      currentBatter: null,
      currentPitcher: null,
      lineups: { home: [], away: [] },
      defense: { home: {}, away: {} },
      battingLineup: [],
      defensiveLineup: [],
      bases: { first: null, second: null, third: null }
    });
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);

    const start = screen.getByRole('button', { name: 'Start game' });
    expect(start).toBeDisabled();
    const away = screen.getByRole('group', { name: 'Away · Wolves' });
    fireEvent.change(within(away).getByLabelText('Add roster player to Wolves'), { target: { value: 'bench-away' } });
    fireEvent.click(within(away).getByRole('button', { name: 'Add' }));
    fireEvent.click(within(away).getByText('Add manual opponent/player'));
    fireEvent.change(within(away).getByLabelText('Name'), { target: { value: 'Guest Nine' } });
    fireEvent.change(within(away).getByLabelText('Number'), { target: { value: '9' } });
    fireEvent.click(within(away).getByRole('button', { name: 'Add manual player' }));
    fireEvent.click(within(away).getByRole('button', { name: 'Move Guest Nine up' }));

    const home = screen.getByRole('group', { name: 'Home · Bears' });
    fireEvent.change(within(home).getByLabelText('Add roster player to Bears'), { target: { value: 'batter-1' } });
    fireEvent.click(within(home).getByRole('button', { name: 'Add' }));

    fireEvent.click(within(away).getByRole('button', { name: 'Save away lineup' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1), { timeout: 5_000 });
    fireEvent.click(within(home).getByRole('button', { name: 'Save home lineup' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(2), { timeout: 5_000 });

    const lineupCalls = fixture.createCommand.mock.calls.map(([input]) => input).filter((input) => input.type === 'set_lineup');
    expect(lineupCalls).toEqual([
      expect.objectContaining({
        expectedRevision: 7,
        payload: {
          side: 'away',
          entries: [
            {
              slot: 1,
              playerId: 'manual:12345678-1234-4234-9234-123456789abc',
              displayName: 'Guest Nine',
              jerseyNumber: '9',
              starter: true,
              battingRole: 'regular'
            },
            {
              slot: 2,
              playerId: 'bench-away',
              displayName: 'Sam Ortiz',
              jerseyNumber: '10',
              starter: true,
              battingRole: 'regular'
            }
          ]
        }
      }),
      expect.objectContaining({
        expectedRevision: 8,
        payload: {
          side: 'home',
          entries: [
            {
              slot: 1,
              playerId: 'batter-1',
              displayName: 'Avery Carter',
              jerseyNumber: '12',
              starter: true,
              battingRole: 'regular'
            }
          ]
        }
      })
    ]);
    expect(fixture.client.createSecureId).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Start game' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Wolves P'), { target: { value: 'bench-away' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save away defense' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(3), { timeout: 5_000 });
    fireEvent.change(screen.getByLabelText('Bears P'), { target: { value: 'batter-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save home defense' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(4), { timeout: 5_000 });

    const defenseCalls = fixture.createCommand.mock.calls
      .map(([input]) => input)
      .filter((input) => input.type === 'set_defensive_alignment');
    expect(defenseCalls).toEqual([
      expect.objectContaining({
        expectedRevision: 9,
        payload: { side: 'away', assignments: [{ position: 'P', playerId: 'bench-away' }] }
      }),
      expect.objectContaining({
        expectedRevision: 10,
        payload: { side: 'home', assignments: [{ position: 'P', playerId: 'batter-1' }] }
      })
    ]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start game' })).toBeEnabled(), { timeout: 5_000 });
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(5), { timeout: 5_000 });
    expect(fixture.createCommand).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'start', expectedRevision: 11 }));
  });

  it('derives initial batting roles from the pinned profile and never offers FLEX as a batting slot', async () => {
    const baseball = buildSnapshot({
      lifecycle: 'ready',
      rulesProfileId: 'baseball-obr@1',
      ruleCapabilities: { dpFlex: false, courtesyRunner: { pitcher: false, catcher: false } }
    });
    const baseballFixture = createClient(baseball);
    const rendered = renderScorebook(baseball, baseballFixture);
    const baseballHome = screen.getByRole('group', { name: 'Home · Bears' });
    const dhRole = within(baseballHome).getByLabelText('Avery Carter batting role') as HTMLSelectElement;
    expect(Array.from(dhRole.options).map((option) => option.value)).toEqual(['regular', 'dh']);
    fireEvent.change(dhRole, { target: { value: 'dh' } });
    fireEvent.click(within(baseballHome).getByRole('button', { name: 'Save home lineup' }));
    await waitFor(() => expect(baseballFixture.submitCommand).toHaveBeenCalledTimes(1));
    expect(baseballFixture.createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'set_lineup',
        payload: expect.objectContaining({
          side: 'home',
          entries: expect.arrayContaining([expect.objectContaining({ playerId: 'batter-1', battingRole: 'dh' })])
        })
      })
    );
    rendered.unmount();

    const fastpitch = buildSnapshot({
      lifecycle: 'ready',
      rulesProfileId: 'fastpitch-youth@1',
      ruleCapabilities: { dpFlex: true, courtesyRunner: { pitcher: true, catcher: true } }
    });
    renderScorebook(fastpitch, createClient(fastpitch));
    const fastpitchHome = screen.getByRole('group', { name: 'Home · Bears' });
    const dpRole = within(fastpitchHome).getByLabelText('Avery Carter batting role') as HTMLSelectElement;
    expect(Array.from(dpRole.options).map((option) => option.value)).toEqual(['regular', 'dp', 'eh', 'ep']);
    expect(Array.from(dpRole.options).map((option) => option.value)).not.toContain('flex');
    expect(Array.from(dpRole.options).map((option) => option.value)).not.toContain('dh');
  });

  it('reviews runner-only Full-mode events with explicit partial-coverage omissions', async () => {
    const fixture = createClient();
    renderScorebook(buildSnapshot(), fixture);
    fireEvent.click(screen.getByText('Full-mode advanced plays'));
    const runnerTools = screen.getByRole('group', { name: 'Runner-only play' });
    fireEvent.change(within(runnerTools).getByLabelText('Event'), { target: { value: 'wild_pitch' } });
    fireEvent.click(within(runnerTools).getByRole('button', { name: 'Review runner event' }));

    const review = screen.getByRole('dialog', { name: 'Review wild pitch' });
    expect(fixture.submitCommand).not.toHaveBeenCalled();
    fireEvent.click(within(review).getByRole('button', { name: 'Confirm action' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));
    expect(fixture.createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'advance_runner',
        payload: {
          runnerId: 'runner-1',
          from: 'first',
          to: 'second',
          cause: 'wild_pitch',
          omissions: ['fielding', 'situational']
        }
      })
    );
  });

  it('exposes every reducer-supported pitch and plate-appearance result in Full mode', () => {
    renderScorebook();

    expect(
      within(screen.getByRole('group', { name: 'Pitch' }))
        .getAllByRole('button')
        .map((button) => button.textContent?.trim())
    ).toEqual([
      'Ball',
      'Called strike',
      'Swinging strike',
      'Foul',
      'Foul bunt',
      'In play',
      'Hit batter',
      'Catcher interference',
      'Illegal pitch',
      'Balk',
      'Pickoff attempt'
    ]);
    expect(
      within(screen.getByRole('group', { name: 'Plate appearance' }))
        .getAllByRole('button')
        .map((button) => button.textContent?.trim())
    ).toEqual([
      'Single',
      'Double',
      'Triple',
      'Home run',
      'Walk',
      'Intentional walk',
      'Hit by pitch',
      'Strikeout',
      'Ground out',
      'Fly out',
      'Line out',
      'Reached on error',
      "Fielder's choice",
      'Sac bunt',
      'Sac fly',
      'Interference',
      'Dropped third strike',
      'Double play',
      'Triple play'
    ]);
  });

  it('places the required previous batter for a tiebreaker through a reducer-accepted UI command', async () => {
    const snapshot = buildSnapshot({
      inning: { number: 7, half: 'top', outs: 0, balls: 0, strikes: 0, pitchesInPlateAppearance: 0 },
      bases: { first: null, second: null, third: null },
      currentPitcher: { playerId: 'batter-1', name: 'Avery Carter', number: '12' },
      lineups: {
        home: buildSnapshot().lineups.home,
        away: [
          { playerId: 'pitcher-1', name: 'Morgan Diaz', number: '7', slot: 1 },
          { playerId: 'fielder-2', name: 'Riley Chen', number: '2', slot: 2 }
        ]
      },
      nextBatterSlot: { home: 0, away: 0 }
    });
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);

    expect(screen.getByText(/Riley Chen .* previous scheduled batter/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm tiebreaker runner' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));
    expect(fixture.createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'place_tiebreaker_runner',
        payload: { side: 'away', runnerId: 'fielder-2', base: 'second', chargedToPitcherId: 'batter-1' }
      })
    );

    const uiPayload = fixture.createCommand.mock.calls[0]![0].payload as unknown as DiamondCommandPayloadMap['place_tiebreaker_runner'];
    const startingState = buildReducerStateForUiSnapshot();
    const reduced = reduceDiamondEvent(
      {
        ...startingState,
        inning: {
          ...startingState.inning,
          number: 7,
          half: 'top',
          outs: 0,
          balls: 0,
          strikes: 0,
          pitchesInPlateAppearance: 0,
          lastPitchResult: null
        },
        bases: { first: null, second: null, third: null },
        nextBatterSlot: { home: 0, away: 0 }
      },
      { type: 'place_tiebreaker_runner', eventId: 'ui-tiebreaker', payload: uiPayload }
    );
    expect(reduced.bases.second).toMatchObject({
      runnerId: 'fielder-2',
      chargedToPitcherId: 'batter-1',
      courtesyForPlayerId: null,
      reachedOnEventId: 'ui-tiebreaker'
    });
  });

  it('fails the tiebreaker placement closed when the authoritative current pitcher is missing', () => {
    const snapshot = buildSnapshot({
      inning: { number: 7, half: 'top', outs: 0, balls: 0, strikes: 0, pitchesInPlateAppearance: 0 },
      bases: { first: null, second: null, third: null },
      currentPitcher: null,
      lineups: {
        home: buildSnapshot().lineups.home,
        away: [
          { playerId: 'pitcher-1', name: 'Morgan Diaz', number: '7', slot: 1 },
          { playerId: 'fielder-2', name: 'Riley Chen', number: '2', slot: 2 }
        ]
      },
      nextBatterSlot: { home: 0, away: 0 }
    });
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);

    expect(screen.getByRole('button', { name: 'Confirm tiebreaker runner' })).toBeDisabled();
    expect(fixture.createCommand).not.toHaveBeenCalled();
  });

  it('reviews and submits a complete same-personnel live defensive swap without changing lineup history', async () => {
    const snapshot = buildSnapshot();
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);

    const defense = screen.getByRole('group', { name: 'Live Wolves defense' });
    const pitcher = within(defense).getByLabelText('Live Wolves P') as HTMLSelectElement;
    const catcher = within(defense).getByLabelText('Live Wolves C') as HTMLSelectElement;
    expect(Array.from(pitcher.options).map((option) => option.value)).toEqual(['pitcher-1', 'fielder-2']);
    expect(Array.from(pitcher.options).map((option) => option.value)).not.toContain('bench-away');
    expect(within(defense).getByRole('button', { name: 'Review away defense change' })).toBeDisabled();

    fireEvent.change(pitcher, { target: { value: 'fielder-2' } });
    expect(pitcher).toHaveValue('fielder-2');
    expect(catcher).toHaveValue('pitcher-1');
    fireEvent.click(within(defense).getByRole('button', { name: 'Review away defense change' }));

    expect(fixture.createCommand).not.toHaveBeenCalled();
    const review = screen.getByRole('dialog', { name: 'Review Wolves defensive alignment' });
    const reviewedAssignments = within(review).getByRole('list', { name: 'Complete Wolves defensive alignment' });
    expect(within(reviewedAssignments).getByText('P · #2 Riley Chen')).toBeInTheDocument();
    expect(within(reviewedAssignments).getByText('C · #7 Morgan Diaz')).toBeInTheDocument();
    fireEvent.click(within(review).getByRole('button', { name: 'Cancel' }));
    expect(fixture.createCommand).not.toHaveBeenCalled();

    fireEvent.click(within(defense).getByRole('button', { name: 'Review away defense change' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Review Wolves defensive alignment' })).getByRole('button', {
        name: 'Confirm action'
      })
    );

    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));
    expect(fixture.createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'set_defensive_alignment',
        expectedRevision: 7,
        leaseId: scorerLeaseId,
        payload: {
          side: 'away',
          assignments: [
            { position: 'P', playerId: 'fielder-2' },
            { position: 'C', playerId: 'pitcher-1' }
          ]
        }
      })
    );

    const uiPayload = fixture.createCommand.mock.calls[0]![0].payload as unknown as DiamondCommandPayloadMap['set_defensive_alignment'];
    const startingState = buildReducerStateForUiSnapshot();
    const reduced = reduceDiamondEvent(startingState, {
      type: 'set_defensive_alignment',
      eventId: 'ui-defense-swap',
      payload: uiPayload
    });
    expect(reduced.lineups.away.defense).toEqual({ P: 'fielder-2', C: 'pitcher-1' });
    expect(reduced.lineups.away.battingOrder).toEqual(startingState.lineups.away.battingOrder);
    expect(reduced.lineups.away.dpFlex).toEqual(startingState.lineups.away.dpFlex);
  });

  it('targets only the side currently fielding for a live defensive swap', () => {
    const snapshot = buildSnapshot({
      inning: { ...buildSnapshot().inning, half: 'top' },
      currentPitcher: { playerId: 'batter-1', name: 'Avery Carter', number: '12' },
      defense: {
        home: {
          P: { playerId: 'batter-1', name: 'Avery Carter', number: '12' },
          SS: { playerId: 'runner-1', name: 'Jordan Lee', number: '8' }
        },
        away: buildSnapshot().defense.away
      }
    });
    renderScorebook(snapshot, createClient(snapshot));

    expect(screen.getByRole('group', { name: 'Live Bears defense' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Live Wolves defense' })).not.toBeInTheDocument();
  });

  it('expires a live defensive review when the authoritative revision or lease changes', async () => {
    const snapshot = buildSnapshot();
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);
    const defense = screen.getByRole('group', { name: 'Live Wolves defense' });
    fireEvent.change(within(defense).getByLabelText('Live Wolves P'), { target: { value: 'fielder-2' } });
    fireEvent.click(within(defense).getByRole('button', { name: 'Review away defense change' }));
    expect(screen.getByRole('dialog', { name: 'Review Wolves defensive alignment' })).toBeInTheDocument();

    (fixture.client.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      buildSnapshot({
        revision: 8,
        checkpointHash: checkpointForRevision(8),
        completeness: { ...snapshot.completeness, authoritativeRevision: 8 }
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Refresh authoritative scorebook' }));

    expect(await screen.findByText(/defensive alignment review expired.*revision or scoring lease changed/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Review Wolves defensive alignment' })).not.toBeInTheDocument();
    expect(fixture.createCommand).not.toHaveBeenCalled();
    expect(fixture.submitCommand).not.toHaveBeenCalled();
  });

  it.each([
    [
      'lease ownership',
      {
        lease: {
          status: 'held-by-other' as const,
          canScore: false,
          canAcquire: false,
          canRecover: false,
          holderUid: 'coach-2',
          holderName: 'Coach Lee',
          leaseId: replacementScorerLeaseId,
          epoch: 2,
          expiresAt: null,
          eligibleScorers: []
        }
      }
    ],
    ['snapshot authority', { authoritative: false }],
    [
      'defensive map',
      {
        defense: {
          home: buildSnapshot().defense.home,
          away: {
            P: { playerId: 'fielder-2', name: 'Riley Chen', number: '2' },
            C: { playerId: 'pitcher-1', name: 'Morgan Diaz', number: '7' }
          }
        }
      }
    ],
    [
      'defensive personnel',
      {
        defense: {
          home: buildSnapshot().defense.home,
          away: {
            P: { playerId: 'pitcher-1', name: 'Morgan Diaz', number: '7' },
            C: { playerId: 'bench-away', name: 'Sam Ortiz', number: '10' }
          }
        }
      }
    ]
  ])('expires a pending live defensive review after a same-revision %s change', async (_label, overrides) => {
    const snapshot = buildSnapshot();
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);
    const defense = screen.getByRole('group', { name: 'Live Wolves defense' });
    fireEvent.change(within(defense).getByLabelText('Live Wolves P'), { target: { value: 'fielder-2' } });
    fireEvent.click(within(defense).getByRole('button', { name: 'Review away defense change' }));

    (fixture.client.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce(buildSnapshot(overrides));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh authoritative scorebook' }));

    expect(await screen.findByText(/defensive alignment review expired.*revision or scoring lease changed/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Review Wolves defensive alignment' })).not.toBeInTheDocument();
    expect(fixture.createCommand).not.toHaveBeenCalled();
    expect(fixture.submitCommand).not.toHaveBeenCalled();
  });

  it('expires a pending live defensive review when the authenticated scorer changes', async () => {
    const snapshot = buildSnapshot();
    const fixture = createClient(snapshot);
    const rendered = render(
      <MemoryRouter>
        <DiamondScorebook auth={auth} teamId="team-1" gameId="game-1" initialSnapshot={snapshot} client={fixture.client} />
      </MemoryRouter>
    );
    const defense = screen.getByRole('group', { name: 'Live Wolves defense' });
    fireEvent.change(within(defense).getByLabelText('Live Wolves P'), { target: { value: 'fielder-2' } });
    fireEvent.click(within(defense).getByRole('button', { name: 'Review away defense change' }));

    const changedAuth: AuthState = {
      ...auth,
      user: { ...auth.user!, uid: 'coach-2', email: 'lee@example.com', displayName: 'Coach Lee' }
    };
    rendered.rerender(
      <MemoryRouter>
        <DiamondScorebook auth={changedAuth} teamId="team-1" gameId="game-1" initialSnapshot={snapshot} client={fixture.client} />
      </MemoryRouter>
    );

    expect(await screen.findByText(/defensive alignment review expired.*revision or scoring lease changed/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Review Wolves defensive alignment' })).not.toBeInTheDocument();
    expect(fixture.createCommand).not.toHaveBeenCalled();
    expect(fixture.submitCommand).not.toHaveBeenCalled();
  });

  it('keeps a rejected live defensive review available for an explicit retry', async () => {
    const snapshot = buildSnapshot();
    const fixture = createClient(snapshot);
    fixture.submitCommand.mockRejectedValueOnce(new DiamondScorebookError('invalid-input', 'Alignment rejected.'));
    renderScorebook(snapshot, fixture);
    const defense = screen.getByRole('group', { name: 'Live Wolves defense' });
    fireEvent.change(within(defense).getByLabelText('Live Wolves P'), { target: { value: 'fielder-2' } });
    fireEvent.click(within(defense).getByRole('button', { name: 'Review away defense change' }));
    const review = screen.getByRole('dialog', { name: 'Review Wolves defensive alignment' });
    fireEvent.click(within(review).getByRole('button', { name: 'Confirm action' }));

    expect(await screen.findByText('Alignment rejected.')).toBeInTheDocument();
    expect(review).toBeInTheDocument();
    expect(fixture.client.enqueue).not.toHaveBeenCalled();

    fireEvent.click(within(review).getByRole('button', { name: 'Confirm action' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('dialog', { name: 'Review Wolves defensive alignment' })).not.toBeInTheDocument();
  });

  it('queues one offline defensive swap, locks later scoring, and reconciles in order', async () => {
    const snapshot = buildSnapshot();
    const fixture = createClient(snapshot);
    const reconciled = buildSnapshot({
      revision: 8,
      checkpointHash: checkpointForRevision(8),
      currentPitcher: { playerId: 'fielder-2', name: 'Riley Chen', number: '2' },
      defense: {
        ...snapshot.defense,
        away: {
          P: { playerId: 'fielder-2', name: 'Riley Chen', number: '2' },
          C: { playerId: 'pitcher-1', name: 'Morgan Diaz', number: '7' }
        }
      },
      completeness: { ...snapshot.completeness, authoritativeRevision: 8 }
    });
    renderScorebook(snapshot, fixture);
    fireEvent(window, new Event('offline'));
    await screen.findByText('Offline · 0 queued');

    const defense = screen.getByRole('group', { name: 'Live Wolves defense' });
    fireEvent.change(within(defense).getByLabelText('Live Wolves P'), { target: { value: 'fielder-2' } });
    fireEvent.click(within(defense).getByRole('button', { name: 'Review away defense change' }));
    const confirm = within(screen.getByRole('dialog', { name: 'Review Wolves defensive alignment' })).getByRole('button', {
      name: 'Confirm action'
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(fixture.client.enqueue).toHaveBeenCalledTimes(1));
    expect(fixture.createCommand).toHaveBeenCalledTimes(1);
    expect(fixture.submitCommand).not.toHaveBeenCalled();
    expect(screen.getByText('Offline · 1 queued')).toBeInTheDocument();
    expect(within(defense).getByLabelText('Live Wolves P')).toHaveValue('pitcher-1');
    expect(screen.getByRole('button', { name: 'Single' })).toBeDisabled();
    expect(within(defense).getByRole('button', { name: 'Review away defense change' })).toBeDisabled();

    (fixture.client.reconcileQueue as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      accepted: 1,
      duplicates: 0,
      remaining: [],
      lastSnapshot: reconciled
    });
    (fixture.client.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce(reconciled);
    fireEvent(window, new Event('online'));

    await waitFor(() => expect(fixture.client.reconcileQueue).toHaveBeenCalledTimes(1));
    await screen.findByText('Live · revision 8');
    await waitFor(() =>
      expect(within(screen.getByRole('group', { name: 'Live Wolves defense' })).getByLabelText('Live Wolves P')).toHaveValue('fielder-2')
    );
  });

  it.each([
    ['a completed third-out half', { inning: { ...buildSnapshot().inning, outs: 3 } }],
    ['an explicit half-ending decision', { halfInningEnd: { reason: 'run-limit' as const, decisionEventId: 'event-7' } }],
    ['a game-ending decision', { gameEndDecision: { reason: 'time-limit' as const, decisionEventId: 'event-7', awardedSide: null } }],
    [
      'an automatic walkoff ending',
      {
        score: { home: 4, away: 3 },
        inning: { number: 7, half: 'bottom' as const, outs: 1, balls: 0, strikes: 0, pitchesInPlateAppearance: 0 }
      }
    ]
  ])('does not offer live defense changes during %s', (_label, overrides) => {
    const snapshot = buildSnapshot(overrides);
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);

    expect(screen.queryByRole('group', { name: /Live .* defense/ })).not.toBeInTheDocument();
    expect(fixture.createCommand).not.toHaveBeenCalled();
  });

  it('offers a courtesy runner only when the recorded pitcher or catcher occupies the selected base', async () => {
    const unavailable = renderScorebook();
    fireEvent.click(screen.getByText('Full-mode advanced plays'));
    const unavailableCourtesy = screen.getByRole('group', { name: 'Courtesy runner' });
    expect(within(unavailableCourtesy).getByLabelText('Occupied base')).toBeDisabled();
    expect(within(unavailableCourtesy).getByText('Recorded P is not on base')).toBeInTheDocument();
    expect(within(unavailableCourtesy).getByRole('button', { name: 'Review courtesy runner' })).toBeDisabled();
    unavailable.unmount();

    const snapshot = buildSnapshot({
      bases: {
        first: {
          playerId: 'batter-1',
          name: 'Avery Carter',
          number: '12',
          responsiblePitcherId: 'pitcher-1',
          courtesyForPlayerId: null,
          reachedOnEventId: 'event-6'
        },
        second: null,
        third: null
      }
    });
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);
    fireEvent.click(screen.getByText('Full-mode advanced plays'));
    const courtesy = screen.getByRole('group', { name: 'Courtesy runner' });
    expect(within(courtesy).getByLabelText('Occupied base')).toHaveValue('first');
    fireEvent.change(within(courtesy).getByLabelText('Runner'), { target: { value: 'bench-home' } });
    fireEvent.click(within(courtesy).getByRole('button', { name: 'Review courtesy runner' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Review courtesy runner' })).getByRole('button', { name: 'Confirm action' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));

    const uiPayload = fixture.createCommand.mock.calls[0]![0].payload as unknown as DiamondCommandPayloadMap['add_courtesy_runner'];
    expect(uiPayload).toEqual({
      side: 'home',
      forPlayerId: 'batter-1',
      runnerId: 'bench-home',
      base: 'first',
      forRole: 'pitcher'
    });
    const startingState = buildReducerStateForUiSnapshot();
    const reduced = reduceDiamondEvent(
      {
        ...startingState,
        bases: {
          first: {
            runnerId: 'batter-1',
            chargedToPitcherId: 'pitcher-1',
            courtesyForPlayerId: null,
            reachedOnEventId: 'event-6'
          },
          second: null,
          third: null
        }
      },
      { type: 'add_courtesy_runner', eventId: 'ui-courtesy', payload: uiPayload }
    );
    expect(reduced.bases.first).toMatchObject({ runnerId: 'bench-home', courtesyForPlayerId: 'batter-1' });
  });

  it('provides confirmed substitution and structured fielding fallback commands', async () => {
    const fixture = createClient();
    fixture.loadPrivateHistory.mockImplementation(async ({ expectedRevision }) =>
      buildPrivateHistoryWindow(buildPrivateHistoryItems(expectedRevision), expectedRevision)
    );
    renderScorebook(buildSnapshot(), fixture);
    fireEvent.click(screen.getByText('Full-mode advanced plays'));

    const substitution = screen.getByRole('group', { name: 'Substitution' });
    fireEvent.change(within(substitution).getByLabelText('Incoming'), { target: { value: 'bench-home' } });
    fireEvent.click(within(substitution).getByRole('button', { name: 'Review substitution' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Review substitution' })).getByRole('button', { name: 'Confirm action' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));
    expect(fixture.createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'substitute',
        payload: {
          side: 'home',
          battingSlot: 1,
          outgoingPlayerId: 'batter-1',
          incomingPlayerId: 'bench-home'
        }
      })
    );

    const structured = screen.getByRole('group', { name: 'Structured fielding or scoring judgment' });
    fireEvent.click(within(structured).getByRole('button', { name: 'Load exact play targets' }));
    await waitFor(() => expect(within(structured).getByLabelText('Effective play')).toHaveValue('event-7'));
    fireEvent.change(within(structured).getByLabelText('Putout'), { target: { value: 'fielder-2' } });
    fireEvent.click(within(structured).getByRole('button', { name: 'Review fielding detail' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Review fielding detail' })).getByRole('button', { name: 'Confirm action' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(2));
    expect(fixture.createCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'record_fielding',
        payload: { playEventId: 'event-7', fielding: { putoutBy: 'fielder-2' } }
      })
    );
  });

  it('excludes batting-side substitute and re-entry candidates already occupying a live base without cross-team ID leakage', () => {
    const baseSnapshot = buildSnapshot();
    const snapshot = buildSnapshot({
      bases: {
        first: {
          playerId: 'bench-away',
          name: 'Local ID collision',
          number: null,
          responsiblePitcherId: 'pitcher-1',
          courtesyForPlayerId: null,
          reachedOnEventId: 'event-4'
        },
        second: {
          playerId: 'bench-home',
          name: 'Taylor Gray',
          number: '15',
          responsiblePitcherId: 'pitcher-1',
          courtesyForPlayerId: null,
          reachedOnEventId: 'event-5'
        },
        third: {
          playerId: 'batter-1',
          name: 'Avery Carter',
          number: '12',
          responsiblePitcherId: 'pitcher-1',
          courtesyForPlayerId: null,
          reachedOnEventId: 'event-6'
        }
      },
      lineups: {
        away: baseSnapshot.lineups.away,
        home: [
          {
            playerId: 'runner-3',
            name: 'Casey Kim',
            number: '4',
            slot: 1,
            active: true,
            starterPlayerId: 'batter-1',
            starterReentriesUsed: 0,
            substitutions: ['runner-3']
          },
          baseSnapshot.lineups.home[1]!
        ]
      }
    });
    renderScorebook(snapshot, createClient(snapshot));
    fireEvent.click(screen.getByText('Full-mode advanced plays'));

    const substitution = screen.getByRole('group', { name: 'Substitution' });
    const incoming = within(substitution).getByLabelText('Incoming');
    expect(within(incoming).queryByRole('option', { name: '#15 Taylor Gray' })).not.toBeInTheDocument();
    expect(within(substitution).getByRole('button', { name: 'Review starter re-entry' })).toBeDisabled();

    fireEvent.change(within(substitution).getByLabelText('Side'), { target: { value: 'away' } });
    expect(within(within(substitution).getByLabelText('Incoming')).getByRole('option', { name: '#10 Sam Ortiz' })).toBeInTheDocument();
  });

  it('discloses a reducer-derived batting-side base transfer without adding it to the substitution payload', async () => {
    const snapshot = buildSnapshot({
      bases: {
        first: {
          playerId: 'batter-1',
          name: 'Avery Carter',
          number: '12',
          responsiblePitcherId: 'pitcher-1',
          courtesyForPlayerId: null,
          reachedOnEventId: 'event-6'
        },
        second: null,
        third: null
      }
    });
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);
    fireEvent.click(screen.getByText('Full-mode advanced plays'));

    const substitution = screen.getByRole('group', { name: 'Substitution' });
    fireEvent.change(within(substitution).getByLabelText('Incoming'), { target: { value: 'bench-home' } });
    fireEvent.click(within(substitution).getByRole('button', { name: 'Review substitution' }));

    const review = screen.getByRole('dialog', { name: 'Review substitution' });
    expect(review).toHaveTextContent(/first base transfer/i);
    expect(review).toHaveTextContent(/#12 Avery Carter.*#15 Taylor Gray/i);
    expect(review).toHaveTextContent(/pitcher responsibility.*courtesy.*reach-event/i);
    fireEvent.click(within(review).getByRole('button', { name: 'Confirm action' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));

    expect(fixture.createCommand.mock.calls[0]![0].payload).toEqual({
      side: 'home',
      battingSlot: 1,
      outgoingPlayerId: 'batter-1',
      incomingPlayerId: 'bench-home'
    });
  });

  it.each([
    [
      'revision',
      (snapshot: DiamondScorebookSnapshot) => ({
        ...snapshot,
        revision: 8,
        checkpointHash: checkpointForRevision(8),
        completeness: { ...snapshot.completeness, authoritativeRevision: 8 }
      })
    ],
    [
      'base responsibility',
      (snapshot: DiamondScorebookSnapshot) => ({
        ...snapshot,
        bases: {
          ...snapshot.bases,
          first: snapshot.bases.first ? { ...snapshot.bases.first, responsiblePitcherId: 'pitcher-2' } : null
        }
      })
    ]
  ])('expires a pending substitution review after a stale %s change', async (_label, updateSnapshot) => {
    const snapshot = buildSnapshot({
      bases: {
        first: {
          playerId: 'batter-1',
          name: 'Avery Carter',
          number: '12',
          responsiblePitcherId: 'pitcher-1',
          courtesyForPlayerId: null,
          reachedOnEventId: 'event-6'
        },
        second: null,
        third: null
      }
    });
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);
    fireEvent.click(screen.getByText('Full-mode advanced plays'));
    const substitution = screen.getByRole('group', { name: 'Substitution' });
    fireEvent.change(within(substitution).getByLabelText('Incoming'), { target: { value: 'bench-home' } });
    fireEvent.click(within(substitution).getByRole('button', { name: 'Review substitution' }));

    (fixture.client.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce(updateSnapshot(snapshot));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh authoritative scorebook' }));

    expect(await screen.findByText(/substitution review expired.*revision or live base state changed/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Review substitution' })).not.toBeInTheDocument();
    expect(fixture.createCommand).not.toHaveBeenCalled();
    expect(fixture.submitCommand).not.toHaveBeenCalled();
  });

  it('rechecks the live-base fingerprint after asynchronous build verification and before command creation', async () => {
    const snapshot = buildSnapshot({
      bases: {
        first: {
          playerId: 'batter-1',
          name: 'Avery Carter',
          number: '12',
          responsiblePitcherId: 'pitcher-1',
          courtesyForPlayerId: null,
          reachedOnEventId: 'event-6'
        },
        second: null,
        third: null
      }
    });
    let finishBuild: ((value: number) => void) | null = null;
    const buildPending = new Promise<number>((resolve) => {
      finishBuild = resolve;
    });
    const fixture = createClient(snapshot);
    (fixture.client.resolveAppBuild as ReturnType<typeof vi.fn>).mockReturnValue(buildPending);
    renderScorebook(snapshot, fixture);
    fireEvent.click(screen.getByText('Full-mode advanced plays'));
    const substitution = screen.getByRole('group', { name: 'Substitution' });
    fireEvent.change(within(substitution).getByLabelText('Incoming'), { target: { value: 'bench-home' } });
    fireEvent.click(within(substitution).getByRole('button', { name: 'Review substitution' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Review substitution' })).getByRole('button', { name: 'Confirm action' }));
    await waitFor(() => expect(fixture.client.resolveAppBuild).toHaveBeenCalledTimes(1));

    (fixture.client.load as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...snapshot,
      bases: {
        ...snapshot.bases,
        first: snapshot.bases.first ? { ...snapshot.bases.first, reachedOnEventId: 'event-7-other' } : null
      }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh authoritative scorebook' }));
    await waitFor(() => expect(fixture.client.load).toHaveBeenCalledTimes(1));
    await act(async () => finishBuild?.(appBuild));

    expect(await screen.findByText(/substitution review expired.*live base state changed/i)).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Review substitution' })).not.toBeInTheDocument();
    expect(fixture.createCommand).not.toHaveBeenCalled();
    expect(fixture.submitCommand).not.toHaveBeenCalled();
    expect(fixture.client.enqueue).not.toHaveBeenCalled();
  });

  it('ignores retained left-on-base placements for a between-innings substitution', () => {
    const baseSnapshot = buildSnapshot();
    const snapshot = buildSnapshot({
      inning: { ...baseSnapshot.inning, outs: 3 },
      bases: {
        first: {
          playerId: 'bench-home',
          name: 'Taylor Gray',
          number: '15',
          responsiblePitcherId: 'pitcher-1',
          courtesyForPlayerId: null,
          reachedOnEventId: 'event-6'
        },
        second: null,
        third: null
      }
    });
    renderScorebook(snapshot, createClient(snapshot));
    fireEvent.click(screen.getByText('Full-mode advanced plays'));

    const substitution = screen.getByRole('group', { name: 'Substitution' });
    expect(within(within(substitution).getByLabelText('Incoming')).getByRole('option', { name: '#15 Taylor Gray' })).toBeInTheDocument();
    fireEvent.change(within(substitution).getByLabelText('Incoming'), { target: { value: 'bench-home' } });
    fireEvent.click(within(substitution).getByRole('button', { name: 'Review substitution' }));
    expect(screen.getByRole('dialog', { name: 'Review substitution' })).not.toHaveTextContent(/base transfer/i);
  });

  it('discloses the same live-base transfer when the verified starter re-enters', async () => {
    const baseSnapshot = buildSnapshot();
    const snapshot = buildSnapshot({
      bases: {
        first: {
          playerId: 'bench-home',
          name: 'Taylor Gray',
          number: '15',
          responsiblePitcherId: 'pitcher-1',
          courtesyForPlayerId: null,
          reachedOnEventId: 'event-6'
        },
        second: null,
        third: null
      },
      lineups: {
        away: baseSnapshot.lineups.away,
        home: [
          {
            playerId: 'bench-home',
            name: 'Taylor Gray',
            number: '15',
            slot: 1,
            active: true,
            starterPlayerId: 'batter-1',
            starterReentriesUsed: 0,
            substitutions: ['bench-home']
          },
          baseSnapshot.lineups.home[1]!
        ]
      },
      defense: {
        ...baseSnapshot.defense,
        home: { P: { playerId: 'bench-home', name: 'Taylor Gray', number: '15' } }
      }
    });
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);
    fireEvent.click(screen.getByText('Full-mode advanced plays'));

    const substitution = screen.getByRole('group', { name: 'Substitution' });
    fireEvent.click(within(substitution).getByRole('button', { name: 'Review starter re-entry' }));
    const review = screen.getByRole('dialog', { name: 'Review starter re-entry' });
    expect(review).toHaveTextContent(/first base transfer/i);
    expect(review).toHaveTextContent(/#15 Taylor Gray.*#12 Avery Carter/i);
    fireEvent.click(within(review).getByRole('button', { name: 'Confirm action' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));

    expect(fixture.createCommand.mock.calls[0]![0].payload).toEqual({
      side: 'home',
      battingSlot: 1,
      starterPlayerId: 'batter-1',
      replacedPlayerId: 'bench-home'
    });
  });

  it('re-enters the verified starter and restores the defensive assignment through a reducer-accepted command', async () => {
    const baseSnapshot = buildSnapshot();
    const snapshot = buildSnapshot({
      lineups: {
        away: baseSnapshot.lineups.away,
        home: [
          {
            playerId: 'bench-home',
            name: 'Taylor Gray',
            number: '15',
            slot: 1,
            active: true,
            starterPlayerId: 'batter-1',
            starterReentriesUsed: 0,
            substitutions: ['bench-home']
          },
          {
            ...baseSnapshot.lineups.home[1]!,
            starterPlayerId: 'runner-1',
            starterReentriesUsed: 0,
            substitutions: []
          }
        ]
      },
      defense: {
        ...baseSnapshot.defense,
        home: { P: { playerId: 'bench-home', name: 'Taylor Gray', number: '15' } }
      }
    });
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);
    fireEvent.click(screen.getByText('Full-mode advanced plays'));
    const substitution = screen.getByRole('group', { name: 'Substitution' });
    expect(within(substitution).getByRole('button', { name: 'Review starter re-entry' })).toBeEnabled();
    fireEvent.click(within(substitution).getByRole('button', { name: 'Review starter re-entry' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Review starter re-entry' })).getByRole('button', { name: 'Confirm action' })
    );
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));

    const uiPayload = fixture.createCommand.mock.calls[0]![0].payload as unknown as DiamondCommandPayloadMap['re_enter'];
    expect(uiPayload).toEqual({
      side: 'home',
      battingSlot: 1,
      starterPlayerId: 'batter-1',
      replacedPlayerId: 'bench-home'
    });
    const initialState = buildReducerStateForUiSnapshot();
    const substituted = reduceDiamondEvent(initialState, {
      type: 'substitute',
      eventId: 'ui-substitute-setup',
      payload: {
        side: 'home',
        battingSlot: 1,
        outgoingPlayerId: 'batter-1',
        incomingPlayerId: 'bench-home'
      }
    });
    const reduced = reduceDiamondEvent(substituted, { type: 're_enter', eventId: 'ui-reentry', payload: uiPayload });
    expect(reduced.lineups.home.battingOrder[0]).toMatchObject({ activePlayerId: 'batter-1', starterReentriesUsed: 1 });
    expect(reduced.lineups.home.defense.P).toBe('batter-1');
  });

  it('renders loaded staff-private notes and reviews a structured scoring judgment against an exact play', async () => {
    const snapshot = buildSnapshot({
      revision: 8,
      checkpointHash: checkpointForRevision(8),
      completeness: { ...buildSnapshot().completeness, authoritativeRevision: 8 }
    });
    const history = buildPrivateHistoryItems(8);
    history[7] = buildPrivateEvent('event-8', 8, {
      type: 'private_note',
      payload: { text: 'Confirm the inherited-runner ruling.', attachedEventId: 'event-7', visibility: 'staff-private' }
    });
    const fixture = createClient(snapshot);
    fixture.loadPrivateHistory.mockResolvedValue(buildPrivateHistoryWindow(history, 8));
    renderScorebook(snapshot, fixture);
    fireEvent.click(screen.getByRole('button', { name: 'Load recent private history' }));
    expect(await screen.findByText('Confirm the inherited-runner ruling.')).toBeInTheDocument();
    expect(screen.getByText('Attached to event-7')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Full-mode advanced plays'));
    const structured = screen.getByRole('group', { name: 'Structured fielding or scoring judgment' });
    expect(within(structured).getByLabelText('Effective play')).toHaveValue('event-7');
    fireEvent.change(within(structured).getByLabelText('Structured command type'), {
      target: { value: 'record_scoring_judgment' }
    });
    fireEvent.change(within(structured).getByText('Earned run').querySelector('select')!, { target: { value: 'no' } });
    fireEvent.change(within(structured).getByText('RBI').querySelector('select')!, { target: { value: 'yes' } });
    fireEvent.change(within(structured).getByLabelText('Responsible pitcher'), { target: { value: 'pitcher-1' } });
    fireEvent.click(within(structured).getByRole('button', { name: 'Review scoring judgment' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Review scoring judgment' })).getByRole('button', { name: 'Confirm action' })
    );
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));
    expect(fixture.createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'record_scoring_judgment',
        payload: {
          playEventId: 'event-7',
          earned: false,
          rbi: true,
          responsiblePitcherId: 'pitcher-1'
        }
      })
    );
  });

  it('keeps an edited plate-appearance replacement on the append-only supersede path', async () => {
    const fixture = createClient();
    fixture.loadPrivateHistory.mockResolvedValue(buildPrivateHistoryWindow(buildPrivateHistoryItems(), 7));
    renderScorebook(buildSnapshot(), fixture);
    fireEvent.click(screen.getByRole('button', { name: 'Load recent private history' }));
    await screen.findByText(/Complete private history: 7 canonical events/);
    fireEvent.change(screen.getByLabelText('Correction reason'), { target: { value: 'Changed the hit ruling.' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Replace PA' })[0]!);

    const review = screen.getByRole('dialog', { name: 'Review Double replacement' });
    fireEvent.change(within(review).getByLabelText('Play result'), { target: { value: 'single' } });
    fireEvent.click(within(review).getByRole('button', { name: 'Confirm correction' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));
    expect(fixture.createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'supersede_event',
        payload: expect.objectContaining({
          targetEventId: 'event-7',
          reason: 'Changed the hit ruling.',
          replacement: expect.objectContaining({
            type: 'record_plate_appearance',
            payload: expect.objectContaining({ result: 'single', batterId: 'batter-1', pitcherId: 'pitcher-1' })
          })
        })
      })
    );
  });

  it('exposes DP/FLEX only for a rules profile that enables it', async () => {
    const snapshot = buildSnapshot({
      lifecycle: 'ready',
      rulesProfileId: 'fastpitch-youth',
      ruleCapabilities: { dpFlex: true, courtesyRunner: { pitcher: true, catcher: true } }
    });
    const fixture = createClient(snapshot);
    renderScorebook(snapshot, fixture);
    fireEvent.click(screen.getByText('Full-mode advanced plays'));

    const dpFlex = screen.getByRole('group', { name: 'Fastpitch DP/FLEX' });
    fireEvent.change(within(dpFlex).getByLabelText('DP in batting order'), { target: { value: 'batter-1' } });
    fireEvent.change(within(dpFlex).getByLabelText('FLEX player'), { target: { value: 'bench-home' } });
    fireEvent.change(within(dpFlex).getByLabelText('FLEX position'), { target: { value: 'CF' } });
    fireEvent.click(within(dpFlex).getByRole('button', { name: 'Review DP/FLEX' }));
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Review DP/FLEX assignment' })).getByRole('button', { name: 'Confirm action' })
    );

    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));
    expect(fixture.createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'set_dp_flex',
        payload: {
          side: 'home',
          dpPlayerId: 'batter-1',
          flexPlayerId: 'bench-home',
          dpBattingSlot: 1,
          flexDefensivePosition: 'CF'
        }
      })
    );
  });

  it('removes the DP/FLEX setup command once the game has started', () => {
    const snapshot = buildSnapshot({
      lifecycle: 'active',
      rulesProfileId: 'fastpitch-youth@1',
      ruleCapabilities: { dpFlex: true, courtesyRunner: { pitcher: true, catcher: true } }
    });
    renderScorebook(snapshot, createClient(snapshot));
    fireEvent.click(screen.getByText('Full-mode advanced plays'));

    expect(screen.queryByRole('group', { name: 'Fastpitch DP/FLEX' })).not.toBeInTheDocument();
  });
});
