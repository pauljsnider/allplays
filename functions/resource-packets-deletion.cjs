'use strict';
const { ROOT, accountBarrierId } = require('./resource-packets-core.cjs');

function scrub(value, uid) {
  if (Array.isArray(value)) return value.map((entry) => scrub(entry, uid));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).flatMap(([key, entry]) => {
    if (['actorUid', 'updatedBy', 'publishedBy'].includes(key) && entry === uid) return [];
    // Remove this actor's current signal entirely, preserving co-guardian reports.
    if (['opened', 'watched', 'practiced'].includes(key) && entry?.actorUid === uid) return [];
    return [[key, scrub(entry, uid)]];
  }));
}
async function cleanupResourcePacketAccount(db, uid) {
  if (typeof uid !== 'string' || !uid || uid.includes('/')) throw new Error('Invalid account identity');
  // Every command reads this barrier in its transaction. A racing command must
  // retry and reject, so a completed scan cannot miss new attribution records.
  await db.doc(`resourcePacketAccountBarriers/${accountBarrierId(uid)}`).set({ deleted: true });
  const index = db.collection(`resourcePacketActors/${uid}/records`);
  for (let page = 0; page < 200; page++) {
    const records = await index.limit(50).get();
    if (records.empty) return;
    await db.runTransaction(async (tx) => {
      const refs = records.docs.map((doc) => {
        const path = doc.data().path;
        if (typeof path !== 'string' || !path.startsWith(`${ROOT}/`) || ![4, 6].includes(path.split('/').length)) throw new Error('Invalid resource packet cleanup reference');
        return db.doc(path);
      });
      const docs = await Promise.all(refs.map((ref) => tx.get(ref)));
      for (let i = 0; i < docs.length; i++) {
        const doc = docs[i];
        if (doc.exists) {
          const data = doc.data(); const kind = doc.ref.path.split('/')[2];
          if (['evidence', 'operations'].includes(kind) && data.actorUid === uid) tx.delete(doc.ref);
          else {
            const cleaned = scrub(data, uid);
            if (kind === 'outbox' && data.actorUid === uid && data.state === 'pending') cleaned.state = 'suppressed';
            tx.set(doc.ref, cleaned);
          }
        }
        tx.delete(records.docs[i].ref);
      }
    });
  }
  throw new Error('Resource packet account cleanup requires another bounded pass');
}
module.exports = { cleanupResourcePacketAccount };
