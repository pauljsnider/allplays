// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../lib/types';
import { ResourcePackets } from './ResourcePackets';

const resourcePacketMocks = vi.hoisted(() => ({
  loadResourcePacketStaff: vi.fn(),
  loadResourcePacketYouTubeMetadata: vi.fn(),
  resourcePacketCommand: vi.fn()
}));

vi.mock('../lib/resourcePacketsService', () => ({
  loadResourcePacketStaff: resourcePacketMocks.loadResourcePacketStaff,
  loadResourcePacketYouTubeMetadata: resourcePacketMocks.loadResourcePacketYouTubeMetadata,
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
  teamName: 'Bears',
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
    resourcePacketMocks.loadResourcePacketYouTubeMetadata.mockResolvedValue({
      videoId: 'abcdefghijk',
      title: 'First-touch technique',
      authorName: 'Example Coach',
      thumbnailUrl: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg',
      source: 'youtube_oembed'
    });
    resourcePacketMocks.resourcePacketCommand.mockImplementation(async (_uid, command) => {
      if (command.action === 'publish') return { assignmentId: 'packet-1', revision: 5, version: 2 };
      if (command.action === 'saveDraft') return { ...assignment, ...command, revision: command.expectedRevision + 1 };
      if (command.action === 'saveResource') return { ...command, version: command.expectedRevision + 1 };
      throw new Error(`Unexpected command: ${command.action}`);
    });
  });

  afterEach(cleanup);

  it.each([
    ['pending', 'Retry pending notification'],
    ['dispatching', 'Check interrupted delivery (after 15 minutes)']
  ])('keeps explicit staff recovery for %s notifications', async (state, label) => {
    resourcePacketMocks.loadResourcePacketStaff.mockResolvedValue({
      ...staffView,
      deliveries: [{ deliveryId: 'delivery-1', assignmentId: 'packet-1', version: 1, state }]
    });
    resourcePacketMocks.resourcePacketCommand.mockResolvedValue({
      notification: state === 'pending' ? 'pending' : 'uncertain',
      resent: false
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Home footwork' });
    fireEvent.click(screen.getByRole('button', { name: 'View progress' }));
    fireEvent.click(screen.getByText('Notification status', { exact: true }));
    expect(resourcePacketMocks.resourcePacketCommand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: label }));
    await screen.findByText(/Notification recovery checked/);
    expect(resourcePacketMocks.resourcePacketCommand).toHaveBeenCalledExactlyOnceWith('coach-1', {
      teamId: 'team-1',
      action: 'retryNotification',
      deliveryId: 'delivery-1',
      confirm: true
    });
  });

  it('never offers to resend an uncertain notification', async () => {
    resourcePacketMocks.loadResourcePacketStaff.mockResolvedValue({
      ...staffView,
      deliveries: [{ deliveryId: 'delivery-1', assignmentId: 'packet-1', version: 1, state: 'uncertain' }]
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Home footwork' });
    fireEvent.click(screen.getByRole('button', { name: 'View progress' }));
    fireEvent.click(screen.getByText('Notification status', { exact: true }));
    expect(screen.queryByRole('button', { name: /Retry pending notification|Check interrupted delivery/ })).not.toBeInTheDocument();
    expect(resourcePacketMocks.resourcePacketCommand).not.toHaveBeenCalled();
  });

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
    expect(resourcePacketMocks.resourcePacketCommand).toHaveBeenCalledWith(
      'coach-1',
      expect.objectContaining({ action: 'saveDraft', completionPolicy: 'practice_ack' })
    );
    expect(resourcePacketMocks.resourcePacketCommand).toHaveBeenLastCalledWith(
      'coach-1',
      expect.objectContaining({ action: 'publish', confirm: true, notify: true, expectedRevision: 1 })
    );
  });

  it('prefills official YouTube metadata through the authenticated team service', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Assignments' });
    fireEvent.click(screen.getByRole('button', { name: 'Share a video' }));
    const url = 'https://youtu.be/abcdefghijk';
    const link = screen.getByLabelText('Video link 1');
    fireEvent.change(link, { target: { value: url } });
    fireEvent.blur(link);
    await waitFor(() => expect(screen.getByLabelText('Video title 1')).toHaveValue('First-touch technique'));
    expect(resourcePacketMocks.loadResourcePacketYouTubeMetadata).toHaveBeenCalledExactlyOnceWith('team-1', url);
    expect(screen.getByLabelText('What to focus on (optional)')).toHaveValue('');
    expect(screen.getByText('YouTube · Example Coach')).toBeInTheDocument();
  });

  it('clears an auto-derived title when the URL changes but preserves a coach-edited title', async () => {
    resourcePacketMocks.loadResourcePacketYouTubeMetadata
      .mockResolvedValueOnce({
        videoId: 'abcdefghijk', title: 'First video', authorName: 'Coach One', thumbnailUrl: '', source: 'youtube_oembed'
      })
      .mockResolvedValueOnce({
        videoId: 'lmnopqrstuv', title: 'Second video', authorName: 'Coach Two', thumbnailUrl: '', source: 'youtube_oembed'
      });
    renderPage();
    await screen.findByRole('heading', { name: 'Assignments' });
    fireEvent.click(screen.getByRole('button', { name: 'Share a video' }));
    const link = screen.getByLabelText('Video link 1');
    fireEvent.change(link, { target: { value: 'https://youtu.be/abcdefghijk' } });
    fireEvent.blur(link);
    await waitFor(() => expect(screen.getByLabelText('Video title 1')).toHaveValue('First video'));
    fireEvent.change(link, { target: { value: 'https://youtu.be/lmnopqrstuv' } });
    expect(screen.getByLabelText('Video title 1')).toHaveValue('');
    fireEvent.blur(link);
    await waitFor(() => expect(screen.getByLabelText('Video title 1')).toHaveValue('Second video'));
    fireEvent.change(screen.getByLabelText('Video title 1'), { target: { value: 'My coaching title' } });
    fireEvent.change(link, { target: { value: 'https://youtu.be/zyxwvutsrqp' } });
    expect(screen.getByLabelText('Video title 1')).toHaveValue('My coaching title');
  });

  it('ignores stale metadata that returns after a newer URL preview', async () => {
    let resolveFirst!: (value: unknown) => void;
    let resolveSecond!: (value: unknown) => void;
    resourcePacketMocks.loadResourcePacketYouTubeMetadata.mockImplementation((_teamId, url) => new Promise((resolve) => {
      if (url.includes('abcdefghijk')) resolveFirst = resolve;
      else resolveSecond = resolve;
    }));
    renderPage();
    await screen.findByRole('heading', { name: 'Assignments' });
    fireEvent.click(screen.getByRole('button', { name: 'Share a video' }));
    const link = screen.getByLabelText('Video link 1');
    fireEvent.change(link, { target: { value: 'https://youtu.be/abcdefghijk' } });
    fireEvent.blur(link);
    fireEvent.change(link, { target: { value: 'https://youtu.be/lmnopqrstuv' } });
    fireEvent.blur(link);
    resolveSecond({ videoId: 'lmnopqrstuv', title: 'New title', authorName: 'New author', thumbnailUrl: '', source: 'youtube_oembed' });
    await waitFor(() => expect(screen.getByLabelText('Video title 1')).toHaveValue('New title'));
    resolveFirst({ videoId: 'abcdefghijk', title: 'Stale title', authorName: 'Stale author', thumbnailUrl: '', source: 'youtube_oembed' });
    await waitFor(() => expect(screen.queryByText('YouTube · Stale author')).not.toBeInTheDocument());
    expect(screen.getByLabelText('Video title 1')).toHaveValue('New title');
    expect(screen.getByText('YouTube · New author')).toBeInTheDocument();
  });

  it('previews exact team, audience and per-video practice actions', async () => {
    resourcePacketMocks.loadResourcePacketStaff.mockResolvedValue({
      ...staffView,
      players: [{ id: 'player-1', name: 'Player One' }, { id: 'player-2', name: 'Player Two' }]
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Assignments' });
    fireEvent.click(screen.getByRole('button', { name: 'Share a video' }));
    fireEvent.change(screen.getByLabelText('Video link 1'), { target: { value: 'https://example.com/one' } });
    fireEvent.change(screen.getByLabelText('Video title 1'), { target: { value: 'One' } });
    fireEvent.click(screen.getByText('Whole team', { exact: true }));
    fireEvent.click(screen.getByLabelText('Player Two'));
    fireEvent.click(screen.getByRole('button', { name: 'Add another video' }));
    fireEvent.change(screen.getByLabelText('Video link 2'), { target: { value: 'https://example.com/two' } });
    fireEvent.change(screen.getByLabelText('Video title 2'), { target: { value: 'Two' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview family view' }));
    const dialog = screen.getByRole('dialog', { name: 'Family preview' });
    expect(within(dialog).getByText(/Bears · For Player One · No due date/)).toBeInTheDocument();
    expect(within(dialog).getAllByText('We practiced this')).toHaveLength(2);
    expect(within(dialog).getByText(/Each video has its own practice acknowledgment/)).toBeInTheDocument();
  });

  it('previews legacy completion without a false practice-acknowledgment instruction', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Home footwork' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit assignment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preview family view' }));
    const dialog = screen.getByRole('dialog', { name: 'Family preview' });
    expect(within(dialog).queryByText('We practiced this')).not.toBeInTheDocument();
    expect(within(dialog).getByText(/Opening each video link completes this legacy assignment/)).toBeInTheDocument();
    expect(screen.getByText(/Replaced or added videos need a new link open/)).toBeInTheDocument();
  });

  it('assigns again with a new identity while preserving the exact audience and pinned videos', async () => {
    resourcePacketMocks.loadResourcePacketStaff.mockResolvedValue({
      ...staffView,
      players: [{ id: 'player-1', name: 'Player One' }, { id: 'player-2', name: 'Player Two' }]
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Home footwork' });
    fireEvent.click(screen.getByRole('button', { name: 'Assign again' }));
    expect(screen.getByText('1 player', { exact: true })).toBeInTheDocument();
    expect(screen.getByLabelText('Player One')).toBeChecked();
    expect(screen.getByLabelText('Player Two')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'Assign & notify' }));
    await screen.findByText(/Assignment shared/);
    const commands = resourcePacketMocks.resourcePacketCommand.mock.calls.map((call) => call[1]);
    expect(commands.filter((command) => command.action === 'saveResource')).toHaveLength(0);
    const save = commands.find((command) => command.action === 'saveDraft');
    expect(save).toMatchObject({
      expectedRevision: 0,
      title: 'Home footwork',
      playerIds: ['player-1'],
      resourceVersions: [1],
      completionPolicy: 'practice_ack',
      dueAt: null,
      practiceId: null
    });
    expect(save.assignmentId).not.toBe('packet-1');
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

  it('keeps an existing blank note and legacy completion policy when editing', async () => {
    resourcePacketMocks.loadResourcePacketStaff.mockResolvedValue({
      ...staffView,
      assignments: [{ ...assignment, notes: '' }]
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Home footwork' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit assignment' }));
    expect(screen.getByLabelText('Coaching note (optional)')).toHaveValue('');
    expect(screen.getByText(/keeps its legacy open-to-complete behavior/i)).toBeInTheDocument();
  });

  it('reconciles an intervening assignment edit without losing the local note or overwriting the newer title', async () => {
    const latest = { ...assignment, revision: 5, title: 'Another coach title' };
    let attempts = 0;
    resourcePacketMocks.resourcePacketCommand.mockImplementation(async (_uid, command) => {
      if (command.action === 'saveDraft' && attempts++ === 0) {
        resourcePacketMocks.loadResourcePacketStaff.mockResolvedValue({ ...staffView, assignments: [latest] });
        throw Object.assign(new Error('Assignment changed'), { code: 'functions/aborted' });
      }
      if (command.action === 'saveDraft') return { ...latest, revision: 6 };
      if (command.action === 'publish') return { revision: 7 };
      throw new Error('Unexpected command');
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Home footwork' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit assignment' }));
    fireEvent.change(screen.getByLabelText('Coaching note (optional)'), { target: { value: 'My unsaved note' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
    const reconcile = await screen.findByRole('button', { name: 'Update draft with these choices' });
    expect(screen.getByRole('button', { name: 'Assign without notifying' })).toBeDisabled();
    fireEvent.click(reconcile);
    expect(screen.getByLabelText('Coaching note (optional)')).toHaveValue('My unsaved note');
    fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
    await screen.findByText(/Assignment shared/);
    const saves = resourcePacketMocks.resourcePacketCommand.mock.calls.map((call) => call[1]).filter((c) => c.action === 'saveDraft');
    expect(saves.map((c) => c.expectedRevision)).toEqual([4, 5]);
    expect(saves[1]).toMatchObject({ title: 'Another coach title', notes: 'My unsaved note', resourceVersions: [1] });
  });

  it('requires a choice for overlapping notes and can recover from a second intervening edit', async () => {
    let attempts = 0;
    resourcePacketMocks.resourcePacketCommand.mockImplementation(async (_uid, command) => {
      if (command.action === 'saveDraft') {
        attempts++;
        if (attempts <= 2) {
          resourcePacketMocks.loadResourcePacketStaff.mockResolvedValue({
            ...staffView,
            assignments: [{ ...assignment, revision: 4 + attempts, notes: `Other note ${attempts}` }]
          });
          throw Object.assign(new Error('Assignment changed'), { code: 'functions/aborted' });
        }
        return { ...assignment, revision: 7 };
      }
      if (command.action === 'publish') return { revision: 8 };
      throw new Error('Unexpected command');
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Home footwork' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit assignment' }));
    fireEvent.change(screen.getByLabelText('Coaching note (optional)'), { target: { value: 'My unsaved note' } });
    for (let attempt = 1; attempt <= 2; attempt++) {
      fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
      await screen.findByLabelText(`Latest assignment: Other note ${attempt}`);
      expect(screen.getByRole('button', { name: 'Update draft with these choices' })).toBeDisabled();
      fireEvent.click(screen.getByLabelText('My draft: My unsaved note'));
      fireEvent.click(screen.getByRole('button', { name: 'Update draft with these choices' }));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
    await screen.findByText(/Assignment shared/);
    const saves = resourcePacketMocks.resourcePacketCommand.mock.calls.map((call) => call[1]).filter((c) => c.action === 'saveDraft');
    expect(saves.map((c) => c.expectedRevision)).toEqual([4, 5, 6]);
    expect(saves[2].notes).toBe('My unsaved note');
  });

  it.each(['Keep my video as a separate resource', 'Use latest library video'])(
    'resolves a shared resource conflict explicitly: %s',
    async (choice) => {
      let resourceAttempts = 0;
      const latest = { ...staffView.resources[0], version: 2, url: 'https://example.com/other-coach' };
      resourcePacketMocks.resourcePacketCommand.mockImplementation(async (_uid, command) => {
        if (command.action === 'saveResource') {
          resourceAttempts++;
          if (resourceAttempts === 1) {
            resourcePacketMocks.loadResourcePacketStaff.mockResolvedValue({ ...staffView, resources: [latest] });
            throw Object.assign(new Error('Resource changed'), { code: 'functions/aborted' });
          }
          return { ...command, version: 1 };
        }
        if (command.action === 'saveDraft') return { ...assignment, revision: 5 };
        if (command.action === 'publish') return { revision: 6 };
        throw new Error('Unexpected command');
      });
      renderPage();
      await screen.findByRole('heading', { name: 'Home footwork' });
      fireEvent.click(screen.getByRole('button', { name: 'Edit assignment' }));
      fireEvent.change(screen.getByLabelText('Video link 1'), { target: { value: 'https://example.com/my-edit' } });
      fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
      await screen.findByText(/Latest library video:.*other-coach/);
      expect(screen.queryByRole('button', { name: 'Update draft with these choices' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Assign without notifying' })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: choice }));
      fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
      await screen.findByText(/Assignment shared/);
      const saves = resourcePacketMocks.resourcePacketCommand.mock.calls.map((call) => call[1]).filter((c) => c.action === 'saveResource');
      if (choice === 'Use latest library video') {
        expect(saves).toHaveLength(1);
        expect(resourcePacketMocks.resourcePacketCommand).toHaveBeenCalledWith(
          'coach-1',
          expect.objectContaining({ action: 'saveDraft', resourceVersions: [2] })
        );
      } else {
        expect(saves).toHaveLength(2);
        expect(saves[1].resourceId).not.toBe('resource-1');
        expect(saves[1]).toMatchObject({ expectedRevision: 0, url: 'https://example.com/my-edit' });
      }
    }
  );

  it('pins a successful partial media save when both the assignment and library advance before retry', async () => {
    const local = { ...staffView.resources[0], version: 2, url: 'https://example.com/my-edit' };
    const latest = { ...assignment, revision: 5, title: 'Other coach title' };
    let drafts = 0;
    resourcePacketMocks.resourcePacketCommand.mockImplementation(async (_uid, command) => {
      if (command.action === 'saveResource') return local;
      if (command.action === 'saveDraft' && drafts++ === 0) {
        resourcePacketMocks.loadResourcePacketStaff.mockResolvedValue({
          ...staffView,
          assignments: [latest],
          resources: [{ ...local, version: 3, url: 'https://example.com/other-edit' }]
        });
        throw Object.assign(new Error('Assignment changed'), { code: 'functions/aborted' });
      }
      if (command.action === 'saveDraft') return { ...latest, revision: 6 };
      if (command.action === 'publish') return { revision: 7 };
      throw new Error('Unexpected command');
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Home footwork' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit assignment' }));
    fireEvent.change(screen.getByLabelText('Video link 1'), { target: { value: local.url } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Update draft with these choices' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
    await screen.findByText(/Assignment shared/);
    const commands = resourcePacketMocks.resourcePacketCommand.mock.calls.map((call) => call[1]);
    expect(commands.filter((c) => c.action === 'saveResource')).toHaveLength(1);
    expect(commands.filter((c) => c.action === 'saveDraft').slice(-1)[0]).toMatchObject({
      expectedRevision: 5,
      resourceVersions: [2],
      title: 'Other coach title'
    });
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

  it.each(['Keep my video as a separate resource', 'Use latest library video'])(
    'requires a decision before replacing historical media: %s',
    async (choice) => {
      resourcePacketMocks.loadResourcePacketStaff.mockResolvedValue({
        ...staffView,
        resources: [
          {
            ...staffView.resources[0],
            version: 2,
            title: 'New library title',
            teachingPoint: 'New library instruction',
            url: 'https://example.com/library-update'
          }
        ]
      });
      renderPage();
      await screen.findByRole('heading', { name: 'Home footwork' });
      fireEvent.click(screen.getByRole('button', { name: 'Edit assignment' }));
      fireEvent.change(screen.getByLabelText('Video link 1'), { target: { value: 'https://example.com/replacement' } });
      fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
      await screen.findByText(/Latest library video:.*New library title/);
      expect(resourcePacketMocks.resourcePacketCommand).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: choice }));
      fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
      await screen.findByText(/Assignment shared/);
      const commands = resourcePacketMocks.resourcePacketCommand.mock.calls.map((call) => call[1]);
      const saves = commands.filter((c) => c.action === 'saveResource');
      if (choice === 'Use latest library video') {
        expect(saves).toHaveLength(0);
        expect(commands.find((c) => c.action === 'saveDraft')).toMatchObject({ resourceIds: ['resource-1'], resourceVersions: [2] });
      } else {
        expect(saves).toHaveLength(1);
        expect(saves[0].resourceId).not.toBe('resource-1');
        expect(saves[0]).toMatchObject({ expectedRevision: 0, url: 'https://example.com/replacement' });
      }
    }
  );

  it('requires a decision when editing a partial save after the library advances', async () => {
    const normalCommand = resourcePacketMocks.resourcePacketCommand.getMockImplementation()!;
    let rejectDraft = true;
    resourcePacketMocks.resourcePacketCommand.mockImplementation(async (uid, command) => {
      if (command.action === 'saveDraft' && rejectDraft) {
        rejectDraft = false;
        resourcePacketMocks.loadResourcePacketStaff.mockResolvedValue({
          ...staffView,
          resources: [{ ...staffView.resources[0], version: 3, title: 'Other coach title', url: 'https://example.com/other' }]
        });
        throw Object.assign(new Error('Correct the note.'), { code: 'functions/invalid-argument' });
      }
      return normalCommand(uid, command);
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Home footwork' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit assignment' }));
    fireEvent.change(screen.getByLabelText('Video link 1'), { target: { value: 'https://example.com/partial' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
    await screen.findByText('Correct the note.');
    await waitFor(() => expect(resourcePacketMocks.loadResourcePacketStaff).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText('Video title 1'), { target: { value: 'My subsequent edit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
    await screen.findByRole('heading', { name: 'This library video changed while you were editing' });
    expect(resourcePacketMocks.resourcePacketCommand.mock.calls.filter((call) => call[1].action === 'saveResource')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Keep my video as a separate resource' }));
    fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
    await screen.findByText(/Assignment shared/);
    const saves = resourcePacketMocks.resourcePacketCommand.mock.calls.map((call) => call[1]).filter((c) => c.action === 'saveResource');
    expect(saves).toHaveLength(2);
    expect(saves[1]).toMatchObject({ expectedRevision: 0, title: 'My subsequent edit' });
    expect(saves[1].resourceId).not.toBe('resource-1');
  });

  it.each([
    [2, 3],
    [11, 13]
  ])('loads unequal collection page counts %i/%i without duplicates or cycling', async (resourcePages, assignmentPages) => {
    resourcePacketMocks.loadResourcePacketStaff.mockImplementation(async (_team, cursors) => {
      const r = Number(cursors?.resources || 0);
      const a = Number(cursors?.assignments || 0);
      return {
        ...staffView,
        resources: [{ ...staffView.resources[0], resourceId: `resource-${r}` }],
        assignments: [{ ...assignment, assignmentId: `assignment-${a}`, title: `Assignment page ${a}` }],
        players: [...staffView.players],
        tasks: [],
        practices: [],
        deliveries: [],
        cursors: { resources: r + 1 < resourcePages ? String(r + 1) : null, assignments: a + 1 < assignmentPages ? String(a + 1) : null }
      };
    });
    renderPage();
    await screen.findByRole('heading', { name: `Assignment page ${assignmentPages - 1}` });
    expect(resourcePacketMocks.loadResourcePacketStaff).toHaveBeenCalledTimes(assignmentPages);
    expect(screen.getAllByRole('heading', { name: /Assignment page/ })).toHaveLength(assignmentPages);
    fireEvent.click(screen.getByRole('button', { name: 'Share a video' }));
    expect(screen.getAllByLabelText('Player One')).toHaveLength(1);
    expect(screen.getByLabelText('Player One')).toBeChecked();
  });

  it('pins a successful partial resource save while correcting invalid assignment input', async () => {
    const normalCommand = resourcePacketMocks.resourcePacketCommand.getMockImplementation()!;
    let rejectDraft = true;
    resourcePacketMocks.resourcePacketCommand.mockImplementation(async (uid, command) => {
      if (command.action === 'saveDraft' && rejectDraft) {
        rejectDraft = false;
        resourcePacketMocks.loadResourcePacketStaff.mockResolvedValue({
          ...staffView,
          resources: [{ ...staffView.resources[0], version: 3, url: 'https://example.com/other-coach' }]
        });
        throw Object.assign(new Error('Correct the note and retry.'), { code: 'functions/invalid-argument' });
      }
      return normalCommand(uid, command);
    });
    renderPage();
    await screen.findByRole('heading', { name: 'Home footwork' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit assignment' }));
    fireEvent.change(screen.getByLabelText('Video link 1'), { target: { value: 'https://example.com/replacement' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
    await screen.findByText('Correct the note and retry.');
    await waitFor(() => expect(resourcePacketMocks.loadResourcePacketStaff).toHaveBeenCalledTimes(2));
    fireEvent.change(screen.getByLabelText('Coaching note (optional)'), { target: { value: 'Corrected note.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign without notifying' }));
    await screen.findByText(/Assignment shared/);
    const saves = resourcePacketMocks.resourcePacketCommand.mock.calls
      .map((call) => call[1])
      .filter((command) => command.action === 'saveResource');
    expect(saves.map((command) => command.expectedRevision)).toEqual([1]);
    expect(resourcePacketMocks.resourcePacketCommand).toHaveBeenCalledWith(
      'coach-1',
      expect.objectContaining({ action: 'saveDraft', resourceVersions: [2] })
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
