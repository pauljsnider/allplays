const functions = require('firebase-functions');
const admin = require('firebase-admin');
const dns = require('node:dns').promises;
const net = require('node:net');

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const firestore = admin.firestore();

function normalizeIcsText(text) {
  const marker = 'BEGIN:VCALENDAR';
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) return text;
  return text.slice(markerIndex);
}

function isPrivateIpAddress(ip) {
  const ipVersion = net.isIP(ip);
  if (!ipVersion) {
    return true;
  }

  if (ipVersion === 4) {
    const parts = ip.split('.').map((part) => Number.parseInt(part, 10));
    if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) {
      return true;
    }
    if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    return false;
  }

  const normalized = ip.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
  return false;
}

function isBlockedHostname(host) {
  const blockedHosts = new Set([
    'localhost',
    '127.0.0.1',
    '0.0.0.0',
    '::1',
    'metadata',
    'metadata.google.internal',
    '169.254.169.254'
  ]);
  return blockedHosts.has(host) || host.endsWith('.local');
}

async function assertPublicHost(host) {
  if (isBlockedHostname(host)) {
    throw new Error('Blocked host');
  }

  if (net.isIP(host) && isPrivateIpAddress(host)) {
    throw new Error('Blocked host address');
  }

  let resolved;
  try {
    resolved = await dns.lookup(host, { all: true, verbatim: true });
  } catch (error) {
    throw new Error('Could not resolve host');
  }

  if (!resolved.length) {
    throw new Error('Could not resolve host');
  }

  for (const entry of resolved) {
    if (isPrivateIpAddress(entry.address)) {
      throw new Error('Blocked host address');
    }
  }
}

async function normalizeTargetUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Missing url');
  }

  let cleaned = rawUrl.trim();
  if (cleaned.startsWith('webcal://')) {
    cleaned = cleaned.replace(/^webcal:\/\//i, 'https://');
  } else if (cleaned.startsWith('http://')) {
    cleaned = cleaned.replace(/^http:\/\//i, 'https://');
  }

  const parsed = new URL(cleaned);
  if (parsed.protocol !== 'https:') {
    throw new Error('Only https calendar URLs are allowed');
  }

  const host = parsed.hostname.toLowerCase();
  await assertPublicHost(host);

  return parsed.toString();
}

async function fetchWithTimeout(url, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'allplays-calendar-fetch/1.0',
        'Accept': 'text/calendar,text/plain,*/*'
      }
    });
    return response;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error('Calendar request timed out');
    }
    throw new Error(`Calendar fetch failed: ${error?.message || 'Unknown network error'}`);
  } finally {
    clearTimeout(timeoutId);
  }
}

function getAllowedOrigins() {
  const configuredOrigins = functions.config()?.calendar?.allowed_origins;
  if (Array.isArray(configuredOrigins)) {
    return configuredOrigins.map((origin) => String(origin).trim()).filter(Boolean);
  }
  if (typeof configuredOrigins === 'string') {
    return configuredOrigins.split(',').map((origin) => origin.trim()).filter(Boolean);
  }
  return [
    'https://allplays.ai',
    'https://www.allplays.ai',
    'http://localhost:8000',
    'http://127.0.0.1:8000'
  ];
}

const allowedOriginSet = new Set(getAllowedOrigins());

function isAllowedOrigin(origin) {
  if (!origin) {
    return true;
  }
  return allowedOriginSet.has(origin);
}

function writeCorsHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && allowedOriginSet.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
  }
  res.set('Access-Control-Allow-Methods', 'GET,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Cache-Control', 'no-store');
}

const calendarServiceAccount =
  functions.config()?.calendar?.service_account ||
  process.env.CALENDAR_FETCH_SERVICE_ACCOUNT ||
  null;
const fetchCalendarRuntime = calendarServiceAccount
  ? { serviceAccount: calendarServiceAccount }
  : {};

