import { describe, expect, it } from 'vitest';
import {
    sanitizeTelemetryKey,
    sanitizeTelemetryProperties,
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

        expect(properties.label_text).toBe('Pay for player [number]');
        expect(properties.nested.email).toBe('[email]');
    });

    it('masks sensitive numeric property values without string coercion by callers', () => {
        const properties = sanitizeTelemetryProperties({
            phone: 5551234567,
            playerId: 123456789,
            loadMs: 240
        });

        expect(properties.phone).toBe('[phone]');
        expect(properties.playerId).toBe('[number]');
        expect(properties.loadMs).toBe(240);
    });

    it('keeps telemetry keys bounded and machine-friendly', () => {
        expect(sanitizeTelemetryKey('bad key.with spaces and dots')).toBe('bad_key_with_spaces_and_dots');
        expect(sanitizeTelemetryKey('many words '.repeat(20))).toHaveLength(60);
        expect(sanitizeTelemetryKey('domContentLoadedMs')).toBe('domContentLoadedMs');
        expect(sanitizeTelemetryKey('local_smoke_test_123456789')).toBe('local_smoke_test_123456789');
        expect(sanitizeTelemetryKey('coach@example.com')).toBe('');
    });
});
