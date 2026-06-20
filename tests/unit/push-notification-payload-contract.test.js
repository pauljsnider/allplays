import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

function getHelper(name, nextMarker) {
    const start = source.indexOf(`function ${name}(`);
    const end = source.indexOf(`\n${nextMarker}`, start);
    const slice = source.slice(start, end);
    return new Function(`${slice}; return ${name};`)();
}

const buildStaffFeeNotificationDestination = getHelper('buildStaffFeeNotificationDestination', 'function buildNotificationLink');
const buildNotificationLink = getHelper('buildNotificationLink', 'function buildNotificationAppRoute');
const buildNotificationAppRoute = getHelper('buildNotificationAppRoute', 'async function getUserIdsByEmails');

describe('push notification payload contract', () => {
    it('includes native app routing fields alongside the legacy web link', () => {
        expect(source).toContain('function buildNotificationAppRoute');
        expect(source).toContain('appRoute,');
        expect(source).toContain("return `/schedule/${encodeURIComponent(teamId)}/${encodeURIComponent(gameId)}?section=game`;");
        expect(source).toContain('eventId: String(eventId || gameId || \'\')');
        expect(source).toContain('conversationId: String(conversationId || \'\')');
        expect(source).toContain("if (category === 'liveChat' || category === 'mentions') {");
        expect(source).toContain("if ((category === 'liveChat' || category === 'mentions') && teamId) {");
        expect(source).toContain('return `${route}?conversationId=${encodeURIComponent(conversationId)}`;');
        expect(source).toContain('params.push(`conversationId=${encodeURIComponent(conversationId)}`);');
        expect(source).toContain('fcmOptions: { link }');
    });

    it('builds fee notification deep links to the parent fees view with fee identifiers', () => {
        expect(buildNotificationLink({
            category: 'fees',
            teamId: 'team 1',
            batchId: 'batch/1',
            recipientId: 'recipient?1'
        })).toBe('https://allplays.ai/app/#/parent-tools/fees?teamId=team+1&batchId=batch%2F1&recipientId=recipient%3F1');

        expect(buildNotificationAppRoute({
            category: 'fees',
            teamId: 'team 1',
            batchId: 'batch/1',
            recipientId: 'recipient?1'
        })).toBe('/parent-tools/fees?teamId=team+1&batchId=batch%2F1&recipientId=recipient%3F1');
    });

    it('builds RSVP notification routes to the event availability view', () => {
        expect(buildNotificationLink({
            category: 'rsvp',
            teamId: 'team 1',
            gameId: 'game/1'
        })).toBe('https://allplays.ai/app/#/schedule/team%201/game%2F1?section=availability');

        expect(buildNotificationAppRoute({
            category: 'rsvp',
            teamId: 'team 1',
            gameId: 'game/1'
        })).toBe('/schedule/team%201/game%2F1?section=availability');
    });

    it('builds staff fee notification routes to the team fee management page', () => {
        expect(buildStaffFeeNotificationDestination({
            teamId: 'team 1',
            batchId: 'batch/1',
            recipientId: 'recipient?1'
        })).toEqual({
            appRoute: '/teams/team%201/fees/batch%2F1?recipientId=recipient%3F1',
            link: 'https://allplays.ai/app/#/teams/team%201/fees/batch%2F1?recipientId=recipient%3F1'
        });
        expect(source).toContain('linkOverride: staffFeeDestination.link');
        expect(source).toContain('appRouteOverride: staffFeeDestination.appRoute');
    });
});
