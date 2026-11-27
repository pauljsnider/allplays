// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
const mock = vi.hoisted(() => ({ load: vi.fn(), prepare: vi.fn(), confirm: vi.fn() }));
vi.mock('../lib/mcpActionReviewService', () => ({
  loadMcpActionReview: mock.load,
  prepareMcpActionReview: mock.prepare,
  confirmMcpActionReview: mock.confirm
}));
import { McpActionReview } from './McpActionReview';
const requestId = '00112233-4455-4677-8899-aabbccddeeff';
const user = { uid: 'synthetic', email: 'synthetic@example.test', displayName: 'Synthetic', roles: [] };
const request = { requestTool: 'create_team', reviewStatus: 'requested', args: { name: 'Synthetic Bears' } };
const pending = { id: 'ai_synthetic', summary: 'Create Synthetic Bears', args: request.args };
const renderReview = () =>
  render(
    <MemoryRouter initialEntries={[`/ai/mcp/${requestId}`]}>
      <Routes>
        <Route
          path="/ai/mcp/:requestId"
          element={
            <McpActionReview
              auth={{
                user,
                profile: null,
                loading: false,
                error: null,
                roles: [],
                isParent: false,
                isCoach: false,
                isAdmin: false,
                isPlatformAdmin: false,
                refresh: async () => user,
                signOut: async () => {}
              }}
            />
          }
        />
      </Routes>
    </MemoryRouter>
  );
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  mock.load.mockResolvedValue({ request, pending: null });
  mock.prepare.mockResolvedValue({ request: { ...request, reviewStatus: 'prepared' }, pending });
  mock.confirm.mockResolvedValue({ status: 'completed', result: { ok: true } });
});
describe('MCP review screen', () => {
  it('requires separate user clicks to prepare and confirm and never executes on link opening', async () => {
    renderReview();
    const prepare = await screen.findByRole('button', { name: 'Prepare for review' });
    expect(mock.prepare).not.toHaveBeenCalled();
    fireEvent.click(prepare);
    expect(mock.confirm).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm change' }));
    expect(await screen.findByText('Change completed.')).toBeTruthy();
    expect(mock.confirm).toHaveBeenCalledWith(user, requestId, pending);
    expect(screen.queryByRole('button', { name: 'Confirm change' })).toBeNull();
  });
  it('reconciles a completed confirmation into the rendered terminal status', async () => {
    mock.load.mockResolvedValue({ request: { ...request, reviewStatus: 'prepared' }, pending });
    renderReview();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm change' }));
    expect(await screen.findByText('Status: completed')).toBeTruthy();
    expect(screen.getByText('Change completed.')).toBeTruthy();
    expect(screen.queryByText('Status: prepared')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm change' })).toBeNull();
  });

  it('renders a failed confirmation without claiming completion or offering replay', async () => {
    mock.load.mockResolvedValue({ request: { ...request, reviewStatus: 'prepared' }, pending });
    mock.confirm.mockResolvedValue({ status: 'failed', result: { ok: false, error: 'Synthetic failure.' } });
    renderReview();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm change' }));
    expect(await screen.findByText('Status: failed')).toBeTruthy();
    expect(screen.getByText('This request did not complete. Check current app data before creating another request.')).toBeTruthy();
    expect(screen.queryByText('Change completed.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm change' })).toBeNull();
  });

  it('reloads and displays only the remaining prepared work after a partial result', async () => {
    const remaining = { ...pending, args: { name: 'Only remaining work' } };
    mock.load
      .mockResolvedValueOnce({ request: { ...request, reviewStatus: 'prepared' }, pending })
      .mockResolvedValueOnce({ request: { ...request, reviewStatus: 'partial' }, pending: remaining });
    mock.confirm.mockResolvedValue({ status: 'partial', result: { ok: true, requiresConfirmation: true } });
    renderReview();
    fireEvent.click(await screen.findByRole('button', { name: 'Confirm change' }));
    expect(await screen.findByText('Status: partial')).toBeTruthy();
    expect(screen.getByText('Only remaining work')).toBeTruthy();
    expect(screen.getByText(/Some changes completed/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm remaining changes' })).toBeTruthy();
    expect(screen.queryByText('Change completed.')).toBeNull();
  });

  it('explains an executing request as in progress or uncertain without offering replay', async () => {
    mock.load.mockResolvedValue({ request: { ...request, reviewStatus: 'executing' }, pending: null });
    renderReview();
    expect(await screen.findByText('Status: executing')).toBeTruthy();
    expect(
      screen.getByText(
        'This request may still be executing, or its outcome could not be confirmed. Reload to check its status and do not repeat the change.'
      )
    ).toBeTruthy();
    expect(screen.queryByText('Change completed.')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows denial without controls and does not call prepare or confirm', async () => {
    mock.load.mockRejectedValue(new Error('Review unavailable for this account.'));
    renderReview();
    expect(await screen.findByText('Review unavailable for this account.')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    expect(mock.prepare).not.toHaveBeenCalled();
    expect(mock.confirm).not.toHaveBeenCalled();
  });
  it('blocks duplicate clicks while confirmation is in flight', async () => {
    mock.load.mockResolvedValue({ request: { ...request, reviewStatus: 'prepared' }, pending });
    mock.confirm.mockReturnValue(new Promise(() => {}));
    renderReview();
    const button = await screen.findByRole('button', { name: 'Confirm change' });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(mock.confirm).toHaveBeenCalledTimes(1));
  });
});
