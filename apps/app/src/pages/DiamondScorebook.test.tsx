// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { AuthState } from '../lib/types';
import type { DiamondAiDependencies, DiamondAiModelRequest } from '../lib/diamondScorebookAi';
import type {
  DiamondCommandEnvelope,
  DiamondCommandOutcome,
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

function buildSnapshot(overrides: Partial<DiamondScorebookSnapshot> = {}): DiamondScorebookSnapshot {
  return {
    schemaVersion: 2,
    teamId: 'team-1',
    gameId: 'game-1',
    revision: 7,
    checkpointHash: 'sha256:revision-7',
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
      first: { playerId: 'runner-1', name: 'Jordan Lee', number: '8' },
      second: null,
      third: { playerId: 'runner-3', name: 'Casey Kim', number: '4' }
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
    battingLineup: [
      { playerId: 'batter-1', name: 'Avery Carter', number: '12', slot: 1 },
      { playerId: 'runner-1', name: 'Jordan Lee', number: '8', slot: 2 }
    ],
    defensiveLineup: [
      { playerId: 'pitcher-1', name: 'Morgan Diaz', number: '7', slot: 1 },
      { playerId: 'fielder-2', name: 'Riley Chen', number: '2', slot: 2 }
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
      holderUid: 'coach-1',
      holderName: 'Coach Carter',
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
    if (command.type === 'start') loadedSnapshot = { ...loadedSnapshot, lifecycle: 'active' };
    if (command.type === 'suspend') loadedSnapshot = { ...loadedSnapshot, lifecycle: 'suspended' };
    loadedSnapshot = {
      ...loadedSnapshot,
      revision: command.expectedRevision + 1,
      checkpointHash: `sha256:revision-${command.expectedRevision + 1}`,
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
        expectedRevision: input.expectedRevision,
        rulesProfileId: input.rulesProfileId,
        rulesProfileVersion: input.rulesProfileVersion,
        type: 'scorer_handoff',
        payload: { toUid: input.toUid }
      })
    )
  );
  const client = {
    load: vi.fn(async () => loadedSnapshot),
    createSecureId: vi.fn(() => '12345678-1234-4234-9234-123456789abc'),
    createCommand,
    submitCommand,
    parseVoice: vi.fn(),
    savePrivateNote,
    requestHandoff,
    readQueue: vi.fn(() => []),
    enqueue: vi.fn((command: DiamondCommandEnvelope) => [{ command, queuedAt: '2026-09-05T12:00:00.000Z' }]),
    reconcileQueue: vi.fn(async () => ({ accepted: 0, duplicates: 0, remaining: [], lastSnapshot: null }))
  } as unknown as DiamondScorebookClient;
  return { client, createCommand, submitCommand, savePrivateNote, requestHandoff };
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
    const { createCommand, submitCommand } = renderScorebook();
    fireEvent.click(screen.getByRole('button', { name: /Correct last/ }));

    const dialog = screen.getByRole('dialog', { name: 'Append this correction?' });
    expect(dialog).toHaveTextContent('remains in canonical history');
    expect(submitCommand).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(submitCommand).toHaveBeenCalledTimes(1));
    expect(createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'void_event',
        payload: { targetEventId: 'event-7', reason: 'Scorekeeper undo from recent plays' }
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
    renderScorebook(snapshot, fixture);

    const items = within(screen.getByRole('list', { name: 'Recent scorebook plays' })).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Avery doubled');
    expect(items[1]).toHaveTextContent('Jordan walked');

    fireEvent.click(screen.getByRole('button', { name: /Correct last/ }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Append this correction?' })).getByRole('button', { name: 'Confirm' }));

    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));
    expect(fixture.createCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'void_event',
        payload: { targetEventId: 'event-7', reason: 'Scorekeeper undo from recent plays' }
      })
    );
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
    fireEvent.click(within(review).getByRole('button', { name: 'Confirm play' }));

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
        checkpointHash: 'sha256:revision-8',
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
    renderScorebook(buildSnapshot(), fixture);

    fireEvent.click(screen.getByRole('button', { name: 'Private note' }));
    fireEvent.change(screen.getByLabelText('Editable transcript'), { target: { value: 'Check Avery’s timing after the game.' } });
    fireEvent.click(screen.getByLabelText('Attach to the latest confirmed play'));
    fireEvent.click(screen.getByRole('button', { name: /Save privately/ }));

    await waitFor(() =>
      expect(fixture.savePrivateNote).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'Check Avery’s timing after the game.',
          attachedEventId: 'event-7',
          expectedRevision: 7
        })
      )
    );
    expect(fixture.client.enqueue).not.toHaveBeenCalled();
    expect(screen.queryByText('Check Avery’s timing after the game.')).not.toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Recent scorebook plays' })).queryByText(/timing after/i)).not.toBeInTheDocument();
  });

  it('is fail-closed when another scorer owns the lease', () => {
    renderScorebook(
      buildSnapshot({
        lease: {
          status: 'held-by-other',
          canScore: false,
          holderUid: 'coach-2',
          holderName: 'Coach Lee',
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
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(1));
    fireEvent.click(within(home).getByRole('button', { name: 'Save home lineup' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(2));

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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start game' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Start game' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(3));
    expect(fixture.createCommand).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'start', expectedRevision: 9 }));
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
    fireEvent.click(within(review).getByRole('button', { name: 'Confirm play' }));
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

  it('provides confirmed substitution and structured fielding fallback commands', async () => {
    const fixture = createClient();
    renderScorebook(buildSnapshot(), fixture);
    fireEvent.click(screen.getByText('Full-mode advanced plays'));

    const substitution = screen.getByRole('group', { name: 'Substitution' });
    fireEvent.change(within(substitution).getByLabelText('Incoming'), { target: { value: 'bench-home' } });
    fireEvent.click(within(substitution).getByRole('button', { name: 'Review substitution' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Review substitution' })).getByRole('button', { name: 'Confirm play' }));
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
    fireEvent.change(within(structured).getByLabelText('Structured command details'), {
      target: { value: JSON.stringify({ playEventId: 'event-7', fielding: { putoutBy: 'fielder-2' } }) }
    });
    fireEvent.click(within(structured).getByRole('button', { name: 'Review structured command' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Review fielding detail' })).getByRole('button', { name: 'Confirm play' }));
    await waitFor(() => expect(fixture.submitCommand).toHaveBeenCalledTimes(2));
    expect(fixture.createCommand).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'record_fielding',
        payload: { playEventId: 'event-7', fielding: { putoutBy: 'fielder-2' } }
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
      within(screen.getByRole('dialog', { name: 'Review DP/FLEX assignment' })).getByRole('button', { name: 'Confirm play' })
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
});
