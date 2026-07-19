const crypto = require('node:crypto');

const MAX_TELEMETRY_BODY_BYTES = 64 * 1024;
const MAX_ATTESTED_EVENTS_PER_REQUEST = 15;
// Observe mode must not make an ordinary client batch lossy just because App
// Check is unavailable. Abuse is bounded by the per-client request budget,
// max instances, body size, finite dimensions, and grouped persistence below.
const MAX_UNATTESTED_EVENTS_PER_REQUEST = MAX_ATTESTED_EVENTS_PER_REQUEST;
const ATTESTED_REQUESTS_PER_WINDOW = 30;
const UNATTESTED_REQUESTS_PER_WINDOW = 6;
const TELEMETRY_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const MAX_APP_CHECK_TOKEN_BYTES = 8 * 1024;
const TELEMETRY_AGGREGATE_SHARD_COUNT = 16;
const MAX_TELEMETRY_WRITES_PER_REQUEST = (MAX_ATTESTED_EVENTS_PER_REQUEST * 5) + 1;
const ORDINARY_TELEMETRY_WRITES_PER_REQUEST = MAX_ATTESTED_EVENTS_PER_REQUEST + 5;

const KNOWN_TELEMETRY_EVENT_NAMES = new Set([
  'app_initial_load',
  'app_load_error',
  'app_ux_timing',
  'app_web_vital',
  'app_workflow_timing',
  'interaction_change',
  'interaction_click',
  'interaction_rage_click',
  'interaction_submit',
  'js_error',
  'js_unhandled_rejection',
  'page_leave',
  'page_performance',
  'page_view',
  'scroll_depth',
  'visibility_change'
]);

// Aggregate dimensions must come from a finite, source-controlled vocabulary.
// Raw request strings cannot be allowed to create a new aggregate document.
const KNOWN_TELEMETRY_PAGE_PATHS = new Set([
  '/',
  '/app',
  '/accept-invite.html',
  '/admin.html',
  '/athlete-profile-builder.html',
  '/athlete-profile.html',
  '/beta/cheer/track-cheer-mobile.html',
  '/beta/sub-tracker-prototype.html',
  '/beta/track-basketball-mobile-mock.html',
  '/beta/track-basketball-mock.html',
  '/calendar.html',
  '/certificates.html',
  '/dashboard.html',
  '/drills.html',
  '/edit-config.html',
  '/edit-roster.html',
  '/edit-schedule.html',
  '/edit-team.html',
  '/family.html',
  '/game-day.html',
  '/game-plan.html',
  '/game.html',
  '/help-account.html',
  '/help-game-operations.html',
  '/help-page-reference.html',
  '/help-team-operations.html',
  '/help-watch-chat.html',
  '/help.html',
  '/index.html',
  '/live-game.html',
  '/live-tracker.html',
  '/login.html',
  '/mockups/game-day-command-center.html',
  '/mockups/practice-command-center.html',
  '/officials.html',
  '/organization-schedule.html',
  '/parent-dashboard.html',
  '/player.html',
  '/profile.html',
  '/registration.html',
  '/reset-password.html',
  '/team-chat.html',
  '/team-fees.html',
  '/team-media.html',
  '/team.html',
  '/teams.html',
  '/track-basketball.html',
  '/track-live.html',
  '/track-statsheet.html',
  '/track.html',
  '/tracking-items.html',
  '/verify-pending.html',
  '/widget-scoreboard.html',
  '/workflow-admin-ops.html',
  '/workflow-awards-certificates.html',
  '/workflow-choose-home-dashboard.html',
  '/workflow-communication.html',
  '/workflow-family-sharing.html',
  '/workflow-fees-payments.html',
  '/workflow-game-day.html',
  '/workflow-getting-started.html',
  '/workflow-join-team.html',
  '/workflow-live-tracker.html',
  '/workflow-live-watch-replay.html',
  '/workflow-postgame.html',
  '/workflow-registration.html',
  '/workflow-roster.html',
  '/workflow-schedule.html',
  '/workflow-team-media.html',
  '/workflow-team-setup.html',
  '/workflow-track-game.html'
]);

