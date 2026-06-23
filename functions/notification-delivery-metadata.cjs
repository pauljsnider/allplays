const ANDROID_NOTIFICATION_CHANNEL_IDS = Object.freeze({
  messages: 'allplays_messages',
  gameDay: 'allplays_game_day',
  schedule: 'allplays_schedule',
  money: 'allplays_money',
  team: 'allplays_team'
});

const ANDROID_NOTIFICATION_CHANNELS = Object.freeze([
  Object.freeze({
    id: ANDROID_NOTIFICATION_CHANNEL_IDS.messages,
    name: 'Messages',
    description: 'Team chat, direct messages, and mentions.',
    importance: 4
  }),
  Object.freeze({
    id: ANDROID_NOTIFICATION_CHANNEL_IDS.gameDay,
    name: 'Game day',
    description: 'Live scores, game-day alerts, and practice packets.',
    importance: 4
  }),
  Object.freeze({
    id: ANDROID_NOTIFICATION_CHANNEL_IDS.schedule,
    name: 'Schedule',
    description: 'Schedule changes, RSVP reminders, and officiating updates.',
    importance: 3
  }),
  Object.freeze({
    id: ANDROID_NOTIFICATION_CHANNEL_IDS.money,
    name: 'Money',
    description: 'Team fee assignments, reminders, and payment updates.',
    importance: 3
  }),
  Object.freeze({
    id: ANDROID_NOTIFICATION_CHANNEL_IDS.team,
    name: 'Team',
    description: 'Team access, rideshare, media, and award updates.',
    importance: 3
  })
]);

const NOTIFICATION_CATEGORY_DELIVERY = Object.freeze({
  liveChat: Object.freeze({ androidChannelId: ANDROID_NOTIFICATION_CHANNEL_IDS.messages, iosThreadScope: 'messages' }),
  mentions: Object.freeze({ androidChannelId: ANDROID_NOTIFICATION_CHANNEL_IDS.messages, iosThreadScope: 'messages' }),
  liveScore: Object.freeze({ androidChannelId: ANDROID_NOTIFICATION_CHANNEL_IDS.gameDay, iosThreadScope: 'game', iosCollapseScope: 'score' }),
  gameDay: Object.freeze({ androidChannelId: ANDROID_NOTIFICATION_CHANNEL_IDS.gameDay, iosThreadScope: 'game' }),
  schedule: Object.freeze({ androidChannelId: ANDROID_NOTIFICATION_CHANNEL_IDS.schedule, iosThreadScope: 'team' }),
  rsvp: Object.freeze({ androidChannelId: ANDROID_NOTIFICATION_CHANNEL_IDS.schedule, iosThreadScope: 'team' }),
  fees: Object.freeze({ androidChannelId: ANDROID_NOTIFICATION_CHANNEL_IDS.money, iosThreadScope: 'team' }),
  practice: Object.freeze({ androidChannelId: ANDROID_NOTIFICATION_CHANNEL_IDS.gameDay, iosThreadScope: 'team', iosCollapseScope: 'event' }),
  access: Object.freeze({ androidChannelId: ANDROID_NOTIFICATION_CHANNEL_IDS.team, iosThreadScope: 'team' }),
  rideshare: Object.freeze({ androidChannelId: ANDROID_NOTIFICATION_CHANNEL_IDS.team, iosThreadScope: 'team' }),
  media: Object.freeze({ androidChannelId: ANDROID_NOTIFICATION_CHANNEL_IDS.team, iosThreadScope: 'team' }),
  awards: Object.freeze({ androidChannelId: ANDROID_NOTIFICATION_CHANNEL_IDS.team, iosThreadScope: 'team' }),
  officiating: Object.freeze({ androidChannelId: ANDROID_NOTIFICATION_CHANNEL_IDS.schedule, iosThreadScope: 'team' })
});

const WEB_PUSH_NOTIFICATION_ASSETS = Object.freeze({
  icon: '/img/logo_small.png',
  badge: '/img/logo_small.png'
});

