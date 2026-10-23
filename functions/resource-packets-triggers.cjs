'use strict';
const { createResourcePacketDelivery } = require('./resource-packets-delivery.cjs');
const { cleanupResourcePacketAccount } = require('./resource-packets-deletion.cjs');
function createResourcePacketTriggers({ functions, ...dependencies }) {
  const deliver = createResourcePacketDelivery(dependencies);
  return {
    published: functions.runWith({ failurePolicy: true }).firestore.document('resourcePacketTeams/{teamId}/outbox/{deliveryId}')
      .onWrite((change, context) => change.after.exists && change.after.data().state === 'pending' ? deliver(context.params.teamId, context.params.deliveryId) : null),
    accountDeleted: functions.runWith({ failurePolicy: true }).auth.user().onDelete((user) => cleanupResourcePacketAccount(dependencies.db, user.uid))
  };
}
module.exports = { createResourcePacketTriggers };