const KNOWN_TELEMETRY_APP_ROUTES = new Set([
  '/',
  '/accept-invite',
  '/ai',
  '/auth',
  '/discover',
  '/discover/manage',
  '/discover/new',
  '/help',
  '/home',
  '/messages',
  '/officials',
  '/parent-tools',
  '/profile',
  '/profile/settings',
  '/registration',
  '/reset-password',
  '/schedule',
  '/teams',
  '/teams/browse',
  '/teams/new',
  '/verify-pending'
]);

const KNOWN_TELEMETRY_APP_ROUTE_TEMPLATES = [
  { pattern: /^\/capabilities\/[^/]+$/, template: '/capabilities/:id' },
  { pattern: /^\/discover\/inquiries\/[^/]+$/, template: '/discover/inquiries/:id' },
  { pattern: /^\/discover\/opportunities\/[^/]+\/edit$/, template: '/discover/opportunities/:id/edit' },
  { pattern: /^\/discover\/opportunities\/[^/]+$/, template: '/discover/opportunities/:id' },
  { pattern: /^\/family\/[^/]+$/, template: '/family/:id' },
  { pattern: /^\/games\/[^/]+$/, template: '/games/:id' },
  { pattern: /^\/help\/[^/]+$/, template: '/help/:id' },
  { pattern: /^\/messages\/[^/]+$/, template: '/messages/:id' },
  { pattern: /^\/parent-tools\/registrations\/[^/]+\/[^/]+$/, template: '/parent-tools/registrations/:id/:id' },
  { pattern: /^\/parent-tools\/[^/]+$/, template: '/parent-tools/:id' },
  { pattern: /^\/people\/[^/]+$/, template: '/people/:id' },
  { pattern: /^\/players\/[^/]+\/[^/]+$/, template: '/players/:id/:id' },
  { pattern: /^\/players\/[^/]+$/, template: '/players/:id' },
  { pattern: /^\/schedule\/[^/]+\/[^/]+\/track$/, template: '/schedule/:id/:id/track' },
  { pattern: /^\/schedule\/[^/]+\/[^/]+$/, template: '/schedule/:id/:id' },
  { pattern: /^\/teams\/[^/]+\/fees\/[^/]+$/, template: '/teams/:id/fees/:id' },
  { pattern: /^\/teams\/[^/]+\/registrations\/[^/]+$/, template: '/teams/:id/registrations/:id' },
  {
    pattern: /^\/teams\/[^/]+\/(?:certificates|drills|edit|fees|media|public|registration-forms)$/,
    template(value) {
      return value.replace(/^\/teams\/[^/]+\//, '/teams/:id/');
    }
  },
  { pattern: /^\/teams\/[^/]+$/, template: '/teams/:id' }
];

function getHeaderValue(headers = {}, name = '') {
  const matchingKey = Object.keys(headers || {}).find((key) => key.toLowerCase() === name.toLowerCase());
  const value = matchingKey ? headers[matchingKey] : undefined;
  return Array.isArray(value) ? value[0] : value;
}

function getTelemetryBodyByteLength(req = {}) {
  if (Buffer.isBuffer(req.rawBody)) {
    return req.rawBody.length;
  }
  if (Buffer.isBuffer(req.body)) {
    return req.body.length;
  }
  if (typeof req.body === 'string') {
    return Buffer.byteLength(req.body, 'utf8');
  }

  const serialized = JSON.stringify(req.body);
  if (typeof serialized !== 'string') {
    throw new TypeError('Telemetry body is not serializable.');
  }
  return Buffer.byteLength(serialized, 'utf8');
}

function canonicalizeTelemetryEventName(value) {
  return KNOWN_TELEMETRY_EVENT_NAMES.has(value) ? value : 'other_event';
}

function canonicalizeTelemetryPagePath(value) {
  return KNOWN_TELEMETRY_PAGE_PATHS.has(value) ? value : '/other';
}

function canonicalizeTelemetryAppRoute(value) {
  if (KNOWN_TELEMETRY_APP_ROUTES.has(value)) return value;
  const match = KNOWN_TELEMETRY_APP_ROUTE_TEMPLATES.find(({ pattern }) => pattern.test(value));
  if (match) return typeof match.template === 'function' ? match.template(value) : match.template;
  return '/other';
}

async function verifyTelemetryAppCheck(req = {}, verifyToken) {
  const token = String(getHeaderValue(req.headers, 'x-firebase-appcheck') || '').trim();
  if (!token) return { status: 'missing' };
  if (Buffer.byteLength(token, 'utf8') > MAX_APP_CHECK_TOKEN_BYTES) return { status: 'invalid' };
  if (typeof verifyToken !== 'function') return { status: 'invalid' };

  try {
    await verifyToken(token);
    return {
      status: 'verified',
      rateLimitKey: crypto.createHash('sha256').update(token, 'utf8').digest('hex')
    };
  } catch (_error) {
    return { status: 'invalid' };
  }
}

function getTelemetryRateLimitBoundary(appCheck) {
  if (appCheck?.status === 'verified' && /^[a-f0-9]{64}$/.test(appCheck.rateLimitKey || '')) {
    return `verified|${appCheck.rateLimitKey}`;
  }
  // Missing/invalid App Check is limited ephemerally by validated client IP.
  // Never create a durable raw-IP key or a shared global Firestore boundary.
  return null;
}

function getTelemetryIngressPolicy(appCheckStatus) {
  const verified = appCheckStatus === 'verified';
  return {
    verified,
    maxEvents: verified ? MAX_ATTESTED_EVENTS_PER_REQUEST : MAX_UNATTESTED_EVENTS_PER_REQUEST,
    maxRequests: verified ? ATTESTED_REQUESTS_PER_WINDOW : UNATTESTED_REQUESTS_PER_WINDOW
  };
}

function deduplicateTelemetryEvents(events = []) {
  const seen = new Set();
  return events.filter((event) => {
    if (!event?.id || seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

function getTelemetryAggregateShard(events = []) {
  const boundary = events
    .map((event) => String(event?.id || event?.sessionId || '').trim())
    .find(Boolean) || 'empty';
  const value = crypto.createHash('sha256').update(boundary, 'utf8').digest().readUInt32BE(0);
  return `s${String(value % TELEMETRY_AGGREGATE_SHARD_COUNT).padStart(2, '0')}`;
}

module.exports = {
  ATTESTED_REQUESTS_PER_WINDOW,
  KNOWN_TELEMETRY_APP_ROUTES,
  KNOWN_TELEMETRY_EVENT_NAMES,
  KNOWN_TELEMETRY_PAGE_PATHS,
  MAX_APP_CHECK_TOKEN_BYTES,
  MAX_ATTESTED_EVENTS_PER_REQUEST,
  MAX_TELEMETRY_WRITES_PER_REQUEST,
  MAX_TELEMETRY_BODY_BYTES,
  MAX_UNATTESTED_EVENTS_PER_REQUEST,
  ORDINARY_TELEMETRY_WRITES_PER_REQUEST,
  TELEMETRY_AGGREGATE_SHARD_COUNT,
  TELEMETRY_RATE_LIMIT_WINDOW_MS,
  UNATTESTED_REQUESTS_PER_WINDOW,
  canonicalizeTelemetryAppRoute,
  canonicalizeTelemetryEventName,
  canonicalizeTelemetryPagePath,
  deduplicateTelemetryEvents,
  getTelemetryAggregateShard,
  getTelemetryBodyByteLength,
  getTelemetryIngressPolicy,
  getTelemetryRateLimitBoundary,
  verifyTelemetryAppCheck
};
