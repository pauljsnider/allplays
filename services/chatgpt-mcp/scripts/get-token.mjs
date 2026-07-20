#!/usr/bin/env node
// Sign in to AllPlays (Firebase Auth) and print the refresh token to use as
// the ChatGPT connector's bearer token.
//
// Usage:
//   ALLPLAYS_EMAIL=you@example.com ALLPLAYS_PASSWORD=... node scripts/get-token.mjs
//
// Credentials are read from env only (never argv) so they stay out of shell
// history and process listings.

const API_KEY = process.env.FIREBASE_WEB_API_KEY || 'AIzaSyDoixIoKJuUVWdmImwjYRTthjKOv2mU0Jc';
const email = process.env.ALLPLAYS_EMAIL;
const password = process.env.ALLPLAYS_PASSWORD;

if (!email || !password) {
    console.error('Set ALLPLAYS_EMAIL and ALLPLAYS_PASSWORD environment variables.');
    process.exit(1);
}

// The public API key is referrer-restricted to the AllPlays site, so send the
// site as referer (same key policy the browser clients satisfy naturally).
const REFERER = process.env.ALLPLAYS_REFERER || 'https://allplays.ai/';

const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: REFERER },
    body: JSON.stringify({ email, password, returnSecureToken: true })
});

const body = await response.json();
if (!response.ok) {
    console.error(`Sign-in failed: ${body?.error?.message || response.status}`);
    process.exit(1);
}

console.log(`uid:           ${body.localId}`);
console.log(`refresh token: ${body.refreshToken}`);
console.log('\nUse the refresh token as the Bearer token for the MCP connector.');
