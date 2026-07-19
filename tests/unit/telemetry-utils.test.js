import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import {
    REDACTED_IDENTIFIER,
    REDACTED_TEXT,
    sanitizeTelemetryKey,
    sanitizeTelemetryProperties,
    sanitizeTelemetryRoute,
    sanitizeTelemetryText
} from '../../js/telemetry-utils.js';

const require = createRequire(import.meta.url);
const {
    KNOWN_TELEMETRY_APP_ROUTES,
    KNOWN_TELEMETRY_PAGE_PATHS
} = require('../../functions/telemetry-ingress-core.cjs');

function readSetValues(path, setName) {
    const source = readFileSync(path, 'utf8');
    const match = source.match(new RegExp(`const ${setName} = new Set\\((\\[[\\s\\S]*?\\])\\);`));
    expect(match, `${setName} must remain a literal finite set`).toBeTruthy();
    const literal = match[1].replace(/\b(?:TELEMETRY_)?REDACTED_TEXT\b/g, JSON.stringify(REDACTED_TEXT));
    return Function(`return ${literal}`)();
}

describe('telemetry privacy utilities', () => {
    it('masks common personal data patterns before telemetry is sent', () => {
        const text = sanitizeTelemetryText('Email coach@example.com or call 555-123-4567 with code abcdefghijklmnopqrstuvwxyz');

        expect(text).toContain('[email]');
        expect(text).toContain('[phone]');
        expect(text).toContain('[token]');
        expect(text).not.toContain('coach@example.com');
        expect(text).not.toContain('555-123-4567');
    });

    it('normalizes object keys and strips unsafe text from nested properties', () => {
        const properties = sanitizeTelemetryProperties({
            'label text': 'Pay for player 123456789',
            nested: {
                email: 'parent@example.com'
            }
        });

        expect(properties.label_text).toBe(REDACTED_TEXT);
        expect(properties.nested.email).toBe(REDACTED_TEXT);
    });

    it('masks sensitive numeric property values without string coercion by callers', () => {
        const properties = sanitizeTelemetryProperties({
            phone: 5551234567,
            playerId: 123456789,
            targetXPercent: 47,
            clientY: 810,
            loadMs: 240
        });

        expect(properties.phone).toBe(REDACTED_TEXT);
        expect(properties.playerId).toBe(REDACTED_IDENTIFIER);
        expect(properties.targetXPercent).toBe(REDACTED_TEXT);
        expect(properties.clientY).toBe(REDACTED_TEXT);
        expect(properties.loadMs).toBe(240);
    });

    it('templates dynamic routes and drops query and fragment data', () => {
        expect(sanitizeTelemetryRoute('/players/team-123/player-456?token=secret#notes'))
            .toBe('/players/:id/:id');
        expect(sanitizeTelemetryRoute('/accept-invite/AB12CD34?email=parent@example.com'))
            .toBe('/accept-invite/:id');
        expect(sanitizeTelemetryRoute('/messages/conversation-secret')).toBe('/messages/:id');
        expect(sanitizeTelemetryRoute('/family/public-share-token')).toBe('/family/:id');
        expect(sanitizeTelemetryRoute('/app/profile')).toBe('/app/profile');
        expect(sanitizeTelemetryRoute('/private/paul')).toBe('/:redacted/:redacted');
    });

    it('preserves every source-controlled legacy page path', () => {
        for (const pagePath of KNOWN_TELEMETRY_PAGE_PATHS) {
            expect(sanitizeTelemetryRoute(pagePath), pagePath).toBe(pagePath);
        }
    });

    it('preserves every source-controlled static app route', () => {
        for (const appRoute of KNOWN_TELEMETRY_APP_ROUTES) {
            expect(sanitizeTelemetryRoute(appRoute), appRoute).toBe(appRoute);
        }
    });

    it('keeps client and server canonical value vocabularies in sync', () => {
        expect(readSetValues('js/telemetry-utils.js', 'SAFE_ROUTE_SEGMENTS'))
            .toEqual(readSetValues('functions/index.js', 'TELEMETRY_SAFE_ROUTE_SEGMENTS'));
        const clientTextValues = readSetValues('js/telemetry-utils.js', 'SAFE_CANONICAL_TEXT_VALUES');
        const serverTextValues = readSetValues('functions/index.js', 'TELEMETRY_SAFE_TEXT_VALUES');
        expect(clientTextValues).toEqual(serverTextValues);
    });

    it('redacts unknown strings while retaining code-defined categories', () => {
        expect(sanitizeTelemetryProperties({
            outcome: 'success',
            label: 'Paul Snider',
            workflowName: 'Ava practice',
            source: 'coach-name',
            arbitrary: 'Taylor wrote a private note',
            targetRoute: '/teams/team-1/games/game-2',
            sourceRoute: '/private/paul'
        })).toEqual({
            outcome: 'success',
            label: REDACTED_TEXT,
            workflowName: REDACTED_TEXT,
            source: REDACTED_TEXT,
            arbitrary: REDACTED_TEXT,
            targetRoute: '/teams/:id/games/:id',
            sourceRoute: '/:redacted/:redacted'
        });
    });

    it('keeps telemetry keys bounded and machine-friendly', () => {
        expect(sanitizeTelemetryKey('bad key.with spaces and dots')).toBe('bad_key_with_spaces_and_dots');
        expect(sanitizeTelemetryKey('many words '.repeat(20))).toHaveLength(60);
        expect(sanitizeTelemetryKey('domContentLoadedMs')).toBe('domContentLoadedMs');
        expect(sanitizeTelemetryKey('local_smoke_test_123456789')).toBe('local_smoke_test_123456789');
        expect(sanitizeTelemetryKey('coach@example.com')).toBe('');
    });
});
