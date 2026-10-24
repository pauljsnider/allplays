import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
  ResourcePacketQueue: ({ children }: { children: { playerId: string }[] }) => <div>Assignment for {children[0].playerId}</div>
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
    await screen.findByText('Assignment for one');
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
    expect(screen.queryByText('Assignment for one')).not.toBeInTheDocument();
  });
});