function sanitizeDeliverySegment(value) {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildBoundedIdentifier(parts, maxLength = 64) {
  const identifier = parts
    .map((part) => sanitizeDeliverySegment(part))
    .filter(Boolean)
    .join('-');
  if (identifier.length <= maxLength) return identifier;
  return identifier.slice(0, maxLength).replace(/-+$/g, '');
}

function buildIosThreadId({ metadata, teamId, gameId, eventId }) {
  if (metadata?.iosThreadScope === 'messages') {
    return buildBoundedIdentifier(['messages', teamId]);
  }
  if (metadata?.iosThreadScope === 'game') {
    return buildBoundedIdentifier(['game', teamId, gameId || eventId]);
  }
  if (metadata?.iosThreadScope === 'team') {
    return buildBoundedIdentifier(['team', teamId]);
  }
  return '';
}

function buildIosCollapseId({ metadata, teamId, gameId, eventId }) {
  if (metadata?.iosCollapseScope === 'score') {
    return buildBoundedIdentifier(['score', teamId, gameId || eventId]);
  }
  if (metadata?.iosCollapseScope === 'event') {
    return buildBoundedIdentifier(['event', teamId, eventId || gameId]);
  }
  return '';
}

function buildNotificationCollapseTag({ metadata, teamId, gameId, eventId }) {
  if (metadata?.iosCollapseScope === 'score') {
    return buildBoundedIdentifier(['score', teamId, gameId || eventId]);
  }
  if (metadata?.iosCollapseScope === 'event') {
    return buildBoundedIdentifier(['event', teamId, eventId || gameId]);
  }
  return '';
}

function getNotificationDeliveryMetadata(category) {
  return NOTIFICATION_CATEGORY_DELIVERY[category] || null;
}

function buildNotificationDeliveryOptions({ category, teamId, gameId = null, eventId = null, timeSensitive = false } = {}) {
  const metadata = getNotificationDeliveryMetadata(category);
  if (!metadata) return {};

  const collapseTag = buildNotificationCollapseTag({ metadata, teamId, gameId, eventId });
  const android = metadata.androidChannelId
    ? {
        ...(timeSensitive ? { priority: 'high' } : {}),
        notification: {
          channelId: metadata.androidChannelId,
          ...(timeSensitive ? { priority: 'high' } : {}),
          ...(collapseTag ? { tag: collapseTag } : {})
        }
      }
    : undefined;
  const iosThreadId = buildIosThreadId({ metadata, teamId, gameId, eventId });
  const iosCollapseId = buildIosCollapseId({ metadata, teamId, gameId, eventId });
  const aps = iosThreadId || timeSensitive
    ? {
        ...(iosThreadId ? { 'thread-id': iosThreadId } : {}),
        ...(timeSensitive ? { 'interruption-level': 'time-sensitive' } : {})
      }
    : undefined;
  const apnsHeaders = iosCollapseId || timeSensitive
    ? {
        ...(iosCollapseId ? { 'apns-collapse-id': iosCollapseId } : {}),
        ...(timeSensitive ? { 'apns-priority': '10' } : {})
      }
    : undefined;
  const apns = aps || apnsHeaders
    ? {
        ...(apnsHeaders ? { headers: apnsHeaders } : {}),
        ...(aps ? { payload: { aps } } : {})
      }
    : undefined;

  return {
    ...(android ? { android } : {}),
    ...(collapseTag ? { webpush: { notification: { tag: collapseTag } } } : {}),
    ...(apns ? { apns } : {})
  };
}

module.exports = {
  ANDROID_NOTIFICATION_CHANNEL_IDS,
  ANDROID_NOTIFICATION_CHANNELS,
  NOTIFICATION_CATEGORY_DELIVERY,
  WEB_PUSH_NOTIFICATION_ASSETS,
  buildNotificationDeliveryOptions,
  getNotificationDeliveryMetadata
};
