import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const functionsSource = readFileSync(resolve(process.cwd(), 'functions/index.js'), 'utf8');
const corsCoreSource = readFileSync(resolve(process.cwd(), 'functions/public-rsvp-cors-core.cjs'), 'utf8');
const {
    isAllowedPublicRsvpAdminOrigin,
    isAllowedPublicRsvpOrigin
} = require(resolve(process.cwd(), 'functions/public-rsvp-cors-core.cjs'));

function extractPublicRsvpCorsWrapper(functionsFileSource) {
    const start = functionsFileSource.indexOf('function writePublicRsvpCors(');
    expect(start, 'Expected writePublicRsvpCors to exist in functions/index.js').toBeGreaterThanOrEqual(0);

    const end = functionsFileSource.indexOf('\nfunction publicRsvpJsonError', start);
    expect(end, 'Expected writePublicRsvpCors to end before publicRsvpJsonError').toBeGreaterThan(start);
    return functionsFileSource.slice(start, end);
}

describe('public RSVP CORS origins', () => {
    it('keeps the HTTPS function wrapper delegated to the shared origin allowlist', () => {
        const publicRsvpCorsWrapper = extractPublicRsvpCorsWrapper(functionsSource);

        expect(functionsSource).toContain("require('./public-rsvp-cors-core.cjs')");
        expect(publicRsvpCorsWrapper).toContain('function writePublicRsvpCors(');
        expect(publicRsvpCorsWrapper).toContain('isAllowedPublicRsvpOrigin(origin)');
        expect(publicRsvpCorsWrapper).toContain('isAllowedPublicRsvpAdminOrigin(origin)');
        expect(publicRsvpCorsWrapper).not.toContain("Access-Control-Allow-Origin', '*'");
        expect(corsCoreSource).not.toContain("Access-Control-Allow-Origin': '*'");
    });

    it('scopes exact native origins to the authenticated staff reminder endpoint', () => {
        const sendStart = functionsSource.indexOf('exports.sendPublicRsvpEmails = functions.https.onRequest');
        const getStart = functionsSource.indexOf('exports.getPublicRsvp = functions.https.onRequest');
        const submitStart = functionsSource.indexOf('exports.submitPublicRsvp = functions.https.onRequest');
        const telemetryStart = functionsSource.indexOf('exports.collectTelemetry', submitStart);
        const sendSource = functionsSource.slice(sendStart, getStart);
        const getSource = functionsSource.slice(getStart, submitStart);
        const submitSource = functionsSource.slice(submitStart, telemetryStart);

        expect(sendSource).toContain('writePublicRsvpCors(req, res, { allowNativeAdminOrigin: true });');
        expect(getSource).toContain('writePublicRsvpCors(req, res);');
        expect(submitSource).toContain('writePublicRsvpCors(req, res);');
        expect(getSource).not.toContain('allowNativeAdminOrigin');
        expect(submitSource).not.toContain('allowNativeAdminOrigin');

        expect(isAllowedPublicRsvpAdminOrigin('https://localhost')).toBe(true);
        expect(isAllowedPublicRsvpAdminOrigin('capacitor://localhost')).toBe(true);
        expect(isAllowedPublicRsvpOrigin('https://localhost')).toBe(false);
        expect(isAllowedPublicRsvpOrigin('capacitor://localhost')).toBe(false);
    });

    it('allows the production domains and Firebase Hosting default domains', () => {
        expect(isAllowedPublicRsvpOrigin('https://allplays.ai')).toBe(true);
        expect(isAllowedPublicRsvpOrigin('https://www.allplays.ai')).toBe(true);
        expect(isAllowedPublicRsvpOrigin('https://game-flow-c6311.web.app')).toBe(true);
        expect(isAllowedPublicRsvpOrigin('https://game-flow-c6311.firebaseapp.com')).toBe(true);
    });

    it('allows expected dev and Firebase preview origins without widening to lookalikes', () => {
        expect(isAllowedPublicRsvpOrigin('http://localhost:5174')).toBe(true);
        expect(isAllowedPublicRsvpOrigin('http://127.0.0.1:5174')).toBe(true);
        expect(isAllowedPublicRsvpOrigin('https://game-flow-c6311--pr-3864-abc123.web.app')).toBe(true);
        expect(isAllowedPublicRsvpOrigin('*')).toBe(false);
        expect(isAllowedPublicRsvpOrigin('https://game-flow-c6311--x.web.app.evil.com')).toBe(false);
        expect(isAllowedPublicRsvpOrigin('http://localhost:5174.evil.com')).toBe(false);
        expect(isAllowedPublicRsvpAdminOrigin('https://localhost:5174')).toBe(false);
        expect(isAllowedPublicRsvpAdminOrigin('https://localhost.evil.com')).toBe(false);
        expect(isAllowedPublicRsvpAdminOrigin('capacitor://localhost.evil.com')).toBe(false);
    });

    it('keeps the RSVP origin policy independent from calendar and telemetry policy state', () => {
        expect(corsCoreSource).not.toContain('calendarAllowedOriginSet');
        expect(corsCoreSource).not.toContain('telemetryAllowedOriginSet');
        expect(corsCoreSource).not.toContain('allowedOriginPolicy');
    });

    it('no longer allows the retired GitHub Pages origin', () => {
        expect(isAllowedPublicRsvpOrigin('https://pauljsnider.github.io')).toBe(false);
        expect(functionsSource).not.toContain('pauljsnider.github.io');
        expect(corsCoreSource).not.toContain('pauljsnider.github.io');
    });
});
