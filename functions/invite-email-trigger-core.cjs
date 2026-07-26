'use strict';

function createInviteEmailOnCreateHandler({
  shouldQueueInviteEmail,
  autoLinkParentInvite,
  loadLatestInvite,
  queueInviteEmail,
  logger = console
}) {
  return async function handleInviteEmailOnCreate(snapshot, context = {}) {
    const codeData = snapshot?.data?.() || {};
    if (!shouldQueueInviteEmail(codeData)) return null;

    const codeId = String(context?.params?.codeId || snapshot?.id || '').trim();
    let deliveryData = codeData;
    if (String(codeData.type || '').trim().toLowerCase() === 'parent_invite') {
      const generatedBy = String(codeData.generatedBy || '').trim();
      if (generatedBy) {
        try {
          await autoLinkParentInvite(codeId, generatedBy);
        } catch (error) {
          logger.warn('Unable to auto-link a parent invite before email delivery.', {
            error,
            codeId
          });
        }
      }
      deliveryData = await loadLatestInvite(snapshot, codeId);
    }

    await queueInviteEmail(codeId, deliveryData || codeData);
    return null;
  };
}

module.exports = { createInviteEmailOnCreateHandler };
