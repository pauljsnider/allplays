// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../lib/types';
import { ResourcePackets } from './ResourcePackets';

const resourcePacketMocks = vi.hoisted(() => ({
  loadResourcePacketStaff: vi.fn(),
  resourcePacketCommand: vi.fn()
}));

vi.mock('../lib/resourcePacketsService', () => ({
  loadResourcePacketStaff: resourcePacketMocks.loadResourcePacketStaff,
  packetDueDate: vi.fn(() => null),
  resourcePacketCommand: resourcePacketMocks.resourcePacketCommand,
  resourcePacketsAvailable: vi.fn(() => true)
}));

vi.mock('../lib/teamDrillsService', () => ({
  loadTeamDrillLibraryPage: vi.fn()
}));

const auth = {
  user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Coach' },
  profile: null,
  loading: false
} as AuthState;

const assignment = {
  assignmentId: 'packet-1',
  revision: 4,
  publishedVersion: 1,
  title: 'Home footwork',
  notes: 'Five minutes each day.',
  resourceIds: ['resource-1'],
  playerIds: ['player-1'],
  practiceId: null,
  dueAt: null,
  timeZone: 'UTC',
  items: [{ resourceId: 'resource-1', resourceVersion: 1, title: 'Balance drill' }]
};

const staffView = {
  cursors: { resources: null, assignments: null, tasks: null, players: null, practices: null, deliveries: null },
  resources: [{
    resourceId: 'resource-1',
    version: 1,
    title: 'Balance drill',
    teachingPoint: 'Stay balanced.',
    url: 'https://example.com/balance'
  }],
  assignments: [assignment],
  tasks: [],
  players: [{ id: 'player-1', name: 'Player One' }],
  practices: [],
  deliveries: []
};

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/teams/team-1/resources']}>
      <Routes>
        <Route path="/teams/:teamId/resources" element={<ResourcePackets auth={auth} />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ResourcePackets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resourcePacketMocks.loadResourcePacketStaff.mockResolvedValue(staffView);
    resourcePacketMocks.resourcePacketCommand.mockImplementation(async (_uid, command) => {
      if (command.action === 'publish') return { assignmentId: 'packet-1', revision: 5, version: 2 };
      if (command.action === 'saveDraft') return { ...assignment, ...command, revision: 6, publishedVersion: 2 };
      throw new Error(`Unexpected command: ${command.action}`);
    });
  });

  afterEach(cleanup);

  it('uses the revision returned by publish when the open draft is saved again', async () => {
    renderPage();

    await screen.findByRole('heading', { name: 'Home footwork' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit draft' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review publication' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm publish without notification' }));
    await screen.findByText(/Packet published/);

    fireEvent.change(screen.getByLabelText('Notes for families'), {
      target: { value: 'Updated immediately after publishing.' }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save packet draft' }));

    await waitFor(() => {
      expect(resourcePacketMocks.resourcePacketCommand).toHaveBeenLastCalledWith(
        'coach-1',
        expect.objectContaining({
          action: 'saveDraft',
          assignmentId: 'packet-1',
          expectedRevision: 5,
          notes: 'Updated immediately after publishing.'
        })
      );
    });
  });
});
