// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './ConfirmDialog';

describe('ConfirmDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('confirms through the in-app dialog instead of a native confirm (#5312)', async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        title="Deactivate Pat Star?"
        message="Linked parents may lose access to this team."
        confirmLabel="Deactivate"
        destructive
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );

    const dialog = screen.getByRole('dialog', { name: 'Deactivate Pat Star?' });
    expect(dialog).toBeTruthy();
    expect(screen.getByText('Linked parents may lose access to this team.')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancels without confirming', () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    render(
      <ConfirmDialog
        title="Archive Waiver?"
        message="Archived items can be restored."
        confirmLabel="Archive"
        onConfirm={onConfirm}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('disables both actions while the confirm is busy', () => {
    render(
      <ConfirmDialog
        title="Send RSVP reminder?"
        message="Parents will be emailed."
        confirmLabel="Send reminder"
        confirmBusy
        busyLabel="Sending…"
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />
    );

    expect((screen.getByRole('button', { name: 'Sending…' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