exports.fetchCalendarIcs = functions
  .runWith(fetchCalendarRuntime)
  .https
  .onRequest(async (req, res) => {
    writeCorsHeaders(req, res);

    if (!isAllowedOrigin(req.headers.origin)) {
      res.status(403).json({ ok: false, error: 'Origin not allowed' });
      return;
    }

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    try {
      const rawUrl = req.query.url;
      const normalizedUrl = await normalizeTargetUrl(rawUrl);

      const response = await fetchWithTimeout(normalizedUrl);
      if (!response.ok) {
        res.status(502).json({
          ok: false,
          error: `Calendar fetch failed: ${response.status} ${response.statusText}`
        });
        return;
      }

      const rawText = await response.text();
      const icsText = normalizeIcsText(rawText);

      if (!icsText.includes('BEGIN:VCALENDAR')) {
        res.status(502).json({ ok: false, error: 'Response was not valid ICS' });
        return;
      }

      const fetchedAt = new Date().toISOString();

      res.status(200).json({
        ok: true,
        source: 'live',
        fetchedAt,
        icsText
      });
    } catch (error) {
      res.status(400).json({
        ok: false,
        error: error?.message || 'Unknown error'
      });
    }
  });

const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  liveChat: false,
  liveScore: false,
  schedule: false
});

function normalizeNotificationPreferences(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  return {
    liveChat: source.liveChat === true,
    liveScore: source.liveScore === true,
    schedule: source.schedule === true
  };
}

function toNumericScore(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function normalizeComparableValue(value) {
  if (value == null) {
    return null;
  }

  if (typeof value?.toMillis === 'function') {
    const millis = value.toMillis();
    if (Number.isFinite(millis)) {
      return { __type: 'timestamp', value: millis };
    }
  }

  if (value instanceof Date) {
    return { __type: 'date', value: value.getTime() };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => normalizeComparableValue(entry));
  }

  if (typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((normalized, key) => {
        normalized[key] = normalizeComparableValue(value[key]);
        return normalized;
      }, {});
  }

  return value;
}

function valuesDiffer(beforeValue, afterValue) {
  return JSON.stringify(normalizeComparableValue(beforeValue)) !== JSON.stringify(normalizeComparableValue(afterValue));
}

function detectGameNotificationCategory(beforeGame, afterGame) {
  const beforeHome = toNumericScore(beforeGame?.homeScore);
  const beforeAway = toNumericScore(beforeGame?.awayScore);
  const afterHome = toNumericScore(afterGame?.homeScore);
  const afterAway = toNumericScore(afterGame?.awayScore);
  if (beforeHome !== afterHome || beforeAway !== afterAway) {
    return 'liveScore';
  }

  const scheduleFields = ['date', 'location', 'status', 'opponent', 'title'];
  const scheduleChanged = scheduleFields.some((field) => valuesDiffer(beforeGame?.[field] ?? null, afterGame?.[field] ?? null));

  return scheduleChanged ? 'schedule' : null;
}

function buildNotificationLink({ category, teamId, gameId }) {
  if (category === 'liveChat') {
    return `https://allplays.ai/team-chat.html?teamId=${encodeURIComponent(teamId)}`;
  }
  if (category === 'liveScore' && gameId) {
    return `https://allplays.ai/live-game.html?teamId=${encodeURIComponent(teamId)}&gameId=${encodeURIComponent(gameId)}`;
  }
  return `https://allplays.ai/team.html?teamId=${encodeURIComponent(teamId)}`;
}

async function getUserIdsByEmails(emails) {
  const uniqueEmails = Array.from(new Set(
    (Array.isArray(emails) ? emails : [])
      .map((email) => String(email || '').trim().toLowerCase())
      .filter(Boolean)
  ));
  if (!uniqueEmails.length) return [];

  const ids = new Set();
  const lookupResults = await Promise.allSettled(
    uniqueEmails.map((email) => admin.auth().getUserByEmail(email))
  );
  lookupResults.forEach((result) => {
    if (result.status === 'fulfilled' && result.value?.uid) {
      ids.add(result.value.uid);
    }
  });
  return Array.from(ids);
}

