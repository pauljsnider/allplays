import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, it, vi } from 'vitest';
import { HomeAssignments } from './HomeAssignments';
const mocks = vi.hoisted(() => ({ family: vi.fn(), players: vi.fn() }));
vi.mock('../../lib/resourcePacketsService', () => ({
  loadResourcePacketLinkedPlayers: mocks.players,
  loadResourcePacketFamily: mocks.family
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.players.mockResolvedValue({ players: [{ teamId: 'team', playerId: 'child' }] });
});

it('counts unfinished assignments across pages and links the exact child', async () => {
  const task = {
    teamId: 'team',
    playerId: 'child',
    playerName: 'Child',
    assignmentId: 'a',
    title: 'Balance',
    items: [{ resourceId: 'r' }],
    signals: {}
  };
  mocks.family.mockResolvedValueOnce({ tasks: [task], cursors: { tasks: 'a' } }).mockResolvedValueOnce({
    tasks: [{ ...task, assignmentId: 'b', signals: { r: { opened: { value: true } } } }],
    cursors: { tasks: null }
  });
  render(
    <MemoryRouter>
      <HomeAssignments uid="parent" />
    </MemoryRouter>
  );
  await screen.findByText('Video assignments (1 to do)');
  expect(screen.getByRole('link', { name: /Balance/ })).toHaveAttribute('href', '/players/team/child/resources?assignmentId=a');
  expect(mocks.family).toHaveBeenLastCalledWith('team', 'child', 'a');
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it('does not start family reads when linked players arrive after sign-out unmounts Home', async () => {
  const pending = deferred<{ players: { teamId: string; playerId: string }[] }>();
  mocks.players.mockReturnValue(pending.promise);
  const onCount = vi.fn();
  const view = render(
    <MemoryRouter>
      <HomeAssignments uid="parent" onCount={onCount} />
    </MemoryRouter>
  );
  view.unmount();
  await act(async () => {
    pending.resolve({ players: [{ teamId: 'team', playerId: 'child' }] });
  });
  expect(mocks.family).not.toHaveBeenCalled();
  expect(onCount.mock.calls).toEqual([[null]]);
});

it.each(['next-page', 'next-child'] as const)('stops %s requests when an in-flight page finishes after sign-out', async (next) => {
  const pending = deferred<{ tasks: never[]; cursors: { tasks: string | null } }>();
  mocks.players.mockResolvedValue({
    players: [
      { teamId: 'team', playerId: 'child' },
      { teamId: 'team', playerId: 'other' }
    ]
  });
  mocks.family.mockReturnValueOnce(pending.promise).mockResolvedValue({ tasks: [], cursors: { tasks: null } });
  const view = render(
    <MemoryRouter>
      <HomeAssignments uid="parent" />
    </MemoryRouter>
  );
  await waitFor(() => expect(mocks.family).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () => {
    pending.resolve({ tasks: [], cursors: { tasks: next === 'next-page' ? 'cursor' : null } });
  });
  expect(mocks.family).toHaveBeenCalledTimes(1);
});

it('does not continue the previous account load after switching users', async () => {
  const old = deferred<{ players: { teamId: string; playerId: string }[] }>();
  mocks.players.mockReturnValueOnce(old.promise).mockResolvedValue({ players: [] });
  const view = render(
    <MemoryRouter>
      <HomeAssignments uid="old-parent" />
    </MemoryRouter>
  );
  view.rerender(
    <MemoryRouter>
      <HomeAssignments uid="new-parent" />
    </MemoryRouter>
  );
  await screen.findByText(/No videos to open/);
  await act(async () => {
    old.resolve({ players: [{ teamId: 'old-team', playerId: 'old-child' }] });
  });
  expect(mocks.family).not.toHaveBeenCalled();
});
