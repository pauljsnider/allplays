import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const scheduleLogicSource = readFileSync(new URL('../../apps/app/src/lib/scheduleLogic.ts', import.meta.url), 'utf8');
const scheduleServiceSource = readFileSync(new URL('../../apps/app/src/lib/scheduleService.ts', import.meta.url), 'utf8');

function getBuildPreEventReminderPayload() {
    const start = functionsSource.indexOf('function buildPreEventReminderPayload({ teamId, gameId, event })');
    const end = functionsSource.indexOf('\nfunction getPreEventReminderChatMessageId', start);
    const slice = functionsSource.slice(start, end);
    return new Function('coerceDate', 'getEventTitle', `${slice}; return buildPreEventReminderPayload;`)(
        (value) => new Date(value),
        (event) => event.title || 'Team event'
    );
}

function getSendCreatedScheduleEventNotification({ sendCategoryNotification }) {
    const start = functionsSource.indexOf('async function sendCreatedScheduleEventNotification({ teamId, gameId, game })');
    const end = functionsSource.indexOf('\nasync function sendScheduleImportBatchNotifications', start);
    const slice = functionsSource.slice(start, end);
    return new Function(
        'sendCategoryNotification',
        'getEventTitle',
        'coerceDate',
        'formatScheduleUpdateDate',
        `${slice}; return sendCreatedScheduleEventNotification;`
    )(
        sendCategoryNotification,
        (event) => event.title || event.name || 'Untitled event',
        (value) => value ? new Date(value) : null,
        () => 'Mon, Jun 22 at 6:00 PM'
    );
}

