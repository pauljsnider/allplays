import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlayerResourcePackets } from './PlayerResourcePackets';
import type { AuthState } from '../lib/types';
const mocks = vi.hoisted(() => ({ players: vi.fn(), family: vi.fn() }));
vi.mock('../lib/resourcePacketsService', () => ({
  resourcePacketsAvailable: () => true,
  loadResourcePacketLinkedPlayers: mocks.players,
  loadResourcePacketFamily: mocks.family
}));
vi.mock('../components/schedule/ResourcePacketQueue', () => ({
  ResourcePacketQueue: ({ linkedChildren }: { linkedChildren: { playerId: string; playerName: string; teamName: string }[] }) => (
    <div>Assignment for {linkedChildren[0].playerId} · {linkedChildren[0].playerName} · {linkedChildren[0].teamName}</div>
  )
}));
const auth = { user: { uid: 'parent' }, loading: false } as AuthState;
describe('assignment notification destination', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.players.mockResolvedValue({
      players: [
        { teamId: 'team', playerId: 'one', playerName: 'One', teamName: 'Team' },
        { teamId: 'team', playerId: 'two', playerName: 'Two', teamName: 'Team' }
      ]
    });
  });
  it('opens the sole assigned child directly and ignores an unassigned sibling', async () => {
    mocks.family.mockImplementation(async (_team, player) => ({ tasks: player === 'one' ? [{}] : [] }));
    render(
      <MemoryRouter initialEntries={['/practice-resources?teamId=team&assignmentId=packet']}>
        <PlayerResourcePackets auth={auth} />
      </MemoryRouter>
    );
    await screen.findByText('Assignment for one · One · Team');
    expect(screen.queryByRole('link', { name: /Two/ })).not.toBeInTheDocument();
    expect(mocks.family).toHaveBeenCalledWith('team', 'one', undefined, 'packet');
  });
  it('requires deliberate child selection when both siblings are assigned', async () => {
    mocks.family.mockResolvedValue({ tasks: [{}] });
    render(
      <MemoryRouter initialEntries={['/practice-resources?teamId=team&assignmentId=packet']}>
        <PlayerResourcePackets auth={auth} />
      </MemoryRouter>
    );
    expect(await screen.findByRole('link', { name: 'One · Team' })).toHaveAttribute(
      'href',
      '/players/team/one/resources?assignmentId=packet'
    );
    expect(screen.getByRole('link', { name: 'Two · Team' })).toHaveAttribute('href', '/players/team/two/resources?assignmentId=packet');
  });
  it('does not hide an authorization error as a different child or empty list', async () => {
    mocks.family.mockRejectedValue(new Error('Access removed'));
    render(
      <MemoryRouter initialEntries={['/practice-resources?teamId=team&assignmentId=packet']}>
        <PlayerResourcePackets auth={auth} />
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Access removed'));
    expect(screen.queryByText('Assignment for one · One · Team')).not.toBeInTheDocument();
  });
  it('resolves real child and team context on a direct task route', async () => {
    render(
      <MemoryRouter initialEntries={['/players/team/one/resources?assignmentId=packet']}>
        <Routes>
          <Route path="/players/:teamId/:playerId/resources" element={<PlayerResourcePackets auth={auth} />} />
        </Routes>
      </MemoryRouter>
    );
    expect(await screen.findByText('Assignment for one · One · Team')).toBeInTheDocument();
    expect(screen.queryByText(/Selected (team|player)/)).not.toBeInTheDocument();
    expect(mocks.players).toHaveBeenCalledTimes(1);
    expect(mocks.family).not.toHaveBeenCalled();
  });
});