async function getCandidateUserIdsForTeam(teamId) {
  const teamSnap = await firestore.doc(`teams/${teamId}`).get();
  if (!teamSnap.exists) return [];
  const team = teamSnap.data() || {};

  const userIds = new Set();
  if (team.ownerId) userIds.add(team.ownerId);

  const parentSnap = await firestore.collection('users').where('parentTeamIds', 'array-contains', teamId).get();
  parentSnap.forEach((docSnap) => userIds.add(docSnap.id));

  const adminUserIds = await getUserIdsByEmails(team.adminEmails || []);
  adminUserIds.forEach((id) => userIds.add(id));

  return Array.from(userIds);
}

async function getTargetsForCategory(teamId, category, actorUid = null) {
  const userIds = await getCandidateUserIdsForTeam(teamId);
  const queryTasks = userIds
    .filter((uid) => uid && uid !== actorUid)
    .map(async (uid) => {
      const prefRef = firestore.doc(`users/${uid}/notificationPreferences/${teamId}`);
      const devicesRef = firestore.collection(`users/${uid}/notificationDevices`);
      const [prefSnap, devicesSnap] = await Promise.all([
        prefRef.get(),
        devicesRef.get()
      ]);
      const prefs = prefSnap.exists
        ? normalizeNotificationPreferences(prefSnap.data())
        : DEFAULT_NOTIFICATION_PREFERENCES;
      if (prefs[category] !== true) return [];
      return devicesSnap.docs
        .map((docSnap) => {
          const data = docSnap.data() || {};
          const token = String(data.token || '').trim();
          if (!token) return null;
          return {
            uid,
            deviceId: docSnap.id,
            token
          };
        })
        .filter(Boolean);
    });

  const targetGroups = await Promise.all(queryTasks);
  return targetGroups.flat();
}

async function pruneInvalidTokens(sendResult, targets) {
  if (!sendResult || !Array.isArray(sendResult.responses)) return;
  const removableCodes = new Set([
    'messaging/invalid-registration-token',
    'messaging/registration-token-not-registered'
  ]);

  const removals = [];
  sendResult.responses.forEach((response, index) => {
    if (response.success) return;
    const code = response.error?.code;
    if (!removableCodes.has(code)) return;
    const target = targets[index];
    if (!target?.uid || !target?.deviceId) return;
    removals.push(
      firestore.doc(`users/${target.uid}/notificationDevices/${target.deviceId}`).delete()
    );
  });

  if (removals.length) {
    await Promise.allSettled(removals);
  }
}

async function sendCategoryNotification({
  teamId,
  gameId = null,
  category,
  title,
  body,
  actorUid = null,
  linkOverride = null
}) {
  const targets = await getTargetsForCategory(teamId, category, actorUid);
  if (!targets.length) return null;

  const link = linkOverride || buildNotificationLink({ category, teamId, gameId });
  const maxMulticastTokens = 500;
  const allResponses = [];
  let successCount = 0;
  let failureCount = 0;

  for (let i = 0; i < targets.length; i += maxMulticastTokens) {
    const targetChunk = targets.slice(i, i + maxMulticastTokens);
    const sendResult = await admin.messaging().sendEachForMulticast({
      tokens: targetChunk.map((target) => target.token),
      notification: { title, body },
      data: {
        teamId: String(teamId),
        gameId: String(gameId || ''),
        category: String(category),
        link
      },
      webpush: {
        fcmOptions: { link }
      }
    });
    allResponses.push(...(Array.isArray(sendResult.responses) ? sendResult.responses : []));
    successCount += Number(sendResult.successCount || 0);
    failureCount += Number(sendResult.failureCount || 0);
    await pruneInvalidTokens(sendResult, targetChunk);
  }

  return {
    responses: allResponses,
    successCount,
    failureCount
  };
}

