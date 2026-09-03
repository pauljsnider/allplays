// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameReplayEditor, canManageGameReplay } from './GameReplayEditor';
import type { ParentScheduleEvent } from '../../lib/scheduleLogic';
import type { AuthState } from '../../lib/types';

const serviceMocks = vi.hoisted(() => ({
  readGameReplayArchiveForApp: vi.fn(),
  linkGameYouTubeReplayForApp: vi.fn(),
  removeGameReplayForApp: vi.fn(),
  createReplayMutationId: vi.fn(() => 'mutation-1'),
  isReplayMutationUnconfirmedError: vi.fn((error) => error?.code === 'replay-mutation-unconfirmed'),
  toSafeReplayArchiveState: vi.fn((value) => ({
    state: value.state,
    hasRecordedReplay: value.hasRecordedReplay,
    hasReplayVideo: value.hasReplayVideo,
    replayArchiveRevision: value.replayArchiveRevision
  }))
}));

const publicActionMocks = vi.hoisted(() => ({ openPublicUrl: vi.fn() }));

vi.mock('../../lib/replayArchiveService', () => serviceMocks);
vi.mock('../../lib/publicActions', () => publicActionMocks);

const auth = {
  user: { uid: 'videographer-1', email: 'video@example.com', displayName: 'Video Helper', roles: [] },
  profile: null,
  loading: false,
  error: null,
  roles: [],
  isParent: false,
  isCoach: false,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn()
} as AuthState;

function buildEvent(overrides: Partial<ParentScheduleEvent> = {}): ParentScheduleEvent {
  const event: ParentScheduleEvent = {
    eventKey: 'team-1::game-1::player-1',
    id: 'game-1',
    teamId: 'team-1',
    teamName: 'Vipers',
    type: 'game',
    date: new Date('2026-08-29T18:00:00.000Z'),
    location: 'Main Field',
    childId: 'player-1',
    childName: 'Avery',
    isDbGame: true,
    isCancelled: false,
    status: 'completed',
    liveStatus: 'completed',
    rawReplayLifecycle: { type: 'game', status: 'completed', liveStatus: 'completed' },
    assignments: [],
    openAssignmentCount: 0,
    canManageReplayVideo: true,
    hasRecordedReplay: false,
    hasReplayVideo: false,
    replayArchiveRevision: 'revision-1',
    replayArchiveState: 'none',
    ...overrides
  };
  if (!Object.prototype.hasOwnProperty.call(overrides, 'rawReplayLifecycle')) {
    event.rawReplayLifecycle = { type: event.type, status: event.status, liveStatus: event.liveStatus };
  }
  return event;
}

const existingReplay = {
  provider: 'youtube' as const,
  videoId: 'PK1HyC37doc',
  embedUrl: 'https://www.youtube.com/embed/PK1HyC37doc',
  publicUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
  status: 'ready' as const
};

const emptyState = {
  state: 'none' as const,
  hasRecordedReplay: false,
  hasReplayVideo: false,
  replayArchiveRevision: 'revision-1',
  replayVideo: null,
  lastMutationId: null
};

const readyState = {
  state: 'ready' as const,
  hasRecordedReplay: true,
  hasReplayVideo: true,
  replayArchiveRevision: 'revision-2',
  replayVideo: existingReplay,
  lastMutationId: 'mutation-1'
};