describe('schedule and RSVP notification contract', () => {
    it('sends created-event notifications unless the event is draft or part of a large import batch', () => {
        expect(functionsSource).toContain('async function sendCreatedScheduleEventNotification({ teamId, gameId, game })');
        expect(functionsSource).toContain('if (game.source || game.sourceMetadata) return null;');
        expect(functionsSource).toContain("const category = isPractice ? 'practice' : 'schedule';");
        expect(functionsSource).toContain('title: payload.title');
        expect(functionsSource).toContain('const notifyGameCreated = functions.firestore');
        expect(functionsSource).toContain(".document('teams/{teamId}/games/{gameId}')");
        expect(functionsSource).toContain("if (status === 'draft') return null;");
        expect(functionsSource).toContain('if (importBatch && importBatch.totalCount > 3) {');
        expect(functionsSource).toContain('return registerScheduleImportBatchEvent({ teamId, gameId, game, batch: importBatch });');
        expect(functionsSource).toContain('return sendCreatedScheduleEventNotification({ teamId, gameId, game });');
    });

    it('summarizes large schedule imports and deduplicates the individual event ids', () => {
        expect(functionsSource).toContain('async function sendScheduleImportBatchNotifications({ teamId, batchId, batch })');
        expect(functionsSource).toContain('if (totalCount > 3) {');
        expect(functionsSource).toContain('const payload = buildScheduleImportSummaryPayload({ totalCount, gameCount, practiceCount });');
        expect(functionsSource).toContain("dedupKey: `import-batch:${batchId}`");
        expect(functionsSource).toContain("eventIds.map((eventId) => markNotificationDedupSent(teamId, 'schedule', eventId))");
        expect(functionsSource).toContain('exports.notifyScheduleImportBatchCompleted = notifyScheduleImportBatchCompleted;');
        expect(functionsSource).toContain('exports._internal.notifyScheduleImportBatchCompleted = notifyScheduleImportBatchCompleted;');
    });

    it('sends recurring practice creation through the standard practice notification path', async () => {
        const sentPayloads = [];
        const sendCreatedScheduleEventNotification = getSendCreatedScheduleEventNotification({
            sendCategoryNotification: async (payload) => {
                sentPayloads.push(payload);
                return { successCount: 1 };
            }
        });

        await expect(sendCreatedScheduleEventNotification({
            teamId: 'team-1',
            gameId: 'practice-series-1',
            game: {
                type: 'practice',
                title: 'Skills night',
                date: '2026-06-22T23:00:00.000Z',
                recurrence: { frequency: 'weekly' },
                isSeriesMaster: true,
                createdBy: 'coach-1'
            }
        })).resolves.toEqual({ successCount: 1 });

        expect(sentPayloads).toEqual([{
            teamId: 'team-1',
            gameId: 'practice-series-1',
            category: 'practice',
            title: 'New practice: Skills night',
            body: 'Mon, Jun 22 at 6:00 PM',
            actorUid: 'coach-1'
        }]);
    });

    it('suppresses imported events before sending created-event notifications', async () => {
        const sentPayloads = [];
        const sendCreatedScheduleEventNotification = getSendCreatedScheduleEventNotification({
            sendCategoryNotification: async (payload) => {
                sentPayloads.push(payload);
                return { successCount: 1 };
            }
        });

        await expect(sendCreatedScheduleEventNotification({
            teamId: 'team-1',
            gameId: 'imported-1',
            game: {
                title: 'Imported event',
                source: 'csv_import'
            }
        })).resolves.toBeNull();
        expect(sentPayloads).toEqual([]);
    });

    it('dispatches scheduled reminders to schedule push, public RSVP email, and RSVP push targets', () => {
        expect(functionsSource).toContain("collectionGroup('games')");
        expect(functionsSource).toContain(".where('scheduleNotifications.nextReminderAt', '<=', dueIso)");
        expect(functionsSource).toContain('const payload = buildPreEventReminderPayload({ teamId, gameId, event: claimedEvent });');
        expect(functionsSource).toContain("category: 'schedule'");
        expect(functionsSource).toContain('const emailResult = await createPublicRsvpEmailDeliveries({');
        expect(functionsSource).toContain('rsvpPushResult = await sendRsvpReminderPushNotifications({');
        expect(functionsSource).toContain('recipientTargets: emailResult.recipientTargets');
        expect(functionsSource).toContain('recipientUserIds: emailResult.recipientUserIds');
        expect(functionsSource).toContain('rsvpPushSuccessCount: rsvpPushResult.successCount');
        expect(functionsSource).toContain('rsvpPushTargetCount: rsvpPushResult.targetCount');
    });

    it('builds pre-event reminder payloads with event context and a game-day fallback link', () => {
        const buildPreEventReminderPayload = getBuildPreEventReminderPayload();

        expect(buildPreEventReminderPayload({
            teamId: 'team 1',
            gameId: 'game/1',
            event: {
                title: 'vs. Falcons',
                date: '2026-07-04T18:30:00.000Z',
                timeZone: 'America/Chicago',
                location: 'Main Gym'
            }
        })).toEqual({
            title: 'Upcoming team event',
            body: 'vs. Falcons is coming up Sat, Jul 4, 1:30 PM. Location: Main Gym',
            link: 'https://allplays.ai/game-day.html?teamId=team%201&gameId=game%2F1',
            chatText: [
                'Schedule reminder: Upcoming team event',
                'vs. Falcons is coming up Sat, Jul 4, 1:30 PM.',
                'Location: Main Gym'
            ].join('\n')
        });
    });

    it('sends RSVP reminder pushes through the rsvp category with per-recipient child deep links', () => {
        expect(functionsSource).toContain('async function sendRsvpReminderPushNotifications({ teamId, gameId, event = {}, recipientUserIds = [], recipientTargets = [] } = {})');
        expect(functionsSource).toContain('const childIdByRecipientGroup = new Map();');
        expect(functionsSource).toContain('const groupUserIds = childIdByRecipientGroup.get(childId) || [];');
        expect(functionsSource).toContain("const targets = await getTargetsForCategoryUserIds(teamId, 'rsvp', userIds);");
        expect(functionsSource).toContain("category: 'rsvp'");
        expect(functionsSource).toContain('eventId: gameId');
        expect(functionsSource).toContain('childId: getScheduleNotificationChildId(event)');
        expect(functionsSource).toContain("childId: String(childId || '')");
        expect(functionsSource).toContain('targetCount += targets.length');
        expect(functionsSource).toContain("return `/schedule/${encodeURIComponent(teamId)}/${encodeURIComponent(scheduleEventId)}${buildScheduleSectionQuery('availability', childId)}`;");
    });

    it('persists app-initiated RSVP reminder push metrics in schedule notification metadata', () => {
        expect(scheduleLogicSource).toContain('lastRsvpPushSuccessCount');
        expect(scheduleLogicSource).toContain('lastRsvpPushFailureCount');
        expect(scheduleLogicSource).toContain('lastRsvpPushTargetCount');
        expect(scheduleLogicSource).toContain('lastRsvpPushError');
        expect(scheduleServiceSource).toContain('normalizeStaffRsvpReminderPushMetrics(emailResult)');
        expect(scheduleServiceSource).toContain('await updateRsvpReminderMetadata(event, user, preview.missingPlayerCount, emailSentCount, rsvpPushMetrics);');
    });
});
