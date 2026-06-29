// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_BACK_DISMISS_EVENT } from '../../../lib/nativeBackButton';
import { Sheet } from './ChatWindow';

afterEach(() => {
  cleanup();
});

describe('Messages Sheet native back behavior', () => {
  it('consumes native back dismiss events and closes the sheet', () => {
    const onClose = vi.fn();

    render(
      <Sheet title="Message audience" onClose={onClose}>
        <button type="button">Selected members</button>
      </Sheet>
    );

    expect(screen.getByRole('dialog', { name: 'Message audience' })).toBeVisible();

    const event = new Event(APP_BACK_DISMISS_EVENT, { cancelable: true });
    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ignores native back dismiss events already consumed by a higher overlay', () => {
    const onClose = vi.fn();

    render(
      <Sheet title="Message audience" onClose={onClose}>
        <button type="button">Selected members</button>
      </Sheet>
    );

    const event = new Event(APP_BACK_DISMISS_EVENT, { cancelable: true });
    event.preventDefault();
    window.dispatchEvent(event);

    expect(onClose).not.toHaveBeenCalled();
  });
});
