import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const viteConfigSource = readFileSync(new URL('../../apps/app/vite.config.ts', import.meta.url), 'utf8');
const legacyUtilsSource = readFileSync(new URL('../../js/utils.js', import.meta.url), 'utf8');

describe('calendar function CORS origins', () => {
  it('uses the project-scoped Firebase Hosting matcher only for the default policy', () => {
    expect(functionsSource).toContain(
      "const { isAllPlaysFirebaseHostingOrigin } = require('./hosting-origin-policy.cjs');"
    );
    expect(functionsSource).toContain('allowFirebaseHosting: false');
    expect(functionsSource).toContain('allowFirebaseHosting: true');
    expect(functionsSource).toContain(
      '(allowedOriginPolicy.allowFirebaseHosting && isAllPlaysFirebaseHostingOrigin(origin))'
    );
  });

  it('uses the complete origin policy when emitting CORS response headers', () => {
    const writeCorsStart = functionsSource.indexOf('function writeCorsHeaders(req, res');
    const writeCorsEnd = functionsSource.indexOf('function normalizeTelemetryString', writeCorsStart);
    const writeCorsSource = functionsSource.slice(writeCorsStart, writeCorsEnd);

    expect(writeCorsStart).toBeGreaterThanOrEqual(0);
    expect(writeCorsEnd).toBeGreaterThan(writeCorsStart);
    expect(writeCorsSource).toContain('if (origin && isAllowedOrigin(origin))');
    expect(writeCorsSource).toContain("res.set('Access-Control-Allow-Origin', origin);");
  });

  it('scopes native calendar compatibility to the exact Capacitor WebView origins', () => {
    const calendarSetStart = functionsSource.indexOf('const calendarAllowedOriginSet = new Set([');
    const calendarSetEnd = functionsSource.indexOf(']);', calendarSetStart) + 3;
    const calendarSetSource = functionsSource.slice(calendarSetStart, calendarSetEnd);
    const originCheckStart = functionsSource.indexOf('function isAllowedOrigin(origin)');
    const originCheckEnd = functionsSource.indexOf('function writeCorsHeaders', originCheckStart);
    const originCheckSource = functionsSource.slice(originCheckStart, originCheckEnd);

    expect(calendarSetStart).toBeGreaterThanOrEqual(0);
    expect(calendarSetEnd).toBeGreaterThan(calendarSetStart);
    expect(calendarSetSource).toContain('allowedOriginPolicy.allowNativeCalendarOrigins');
    expect(calendarSetSource).toContain("'https://localhost'");
    expect(calendarSetSource).toContain("'capacitor://localhost'");
    expect(calendarSetSource).not.toContain("'http://localhost'");
    expect(calendarSetSource).not.toContain("'*'");
    expect(originCheckSource).toContain('calendarAllowedOriginSet.has(origin)');
    expect(originCheckSource).not.toContain('startsWith(');
    expect(originCheckSource).not.toContain('includes(origin)');
  });

  it('keeps configured calendar allowlists authoritative and telemetry policy separate', () => {
    const policyStart = functionsSource.indexOf('function getAllowedOriginPolicy()');
    const policyEnd = functionsSource.indexOf('const allowedOriginPolicy', policyStart);
    const policySource = functionsSource.slice(policyStart, policyEnd);
    const telemetryStart = functionsSource.indexOf('const telemetryAllowedOriginSet = new Set([');
    const telemetryEnd = functionsSource.indexOf(']);', telemetryStart) + 3;
    const telemetrySource = functionsSource.slice(telemetryStart, telemetryEnd);

    expect(policySource.match(/allowNativeCalendarOrigins: false/g)).toHaveLength(2);
    expect(policySource.match(/allowNativeCalendarOrigins: true/g)).toHaveLength(1);
    expect(telemetrySource).not.toContain('calendarAllowedOriginSet');
    expect(telemetrySource).not.toContain('allowNativeCalendarOrigins');
    expect(telemetrySource).toContain("'https://localhost'");
    expect(telemetrySource).toContain("'capacitor://localhost'");
    expect(telemetrySource).toContain("'http://localhost'");
    expect(telemetrySource).not.toContain("'*'");
  });

  it('allows both local app and legacy development origins', () => {
    expect(functionsSource).toContain("'http://localhost:8000'");
    expect(functionsSource).toContain("'http://127.0.0.1:8000'");
    expect(functionsSource).toContain("'http://localhost:5174'");
    expect(functionsSource).toContain("'http://127.0.0.1:5174'");
  });

  it('routes local Vite calendar requests through the same-origin development proxy', () => {
    expect(viteConfigSource).toContain("'/__allplays/calendar'");
    expect(viteConfigSource).toContain("'/fetchCalendarIcs'");
    expect(legacyUtilsSource).toContain("window.location.port === '5174'");
    expect(legacyUtilsSource).toContain("return '/__allplays/calendar'");
  });
});
