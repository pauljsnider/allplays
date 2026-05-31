import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameDetail } from './GameDetail';
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
});
