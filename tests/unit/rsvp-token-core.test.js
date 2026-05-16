import { describe, expect, it } from 'vitest';
import {
    buildScopedRsvpDocId,
    hashRsvpToken,
    normalizeRsvpTokenCreateInput,
    validateRsvpTokenRedemption
} from '../../functions/rsvp-token-core.cjs';

describe('RSVP token core', () => {
    it('normalizes a scoped token creation request', () => {
        const input = normalizeRsvpTokenCreateInput({
            teamId: ' team-1 ',
            eventId: ' game-1 ',
            childId: ' player-1 ',
            guardianEmail: ' Parent@Example.COM ',
            response: 'going',
            ttlMinutes: 15
        }, 1_000);

        expect(input).toEqual({
            teamId: 'team-1',
            gameId: 'game-1',
            playerId: 'player-1',
            guardianEmail: 'parent@example.com',
            response: 'going',
            expiresAtMs: 901_000
        });
    });

    it('rejects invalid scoped token input', () => {
        expect(() => normalizeRsvpTokenCreateInput({
            teamId: 'team-1',
            gameId: 'game-1',
            playerId: 'player-1',
            guardianEmail: 'parent@example.com',
            response: 'late'
        })).toThrow('Invalid RSVP response.');
    });

    it('builds stable non-email RSVP document ids for guardian scoped writes', () => {
        expect(buildScopedRsvpDocId({
            guardianEmail: 'Parent@Example.COM',
            playerId: 'player-1'
        })).toMatch(/^email_[a-f0-9]{24}__player-1$/);
    });

    it('hashes tokens without exposing raw token values', () => {
        expect(hashRsvpToken('abc123')).toHaveLength(64);
        expect(hashRsvpToken('abc123')).toBe(hashRsvpToken(' abc123 '));
    });

    it('rejects expired, revoked, reused, and mismatched token redemptions', () => {
        const tokenData = {
            expiresAt: new Date('2026-01-01T00:10:00Z'),
            response: 'going'
        };

        expect(validateRsvpTokenRedemption({
            tokenData,
            requestBody: { response: 'going' },
            nowMs: new Date('2026-01-01T00:00:00Z').getTime()
        })).toEqual({ ok: true });

        expect(validateRsvpTokenRedemption({
            tokenData: { ...tokenData, expiresAt: new Date('2025-12-31T23:59:00Z') },
            nowMs: new Date('2026-01-01T00:00:00Z').getTime()
        })).toEqual({ ok: false, reason: 'expired' });

        expect(validateRsvpTokenRedemption({
            tokenData: { ...tokenData, revoked: true },
            nowMs: new Date('2026-01-01T00:00:00Z').getTime()
        })).toEqual({ ok: false, reason: 'revoked' });

        expect(validateRsvpTokenRedemption({
            tokenData: { ...tokenData, usedAt: new Date('2026-01-01T00:01:00Z') },
            nowMs: new Date('2026-01-01T00:00:00Z').getTime()
        })).toEqual({ ok: false, reason: 'reused' });

        expect(validateRsvpTokenRedemption({
            tokenData,
            requestBody: { response: 'maybe' },
            nowMs: new Date('2026-01-01T00:00:00Z').getTime()
        })).toEqual({ ok: false, reason: 'mismatched_response' });

        expect(validateRsvpTokenRedemption({
            tokenData: { ...tokenData, gameId: 'game-1', playerId: 'player-1', guardianEmail: 'parent@example.com' },
            requestBody: { gameId: 'game-2' },
            nowMs: new Date('2026-01-01T00:00:00Z').getTime()
        })).toEqual({ ok: false, reason: 'mismatched_event' });

        expect(validateRsvpTokenRedemption({
            tokenData: { ...tokenData, gameId: 'game-1', playerId: 'player-1', guardianEmail: 'parent@example.com' },
            requestBody: { playerId: 'player-2' },
            nowMs: new Date('2026-01-01T00:00:00Z').getTime()
        })).toEqual({ ok: false, reason: 'mismatched_player' });
    });
});
