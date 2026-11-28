'use strict';
const { createResourcePacketsService, PacketError } = require('./resource-packets-core.cjs');

// Firestore/Auth provider failures carry their own code (string, a
// 'firestore/'-prefixed string, or a numeric gRPC code). Forwarding a known
// code lets the client distinguish permission-denied / not-found / timeout /
// unavailable instead of collapsing every linkedPlayers failure into a
// generic 'internal' (#5307). Unknown codes still collapse to 'internal',
// and the message stays generic so no provider internals leak.
const FORWARDABLE_PROVIDER_ERROR_CODES = new Set([
  'aborted',
  'already-exists',
  'deadline-exceeded',
  'failed-precondition',
  'invalid-argument',
  'not-found',
  'permission-denied',
  'resource-exhausted',
  'unauthenticated',
  'unavailable'
]);
const GRPC_CODE_NAMES = {
  3: 'invalid-argument',
  4: 'deadline-exceeded',
  5: 'not-found',
  6: 'already-exists',
  7: 'permission-denied',
  8: 'resource-exhausted',
  9: 'failed-precondition',
  10: 'aborted',
  14: 'unavailable',
  16: 'unauthenticated'
};
function resolveForwardableErrorCode(error) {
  const raw = error?.code;
  const name = typeof raw === 'number'
    ? GRPC_CODE_NAMES[raw]
    : typeof raw === 'string'
      ? raw.replace(/^firestore\//, '').replace(/^functions\//, '')
      : undefined;
  return name && FORWARDABLE_PROVIDER_ERROR_CODES.has(name) ? name : null;
}
function createResourcePacketHandlers({ functions, db, auth, enabled }) {
  const service = createResourcePacketsService({ db, auth, enabled });
  return Object.fromEntries(['command', 'query'].map((method) => [method, functions.https.onCall(async (data, context) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new functions.https.HttpsError('invalid-argument', 'A packet request is required.');
    try { return await service[method](data, context); }
    catch (error) {
      if (error instanceof PacketError) throw new functions.https.HttpsError(error.code, error.message);
      const code = resolveForwardableErrorCode(error);
      if (code) throw new functions.https.HttpsError(code, 'The packet could not be loaded or saved. Retry with the same request.');
      // Never return private documents, account details or provider errors.
      throw new functions.https.HttpsError('internal', 'The packet could not be loaded or saved. Retry with the same request.');
    }
  })]));
}
module.exports = { createResourcePacketHandlers };
