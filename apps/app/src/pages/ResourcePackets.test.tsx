// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  items: [
    {
      resourceId: 'resource-1',
      resourceVersion: 1,
      title: 'Balance drill',
      url: 'https://example.com/balance',
      teachingPoint: 'Stay balanced.'
    }
  ]
};

const staffView = {
  cursors: { resources: null, assignments: null, tasks: null, players: null, practices: null, deliveries: null },
  resources: [
    {
      resourceId: 'resource-1',
      version: 1,
      title: 'Balance drill',
      teachingPoint: 'Stay balanced.',
      url: 'https://example.com/balance'
    }
  ],
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
      if (command.action === 'saveDraft') return { ...assignment, ...command, revision: command.expectedRevision + 1 };
      if (command.action === 'saveResource') return { ...command, version: command.expectedRevision + 1 };
      throw new Error(`Unexpected command: ${command.action}`);
    });
  });

  afterEach(cleanup);

  it('shares from one composer without resource save or publication wizard', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Assignments' });
    fireEvent.click(screen.getByRole('button', { name: 'Share a video' }));
    fireEvent.change(screen.getByLabelText('Video link 1'), { target: { value: 'https://example.com/video' } });
    fireEvent.change(screen.getByLabelText('Video title 1'), { target: { value: 'Balance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign & notify' }));
    await screen.findByText(/Assignment shared/);
    expect(resourcePacketMocks.resourcePacketCommand.mock.calls.map((call) => call[1].action)).toEqual([
      'saveResource',
      'saveDraft',
      'publish'
    ]);
    expect(resourcePacketMocks.resourcePacketCommand).toHaveBeenLastCalledWith(
      'coach-1',
      expect.objectContaining({ action: 'publish', confirm: true, notify: true, expectedRevision: 1 })
    );
  });

  it('saves edited publication from the current revision and preserves the visible audience', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Home footwork' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit assignment' }));
    fireEvent.change(screen.getByLabelText('Coaching note (optional)'), { target: { value: 'Updated instruction.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
    await screen.findByText(/Assignment shared/);
    expect(resourcePacketMocks.resourcePacketCommand).toHaveBeenCalledWith(
      'coach-1',
      expect.objectContaining({ action: 'saveDraft', expectedRevision: 4, playerIds: ['player-1'], notes: 'Updated instruction.' })
    );
    expect(resourcePacketMocks.resourcePacketCommand).toHaveBeenLastCalledWith(
      'coach-1',
      expect.objectContaining({ action: 'publish', expectedRevision: 5, notify: false })
    );
  });

  it('keeps historical media and completion when a second assignment receives a note-only edit', async () => {
    const newerAssignment = {
      ...assignment,
      assignmentId: 'packet-newer',
      title: 'Updated library assignment',
      items: [
        {
          resourceId: 'resource-1',
          resourceVersion: 2,
          title: 'Updated balance drill',
          teachingPoint: 'Keep your hips level.',
          url: 'https://example.com/updated-balance'
        }
      ]
    };
    const historicalAssignment = { ...assignment, assignmentId: 'packet-historical' };
    resourcePacketMocks.loadResourcePacketStaff.mockResolvedValue({
      ...staffView,
      assignments: [newerAssignment, historicalAssignment],
      resources: [
        {
          resourceId: 'resource-1',
          version: 2,
          title: 'Updated balance drill',
          teachingPoint: 'Keep your hips level.',
          url: 'https://example.com/updated-balance'
        }
      ],
      tasks: [
        {
          teamId: 'team-1',
          assignmentId: 'packet-historical',
          version: 1,
          playerId: 'player-1',
          playerName: 'Player One',
          title: historicalAssignment.title,
          notes: historicalAssignment.notes,
          items: historicalAssignment.items,
          dueAt: null,
          timeZone: 'UTC',
          signals: { 'resource-1': { opened: { value: true, at: '2026-10-23T00:00:00.000Z', actorUid: 'parent-1' } } }
        }
      ]
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Home footwork' });
    const historicalCard = screen.getByRole('heading', { name: 'Home footwork' }).closest('article');
    fireEvent.click(within(historicalCard!).getByRole('button', { name: 'Edit assignment' }));
    expect(screen.getByLabelText('Video title 1')).toHaveValue('Balance drill');
    expect(screen.getByLabelText('Video link 1')).toHaveValue('https://example.com/balance');
    fireEvent.change(screen.getByLabelText('Coaching note (optional)'), { target: { value: 'Updated instruction.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
    await screen.findByText(/Assignment shared/);
    expect(resourcePacketMocks.resourcePacketCommand.mock.calls.map((call) => call[1].action)).toEqual(['saveDraft', 'publish']);
    expect(resourcePacketMocks.resourcePacketCommand).toHaveBeenCalledWith(
      'coach-1',
      expect.objectContaining({ action: 'saveDraft', resourceIds: ['resource-1'], resourceVersions: [1] })
    );
    expect(screen.getAllByText('1 of 1 complete')).toHaveLength(1);
  });

  it('pins the current resource version when an edit explicitly adopts its media', async () => {
    const currentResource = {
      resourceId: 'resource-1',
      version: 2,
      title: 'Balance drill',
      teachingPoint: 'Stay balanced.',
      url: 'https://example.com/updated-balance'
    };
    resourcePacketMocks.loadResourcePacketStaff.mockResolvedValue({
      ...staffView,
      resources: [currentResource]
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Home footwork' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit assignment' }));
    fireEvent.change(screen.getByLabelText('Video link 1'), {
      target: { value: currentResource.url }
    });
    fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
    await screen.findByText(/Assignment shared/);
    expect(resourcePacketMocks.resourcePacketCommand.mock.calls.map((call) => call[1].action)).toEqual(['saveDraft', 'publish']);
    expect(resourcePacketMocks.resourcePacketCommand).toHaveBeenCalledWith(
      'coach-1',
      expect.objectContaining({ action: 'saveDraft', resourceIds: ['resource-1'], resourceVersions: [2] })
    );
  });

  it('uses the known current library revision for a new replacement of historical media', async () => {
    resourcePacketMocks.loadResourcePacketStaff.mockResolvedValue({
      ...staffView,
      resources: [{ ...staffView.resources[0], version: 2, url: 'https://example.com/library-update' }]
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Home footwork' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit assignment' }));
    fireEvent.change(screen.getByLabelText('Video link 1'), { target: { value: 'https://example.com/replacement' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
    await screen.findByText(/Assignment shared/);
    expect(resourcePacketMocks.resourcePacketCommand).toHaveBeenCalledWith(
      'coach-1',
      expect.objectContaining({ action: 'saveResource', expectedRevision: 2, url: 'https://example.com/replacement' })
    );
    expect(resourcePacketMocks.resourcePacketCommand).toHaveBeenCalledWith(
      'coach-1',
      expect.objectContaining({ action: 'saveDraft', resourceVersions: [3] })
    );
  });

  it('restores the original resource version when reverting after a partial save failure', async () => {
    const normalCommand = resourcePacketMocks.resourcePacketCommand.getMockImplementation()!;
    let rejectDraft = true;
    resourcePacketMocks.resourcePacketCommand.mockImplementation(async (uid, command) => {
      if (command.action === 'saveDraft' && rejectDraft) {
        rejectDraft = false;
        throw Object.assign(new Error('Draft rejected; correct the note and retry.'), { code: 'functions/invalid-argument' });
      }
      return normalCommand(uid, command);
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Home footwork' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit assignment' }));
    fireEvent.change(screen.getByLabelText('Video link 1'), { target: { value: 'https://example.com/replacement' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
    await screen.findByText('Draft rejected; correct the note and retry.');
    fireEvent.change(screen.getByLabelText('Video link 1'), { target: { value: 'https://example.com/balance' } });
    fireEvent.change(screen.getByLabelText('Coaching note (optional)'), { target: { value: 'Keep the original exercise.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
    await screen.findByText(/Assignment shared/);
    const commands = resourcePacketMocks.resourcePacketCommand.mock.calls.map((call) => call[1]);
    expect(commands.filter((command) => command.action === 'saveResource')).toHaveLength(1);
    const drafts = commands.filter((command) => command.action === 'saveDraft');
    expect(drafts[drafts.length - 1]).toMatchObject({
      resourceIds: ['resource-1'],
      resourceVersions: [1],
      notes: 'Keep the original exercise.'
    });
  });

  it('carries the full existing composition into AI without navigating away or writing', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Home footwork' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit assignment' }));
    fireEvent.change(screen.getByLabelText('Coaching note (optional)'), { target: { value: 'Keep your eyes up.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add another video' }));
    fireEvent.change(screen.getByLabelText('Video link 2'), { target: { value: 'https://example.com/second' } });
    fireEvent.change(screen.getByLabelText('Video title 2'), { target: { value: 'Second exercise' } });
    fireEvent.change(screen.getByLabelText(/Due date \(/), { target: { value: '2026-11-01T18:30' } });
    const link = screen.getByRole('link', { name: 'Help me with AI (new tab)' });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    const destination = new URL(link.getAttribute('href')!, 'https://example.invalid');
    const prompt = destination.searchParams.get('prompt')!;
    const composition = JSON.parse(prompt.split('Composition: ')[1]);
    expect(composition).toMatchObject({
      teamId: 'team-1',
      assignmentId: 'packet-1',
      expectedRevision: 4,
      title: 'Home footwork',
      notes: 'Keep your eyes up.',
      playerIds: ['player-1'],
      dueLocal: '2026-11-01T18:30',
      notify: false,
      items: [
        { resourceId: 'resource-1', resourceVersion: 1, url: 'https://example.com/balance' },
        { resourceVersion: 0, url: 'https://example.com/second', title: 'Second exercise' }
      ]
    });
    expect(prompt).toContain('explicit confirmation before any save, publication or notification');
    expect(resourcePacketMocks.resourcePacketCommand).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Coaching note (optional)')).toHaveValue('Keep your eyes up.');
    expect(screen.getByLabelText('Video link 2')).toHaveValue('https://example.com/second');
  });

  it('shows a recoverable publication error without discarding the composer', async () => {
    resourcePacketMocks.resourcePacketCommand.mockRejectedValue(new Error('Offline: retry when connected.'));
    renderPage();
    await screen.findByRole('heading', { name: 'Assignments' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit assignment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Video title 1')).toHaveValue('Balance drill');
    expect(screen.getByRole('button', { name: 'Assign without notifying' })).toBeEnabled();
  });
  it('retries an uncertain publication without saving another draft or changing its audience', async () => {
    let attempts = 0;
    resourcePacketMocks.resourcePacketCommand.mockImplementation(async (_uid, command) => {
      if (command.action === 'saveDraft') return { ...assignment, revision: 5 };
      if (command.action === 'publish') {
        if (++attempts === 1) throw new Error('Connection lost after send');
        return { assignmentId: 'packet-1', revision: 6, version: 2 };
      }
      throw new Error('Unexpected write');
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Assignments' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit assignment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
    await screen.findByText(/Connection lost after send/);
    expect(screen.getByLabelText('Coaching note (optional)')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
    await screen.findByText(/Assignment shared/);
    expect(resourcePacketMocks.resourcePacketCommand.mock.calls.map((call) => call[1].action)).toEqual(['saveDraft', 'publish', 'publish']);
    expect(resourcePacketMocks.resourcePacketCommand.mock.calls[1][1]).toEqual(resourcePacketMocks.resourcePacketCommand.mock.calls[2][1]);
  });
});
