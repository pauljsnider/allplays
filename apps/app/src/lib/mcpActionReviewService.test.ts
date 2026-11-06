import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ records: new Map<string, any>(), run: vi.fn(), execute: vi.fn(), pending: vi.fn(), failSet: false }));
vi.mock('./adapters/legacyPrivateAi', () => ({
  db: {},
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  getDoc: async (ref: string) => ({ data: () => structuredClone(mock.records.get(ref)) }),
  setDoc: async (ref: string, data: any) => {
    if (mock.failSet) throw new Error('response lost');
    mock.records.set(ref, { ...mock.records.get(ref), ...data });
  },
  runTransaction: async (_db: unknown, fn: any) =>
    fn({
      get: async (ref: string) => ({ data: () => structuredClone(mock.records.get(ref)) }),
      update: (ref: string, data: any) => mock.records.set(ref, { ...mock.records.get(ref), ...data })
    })
}));
vi.mock('./privateAiService', () => ({
  runPrivateAiTool: mock.run,
  executeConfirmedPrivateAiAction: mock.execute,
  loadPrivateAiPendingAction: mock.pending,
  fingerprintPrivateAiAction: (action: any) => JSON.stringify({ toolName: action.toolName, args: action.args })
}));
import { confirmMcpActionReview, loadMcpActionReview, prepareMcpActionReview } from './mcpActionReviewService';
const user = { uid: 'owner', email: 'synthetic@example.test', displayName: 'Test', roles: [] };
const requestId = '00112233-4455-4677-8899-aabbccddeeff';
const path = `users/owner/privateAiPendingActions/mcp_${requestId}`;
const pending = {
  id: 'ai_synthetic',
  conversationId: `mcp_${requestId}`,
  toolName: 'create_team',
  args: { name: 'Synthetic Bears' },
  status: 'pending',
  summary: 'Create Synthetic Bears'
};
beforeEach(() => {
  vi.clearAllMocks();
  mock.records.clear();
  mock.failSet = false;
  mock.records.set(path, {
    userId: 'owner',
    toolName: 'mcp_review_request',
    requestTool: 'create_team',
    reviewStatus: 'requested',
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    payloadScope: 'user',
    teamId: '',
    args: pending.args
  });
  mock.run.mockResolvedValue({ ok: true, requiresConfirmation: true, confirmationId: pending.id });
  mock.pending.mockResolvedValue(pending);
  mock.execute.mockResolvedValue({ ok: true, data: { teamId: 'synthetic' } });
});
describe('shared app review lifecycle', () => {
  it('loading cannot prepare or execute and another user cannot read the request', async () => {
    expect((await loadMcpActionReview(user, requestId)).request.reviewStatus).toBe('requested');
    expect(mock.run).not.toHaveBeenCalled();
    expect(mock.execute).not.toHaveBeenCalled();
    await expect(loadMcpActionReview({ ...user, uid: 'other' }, requestId)).rejects.toThrow('signed-in account');
  });
  it('prepares through the same app service, then requires separate explicit confirmation', async () => {
    const review = await prepareMcpActionReview(user, requestId);
    expect(mock.run).toHaveBeenCalledWith(user, { name: 'create_team', args: pending.args }, { conversationId: `mcp_${requestId}` });
    expect(mock.execute).not.toHaveBeenCalled();
    expect(review.request.reviewStatus).toBe('prepared');
    expect((await confirmMcpActionReview(user, requestId, review.pending!)).status).toBe('completed');
    expect(mock.execute).toHaveBeenCalledWith(user, pending.id, JSON.stringify({ toolName: pending.toolName, args: pending.args }));
    await expect(confirmMcpActionReview(user, requestId, review.pending!)).rejects.toThrow('Review');
    expect(mock.execute).toHaveBeenCalledTimes(1);
  });
  it('rejects a stale displayed proposal instead of applying changed arguments', async () => {
    const review = await prepareMcpActionReview(user, requestId);
    mock.pending.mockResolvedValue({ ...pending, args: { name: 'Different' } });
    await expect(confirmMcpActionReview(user, requestId, review.pending!)).rejects.toThrow('details changed');
    expect(mock.execute).not.toHaveBeenCalled();
  });
  it('blocks duplicate preparation, expired requests, and unsupported actions', async () => {
    await prepareMcpActionReview(user, requestId);
    await expect(prepareMcpActionReview(user, requestId)).rejects.toThrow('already being processed');
    expect(mock.run).toHaveBeenCalledTimes(1);
    mock.records.get(path).expiresAt = '2000-01-01T00:00:00Z';
    await expect(loadMcpActionReview(user, requestId)).rejects.toThrow('expired');
    mock.records.get(path).requestTool = 'raw_write';
    await expect(loadMcpActionReview(user, requestId)).rejects.toThrow('signed-in account');
  });
  it('keeps an ambiguous preparation blocked without staging a replacement', async () => {
    mock.failSet = true;
    await expect(prepareMcpActionReview(user, requestId)).rejects.toThrow('response lost');
    expect(mock.records.get(path).reviewStatus).toBe('preparing');
    mock.failSet = false;
    await expect(prepareMcpActionReview(user, requestId)).rejects.toThrow('already being processed');
    expect(mock.run).toHaveBeenCalledTimes(1);
  });
  it('never claims partial work is completed and blocks uncertain execution replay', async () => {
    const review = await prepareMcpActionReview(user, requestId);
    mock.execute.mockResolvedValue({ ok: true, data: { failedCount: 1 }, requiresConfirmation: true });
    expect((await confirmMcpActionReview(user, requestId, review.pending!)).status).toBe('partial');
    mock.records.get(path).reviewStatus = 'prepared';
    mock.failSet = true;
    await expect(confirmMcpActionReview(user, requestId, review.pending!)).rejects.toThrow('response lost');
    expect(mock.records.get(path).reviewStatus).toBe('executing');
    mock.failSet = false;
    await expect(confirmMcpActionReview(user, requestId, review.pending!)).rejects.toThrow('Review');
  });
  it('requires a fresh displayed review before retrying only the remaining partial action', async () => {
    const original = await prepareMcpActionReview(user, requestId);
    mock.execute.mockResolvedValueOnce({ ok: true, requiresConfirmation: true, data: { failedCount: 1 } });
    expect((await confirmMcpActionReview(user, requestId, original.pending!)).status).toBe('partial');
    const remaining = { ...pending, args: { name: 'Only the remaining work' } };
    mock.pending.mockResolvedValue(remaining);
    const nextReview = await loadMcpActionReview(user, requestId);
    await expect(confirmMcpActionReview(user, requestId, original.pending!)).rejects.toThrow('details changed');
    expect((await confirmMcpActionReview(user, requestId, nextReview.pending!)).status).toBe('completed');
    expect(mock.execute).toHaveBeenCalledTimes(2);
    expect(mock.execute.mock.calls[1][2]).toContain('Only the remaining work');
  });

  it('requires the current team-scoped payload, never the user metadata copy', async () => {
    Object.assign(mock.records.get(path), {
      requestTool: 'apply_roster_import',
      payloadScope: 'team',
      teamId: 'team-1',
      args: { rows: ['do not trust'] }
    });
    await expect(loadMcpActionReview(user, requestId)).rejects.toThrow('no longer available');
    mock.records.set(`teams/team-1/privateAiPendingActions/mcp_${requestId}`, {
      userId: user.uid,
      requestTool: 'apply_roster_import',
      args: { teamId: 'team-1', rows: [] }
    });
    expect((await loadMcpActionReview(user, requestId)).request.args.rows).toEqual([]);
  });
});
