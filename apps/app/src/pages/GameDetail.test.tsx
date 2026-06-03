import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const liveGameChatMocks = vi.hoisted(() => ({
  canUseLiveGameChat: vi.fn(),
  getLiveGameChatNotice: vi.fn(),
  sendLiveGameChatMessage: vi.fn(),
  subscribeToLiveGameChat: vi.fn(() => vi.fn())
}));

vi.mock('../lib/liveGameChatService', () => liveGameChatMocks);

import { GameDetail } from './GameDetail';
import { mockGames } from '../data/mockData';
import type { AuthState } from '../lib/types';

const auth: AuthState = {
  user: null,
  profile: null,
  loading: false,
  error: null,
  roles: ['parent'],
  isParent: true,
  isCoach: false,
  isAdmin: false,
  isPlatformAdmin: false,
  refresh: vi.fn(),
  signOut: vi.fn()
};

function renderGameDetail(path = '/games/game-1') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/games/:gameId" element={<GameDetail auth={auth} />} />
        <Route path="/schedule" element={<div>Schedule</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('GameDetail play-by-play audio', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    liveGameChatMocks.canUseLiveGameChat.mockReturnValue(true);
    liveGameChatMocks.getLiveGameChatNotice.mockReturnValue(null);
    liveGameChatMocks.subscribeToLiveGameChat.mockImplementation((...args: any[]) => {
      const callback = args[2] as (messages: Array<{ id: string; senderName: string; text: string }>) => void;
      callback([{ id: 'chat-1', senderName: 'Jamie', text: 'Let\'s go Bears!' }]);
      return vi.fn();
    });
    liveGameChatMocks.sendLiveGameChatMessage.mockResolvedValue(undefined);
    localStorage.clear();
    vi.stubGlobal('speechSynthesis', { speak: vi.fn(), cancel: vi.fn() });
    vi.stubGlobal('SpeechSynthesisUtterance', vi.fn(function MockUtterance(this: SpeechSynthesisUtterance, text: string) {
      this.text = text;
    }));
  });

  it('renders an accessible announcer toggle and live play-by-play events', () => {
    renderGameDetail();

    expect(screen.getByRole('button', { name: 'Enable play-by-play audio announcements' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Live play by play' })).toBeInTheDocument();
    expect(screen.getByText('#9 Kevin scored 2 points')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Live chat' })).toBeInTheDocument();
    expect(liveGameChatMocks.subscribeToLiveGameChat).toHaveBeenCalledWith('team-bears', 'game-1', expect.any(Function), expect.any(Function));
    expect(screen.getByText("Let's go Bears!")).toBeInTheDocument();
  });

  it('announces displayed game events once when enabled', () => {
    renderGameDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Enable play-by-play audio announcements' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disable play-by-play audio announcements' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enable play-by-play audio announcements' }));

    expect(speechSynthesis.speak).toHaveBeenCalledTimes(2);
    expect(SpeechSynthesisUtterance).toHaveBeenCalledWith('Q1. #9 Kevin scored 2 points');
    expect(SpeechSynthesisUtterance).toHaveBeenCalledWith('Q1. #12 Paul defensive rebound');
    expect(localStorage.getItem('allplaysPlayAnnouncerEnabled')).toBe('true');
  });

  it('sends anonymous live chat messages from the game detail panel', async () => {
    renderGameDetail();

    fireEvent.change(screen.getByLabelText('Display name'), { target: { value: 'Pat Parent' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Great hustle!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await waitFor(() => {
      expect(liveGameChatMocks.sendLiveGameChatMessage).toHaveBeenCalledWith('team-bears', 'game-1', {
        text: 'Great hustle!',
        user: null,
        anonymousDisplayName: 'Pat Parent'
      });
    });
  });

  it('does not resubscribe when the game object is recreated with the same ids', () => {
    const unsubscribe = vi.fn();
    const originalGame = mockGames[0];

    liveGameChatMocks.subscribeToLiveGameChat.mockReturnValue(unsubscribe);

    try {
      const view = renderGameDetail();

      expect(liveGameChatMocks.subscribeToLiveGameChat).toHaveBeenCalledTimes(1);

      mockGames[0] = {
        ...originalGame,
        liveEvents: [...(originalGame.liveEvents || [])]
      };

      view.rerender(
        <MemoryRouter initialEntries={['/games/game-1']}>
          <Routes>
            <Route path="/games/:gameId" element={<GameDetail auth={auth} />} />
            <Route path="/schedule" element={<div>Schedule</div>} />
          </Routes>
        </MemoryRouter>
      );

      expect(liveGameChatMocks.subscribeToLiveGameChat).toHaveBeenCalledTimes(1);
      expect(unsubscribe).not.toHaveBeenCalled();
    } finally {
      mockGames[0] = originalGame;
    }
  });

  it('shows the locked notice and disables the composer when live chat is closed', () => {
    liveGameChatMocks.canUseLiveGameChat.mockReturnValue(false);
    liveGameChatMocks.getLiveGameChatNotice.mockReturnValue('Live chat opens on game day and closes after the live window ends.');

    renderGameDetail('/games/game-2');

    expect(screen.getByText('Live chat opens on game day and closes after the live window ends.')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Send message' })).toBeDisabled();
  });
});
