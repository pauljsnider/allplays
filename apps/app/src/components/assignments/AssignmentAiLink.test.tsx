import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthState } from '../../lib/types';
const native = vi.hoisted(() => vi.fn(() => true));
vi.mock('../../lib/nativeRuntime', () => ({ isNativeRuntime: native }));
vi.mock('../../pages/PrivateAiChat', () => ({
  PrivateAiChat: ({ launchSearch }: { launchSearch: string }) => <div>AI context: {launchSearch}</div>
}));
import { AssignmentAiLink } from './AssignmentAiLink';
afterEach(() => {
  cleanup();
  native.mockReturnValue(true);
});
describe('native composer AI', () => {
  it('keeps the original unsaved form mounted while opening and closing AI', async () => {
    render(
      <MemoryRouter>
        <input aria-label="Unsaved coaching note" defaultValue="Keep balance" />
        <AssignmentAiLink auth={{ user: { uid: 'synthetic-coach' } } as AuthState} to="/ai?teamId=team&prompt=balance">
          Help me with AI (new tab)
        </AssignmentAiLink>
      </MemoryRouter>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Help me with AI' }));
    expect(await screen.findByText('AI context: ?teamId=team&prompt=balance')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Return to unsaved assignment' }));
    expect(screen.getByLabelText('Unsaved coaching note')).toHaveValue('Keep balance');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
  it('keeps the existing new-tab behavior on web', () => {
    native.mockReturnValue(false);
    render(
      <MemoryRouter>
        <AssignmentAiLink auth={{} as AuthState} to="/ai?teamId=team">
          Help me with AI (new tab)
        </AssignmentAiLink>
      </MemoryRouter>
    );
    expect(screen.getByRole('link')).toHaveAttribute('target', '_blank');
  });
});
