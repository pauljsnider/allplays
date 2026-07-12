'use strict';

// Origins allowed to call the public RSVP HTTPS functions with credentials.
// Requests are additionally gated by a bearer ID token + team-permission check,
// so dev/preview origins are safe to allow here — the CORS list only decides
// which browsers may read the response, not who is authorized.
const STATIC_ALLOWED_ORIGINS = new Set([
  'https://allplays.ai',
  'https://www.allplays.ai',
  'https://game-flow-c6311.web.app',
  'https://game-flow-c6311.firebaseapp.com',
  'http://localhost:8000',
  'http://127.0.0.1:8000',
  'http://localhost:8004',
  'http://127.0.0.1:8004'
]);

// Local dev servers (static site + Vite app) on localhost / loopback, any port.
const LOCALHOST_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d{1,5}$/;

// Firebase Hosting preview channels: https://game-flow-c6311--<channel>.web.app
const PREVIEW_CHANNEL_ORIGIN = /^https:\/\/game-flow-c6311--[a-z0-9-]+\.web\.app$/;

function isAllowedPublicRsvpOrigin(origin) {
  if (typeof origin !== 'string' || !origin) return false;
  if (STATIC_ALLOWED_ORIGINS.has(origin)) return true;
  if (LOCALHOST_ORIGIN.test(origin)) return true;
  if (PREVIEW_CHANNEL_ORIGIN.test(origin)) return true;
  return false;
}

module.exports = { isAllowedPublicRsvpOrigin };