function coerceDate(value) {
  if (!value) return null;
  if (typeof value.toDate === 'function') return value.toDate();
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getEventTitle(event) {
  const type = String(event?.type || event?.eventType || '').toLowerCase();
  if (type === 'practice') {
    return event?.title || 'Practice';
  }
  if (event?.title) return event.title;
  return event?.opponent ? `vs. ${event.opponent}` : 'Game';
}

function getReminderDueAt(event) {
  const notifications = event?.scheduleNotifications || {};
  const explicitDueAt = coerceDate(notifications.nextReminderAt);
  if (explicitDueAt) return explicitDueAt;

  const eventDate = coerceDate(event?.date);
  if (!eventDate) return null;
  const reminderHours = Number.parseInt(notifications.reminderHours, 10);
  const supportedHours = [24, 48, 72].includes(reminderHours) ? reminderHours : 24;
  return new Date(eventDate.getTime() - supportedHours * 60 * 60 * 1000);
}

function isEligibleForPreEventReminder(event, now = new Date()) {
  const notifications = event?.scheduleNotifications || {};
  if (notifications.enabled === false) return false;
  if (notifications.reminderSent === true || notifications.reminderStatus === 'sent') return false;
  if (notifications.reminderStatus === 'sending') return false;
  if (event?.deleted === true || event?.isDeleted === true || event?.deletedAt) return false;

  const status = String(event?.status || '').toLowerCase();
  if (status === 'cancelled' || status === 'canceled' || status === 'deleted') return false;

  const eventDate = coerceDate(event?.date);
  if (!eventDate || eventDate <= now) return false;

  const dueAt = getReminderDueAt(event);
  return Boolean(dueAt && dueAt <= now);
}

function buildPreEventReminderPayload({ teamId, gameId, event }) {
  const eventTitle = getEventTitle(event);
  const eventDate = coerceDate(event?.date);
  const dateText = eventDate
    ? eventDate.toLocaleString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZone: event?.timeZone || 'UTC'
    })
    : 'soon';
  const location = String(event?.location || '').trim();
  const bodyParts = [`${eventTitle} is coming up ${dateText}.`];
  if (location) bodyParts.push(`Location: ${location}`);
  const link = gameId
    ? `https://allplays.ai/game-day.html?teamId=${encodeURIComponent(teamId)}&gameId=${encodeURIComponent(gameId)}`
    : `https://allplays.ai/team.html?teamId=${encodeURIComponent(teamId)}`;

  return {
    title: 'Upcoming team event',
    body: bodyParts.join(' '),
    link
  };
}

async function markReminderSending(eventRef, claimId, now) {
  return firestore.runTransaction(async (transaction) => {
    const snap = await transaction.get(eventRef);
    if (!snap.exists) return null;
    const event = snap.data() || {};
    if (!isEligibleForPreEventReminder(event, now)) return null;
    transaction.update(eventRef, {
      'scheduleNotifications.reminderStatus': 'sending',
      'scheduleNotifications.claimId': claimId,
      'scheduleNotifications.sendingAt': admin.firestore.FieldValue.serverTimestamp()
    });
    return event;
  });
}

async function markReminderSent(eventRef, claimId, sendResult) {
  await eventRef.update({
    'scheduleNotifications.reminderStatus': 'sent',
    'scheduleNotifications.reminderSent': true,
    'scheduleNotifications.reminderSentAt': admin.firestore.FieldValue.serverTimestamp(),
    'scheduleNotifications.sentAt': admin.firestore.FieldValue.serverTimestamp(),
    'scheduleNotifications.nextReminderAt': admin.firestore.FieldValue.delete(),
    'scheduleNotifications.lastSentAt': admin.firestore.FieldValue.serverTimestamp(),
    'scheduleNotifications.lastAction': 'pre_event_reminder',
    'scheduleNotifications.claimId': claimId,
    'scheduleNotifications.pushSuccessCount': Number(sendResult?.successCount || 0),
    'scheduleNotifications.pushFailureCount': Number(sendResult?.failureCount || 0)
  });
}

