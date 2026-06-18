import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('push notification payload contract', () => {
    it('includes native app routing fields alongside the legacy web link', () => {
        const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
        expect(source).toContain('function buildNotificationAppRoute');
        expect(source).toContain('appRoute,');
        expect(source).toContain("return `/schedule/${encodeURIComponent(teamId)}/${encodeURIComponent(gameId)}`;");
        expect(source).toContain('eventId: String(eventId || gameId || \'\')');
        expect(source).toContain('conversationId: String(conversationId || \'\')');
        expect(source).toContain('return `${route}?conversationId=${encodeURIComponent(conversationId)}`;');
        expect(source).toContain('params.push(`conversationId=${encodeURIComponent(conversationId)}`);');
        expect(source).toContain('fcmOptions: { link }');
    });
});
