import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { AppSearchDialog } from './AppSearchDialog';
import type { AuthState } from '../lib/types';

vi.mock('../lib/publicActions', () => ({
  openPublicUrl: vi.fn(),
}));

vi.mock('../lib/searchService', () => ({
  computeAppSearchResults: () => ({ actions: [], teams: [], help: [], players: [], flat: [] }),
  loadAppSearchTeams: vi.fn(async () => []),
  searchAppPlayers: vi.fn(async () => []),
}));

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
  signOut: vi.fn(),
};

describe('AppSearchDialog', () => {
  it('closes from a backdrop mousedown but not from pressing inside the search panel', () => {
    const onClose = vi.fn();

    render(
      <MemoryRouter>
        <AppSearchDialog auth={auth} open={true} onClose={onClose} />
      </MemoryRouter>
    );

    fireEvent.mouseDown(screen.getByTestId('app-search-panel'));
    expect(onClose).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog', { name: 'Search teams, players, actions, and help' });
    fireEvent.mouseDown(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