async function markReminderPendingAfterFailure(eventRef, claimId, error) {
  await eventRef.update({
    'scheduleNotifications.reminderStatus': 'pending',
    'scheduleNotifications.claimId': claimId,
    'scheduleNotifications.lastError': error?.message || 'Unknown reminder push error',
    'scheduleNotifications.lastAttemptAt': admin.firestore.FieldValue.serverTimestamp()
  });
}

async function dispatchDuePreEventReminders(now = new Date()) {
  const dueIso = now.toISOString();
  const dueSnap = await firestore
    .collectionGroup('games')
    .where('scheduleNotifications.nextReminderAt', '<=', dueIso)
    .limit(50)
    .get();

  const results = [];
  for (const docSnap of dueSnap.docs) {
    const eventRef = docSnap.ref;
    const teamRef = eventRef.parent?.parent;
    const teamId = teamRef?.id;
    const gameId = eventRef.id;
    if (!teamId) continue;

    const claimId = `pre-event-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const claimedEvent = await markReminderSending(eventRef, claimId, now);
    if (!claimedEvent) continue;

    try {
      const payload = buildPreEventReminderPayload({ teamId, gameId, event: claimedEvent });
      const sendResult = await sendCategoryNotification({
        teamId,
        gameId,
        category: 'schedule',
        title: payload.title,
        body: payload.body,
        linkOverride: payload.link
      });
      await markReminderSent(eventRef, claimId, sendResult);
      results.push({ teamId, gameId, sent: Number(sendResult?.successCount || 0) });
    } catch (error) {
      await markReminderPendingAfterFailure(eventRef, claimId, error);
      console.error('Failed to dispatch pre-event reminder', { teamId, gameId, error });
    }
  }
  return results;
}

exports.dispatchDuePreEventReminders = functions.pubsub
  .schedule('every 15 minutes')
  .onRun(() => dispatchDuePreEventReminders());

exports.notifyTeamChatMessageCreated = functions.firestore
  .document('teams/{teamId}/chatMessages/{messageId}')
  .onCreate(async (snapshot, context) => {
    const data = snapshot.data() || {};
    const text = String(data.text || '').trim();
    const imageUrl = String(data.imageUrl || '').trim();
    if (!text && !imageUrl) return null;

    const teamId = context.params.teamId;
    const actorUid = data.senderId || null;
    const senderName = String(data.senderName || 'Team').trim();
    const body = text
      ? (text.length > 120 ? `${text.slice(0, 117)}...` : text)
      : 'sent a photo';

    return sendCategoryNotification({
      teamId,
      category: 'liveChat',
      title: `${senderName}: Team Chat`,
      body,
      actorUid
    });
  });

exports.notifyGameUpdated = functions.firestore
  .document('teams/{teamId}/games/{gameId}')
  .onUpdate(async (change, context) => {
    const before = change.before.data() || {};
    const after = change.after.data() || {};
    const category = detectGameNotificationCategory(before, after);
    if (!category) return null;

    const teamId = context.params.teamId;
    const gameId = context.params.gameId;
    const actorUid = after.updatedBy || null;

    if (category === 'liveScore') {
      return sendCategoryNotification({
        teamId,
        gameId,
        category,
        title: 'Live score update',
        body: `Score is now ${toNumericScore(after.homeScore)}-${toNumericScore(after.awayScore)}`,
        actorUid
      });
    }

    return sendCategoryNotification({
      teamId,
      gameId,
      category,
      title: 'Schedule update',
      body: 'A team event was updated. Tap to review the latest details.',
      actorUid
    });
  });
