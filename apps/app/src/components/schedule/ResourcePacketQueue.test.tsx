// @vitest-environment jsdom
/* eslint-disable react/no-children-prop -- ResourcePacketQueue intentionally names the linked-player collection `children`. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PacketTask } from '../../lib/resourcePacketsService';
import { ResourcePacketQueue } from './ResourcePacketQueue';

const mocks = vi.hoisted(() => ({
  loadFamily: vi.fn(),
  openLink: vi.fn(),
  command: vi.fn()
}));

vi.mock('../../lib/resourcePacketsService', () => ({
  loadResourcePacketFamily: mocks.loadFamily,
  openResourcePacketLink: mocks.openLink,
  resourcePacketCommand: mocks.command
}));

const item = {
  resourceId: 'video-1',
  resourceVersion: 1,
  title: 'Ball control',
  teachingPoint: 'Keep the ball close.',
  url: 'https://youtu.be/abcdefghijk'
};

const baseTask = (): PacketTask => ({
  teamId: 'team-1',
  assignmentId: 'practice-1',
  version: 1,
  playerId: 'player-1',
  playerName: 'Pat Player',
  title: 'Ball control',
  notes: 'Practice for five minutes.',
  items: [item],
  dueAt: null,
  timeZone: null,
  completionPolicy: 'practice_ack',
  signals: {}
});

function renderQueue() {
  return render(
    <MemoryRouter initialEntries={['/players/team-1/player-1/resources?assignmentId=practice-1']}>
      <ResourcePacketQueue
        uid="guardian-1"
        singlePlayer
        children={[{ teamId: 'team-1', playerId: 'player-1', teamName: 'Bears', playerName: 'Pat Player' }]}
        staffTeams={[]}
      />
    </MemoryRouter>
  );
}

describe('ResourcePacketQueue practice task', () => {
  let task: PacketTask;

  beforeEach(() => {
    vi.clearAllMocks();
    task = baseTask();
    mocks.loadFamily.mockImplementation(async () => ({ tasks: [task], cursors: { tasks: null } }));
    mocks.openLink.mockResolvedValue(undefined);
    mocks.command.mockImplementation(async (_uid, input) => {
      task = {
        ...task,
        signals: {
          ...task.signals,
          [item.resourceId]: {
            ...task.signals[item.resourceId],
            practiced: { value: input.value, at: '2026-10-27T02:00:00.000Z', actorUid: 'guardian-1' }
          }
        }
      };
      return { recorded: true };
    });
  });

  afterEach(cleanup);

  it('keeps external open distinct from persisted practice and supports Undo', async () => {
    renderQueue();
    expect(await screen.findByText('0 of 1 practice items reported')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Open video' }));
    await waitFor(() => expect(mocks.openLink).toHaveBeenCalledOnce());
    expect(screen.getByText('0 of 1 practice items reported')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'We practiced this' }));
    expect(await screen.findByText('Practice reported to the coach')).toBeInTheDocument();
    expect(mocks.command).toHaveBeenCalledWith('guardian-1', expect.objectContaining({ kind: 'practiced', value: true }));

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('0 of 1 practice items reported')).toBeInTheDocument();
    expect(mocks.command).toHaveBeenLastCalledWith('guardian-1', expect.objectContaining({ kind: 'practiced', value: false }));
  });

  it('prevents duplicate acknowledgments while a save is in flight', async () => {
    let resolveSave!: (value: unknown) => void;
    mocks.command.mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    renderQueue();
    const button = await screen.findByRole('button', { name: 'We practiced this' });

    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.command).toHaveBeenCalledOnce();
    expect(button).toBeDisabled();
    await act(async () => resolveSave({ recorded: true }));
  });

  it('shows a retryable save failure without claiming practice was recorded', async () => {
    mocks.command.mockRejectedValue(new Error('Network unavailable'));
    renderQueue();
    fireEvent.click(await screen.findByRole('button', { name: 'We practiced this' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable');
    expect(screen.queryByText('Practice reported to the coach')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'We practiced this' })).toBeEnabled();
  });
});