describe('GameReplayEditor protected replay boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.readGameReplayArchiveForApp.mockResolvedValue(emptyState);
    serviceMocks.linkGameYouTubeReplayForApp.mockResolvedValue(readyState);
    serviceMocks.removeGameReplayForApp.mockResolvedValue({
      ...emptyState,
      state: 'removed',
      replayArchiveRevision: 'revision-3',
      lastMutationId: 'mutation-1'
    });
    publicActionMocks.openPublicUrl.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('preserves selected-videographer/full-manager lifecycle and shared-copy checks', () => {
    expect(canManageGameReplay(buildEvent(), auth)).toBe(true);
    expect(canManageGameReplay(buildEvent({ status: 'scheduled', liveStatus: 'scheduled' }), auth)).toBe(false);
    expect(
      canManageGameReplay(
        buildEvent({
          status: 'scheduled',
          liveStatus: 'scheduled',
          canManageReplayVideo: false,
          canManageReplayVideoAsFullManager: true,
          hasRecordedReplay: true,
          replayArchiveState: 'ready'
        }),
        auth
      )
    ).toBe(true);
    expect(canManageGameReplay(buildEvent({ sharedScheduleId: 'shared-schedule-1' }), auth)).toBe(false);
    expect(canManageGameReplay(buildEvent({ id: 'shared_game-1' }), auth)).toBe(false);
    expect(canManageGameReplay(buildEvent({ canManageReplayVideo: false }), auth)).toBe(false);
  });

  it('loads protected management state before enabling controls', async () => {
    let resolveRead: (value: typeof emptyState) => void = () => {};
    serviceMocks.readGameReplayArchiveForApp.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        })
    );
    render(<GameReplayEditor auth={auth} event={buildEvent()} onReplayArchiveUpdated={vi.fn()} />);

    expect(screen.getByText('Loading the protected replay link…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link YouTube replay' })).toBeDisabled();
    resolveRead(emptyState);

    expect(await screen.findByRole('button', { name: 'Link YouTube replay' })).toBeEnabled();
    expect(serviceMocks.readGameReplayArchiveForApp).toHaveBeenCalledWith('team-1', 'game-1');
  });

  it('links with an opaque revision and stable secure mutation ID, then publishes only safe state', async () => {
    const onReplayArchiveUpdated = vi.fn();
    render(<GameReplayEditor auth={auth} event={buildEvent()} onReplayArchiveUpdated={onReplayArchiveUpdated} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Link YouTube replay' }));
    fireEvent.change(screen.getByLabelText('YouTube video URL'), {
      target: { value: 'https://youtu.be/PK1HyC37doc?si=share-token' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save replay' }));

    await waitFor(() =>
      expect(serviceMocks.linkGameYouTubeReplayForApp).toHaveBeenCalledWith(
        'team-1',
        'game-1',
        'https://www.youtube.com/watch?v=PK1HyC37doc',
        { expectedRevision: 'revision-1', mutationId: 'mutation-1', userId: 'videographer-1' }
      )
    );
    expect(onReplayArchiveUpdated).toHaveBeenCalledWith({
      state: 'ready',
      hasRecordedReplay: true,
      hasReplayVideo: true,
      replayArchiveRevision: 'revision-2'
    });
    expect(JSON.stringify(onReplayArchiveUpdated.mock.calls)).not.toContain('PK1HyC37doc');
    expect(await screen.findByRole('status')).toHaveTextContent('YouTube replay linked.');
  });

  it('keeps the callable-returned URL transient and opens it only after protected read', async () => {
    serviceMocks.readGameReplayArchiveForApp.mockResolvedValue(readyState);
    render(
      <GameReplayEditor
        auth={auth}
        event={buildEvent({ hasRecordedReplay: true, hasReplayVideo: true, replayArchiveState: 'ready' })}
        onReplayArchiveUpdated={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Open video' }));
    await waitFor(() => expect(publicActionMocks.openPublicUrl).toHaveBeenCalledWith(existingReplay.publicUrl));
  });

  it('does not expose an offline stale URL and offers a protected-read retry', async () => {
    serviceMocks.readGameReplayArchiveForApp.mockRejectedValueOnce(new Error('Unable to load replay while offline.'));
    render(
      <GameReplayEditor
        auth={auth}
        event={buildEvent({ hasRecordedReplay: true, hasReplayVideo: true, replayArchiveState: 'ready' })}
        onReplayArchiveUpdated={vi.fn()}
      />
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load replay while offline.');
    expect(screen.queryByRole('button', { name: 'Open video' })).not.toBeInTheDocument();
    expect(publicActionMocks.openPublicUrl).not.toHaveBeenCalled();

    serviceMocks.readGameReplayArchiveForApp.mockResolvedValueOnce(readyState);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('button', { name: 'Open video' })).toBeEnabled();
  });

  it('blocks a new mutation ID until an ambiguous update is refreshed authoritatively', async () => {
    serviceMocks.linkGameYouTubeReplayForApp.mockRejectedValueOnce(Object.assign(
      new Error('The replay update could not be confirmed. Refresh this game before trying again.'),
      { code: 'replay-mutation-unconfirmed' }
    ));
    render(<GameReplayEditor auth={auth} event={buildEvent()} onReplayArchiveUpdated={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Link YouTube replay' }));
    fireEvent.change(screen.getByLabelText('YouTube video URL'), {
      target: { value: 'https://youtu.be/PK1HyC37doc' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save replay' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed');
    expect(screen.queryByLabelText('YouTube video URL')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Link YouTube replay' })).toBeDisabled();
    expect(serviceMocks.createReplayMutationId).toHaveBeenCalledTimes(1);
  });

  it('removes with the loaded revision and publishes a safe tombstone marker', async () => {
    serviceMocks.readGameReplayArchiveForApp.mockResolvedValue(readyState);
    const onReplayArchiveUpdated = vi.fn();
    render(
      <GameReplayEditor
        auth={auth}
        event={buildEvent({ hasRecordedReplay: true, hasReplayVideo: true, replayArchiveState: 'ready' })}
        onReplayArchiveUpdated={onReplayArchiveUpdated}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(serviceMocks.removeGameReplayForApp).toHaveBeenCalledWith('team-1', 'game-1', {
        expectedRevision: 'revision-2',
        mutationId: 'mutation-1',
        userId: 'videographer-1'
      })
    );
    expect(onReplayArchiveUpdated).toHaveBeenCalledWith({
      state: 'removed',
      hasRecordedReplay: false,
      hasReplayVideo: false,
      replayArchiveRevision: 'revision-3'
    });
    expect(JSON.stringify(onReplayArchiveUpdated.mock.calls)).not.toContain('youtube.com');
  });

  it('requires explicit confirmation before replacing a protected non-YouTube archive', async () => {
    serviceMocks.readGameReplayArchiveForApp.mockResolvedValue({ ...readyState, replayVideo: null });
    render(
      <GameReplayEditor
        auth={auth}
        event={buildEvent({ hasRecordedReplay: true, hasReplayVideo: true, replayArchiveState: 'ready' })}
        onReplayArchiveUpdated={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Replace with YouTube replay' }));
    const submit = screen.getByRole('button', { name: 'Replace replay' });
    expect(submit).toBeDisabled();
    fireEvent.click(screen.getByLabelText('I understand this replaces the current non-YouTube replay.'));
    expect(submit).toBeEnabled();
  });
});
