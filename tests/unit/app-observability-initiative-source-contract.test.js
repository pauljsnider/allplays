import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readSource(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

const loggerSource = readSource('apps/app/src/lib/logger.ts');
const telemetrySource = readSource('apps/app/src/lib/telemetry.ts');
const mainSource = readSource('apps/app/src/main.tsx');
const functionsSource = readSource('functions/index.js');

describe('app observability initiative source contract', () => {
    it('keeps structured app logger redaction in the shared logger module', () => {
        expect(loggerSource).toContain('export function createLogger(scope: string)');
        expect(loggerSource).toContain('export function sanitizeForLogging(value: unknown)');
        expect(loggerSource).toContain('function redactBearerTokens(value: string)');
        expect(loggerSource).toContain("const redactedValue = '[REDACTED]';");
        expect(loggerSource).toContain('isSensitiveKey(keyHint)');
    });

    it('initializes startup timing and error tracking before rendering the app', () => {
        expect(mainSource).toContain('initializeAppErrorTracking();');
        expect(mainSource).toContain('installReactErrorTelemetry();');
        expect(mainSource).toContain('const startupTimer = startAppStartupTimer();');
        expect(mainSource).toContain("captureAppStartupFailure(error, { phase: 'initial-render' });");
    });

    it('bridges handled errors, UX timings, and production crashes through telemetry', () => {
        expect(telemetrySource).toContain('export function recordAppUxTiming(label: string, startedAt: number, meta: TelemetryProperties = {})');
        expect(telemetrySource).toContain('export function captureHandledAppError(label: string, error: unknown, context: TelemetryProperties = {})');
        expect(telemetrySource).toContain("captureAppTelemetryEvent('app_load_error'");
        expect(telemetrySource).toContain('Sentry.captureException(normalizedError);');
        expect(telemetrySource).toContain("window.addEventListener('unhandledrejection'");
    });

    it('keeps the server telemetry collector available for app field metrics', () => {
        expect(functionsSource).toContain('exports.collectTelemetry = functions');
        expect(functionsSource).toContain('commitTelemetryEvents(db, events, dateKey)');
        expect(functionsSource).toContain("db.collection('telemetryDaily').doc(dateKey)");
        expect(functionsSource).toContain("db.collection('telemetryEvents').doc(event.id)");
        expect(functionsSource).toContain('verifyTelemetryAuth(req, payload)');
    });
});
