// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameReplayEditor, canManageGameReplay } from './GameReplayEditor';
import type { ParentScheduleEvent } from '../../lib/scheduleLogic';
import type { AuthState } from '../../lib/types';

const serviceMocks = vi.hoisted(() => ({
  linkGameYouTubeReplayForApp: vi.fn(),
  removeGameReplayForApp: vi.fn()
}));

const publicActionMocks = vi.hoisted(() => ({
  openPublicUrl: vi.fn()
}));

vi.mock('../../lib/scheduleService', () => serviceMocks);
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
    ...overrides
  };
  if (!Object.prototype.hasOwnProperty.call(overrides, 'rawReplayLifecycle')) {
    event.rawReplayLifecycle = {
      type: event.type,
      status: event.status,
      liveStatus: event.liveStatus
    };
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

describe('GameReplayEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.linkGameYouTubeReplayForApp.mockResolvedValue({
      provider: 'youtube',
      videoId: 'PK1HyC37doc',
      embedUrl: 'https://www.youtube.com/embed/PK1HyC37doc',
      publicUrl: 'https://www.youtube.com/watch?v=PK1HyC37doc',
      status: 'ready',
      linkedBy: 'videographer-1',
      linkedAt: new Date('2026-08-30T12:00:00.000Z')
    });
    serviceMocks.removeGameReplayForApp.mockResolvedValue({ removed: true });
    publicActionMocks.openPublicUrl.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows only for completed games managed by a full manager or selected videographer', () => {
    expect(canManageGameReplay(buildEvent(), auth)).toBe(true);
    expect(canManageGameReplay(buildEvent({ canManageReplayVideo: false, isTeamAdmin: true }), auth)).toBe(true);
    expect(canManageGameReplay(buildEvent({ status: 'scheduled', liveStatus: 'scheduled' }), auth)).toBe(false);
    expect(canManageGameReplay(buildEvent({
      status: 'scheduled',
      liveStatus: 'live',
      canManageReplayVideo: false,
      isTeamAdmin: true,
      videoUrl: 'https://youtu.be/PK1HyC37doc',
      rawReplayState: { videoUrl: 'https://youtu.be/PK1HyC37doc' }
    }), auth)).toBe(false);
    expect(canManageGameReplay(buildEvent({ status: 'FINAL', liveStatus: '' }), auth)).toBe(false);
    expect(canManageGameReplay(buildEvent({ status: 'completed', liveStatus: 'live' }), auth)).toBe(false);
    expect(canManageGameReplay(buildEvent({ isSharedGame: true }), auth)).toBe(false);
    expect(canManageGameReplay(buildEvent({ sharedScheduleId: 'shared-schedule-1' }), auth)).toBe(false);
    expect(canManageGameReplay(buildEvent({ sharedScheduleSourceTeamId: 'team-2' }), auth)).toBe(false);
    expect(canManageGameReplay(buildEvent({ sharedScheduleOpponentGameId: 'game-2' }), auth)).toBe(false);
    expect(canManageGameReplay(buildEvent({ hasReplayShareMarker: true }), auth)).toBe(false);
    expect(canManageGameReplay(buildEvent({ canManageReplayVideo: false, isTeamAdmin: false }), auth)).toBe(false);
    expect(canManageGameReplay(buildEvent({
      status: 'scheduled',
      liveStatus: 'scheduled',
      replayVideo: existingReplay,
      rawReplayState: { replayVideo: existingReplay }
    }), auth)).toBe(false);
    expect(canManageGameReplay(buildEvent({
      status: 'scheduled',
      liveStatus: 'scheduled',
      canManageReplayVideo: false,
      isTeamAdmin: true,
      rawReplayState: { replayVideoPublicUrl: 'https://example.com/legacy-replay' }
    }), auth)).toBe(true);
    expect(canManageGameReplay(buildEvent({
      status: 'scheduled',
      liveStatus: 'scheduled',
      isTeamAdmin: false,
      canManageReplayVideo: true,
      canManageReplayVideoAsFullManager: true,
      rawReplayState: { replayVideoPublicUrl: 'https://example.com/legacy-replay' }
    }), auth)).toBe(true);
    expect(canManageGameReplay(buildEvent({
      status: 'cancelled',
      liveStatus: 'cancelled',
      rawReplayState: { replayVideoPublicUrl: 'https://example.com/legacy-replay' }
    }), auth)).toBe(false);
  });

  it('hides replay management for a mirrored shared-schedule document', () => {
    render(<GameReplayEditor
      auth={auth}
      event={buildEvent({ sharedScheduleId: 'shared-schedule-1', sharedScheduleOpponentTeamId: 'team-2' })}
      onReplayVideoUpdated={vi.fn()}
    />);

    expect(screen.queryByRole('heading', { name: 'YouTube replay' })).not.toBeInTheDocument();
  });

  it('fails closed when normalized display lifecycle differs from the stored mutation lifecycle', () => {
    render(<GameReplayEditor
      auth={auth}
      event={buildEvent({
        rawReplayLifecycle: { type: 'game', status: 'completed ', liveStatus: 'scheduled' }
      })}
      onReplayVideoUpdated={vi.fn()}
    />);

    expect(screen.queryByRole('heading', { name: 'YouTube replay' })).not.toBeInTheDocument();
  });

  it('hides replay management for a detached mirror that retains its source-team marker', () => {
    render(<GameReplayEditor
      auth={auth}
      event={buildEvent({ sharedScheduleSourceTeamId: 'team-2' })}
      onReplayVideoUpdated={vi.fn()}
    />);

    expect(screen.queryByRole('heading', { name: 'YouTube replay' })).not.toBeInTheDocument();
  });

  it('hides replay management for a legacy sharedGameId mirror marker', () => {
    render(<GameReplayEditor
      auth={auth}
      event={buildEvent({ hasReplayShareMarker: true })}
      onReplayVideoUpdated={vi.fn()}
    />);

    expect(screen.queryByRole('heading', { name: 'YouTube replay' })).not.toBeInTheDocument();
  });

  it('treats a tombstoned canonical replay as suppressed instead of linked', () => {
    render(<GameReplayEditor
      auth={auth}
      event={buildEvent({
        replayVideo: existingReplay,
        rawReplayState: {
          replayVideo: existingReplay,
          replayVideoFallbackDisabled: true
        }
      })}
      onReplayVideoUpdated={vi.fn()}
    />);

    expect(screen.getByRole('button', { name: 'Link YouTube replay' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open video' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
    expect(screen.queryByText('Linked')).not.toBeInTheDocument();
  });

  it.each(['shared_game-1', 'sharedh_bounded-route-id', 'shared::team-1::game-1'])(
    'never renders replay management for the synthetic shared route %s',
    (id) => {
      render(<GameReplayEditor
        auth={auth}
        event={buildEvent({ id, eventKey: `team-1::${id}::player-1` })}
        onReplayVideoUpdated={vi.fn()}
      />);

      expect(screen.queryByRole('heading', { name: 'YouTube replay' })).not.toBeInTheDocument();
    }
  );

  it('links an exact YouTube video and refreshes local replay state immediately', async () => {
    const onReplayVideoUpdated = vi.fn();
    render(<GameReplayEditor auth={auth} event={buildEvent()} onReplayVideoUpdated={onReplayVideoUpdated} />);

    const disclosure = screen.getByRole('button', { name: 'Link YouTube replay' });
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(disclosure.getAttribute('aria-controls')).toContain('game-replay-form-');
    disclosure.focus();
    fireEvent.keyDown(disclosure, { key: 'Enter', code: 'Enter' });
    fireEvent.click(disclosure);
    expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    const replayInput = screen.getByLabelText('YouTube video URL');
    expect(document.getElementById(disclosure.getAttribute('aria-controls') || '')).toBeInTheDocument();
    expect(replayInput).toHaveFocus();
    fireEvent.change(replayInput, {
      target: { value: 'https://youtu.be/PK1HyC37doc?si=share-token' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save replay' }));

    await waitFor(() => {
      expect(serviceMocks.linkGameYouTubeReplayForApp).toHaveBeenCalledWith(
        'team-1',
        'game-1',
        'https://www.youtube.com/watch?v=PK1HyC37doc',
        auth.user,
        { expectedReplayState: {} }
      );
    });
    expect(await screen.findByRole('status')).toHaveTextContent('YouTube replay linked.');
    const replaceDisclosure = screen.getByRole('button', { name: 'Replace link' });
    await waitFor(() => expect(replaceDisclosure).toHaveFocus());
    expect(replaceDisclosure).toHaveAttribute('aria-expanded', 'false');
    expect(onReplayVideoUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ videoId: 'PK1HyC37doc' }),
      { replayVideo: expect.objectContaining({ videoId: 'PK1HyC37doc' }) }
    );
  });

  it('returns keyboard focus to the disclosure after cancelling the form', async () => {
    render(<GameReplayEditor auth={auth} event={buildEvent()} onReplayVideoUpdated={vi.fn()} />);

    const disclosure = screen.getByRole('button', { name: 'Link YouTube replay' });
    fireEvent.click(disclosure);
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Enter', code: 'Enter' });
    fireEvent.click(cancel);

    await waitFor(() => expect(disclosure).toHaveFocus());
    expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('YouTube video URL')).not.toBeInTheDocument();
  });

  it('rejects a channel link before calling the mutation', async () => {
    render(<GameReplayEditor auth={auth} event={buildEvent()} onReplayVideoUpdated={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Link YouTube replay' }));
    fireEvent.change(screen.getByLabelText('YouTube video URL'), {
      target: { value: 'https://www.youtube.com/channel/UCa9ghvbup6VQmnDOdqwYpqQ' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save replay' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Paste a complete YouTube video link.');
    expect(serviceMocks.linkGameYouTubeReplayForApp).not.toHaveBeenCalled();
  });

  it('removes an existing replay only after confirmation', async () => {
    const onReplayVideoUpdated = vi.fn();
    render(<GameReplayEditor
      auth={auth}
      event={buildEvent({
        replayVideo: existingReplay,
        rawReplayState: { replayVideo: existingReplay }
      })}
      onReplayVideoUpdated={onReplayVideoUpdated}
    />);

    const removeButton = screen.getByRole('button', { name: 'Remove' });
    removeButton.focus();
    fireEvent.keyDown(removeButton, { key: 'Enter', code: 'Enter' });
    fireEvent.click(removeButton);

    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Remove this YouTube replay'));
    await waitFor(() => expect(serviceMocks.removeGameReplayForApp).toHaveBeenCalledWith(
      'team-1',
      'game-1',
      auth.user,
      { replayVideo: expect.objectContaining({ videoId: 'PK1HyC37doc' }) }
    ));
    expect(await screen.findByRole('status')).toHaveTextContent('YouTube replay removed.');
    const linkDisclosure = screen.getByRole('button', { name: 'Link YouTube replay' });
    await waitFor(() => expect(linkDisclosure).toHaveFocus());
    expect(onReplayVideoUpdated).toHaveBeenCalledWith(null, { replayVideoFallbackDisabled: true });
  });

  it('keeps removal available after a game changes back to nonfinal and restores focus safely', async () => {
    const onReplayVideoUpdated = vi.fn();
    render(<GameReplayEditor
      auth={auth}
      event={buildEvent({
        status: 'scheduled',
        liveStatus: 'scheduled',
        canManageReplayVideo: false,
        isTeamAdmin: true,
        replayVideo: existingReplay,
        rawReplayState: { replayVideo: existingReplay }
      })}
      onReplayVideoUpdated={onReplayVideoUpdated}
    />);

    expect(screen.queryByRole('button', { name: 'Replace link' })).not.toBeInTheDocument();
    const removeButton = screen.getByRole('button', { name: 'Remove' });
    removeButton.focus();
    fireEvent.click(removeButton);

    expect(await screen.findByRole('status')).toHaveTextContent('YouTube replay removed.');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'YouTube replay' })).toHaveFocus());
    expect(serviceMocks.removeGameReplayForApp).toHaveBeenCalledWith(
      'team-1',
      'game-1',
      auth.user,
      { replayVideo: existingReplay }
    );
    expect(screen.queryByRole('button', { name: 'Link YouTube replay' })).not.toBeInTheDocument();
    expect(onReplayVideoUpdated).toHaveBeenCalledWith(null, { replayVideoFallbackDisabled: true });
  });

  it('lets a full manager remove legacy-only replay evidence without deleting provider media', async () => {
    const onReplayVideoUpdated = vi.fn();
    const rawReplayState = { replayVideoPublicUrl: 'https://example.com/legacy-replay' };
    render(<GameReplayEditor
      auth={auth}
      event={buildEvent({
        status: 'scheduled',
        liveStatus: 'scheduled',
        canManageReplayVideo: false,
        isTeamAdmin: true,
        replayVideo: null,
        rawReplayState
      })}
      onReplayVideoUpdated={onReplayVideoUpdated}
    />);

    expect(screen.queryByRole('button', { name: 'Replace with YouTube replay' })).not.toBeInTheDocument();
    const removeButton = screen.getByRole('button', { name: 'Remove' });
    removeButton.focus();
    fireEvent.click(removeButton);

    expect(window.confirm).toHaveBeenCalledWith(
      'Remove this replay from the game? Viewers will no longer see the linked replay. Provider media will not be deleted.'
    );
    await waitFor(() => expect(serviceMocks.removeGameReplayForApp).toHaveBeenCalledWith(
      'team-1',
      'game-1',
      auth.user,
      rawReplayState
    ));
    expect(await screen.findByRole('status')).toHaveTextContent('Replay removed from this game.');
    await waitFor(() => expect(screen.getByRole('heading', { name: 'YouTube replay' })).toHaveFocus());
    expect(onReplayVideoUpdated).toHaveBeenCalledWith(null, { replayVideoFallbackDisabled: true });
  });

  it('preserves a retained historical videoUrl behind the removal tombstone', async () => {
    const onReplayVideoUpdated = vi.fn();
    const videoUrl = 'https://youtu.be/PK1HyC37doc';
    render(<GameReplayEditor
      auth={auth}
      event={buildEvent({
        liveStatus: 'scheduled',
        canManageReplayVideo: false,
        isTeamAdmin: true,
        videoUrl,
        rawReplayState: { videoUrl }
      })}
      onReplayVideoUpdated={onReplayVideoUpdated}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(serviceMocks.removeGameReplayForApp).toHaveBeenCalledWith(
      'team-1',
      'game-1',
      auth.user,
      { videoUrl }
    ));
    expect(onReplayVideoUpdated).toHaveBeenCalledWith(null, {
      videoUrl,
      replayVideoFallbackDisabled: true
    });
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Link YouTube replay' }));
    fireEvent.change(screen.getByLabelText('YouTube video URL'), {
      target: { value: 'https://youtu.be/PK1HyC37doc' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save replay' }));

    await waitFor(() => expect(serviceMocks.linkGameYouTubeReplayForApp).toHaveBeenCalledWith(
      'team-1',
      'game-1',
      'https://www.youtube.com/watch?v=PK1HyC37doc',
      auth.user,
      {
        expectedReplayState: {
          videoUrl,
          replayVideoFallbackDisabled: true
        }
      }
    ));
    expect(onReplayVideoUpdated).toHaveBeenLastCalledWith(
      expect.objectContaining({ videoId: 'PK1HyC37doc' }),
      {
        videoUrl,
        replayVideo: expect.objectContaining({ videoId: 'PK1HyC37doc' })
      }
    );
  });

  it('surfaces uncertainty-safe write errors without claiming the link failed', async () => {
    serviceMocks.linkGameYouTubeReplayForApp.mockRejectedValueOnce(
      new Error('The replay update could not be confirmed. Refresh this game before trying again.')
    );
    render(<GameReplayEditor auth={auth} event={buildEvent()} onReplayVideoUpdated={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Link YouTube replay' }));
    fireEvent.change(screen.getByLabelText('YouTube video URL'), { target: { value: 'https://youtu.be/PK1HyC37doc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save replay' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be confirmed');
    expect(screen.getByRole('button', { name: 'Save replay' })).toBeEnabled();
  });

  it('requires explicit acknowledgement before replacing a non-YouTube replay', async () => {
    const existingReplay = { provider: 'vimeo', publicUrl: 'https://vimeo.com/12345' };
    render(<GameReplayEditor
      auth={auth}
      event={buildEvent({ rawReplayState: { recordedVideo: existingReplay }, replayVideo: null })}
      onReplayVideoUpdated={vi.fn()}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Replace with YouTube replay' }));
    fireEvent.change(screen.getByLabelText('YouTube video URL'), {
      target: { value: 'https://youtu.be/PK1HyC37doc' }
    });
    expect(screen.getByRole('button', { name: 'Replace replay' })).toBeDisabled();
    expect(serviceMocks.linkGameYouTubeReplayForApp).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('I understand this replaces the current non-YouTube replay.'));
    fireEvent.click(screen.getByRole('button', { name: 'Replace replay' }));

    await waitFor(() => expect(serviceMocks.linkGameYouTubeReplayForApp).toHaveBeenCalledWith(
      'team-1',
      'game-1',
      'https://www.youtube.com/watch?v=PK1HyC37doc',
      auth.user,
      { expectedReplayState: { recordedVideo: existingReplay } }
    ));
  });
});
