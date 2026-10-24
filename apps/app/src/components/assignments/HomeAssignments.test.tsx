import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { HomeAssignments } from './HomeAssignments';
const mocks = vi.hoisted(() => ({ family: vi.fn() }));
vi.mock('../../lib/resourcePacketsService', () => ({
  loadResourcePacketLinkedPlayers: async () => ({ players: [{ teamId: 'team', playerId: 'child' }] }),
  loadResourcePacketFamily: mocks.family
}));
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
  mocks.family
    .mockResolvedValueOnce({ tasks: [task], cursors: { tasks: 'a' } })
    .mockResolvedValueOnce({
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
