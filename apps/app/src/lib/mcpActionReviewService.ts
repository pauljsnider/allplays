import catalog from './mcpWriteCatalog.json';
import { db, doc, getDoc, runTransaction, setDoc } from './adapters/legacyPrivateAi';
import {
  executeConfirmedPrivateAiAction,
  fingerprintPrivateAiAction,
  loadPrivateAiPendingAction,
  runPrivateAiTool
} from './privateAiService';
import type { AuthUser } from './types';

type ReviewRequest = {
  userId: string;
  toolName: string;
  requestTool: string;
  requestDigest: string;
  reviewStatus: string;
  expiresAt: string;
  payloadScope: string;
  teamId: string;
  args: Record<string, unknown>;
  pendingId?: string;
};

function requestRef(user: AuthUser, requestId: string) {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(requestId)) {
    throw new Error('This review link is invalid.');
  }
  return doc(db, 'users', user.uid, 'privateAiPendingActions', `mcp_${requestId}`);
}

function validateRequest(user: AuthUser, value: ReviewRequest | undefined) {
  const definition = catalog.find((entry) => entry.name === value?.requestTool);
  if (!value || value.userId !== user.uid || value.toolName !== 'mcp_review_request' || !definition) {
    throw new Error('This review request is not available for the signed-in account.');
  }
  if (!Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) {
    throw new Error('This request expired. Ask ChatGPT to prepare a new review request.');
  }
  if (value.payloadScope !== (definition.teamScoped ? 'team' : 'user')) throw new Error('Invalid review scope.');
  return definition;
}

export async function loadMcpActionReview(user: AuthUser, requestId: string) {
  const snapshot = await getDoc(requestRef(user, requestId));
  const request: ReviewRequest = snapshot.data();
  const definition = validateRequest(user, request);
  if (definition.teamScoped) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(request.teamId)) throw new Error('Invalid review team.');
    // Re-read through current manager rules on every visit, including completion.
    const payload = (await getDoc(doc(db, 'teams', request.teamId, 'privateAiPendingActions', `mcp_${requestId}`))).data();
    if (
      !payload ||
      payload.userId !== user.uid ||
      payload.requestTool !== request.requestTool ||
      payload.requestDigest !== request.requestDigest ||
      payload.args?.teamId !== request.teamId
    ) {
      throw new Error('This team review is no longer available.');
    }
    request.args = payload.args;
  }
  const hasPreparedAction = request.reviewStatus === 'prepared' || request.reviewStatus === 'partial';
  const pending = hasPreparedAction && request.pendingId ? await loadPrivateAiPendingAction(user, request.pendingId) : null;
  if (
    hasPreparedAction &&
    (!pending || pending.status !== 'pending' || pending.toolName !== request.requestTool || pending.conversationId !== `mcp_${requestId}`)
  ) {
    throw new Error('The prepared change is no longer pending. Check the app before preparing another change.');
  }
  return { request, description: definition.description, pending };
}

async function transition(user: AuthUser, requestId: string, from: string, to: string, expected: ReviewRequest) {
  const ref = requestRef(user, requestId);
  await runTransaction(db, async (transaction: any) => {
    const request = (await transaction.get(ref)).data();
    validateRequest(user, request);
    if (request.reviewStatus !== from) throw new Error('This request changed or is already being processed. Reload before continuing.');
    if (
      request.requestTool !== expected.requestTool ||
      request.pendingId !== expected.pendingId ||
      request.teamId !== expected.teamId ||
      request.requestDigest !== expected.requestDigest
    ) {
      throw new Error('This request changed. Review it again.');
    }
    transaction.update(ref, { reviewStatus: to });
  });
}

export async function prepareMcpActionReview(user: AuthUser, requestId: string) {
  const { request } = await loadMcpActionReview(user, requestId);
  await transition(user, requestId, 'requested', 'preparing', request);
  // This is the same preparation path as in-app chat, without an LLM call.
  // An uncertain save intentionally remains blocked; never auto-stage a duplicate.
  const result = await runPrivateAiTool(
    user,
    { name: request.requestTool, args: request.args },
    {
      conversationId: `mcp_${requestId}`
    }
  );
  if (!result.ok || !result.requiresConfirmation || !result.confirmationId) {
    await setDoc(requestRef(user, requestId), { reviewStatus: 'failed' }, { merge: true });
    throw new Error(result.error || 'The app could not prepare this change. Nothing was confirmed.');
  }
  await setDoc(requestRef(user, requestId), { reviewStatus: 'prepared', pendingId: result.confirmationId }, { merge: true });
  return loadMcpActionReview(user, requestId);
}

export async function confirmMcpActionReview(
  user: AuthUser,
  requestId: string,
  reviewed: NonNullable<Awaited<ReturnType<typeof loadMcpActionReview>>['pending']>
) {
  const { request, pending } = await loadMcpActionReview(user, requestId);
  if (!pending || !request.pendingId) throw new Error('Review the prepared change first.');
  if (request.pendingId !== reviewed.id || fingerprintPrivateAiAction(pending) !== fingerprintPrivateAiAction(reviewed)) {
    throw new Error('The prepared details changed. Review them again before confirming.');
  }
  await transition(user, requestId, request.reviewStatus, 'executing', request);
  const result = await executeConfirmedPrivateAiAction(user, request.pendingId, fingerprintPrivateAiAction(reviewed));
  const partial = result.requiresConfirmation || Number((result.data as any)?.failedCount || 0) > 0;
  const status = partial ? 'partial' : result.ok ? 'completed' : 'failed';
  // If the result save fails, keep "executing" and report uncertainty. A second
  // confirm cannot replay the request; the existing app action claim also holds.
  await setDoc(requestRef(user, requestId), { reviewStatus: status }, { merge: true });
  return { status, result };
}
