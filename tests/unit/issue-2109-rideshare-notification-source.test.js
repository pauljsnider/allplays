import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const targetIndexSource = readFileSync(new URL('../../functions/notification-target-index-core.cjs', import.meta.url), 'utf8');
const deliveryMetadataSource = readFileSync(new URL('../../functions/notification-delivery-metadata.cjs', import.meta.url), 'utf8');
const scheduleServiceSource = readFileSync(new URL('../../apps/app/src/lib/scheduleService.ts', import.meta.url), 'utf8');
const pushRoutingSource = readFileSync(new URL('../../apps/app/src/lib/pushNotificationRouting.ts', import.meta.url), 'utf8');
const rideshareServiceTestSource = readFileSync(new URL('./app-schedule-rideshare-service.test.js', import.meta.url), 'utf8');
const notificationRoutingTestSource = readFileSync(new URL('./app-notification-open-routing.test.jsx', import.meta.url), 'utf8');

describe('issue 2109 rideshare notification source contract', () => {
    it('keeps rideshare as a routed notification category for parents and staff', () => {
        expect(targetIndexSource).toContain("'rideshare'");
        expect(targetIndexSource).toContain('rideshare: false');
        expect(targetIndexSource).toContain("rideshare: Object.freeze(['parent', 'staff'])");
        expect(deliveryMetadataSource).toContain("rideshare: Object.freeze({ androidChannelId: ANDROID_NOTIFICATION_CHANNEL_IDS.team, iosThreadScope: 'team' })");
    });

    it('keeps server and app notification routes landing on the rideshare event tab', () => {
        expect(functionsSource).toContain("if (category === 'rideshare')");
        expect(functionsSource).toContain("buildScheduleSectionQuery('rideshare', childId)");
        expect(functionsSource).toContain("return 'https://allplays.ai/app/#/schedule?section=rideshare';");
        expect(functionsSource).toContain("return '/schedule?section=rideshare';");
        expect(pushRoutingSource).toContain("if (category === 'rideshare')");
        expect(pushRoutingSource).toContain("return buildScheduleEventRoute(teamId, eventId, 'rideshare', childId);");
    });

    it('keeps rideshare offer, request, decision, cancellation, and routing tests in place', () => {
        expect(scheduleServiceSource).toContain('export async function createParentScheduleRideOffer');
        expect(scheduleServiceSource).toContain('export async function requestParentScheduleRideSpot');
        expect(scheduleServiceSource).toContain('export async function updateParentScheduleRideRequestStatus');
        expect(scheduleServiceSource).toContain('export async function setParentScheduleRideOfferStatus');
        expect(scheduleServiceSource).toContain('export async function cancelParentScheduleRideRequest');
        expect(rideshareServiceTestSource).toContain('delegates web rideshare actions to the existing Firebase helpers with legacy source game IDs');
        expect(rideshareServiceTestSource).toContain('dbMocks.cancelRideRequest');
        expect(notificationRoutingTestSource).toContain("category: 'rideshare'");
        expect(notificationRoutingTestSource).toContain('/schedule/team-1/game-7?childId=player-2&section=rideshare');
    });
});
