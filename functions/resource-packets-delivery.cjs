'use strict';
const { ROOT, taskId, isGuardian, isStaff, active, accountBarrierId } = require('./resource-packets-core.cjs');

/** A provider timeout is ambiguous: never automatically resend after claiming
 * dispatch. Inbox writes use the delivery ID; push is at-most-one attempt. */
function createResourcePacketDelivery({ db, auth, enabled, resolveTargets, dispatch, now = () => new Date() }) {
  return async function deliver(teamId, deliveryId) {
    if (!enabled()) return { state: 'disabled' };
    const outboxRef = db.doc(`${ROOT}/${teamId}/outbox/${deliveryId}`);
    const pending = (await outboxRef.get()).data();
    if (!pending || pending.state !== 'pending') return { state: pending?.state || 'missing' };
    const candidates = new Set();
    for (let i = 0; i < pending.playerIds.length; i += 30) {
      const keys = pending.playerIds.slice(i, i + 30).map((id) => `${teamId}::${id}`);
      const users = await db.collection('users').where('parentPlayerKeys', 'array-contains-any', keys).limit(301).get();
      if (users.size > 300) throw new Error('Resource notification audience exceeds its safe bound');
      for (const doc of users.docs) candidates.add(doc.id);
    }
    const enabledUsers = [];
    for (const uid of candidates) {
      const user = await auth.getUser(uid).catch((error) => {
        if (error.code === 'auth/user-not-found') return null;
        throw error;
      });
      if (user && !user.disabled && user.emailVerified && uid !== pending.actorUid) enabledUsers.push(uid);
    }
    // Existing preference/category resolver; never broaden selected players to a team.
    const targets = await resolveTargets(teamId, enabledUsers, pending.actorUid);
    async function authorize(targetUids, expectedState, claim) {
    const actor = await auth.getUser(pending.actorUid).catch((error) => {
      if (error.code === 'auth/user-not-found') return null;
      throw error;
    });
    return db.runTransaction(async (tx) => {
      const current = (await tx.get(outboxRef)).data();
      if (!current || current.state !== expectedState) return null;
      const [team, actorProfile, actorDeletion, actorBarrier] = await Promise.all([tx.get(db.doc(`teams/${teamId}`)), tx.get(db.doc(`users/${current.actorUid}`)), tx.get(db.doc(`accountDeletionRequests/${current.actorUid}`)), tx.get(db.doc(`resourcePacketAccountBarriers/${accountBarrierId(current.actorUid)}`))]);
      if (!active(team.data()) || !active(actorProfile.data()) || actorDeletion.exists || actorBarrier.exists || !actor || actor.disabled || !isStaff(actorProfile.data(), team.data(), { uid: actor.uid, token: { email: actor.email } })) {
        if (claim) tx.update(outboxRef, { state: 'suppressed', recipientCount: 0 });
        return [];
      }
      const tasks = await Promise.all(current.playerIds.map((playerId) => tx.get(db.doc(`${ROOT}/${teamId}/tasks/${taskId(current.assignmentId, playerId)}`))));
      const roster = await Promise.all(current.playerIds.map((playerId) => tx.get(db.doc(`teams/${teamId}/players/${playerId}`))));
      const activePlayers = tasks.filter((doc, index) => active(roster[index].data()) && doc.exists && !doc.data().withdrawn && doc.data().version === current.version).map((doc) => doc.data().playerId);
      const recipients = [];
      for (const uid of targetUids) {
        const [user, deletion, barrier] = await Promise.all([tx.get(db.doc(`users/${uid}`)), tx.get(db.doc(`accountDeletionRequests/${uid}`)), tx.get(db.doc(`resourcePacketAccountBarriers/${accountBarrierId(uid)}`))]);
        if (active(user.data()) && !deletion.exists && !barrier.exists && activePlayers.some((id) => isGuardian(user.data(), teamId, id))) recipients.push(uid);
      }
      if (claim) tx.update(outboxRef, { state: recipients.length ? 'dispatching' : 'suppressed', recipientCount: recipients.length, attemptedAt: now().toISOString() });
      return recipients;
    });
    }
    const targetUids = [...new Set(targets.map((target) => target.uid))].filter((uid) => enabledUsers.includes(uid));
    const allowed = await authorize(targetUids, 'pending', true);
    if (!allowed?.length) return { state: allowed ? 'suppressed' : 'already-claimed' };
    try {
      const result = await dispatch({ teamId, assignmentId: pending.assignmentId, deliveryId, targets: targets.filter((target) => allowed.includes(target.uid)), beforeEffects: async () => {
        if (!enabled()) return false;
        const fresh = await resolveTargets(teamId, allowed, pending.actorUid);
        const freshUids = [...new Set(fresh.map((target) => target.uid))].filter((uid) => allowed.includes(uid));
        const current = await authorize(freshUids, 'dispatching', false);
        if (!current?.length) return false;
        return { allowedUserIds: current, allowedTargetKeys: fresh.filter((target) => current.includes(target.uid)).map((target) => `${target.uid}:${target.deviceId || ''}:${target.token || ''}`) };
      } });
      const state = result === null ? 'suppressed' : result?.failureCount || result?.inboxFailureCount ? 'partial' : 'sent';
      await outboxRef.update({ state, completedAt: now().toISOString() });
      return { state };
    } catch {
      // This update may also fail; durable dispatching still prevents a resend.
      await outboxRef.update({ state: 'uncertain', completedAt: now().toISOString() });
      return { state: 'uncertain' };
    }
  };
}
module.exports = { createResourcePacketDelivery };
