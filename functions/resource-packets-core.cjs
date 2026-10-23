'use strict';

const { createHash } = require('node:crypto');
const ROOT = 'resourcePacketTeams';
const MAX_PLAYERS = 100;
const MAX_ITEMS = 12;
const digest = (value) => createHash('sha256').update(value).digest('hex');
class PacketError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
function fail(code, message) { throw new PacketError(code, message); }
function id(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) fail('invalid-argument', 'Invalid record identifier.');
  return value;
}
function text(value, max, label) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) fail('invalid-argument', `Enter a valid ${label}.`);
  return value.trim();
}
function externalUrl(value) {
  const raw = text(value, 2048, 'HTTPS link');
  let url;
  try { url = new URL(raw); } catch { fail('invalid-argument', 'Enter a complete HTTPS link.'); }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || url.port || /[\s\x00-\x1f\x7f]/.test(raw)
      || !host.includes('.') || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')
      || host.includes(':') || /^\d+(\.\d+){3}$/.test(host)) fail('invalid-argument', 'Use a public HTTPS link without credentials or a custom port.');
  return url.href;
}
function revision(value) {
  if (!Number.isSafeInteger(value) || value < 0) fail('invalid-argument', 'A valid revision is required.');
  return value;
}
function active(data) { return data && data.deleted !== true && data.isDeleted !== true && data.active !== false && data.status !== 'deleted' && data.status !== 'inactive'; }
function isStaff(profile, team, auth) {
  const email = String(auth.token?.email || '').toLowerCase();
  return profile.isAdmin === true || team.ownerId === auth.uid || (email && (team.adminEmails || []).some((value) => String(value).toLowerCase() === email));
}
function isGuardian(profile, teamId, playerId) {
  return (profile.parentPlayerKeys || []).includes(`${teamId}::${playerId}`);
}
function accountBarrierId(uid) { return digest(uid); }
function taskId(assignmentId, playerId) { return digest(`${assignmentId}:${playerId}`); }

