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
