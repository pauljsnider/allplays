import { describe, expect, it } from 'vitest';
import {
    REDACTED_IDENTIFIER,
    REDACTED_TEXT,
    sanitizeTelemetryKey,
    sanitizeTelemetryProperties,
    sanitizeTelemetryRoute,
    sanitizeTelemetryText
} from '../../js/telemetry-utils.js';

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
    });

    it('redacts unknown strings while retaining code-defined categories', () => {
        expect(sanitizeTelemetryProperties({
            outcome: 'success',
            arbitrary: 'Taylor wrote a private note',
            targetRoute: '/teams/team-1/games/game-2'
        })).toEqual({
            outcome: 'success',
            arbitrary: REDACTED_TEXT,
            targetRoute: '/teams/:id/games/:id'
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
