// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParentHomeTeam } from '../lib/homeLogic';
import { getPublicTeamsPage } from '../lib/publicTeamsService';
import { PublicTeamsBrowse } from './PublicTeamsBrowse';

vi.mock('../lib/publicTeamsService', () => ({
  getPublicTeamsPage: vi.fn()
}));

const atlantaTeam: ParentHomeTeam = {
  teamId: 'team-atlanta',
  teamName: 'Atlanta Fire',
  photoUrl: '',
  role: 'Fan',
  sport: 'Soccer',
  location: 'Atlanta, GA',
  players: [],
  eventCount: 0,
  unreadCount: 0,
  openActions: 0,
  nextEvent: null,
  appAccess: true,
  webAccess: true,
  isPublic: true
};

const atlantaSecondPageTeam: ParentHomeTeam = {
  ...atlantaTeam,
  teamId: 'team-atlanta-2',
  teamName: 'Atlanta United 2'
};

function renderBrowseRoute() {
  return render(
    <MemoryRouter initialEntries={['/teams/browse']}>
      <Routes>
        <Route path="/teams/browse" element={<PublicTeamsBrowse />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('PublicTeamsBrowse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('auto-browses on mount and paginates location search with the active query', async () => {
    vi.mocked(getPublicTeamsPage)
      .mockResolvedValueOnce({ teams: [atlantaTeam], nextCursor: null })
      .mockResolvedValueOnce({ teams: [atlantaTeam], nextCursor: 'atlanta-cursor-2' })
      .mockResolvedValueOnce({ teams: [atlantaSecondPageTeam], nextCursor: null });

    renderBrowseRoute();

    await waitFor(() =>
      expect(getPublicTeamsPage).toHaveBeenNthCalledWith(1, {
        searchText: undefined,
        cursor: null
      })
    );
    expect(await screen.findByText('Atlanta Fire')).toBeTruthy();

    const searchInput = screen.getByPlaceholderText('Search by team, city, state, or zip');
    fireEvent.change(searchInput, { target: { value: 'Atlanta, GA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search public teams' }));

    await waitFor(() =>
      expect(getPublicTeamsPage).toHaveBeenNthCalledWith(2, {
        searchText: 'Atlanta, GA',
        cursor: null
      })
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Load more teams' }));

    await waitFor(() =>
      expect(getPublicTeamsPage).toHaveBeenNthCalledWith(3, {
        searchText: 'Atlanta, GA',
        cursor: 'atlanta-cursor-2'
      })
    );
    expect(await screen.findByText('Atlanta United 2')).toBeTruthy();
  });

  it('recovers from a query-specific empty state by browsing all public teams', async () => {
    vi.mocked(getPublicTeamsPage)
      .mockResolvedValueOnce({ teams: [atlantaTeam], nextCursor: null })
      .mockResolvedValueOnce({ teams: [], nextCursor: null })
      .mockResolvedValueOnce({ teams: [atlantaTeam], nextCursor: null });

    renderBrowseRoute();

    expect(await screen.findByText('Atlanta Fire')).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText('Search by team, city, state, or zip'), {
      target: { value: '00000' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search public teams' }));

    expect(await screen.findByText('No public teams found for "00000". Try a different search or browse all public teams.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Browse all public teams' }));

    await waitFor(() =>
      expect(getPublicTeamsPage).toHaveBeenNthCalledWith(3, {
        searchText: undefined,
        cursor: null
      })
    );
    expect(await screen.findByText('Atlanta Fire')).toBeTruthy();
    expect(screen.queryByText(/No public teams found/)).toBeNull();
  });
});