/** All persistent feature state is server-only. Never put evidence in legacy completions. */
function createResourcePacketsService({ db, auth, enabled = () => false, now = () => new Date() }) {
  const ref = (teamId, collection, key) => db.doc(`${ROOT}/${teamId}/${collection}/${key}`);
  async function caller(context) {
    if (!enabled()) fail('failed-precondition', 'Resource packets are not available yet.');
    if (!context.auth?.uid) fail('unauthenticated', 'Sign in to continue.');
    const user = await auth.getUser(context.auth.uid).catch((error) => {
      if (error.code === 'auth/user-not-found') fail('unauthenticated', 'Sign in to continue.');
      throw error;
    });
    if (user.disabled || !user.emailVerified) fail('permission-denied', 'A verified active account is required.');
    if (user.tokensValidAfterTime && Number(context.auth.token?.auth_time || 0) * 1000 < Date.parse(user.tokensValidAfterTime)) fail('unauthenticated', 'Sign in again to continue.');
    return { ...context.auth, token: { ...context.auth.token, email: user.email || '' } };
  }
  async function access(reader, teamId, principal) {
    const [userDoc, teamDoc, deletion, barrier] = await Promise.all([
      reader.get(db.doc(`users/${principal.uid}`)), reader.get(db.doc(`teams/${teamId}`)),
      reader.get(db.doc(`accountDeletionRequests/${principal.uid}`)),
      reader.get(db.doc(`resourcePacketAccountBarriers/${accountBarrierId(principal.uid)}`))
    ]);
    const profile = userDoc.data(); const team = teamDoc.data();
    if (deletion.exists || barrier.exists || !active(profile) || !active(team)) fail('permission-denied', 'This team is unavailable.');
    return { profile, team, staff: isStaff(profile, team, principal) };
  }
  async function roster(reader, teamId, playerIds) {
    if (!playerIds.length || playerIds.length > MAX_PLAYERS) fail('invalid-argument', 'Choose between 1 and 100 players.');
    const docs = await Promise.all(playerIds.map((playerId) => reader.get(db.doc(`teams/${teamId}/players/${id(playerId)}`))));
    if (docs.some((doc) => !active(doc.data()))) fail('failed-precondition', 'An assigned player is no longer active. Refresh the roster.');
    return docs.map((doc) => ({ id: doc.id, name: String(doc.data().name || 'Player').slice(0,100) }));
  }
  async function family(reader, profile, principal, teamId, playerId) {
    const player = (await reader.get(db.doc(`teams/${teamId}/players/${playerId}`))).data();
    if (!active(player)) fail('permission-denied', 'This player is unavailable.');
    const playerOwner = player.userId ?? player.authUid ?? player.accountUserId;
    if (!isGuardian(profile, teamId, playerId) && !(profile.playerKeys || []).includes(`${teamId}::${playerId}`) && playerOwner !== principal.uid) fail('permission-denied', 'This player is not linked to your account.');
  }
  async function command(input, context) {
    const principal = await caller(context);
    const teamId = id(input.teamId); const requestId = id(input.requestId);
    const operationId = digest(`${principal.uid}:${requestId}`);
    const operation = ref(teamId, 'operations', operationId);
    const requestHash = digest(JSON.stringify(input));
    return db.runTransaction(async (tx) => {
      const scope = await access(tx, teamId, principal);
      const existing = await tx.get(operation);
      if (existing.exists) {
        if (existing.data().requestHash !== requestHash) fail('already-exists', 'This retry identifier belongs to a different change.');
        // Re-authorize every replay, including after guardian/staff access changes.
        if (input.action === 'report') {
          await family(tx, scope.profile, principal, teamId, id(input.playerId));
          const currentTask = (await tx.get(ref(teamId, 'tasks', taskId(id(input.assignmentId), input.playerId)))).data();
          if (!currentTask || currentTask.withdrawn || currentTask.version !== input.version) fail('failed-precondition', 'This packet changed. Refresh before reporting.');
        } else if (!scope.staff) fail('permission-denied', 'Team staff access is required.');
        return existing.data().result;
      }
      const at = now().toISOString();
      const remember = (document) => tx.set(db.doc(`resourcePacketActors/${principal.uid}/records/${digest(document.path)}`), { path: document.path });
      let result;
      if (input.action === 'report') {
        const playerId = id(input.playerId); const assignmentId = id(input.assignmentId);
        await family(tx, scope.profile, principal, teamId, playerId);
        const taskRef = ref(teamId, 'tasks', taskId(assignmentId, playerId));
        const taskDoc = await tx.get(taskRef); const task = taskDoc.data();
        if (!task || task.version !== input.version || task.withdrawn) fail('failed-precondition', 'This packet changed. Refresh before reporting.');
        const item = task.items.find((entry) => entry.resourceId === input.resourceId);
        if (!item) fail('invalid-argument', 'This resource is not assigned to this player.');
        if (!['opened', 'watched', 'practiced'].includes(input.kind) || (input.kind !== 'opened' && typeof input.value !== 'boolean')) fail('invalid-argument', 'Choose a valid progress report.');
        const evidence = { schemaVersion: 1, teamId, assignmentId, version: task.version, playerId, resourceId: item.resourceId, resourceVersion: item.resourceVersion, actorUid: principal.uid, kind: input.kind, value: input.kind === 'opened' ? true : input.value, at };
        const signals = { ...(task.signals || {}) };
        signals[item.resourceId] = { ...(signals[item.resourceId] || {}), [input.kind]: { value: evidence.value, at, actorUid: principal.uid } };
        const evidenceRef = ref(teamId, 'evidence', operationId);
        tx.create(evidenceRef, evidence);
        tx.update(taskRef, { signals, updatedAt: at });
        remember(evidenceRef); remember(taskRef);
        result = { recorded: true, at, ...(input.kind === 'opened' ? { url: item.url } : {}) };
      } else {
        if (!scope.staff) fail('permission-denied', 'Team staff access is required.');
        if (input.action === 'retryNotification') {
          if (input.confirm !== true) fail('failed-precondition', 'Confirm notification recovery.');
          const deliveryRef = ref(teamId, 'outbox', id(input.deliveryId));
          const delivery = (await tx.get(deliveryRef)).data();
          if (!delivery) fail('not-found', 'This notification is unavailable.');
          if (delivery.state === 'pending' && !delivery.attemptedAt) {
            tx.update(deliveryRef, { retryRequestedAt: at });
            result = { notification: 'pending' };
          } else if (delivery.state === 'dispatching' && Date.parse(delivery.attemptedAt) < now().getTime() - 15 * 60 * 1000) {
            tx.update(deliveryRef, { state: 'uncertain', reconciledAt: at });
            result = { notification: 'uncertain', resent: false };
          } else fail('failed-precondition', 'This notification cannot be retried safely. No resend was made.');
        } else if (input.action === 'saveResource') {
          const resourceId = id(input.resourceId); const resourceRef = ref(teamId, 'resources', resourceId);
          const previous = await tx.get(resourceRef);
          const current = previous.exists ? previous.data().version : 0;
          if (revision(input.expectedRevision) !== current) fail('aborted', 'This resource changed. Refresh before saving.');
          const resource = { schemaVersion: 1, resourceId, version: current + 1, title: text(input.title, 160, 'title'), teachingPoint: text(input.teachingPoint, 2000, 'teaching point'), url: externalUrl(input.url), updatedAt: at, updatedBy: principal.uid };
          if (input.drillId) {
            const drill = await tx.get(db.doc(`drillLibrary/${id(input.drillId)}`));
            if (!drill.exists || !(drill.data().source === 'community' || drill.data().publishedToCommunity === true || drill.data().teamId === teamId)) fail('permission-denied', 'That library drill is unavailable.');
            resource.drillId = drill.id;
          }
          tx.set(resourceRef, resource);
          tx.create(resourceRef.collection('versions').doc(String(resource.version)), resource);
          remember(resourceRef); remember(resourceRef.collection('versions').doc(String(resource.version)));
          result = resource;
        } else if (input.action === 'saveDraft') {
          const assignmentId = id(input.assignmentId); const assignmentRef = ref(teamId, 'assignments', assignmentId);
          const previous = await tx.get(assignmentRef); const prior = previous.data() || { revision: 0, publishedVersion: 0 };
          if (revision(input.expectedRevision) !== prior.revision) fail('aborted', 'This draft changed. Refresh before saving.');
          if (!Array.isArray(input.resourceIds) || !input.resourceIds.length || input.resourceIds.length > MAX_ITEMS || new Set(input.resourceIds).size !== input.resourceIds.length) fail('invalid-argument', 'Choose 1 to 12 distinct resources.');
          const resources = await Promise.all(input.resourceIds.map((key) => tx.get(ref(teamId, 'resources', id(key)))));
          if (resources.some((doc) => !doc.exists)) fail('failed-precondition', 'A resource is unavailable.');
          const items = resources.map((doc) => { const r = doc.data(); return { resourceId: r.resourceId, resourceVersion: r.version, title: r.title, teachingPoint: r.teachingPoint, url: r.url, ...(r.drillId ? { drillId: r.drillId } : {}) }; });
          if (!Array.isArray(input.playerIds)) fail('invalid-argument', 'Select the assigned players.');
          const players = await roster(tx, teamId, [...new Set(input.playerIds)]);
          let practiceId = null;
          if (input.practiceId) {
            practiceId = id(input.practiceId);
            const event = await tx.get(db.doc(`teams/${teamId}/games/${practiceId}`));
            if (!active(event.data()) || !['practice', 'Practice'].includes(event.data().type)) fail('invalid-argument', 'Choose an active practice on this team.');
          }
          let dueAt = null; let timeZone = null;
          if (input.dueAt) {
            if (typeof input.dueAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.dueAt) || !Number.isFinite(Date.parse(input.dueAt))) fail('invalid-argument', 'Choose a valid due date.');
            dueAt = new Date(input.dueAt).toISOString();
            if (dueAt !== input.dueAt) fail('invalid-argument', 'Choose a real calendar date.');
            timeZone = text(input.timeZone, 80, 'time zone');
            try { new Intl.DateTimeFormat('en', { timeZone }).format(); } catch { fail('invalid-argument', 'Choose a valid time zone.'); }
          }
          const assignment = { schemaVersion: 1, assignmentId, revision: prior.revision + 1, publishedVersion: prior.publishedVersion, title: text(input.title, 160, 'packet title'), notes: input.notes ? text(input.notes, 2000, 'packet notes') : '', items, playerIds: players.map((p) => p.id), practiceId, dueAt, timeZone, updatedAt: at, updatedBy: principal.uid };
          tx.set(assignmentRef, assignment);
          remember(assignmentRef);
          result = assignment;
        } else if (input.action === 'publish') {
          if (input.confirm !== true || typeof input.notify !== 'boolean') fail('failed-precondition', 'Review and explicitly confirm publication and notification intent.');
          const assignmentId = id(input.assignmentId); const assignmentRef = ref(teamId, 'assignments', assignmentId);
          const doc = await tx.get(assignmentRef); const draft = doc.data();
          if (!draft || draft.revision !== revision(input.expectedRevision)) fail('aborted', 'The draft changed. Review it again.');
          const players = await roster(tx, teamId, draft.playerIds);
          const oldTasks = await tx.get(db.collection(`${ROOT}/${teamId}/tasks`).where('assignmentId', '==', assignmentId).where('withdrawn', '==', false).limit(MAX_PLAYERS + 1));
          if (oldTasks.size > MAX_PLAYERS) fail('failed-precondition', 'This assignment exceeds the supported roster size.');
          const version = draft.publishedVersion + 1;
          const publication = { ...draft, version, publishedAt: at, publishedBy: principal.uid, notify: input.notify };
          // Publication attribution belongs to its publisher; do not copy another editor's UID.
          delete publication.updatedBy;
          tx.create(assignmentRef.collection('versions').doc(String(version)), publication);
          remember(assignmentRef.collection('versions').doc(String(version)));
          tx.update(assignmentRef, { publishedVersion: version, revision: draft.revision + 1 });
          for (const old of oldTasks.docs) if (!draft.playerIds.includes(old.data().playerId)) tx.update(old.ref, { withdrawn: true, updatedAt: at });
          for (const player of players) tx.set(ref(teamId, 'tasks', taskId(assignmentId, player.id)), { schemaVersion: 1, teamId, assignmentId, version, playerId: player.id, playerName: player.name, title: draft.title, notes: draft.notes, items: draft.items, practiceId: draft.practiceId, dueAt: draft.dueAt, timeZone: draft.timeZone, signals: {}, withdrawn: false, publishedAt: at, updatedAt: at });
          const deliveryId = digest(`${teamId}:${assignmentId}:${version}`);
          if (input.notify) tx.create(ref(teamId, 'outbox', deliveryId), { teamId, assignmentId, version, playerIds: draft.playerIds, actorUid: principal.uid, state: 'pending', createdAt: at });
          if (input.notify) remember(ref(teamId, 'outbox', deliveryId));
          result = { published: true, assignmentId, version, revision: draft.revision + 1, notification: input.notify ? 'pending' : 'not-requested' };
        } else fail('invalid-argument', 'Unknown packet action.');
      }
      tx.create(operation, { actorUid: principal.uid, requestHash, result, createdAt: at });
      remember(operation);
      return result;
    });
  }
  async function query(input, context) {
    const principal = await caller(context);
    if (input.view === 'linkedPlayers') return db.runTransaction(async (tx) => {
      const [user, deletion, barrier, ...owned] = await Promise.all([
        tx.get(db.doc(`users/${principal.uid}`)), tx.get(db.doc(`accountDeletionRequests/${principal.uid}`)),
        tx.get(db.doc(`resourcePacketAccountBarriers/${accountBarrierId(principal.uid)}`)),
        ...['userId', 'authUid', 'accountUserId'].map(field => tx.get(db.collectionGroup('players').where(field, '==', principal.uid).limit(101)))
      ]);
      const profile = user.data();
      if (!active(profile) || deletion.exists || barrier.exists) fail('permission-denied', 'This account is unavailable.');
      const keys = new Set([...(profile.parentPlayerKeys || []), ...(profile.playerKeys || [])]);
      for (const result of owned) {
        if (result.size > 100) fail('resource-exhausted', 'Too many linked players to load safely.');
        for (const document of result.docs) {
          const parts = document.ref.path.split('/');
          if (parts.length === 4 && parts[0] === 'teams' && parts[2] === 'players') keys.add(`${parts[1]}::${parts[3]}`);
        }
      }
      if (keys.size > 100) fail('resource-exhausted', 'Too many linked players to load safely.');
      const players = [];
      for (const key of keys) {
        if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{1,100}::[A-Za-z0-9_-]{1,100}$/.test(key)) continue;
        const [teamId, playerId] = key.split('::');
        const [team, player] = await Promise.all([tx.get(db.doc(`teams/${teamId}`)), tx.get(db.doc(`teams/${teamId}/players/${playerId}`))]);
        const record = player.data();
        if (!active(team.data()) || !active(record)) continue;
        const owner = record.userId ?? record.authUid ?? record.accountUserId;
        if (!isGuardian(profile, teamId, playerId) && !(profile.playerKeys || []).includes(key) && owner !== principal.uid) continue;
        players.push({ teamId, playerId, teamName: String(team.data().name || 'Team'), playerName: String(record.name || 'Player') });
      }
      return { players };
    }, { readOnly: true });
    const teamId = id(input.teamId);
    return db.runTransaction(async (tx) => {
    const scope = await access(tx, teamId, principal);
    async function page(name, source, size = 100) {
      const cursors = input.cursors || {};
      if (Object.hasOwn(cursors, name) && cursors[name] === null) return { docs: [], cursor: null };
      let ordered = source.orderBy('__name__');
      if (cursors[name]) ordered = ordered.startAfter(id(cursors[name]));
      const result = await tx.get(ordered.limit(size + 1));
      const docs = result.docs.slice(0, size);
      return { docs, cursor: result.size > size ? docs[docs.length - 1].id : null };
    }
    if (input.view === 'staff') {
      if (!scope.staff) fail('permission-denied', 'Team staff access is required.');
      const [resources, assignments, tasks, players, outbox, practices] = await Promise.all([
        page('resources', db.collection(`${ROOT}/${teamId}/resources`)), page('assignments', db.collection(`${ROOT}/${teamId}/assignments`)), page('tasks', db.collection(`${ROOT}/${teamId}/tasks`)), page('players', db.collection(`teams/${teamId}/players`)), page('deliveries', db.collection(`${ROOT}/${teamId}/outbox`)), page('practices', db.collection(`teams/${teamId}/games`).where('type', 'in', ['practice', 'Practice']))
      ]);
      return {
        cursors: { resources: resources.cursor, assignments: assignments.cursor, tasks: tasks.cursor, players: players.cursor, deliveries: outbox.cursor, practices: practices.cursor },
        practices: practices.docs.filter((d) => active(d.data())).map((d) => ({ id: d.id, title: String(d.data().title || d.data().name || 'Practice') })),
        resources: resources.docs.map((d) => d.data()), assignments: assignments.docs.map((d) => d.data()),
        tasks: tasks.docs.filter((d) => !d.data().withdrawn).map((d) => d.data()),
        players: players.docs.filter((d) => active(d.data())).map((d) => ({ id: d.id, name: String(d.data().name || 'Player') })),
        deliveries: outbox.docs.map((d) => ({ deliveryId: d.id, assignmentId: d.data().assignmentId, version: d.data().version, state: d.data().state }))
      };
    }
    if (input.view !== 'family') fail('invalid-argument', 'Unknown packet view.');
    const playerId = id(input.playerId);
    await family(tx, scope.profile, principal, teamId, playerId);
    const tasks = await page('tasks', db.collection(`${ROOT}/${teamId}/tasks`).where('playerId', '==', playerId));
    return { tasks: tasks.docs.filter((d) => !d.data().withdrawn).map((d) => d.data()), cursors: { tasks: tasks.cursor } };
    }, { readOnly: true });
  }
  return { command, query };
}

module.exports = { createResourcePacketsService, externalUrl, PacketError, ROOT, taskId, isGuardian, isStaff, active, accountBarrierId };
