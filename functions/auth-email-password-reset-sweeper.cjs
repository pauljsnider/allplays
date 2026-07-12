'use strict';

function createPasswordResetEmailSweeper({
  listRequests,
  processRequest,
  logger,
  concurrency = 5
}) {
  async function sweep() {
    const requestDocs = Array.from(await listRequests());
    const workerCount = Math.max(1, Math.min(concurrency, requestDocs.length || 1));
    let nextIndex = 0;
    let failed = 0;

    await Promise.all(Array.from({ length: workerCount }, async () => {
      while (nextIndex < requestDocs.length) {
        const requestDoc = requestDocs[nextIndex];
        nextIndex += 1;
        try {
          await processRequest(requestDoc);
        } catch (error) {
          failed += 1;
          logger.warn('Password-reset backlog request remains queued for retry.', {
            code: error?.code || null,
            requestId: requestDoc.id
          });
        }
      }
    }));

    return { processed: requestDocs.length - failed, failed };
  }

  return { sweep };
}

module.exports = { createPasswordResetEmailSweeper };
