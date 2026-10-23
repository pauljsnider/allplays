'use strict';
const { createResourcePacketsService, PacketError } = require('./resource-packets-core.cjs');
function createResourcePacketHandlers({ functions, db, auth, enabled }) {
  const service = createResourcePacketsService({ db, auth, enabled });
  return Object.fromEntries(['command', 'query'].map((method) => [method, functions.https.onCall(async (data, context) => {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new functions.https.HttpsError('invalid-argument', 'A packet request is required.');
    try { return await service[method](data, context); }
    catch (error) {
      if (error instanceof PacketError) throw new functions.https.HttpsError(error.code, error.message);
      // Never return private documents, account details or provider errors.
      throw new functions.https.HttpsError('internal', 'The packet could not be loaded or saved. Retry with the same request.');
    }
  })]));
}
module.exports = { createResourcePacketHandlers };
