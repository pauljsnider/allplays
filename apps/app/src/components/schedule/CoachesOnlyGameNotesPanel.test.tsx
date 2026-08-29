// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
  load: vi.fn(),
  save: vi.fn()
}));

vi.mock('../../lib/coachesOnlyGameNotesService', () => ({
  COACHES_ONLY_GAME_NOTE_MAX_LENGTH: 5000,
  isCoachesOnlyGameNoteSaveUncertainError: (error: unknown) =>
    Boolean(error && typeof error === 'object' && (error as { mayHaveSaved?: unknown }).mayHaveSaved === true),
  loadCoachesOnlyGameNoteForApp: serviceMocks.load,
  saveCoachesOnlyGameNoteForApp: serviceMocks.save
}));

import type { CoachesOnlyGameNote } from '../../lib/coachesOnlyGameNotesService';
import { buildCoachesOnlyGameNoteScopeKey, CoachesOnlyGameNotesPanel } from './CoachesOnlyGameNotesPanel';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe('CoachesOnlyGameNotesPanel', () => {
  beforeEach(() => {
    serviceMocks.load.mockReset();
    serviceMocks.save.mockReset();
    serviceMocks.load.mockResolvedValue({
      exists: true,
      text: 'Force play toward the sideline.',
      updatedAt: null,
      updatedBy: 'coach-1'
    });
    serviceMocks.save.mockImplementation(async ({ text, userId }) => ({ text, updatedBy: userId }));
  });

  afterEach(() => cleanup());

  it('uses an unambiguous scope key when supported IDs contain colons', () => {
    expect(buildCoachesOnlyGameNoteScopeKey('manager:a', 'team-b', 'game-1')).not.toBe(
      buildCoachesOnlyGameNoteScopeKey('manager', 'a:team-b', 'game-1')
    );
  });

  it('keeps editing disabled until an exact private-note read completes', async () => {
    const pending = deferred<CoachesOnlyGameNote>();
    serviceMocks.load.mockReturnValueOnce(pending.promise);
    render(<CoachesOnlyGameNotesPanel teamId="team-1" gameId="game-1" userId="coach-1" />);

    const editor = screen.getByLabelText('Coaches-only notes');
    expect(editor).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Loading private note');

    pending.resolve({
      exists: true,
      text: 'Force play toward the sideline.',
      updatedAt: null,
      updatedBy: 'coach-1'
    });
    await waitFor(() => expect(editor).toBeEnabled());
    expect(editor).toHaveValue('Force play toward the sideline.');
    expect(screen.getByText(/not included in family views/i)).toBeInTheDocument();
  });

  it('treats a confirmed missing document as an editable empty note', async () => {
    serviceMocks.load.mockResolvedValueOnce({ exists: false, text: '', updatedAt: null, updatedBy: null });
    render(<CoachesOnlyGameNotesPanel teamId="team-1" gameId="game-1" userId="coach-1" />);

    const editor = await screen.findByLabelText('Coaches-only notes');
    await waitFor(() => expect(editor).toBeEnabled());
    expect(editor).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('No private note yet');
  });

  it('fails closed on the first read and retries without presenting a blank note as authoritative', async () => {
    serviceMocks.load
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ exists: true, text: 'Recovered private note', updatedAt: null, updatedBy: 'coach-1' });
    render(<CoachesOnlyGameNotesPanel teamId="team-1" gameId="game-1" userId="coach-1" />);

    const editor = screen.getByLabelText('Coaches-only notes');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Editing is disabled'));
    expect(editor).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(editor).toHaveValue('Recovered private note'));
    expect(editor).toBeEnabled();
    expect(serviceMocks.load).toHaveBeenCalledTimes(2);
  });

  it('saves a manager draft and disables repeat saves after acknowledgement', async () => {
    render(<CoachesOnlyGameNotesPanel teamId="team-1" gameId="game-1" userId="coach-1" />);
    const editor = screen.getByLabelText('Coaches-only notes');
    await waitFor(() => expect(editor).toBeEnabled());

    fireEvent.change(editor, { target: { value: 'Press after every backward pass.' } });
    const saveButton = screen.getByRole('button', { name: 'Save private note' });
    expect(saveButton).toBeEnabled();
    fireEvent.click(saveButton);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Private note saved'));
    expect(serviceMocks.save).toHaveBeenCalledWith({
      teamId: 'team-1',
      gameId: 'game-1',
      userId: 'coach-1',
      text: 'Press after every backward pass.',
      sharedGamePath: ''
    });
    expect(saveButton).toBeDisabled();
  });

  it('preserves the unsaved draft when saving fails', async () => {
    serviceMocks.save.mockRejectedValueOnce(new Error('write denied'));
    render(<CoachesOnlyGameNotesPanel teamId="team-1" gameId="game-1" userId="coach-1" />);
    const editor = screen.getByLabelText('Coaches-only notes');
    await waitFor(() => expect(editor).toBeEnabled());

    fireEvent.change(editor, { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save private note' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Your draft is still here'));
    expect(editor).toHaveValue('Keep this draft');
    expect(editor).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Save private note' })).toBeEnabled();
  });

  it('preserves but locks an uncertain native save until an authoritative reload', async () => {
    serviceMocks.save.mockRejectedValueOnce(Object.assign(new Error('unknown commit'), { mayHaveSaved: true }));
    serviceMocks.load
      .mockResolvedValueOnce({ exists: true, text: 'Original note', updatedAt: null, updatedBy: 'coach-1' })
      .mockResolvedValueOnce({ exists: true, text: 'Uncertain draft', updatedAt: null, updatedBy: 'coach-1' });
    render(<CoachesOnlyGameNotesPanel teamId="team-1" gameId="game-1" userId="coach-1" />);
    const editor = screen.getByLabelText('Coaches-only notes');
    await waitFor(() => expect(editor).toHaveValue('Original note'));

    fireEvent.change(editor, { target: { value: 'Uncertain draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save private note' }));

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('may have saved'));
    expect(editor).toHaveValue('Uncertain draft');
    expect(editor).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save private note' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(editor).toBeEnabled());
    expect(editor).toHaveValue('Uncertain draft');
    expect(screen.getByRole('status')).toHaveTextContent('Private note loaded');
  });

  it('ignores a late note response after switching games', async () => {
    const first = deferred<CoachesOnlyGameNote>();
    serviceMocks.load
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce({ exists: true, text: 'Game two note', updatedAt: null, updatedBy: 'coach-1' });
    const { rerender } = render(<CoachesOnlyGameNotesPanel teamId="team-1" gameId="game-1" userId="coach-1" />);

    rerender(<CoachesOnlyGameNotesPanel teamId="team-1" gameId="game-2" userId="coach-1" />);
    await waitFor(() => expect(screen.getByLabelText('Coaches-only notes')).toHaveValue('Game two note'));
    first.resolve({ exists: true, text: 'Stale game one note', updatedAt: null, updatedBy: 'coach-1' });
    await Promise.resolve();
    expect(screen.getByLabelText('Coaches-only notes')).toHaveValue('Game two note');
  });

  it('blanks immediately and ignores a prior principal response when the signed-in user changes', async () => {
    const first = deferred<CoachesOnlyGameNote>();
    const second = deferred<CoachesOnlyGameNote>();
    serviceMocks.load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerender } = render(<CoachesOnlyGameNotesPanel teamId="team-1" gameId="game-1" userId="manager-a" />);

    rerender(<CoachesOnlyGameNotesPanel teamId="team-1" gameId="game-1" userId="parent-b" />);
    const editor = screen.getByLabelText('Coaches-only notes');
    expect(editor).toBeDisabled();
    expect(editor).toHaveValue('');

    first.resolve({ exists: true, text: 'Manager A private note', updatedAt: null, updatedBy: 'manager-a' });
    await Promise.resolve();
    expect(editor).toHaveValue('');

    second.reject(new Error('permission denied'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Editing is disabled'));
    expect(editor).toHaveValue('');
  });

  it('does not acknowledge an old principal save after the account changes', async () => {
    const pendingSave = deferred<{ text: string; updatedBy: string }>();
    const nextLoad = deferred<CoachesOnlyGameNote>();
    serviceMocks.save.mockReturnValueOnce(pendingSave.promise);
    serviceMocks.load
      .mockResolvedValueOnce({ exists: true, text: 'Manager A note', updatedAt: null, updatedBy: 'manager-a' })
      .mockReturnValueOnce(nextLoad.promise);
    const { rerender } = render(<CoachesOnlyGameNotesPanel teamId="team-1" gameId="game-1" userId="manager-a" />);
    const editor = screen.getByLabelText('Coaches-only notes');
    await waitFor(() => expect(editor).toHaveValue('Manager A note'));
    fireEvent.change(editor, { target: { value: 'Manager A pending save' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save private note' }));

    rerender(<CoachesOnlyGameNotesPanel teamId="team-1" gameId="game-1" userId="parent-b" />);
    expect(editor).toBeDisabled();
    expect(editor).toHaveValue('');
    pendingSave.resolve({ text: 'Manager A pending save', updatedBy: 'manager-a' });
    await Promise.resolve();
    expect(editor).toHaveValue('');
    expect(screen.getByRole('status')).not.toHaveTextContent('Private note saved');

    nextLoad.reject(new Error('permission denied'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Editing is disabled'));
  });

  it('keeps a dirty game-scoped draft when only the selected child changes outside the panel', async () => {
    const { rerender } = render(
      <div data-child="player-1">
        <CoachesOnlyGameNotesPanel teamId="team-1" gameId="game-1" userId="coach-1" />
      </div>
    );
    const editor = screen.getByLabelText('Coaches-only notes');
    await waitFor(() => expect(editor).toBeEnabled());
    fireEvent.change(editor, { target: { value: 'Unsaved game-scoped draft' } });

    rerender(
      <div data-child="player-2">
        <CoachesOnlyGameNotesPanel teamId="team-1" gameId="game-1" userId="coach-1" />
      </div>
    );

    expect(editor).toHaveValue('Unsaved game-scoped draft');
    expect(serviceMocks.load).toHaveBeenCalledTimes(1);
  });
});
