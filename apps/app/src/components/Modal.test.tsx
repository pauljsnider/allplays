// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { Modal } from './Modal';
import { APP_BACK_DISMISS_EVENT } from '../lib/nativeBackButton';

function ModalHarness({ onClose = vi.fn() }: { onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    onClose();
    setOpen(false);
  };
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>Open modal</button>
      {open ? (
        <Modal ariaLabel="Test modal" onClose={close}>
          <section>
            <button type="button">First action</button>
            <button type="button">Last action</button>
          </section>
        </Modal>
      ) : null}
    </div>
  );
}

describe('Modal', () => {
  afterEach(() => {
    cleanup();
    document.body.style.overflow = '';
  });

  it('traps focus, closes from Escape and restores trigger focus', async () => {
    const onClose = vi.fn();
    render(<ModalHarness onClose={onClose} />);

    const trigger = screen.getByRole('button', { name: 'Open modal' });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog', { name: 'Test modal' });
    const first = screen.getByRole('button', { name: 'First action' });
    const last = screen.getByRole('button', { name: 'Last action' });

    await waitFor(() => expect(document.activeElement).toBe(first));
    expect(document.body.style.overflow).toBe('hidden');

    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);

    fireEvent.keyDown(dialog, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Test modal' })).toBeNull());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
  });

  it('closes when the overlay is clicked', async () => {
    const onClose = vi.fn();
    render(<ModalHarness onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open modal' }));
    const dialog = await screen.findByRole('dialog', { name: 'Test modal' });
    fireEvent.mouseDown(dialog);

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Test modal' })).toBeNull());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('handles native Back, releases scroll lock and restores trigger focus', async () => {
    const onClose = vi.fn();
    render(<ModalHarness onClose={onClose} />);

    const trigger = screen.getByRole('button', { name: 'Open modal' });
    trigger.focus();
    fireEvent.click(trigger);
    await screen.findByRole('dialog', { name: 'Test modal' });
    expect(document.body.style.overflow).toBe('hidden');

    const event = new Event(APP_BACK_DISMISS_EVENT, { cancelable: true });
    fireEvent(window, event);

    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Test modal' })).toBeNull());
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
  });
});
