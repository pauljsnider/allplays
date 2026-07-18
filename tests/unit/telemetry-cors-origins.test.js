import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const functionsSource = readFileSync(resolve(process.cwd(), 'functions/index.js'), 'utf8');
const { isAllowedTelemetryOrigin } = require(resolve(process.cwd(), 'functions/telemetry-cors-core.cjs'));

function extractTelemetryCorsWrapper(functionsFileSource) {
    const start = functionsFileSource.indexOf('function writeTelemetryCorsHeaders(req, res)');
    expect(start, 'Expected writeTelemetryCorsHeaders to exist in functions/index.js').toBeGreaterThanOrEqual(0);

    const end = functionsFileSource.indexOf('\nfunction normalizeTelemetryString', start);
    expect(end, 'Expected telemetry CORS wrapper to end before telemetry normalization').toBeGreaterThan(start);
    return functionsFileSource.slice(start, end);
}

describe('telemetry CORS origins', () => {
    it('uses the dedicated telemetry origin gate for headers and rejection', () => {
        const wrapper = extractTelemetryCorsWrapper(functionsSource);

        expect(functionsSource).toContain("require('./telemetry-cors-core.cjs')");
        expect(wrapper).toContain('isAllowedTelemetryOrigin(origin, allowedOriginSet)');
        expect(wrapper).not.toContain("Access-Control-Allow-Origin', '*'");
        expect(functionsSource).toContain('if (!isAllowedTelemetryOrigin(req.headers.origin, allowedOriginSet))');
    });

    it('allows production, Firebase Hosting, preview, and configured origins', () => {
        expect(isAllowedTelemetryOrigin('https://allplays.ai')).toBe(true);
        expect(isAllowedTelemetryOrigin('https://game-flow-c6311.web.app')).toBe(true);
        expect(isAllowedTelemetryOrigin('https://game-flow-c6311.firebaseapp.com')).toBe(true);
        expect(isAllowedTelemetryOrigin('https://game-flow-c6311--pr-4029-5585dlsc.web.app')).toBe(true);
        expect(isAllowedTelemetryOrigin(
            'https://telemetry-client.example.test',
            new Set(['https://telemetry-client.example.test'])
        )).toBe(true);
    });

    it('rejects missing, insecure, and lookalike origins', () => {
        expect(isAllowedTelemetryOrigin('')).toBe(false);
        expect(isAllowedTelemetryOrigin('http://allplays.ai')).toBe(false);
        expect(isAllowedTelemetryOrigin('https://evil.example')).toBe(false);
        expect(isAllowedTelemetryOrigin('https://game-flow-c6311--x.web.app.evil.com')).toBe(false);
    });
});
