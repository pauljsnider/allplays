import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const scheduleLogicSource = readFileSync(new URL('../../apps/app/src/lib/scheduleLogic.ts', import.meta.url), 'utf8');
const scheduleServiceSource = readFileSync(new URL('../../apps/app/src/lib/scheduleService.ts', import.meta.url), 'utf8');
const teamDetailSource = readFileSync(new URL('../../apps/app/src/pages/TeamDetail.tsx', import.meta.url), 'utf8');
const scheduleEventDetailSource = readFileSync(new URL('../../apps/app/src/pages/ScheduleEventDetail.tsx', import.meta.url), 'utf8');
const staffRsvpReminderPanelSource = readFileSync(new URL('../../apps/app/src/components/schedule/StaffRsvpReminderPanel.tsx', import.meta.url), 'utf8');
const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const reminderTestSource = readFileSync(new URL('./schedule-rsvp-reminder.test.js', import.meta.url), 'utf8');
const notificationContractTestSource = readFileSync(new URL('./schedule-rsvp-notification-contract.test.js', import.meta.url), 'utf8');
const publicRsvpFunctionsTestSource = readFileSync(new URL('./public-rsvp-functions-source.test.js', import.meta.url), 'utf8');
const teamDetailIntegrationTestSource = readFileSync(new URL('./app-team-detail-integration.test.jsx', import.meta.url), 'utf8');
const appScheduleContractsTestSource = readFileSync(new URL('./app-schedule-service-contracts.test.js', import.meta.url), 'utf8');

describe('issue 1966 schedule RSVP reminders source contract', () => {
    it('keeps staff RSVP reminder preview, message, and metadata helpers available', () => {
        expect(scheduleLogicSource).toContain('export function buildStaffRsvpReminderPreview');
        expect(scheduleLogicSource).toContain('export function buildStaffRsvpReminderMessage');
        expect(scheduleLogicSource).toContain('export function resolveStaffRsvpReminderEmailSentCount');
        expect(scheduleLogicSource).toContain('export function getStaffRsvpReminderMetadataTarget');
        expect(scheduleLogicSource).toContain('export function buildStaffRsvpReminderMetadata');
        expect(reminderTestSource).toContain('counts only active no-response players and de-duplicates eligible emails');
        expect(reminderTestSource).toContain('routes recurring virtual event metadata writes to the persisted master event');
        expect(reminderTestSource).toContain('persists RSVP push metrics in reminder metadata');
    });

    it('keeps app reminder sends gated to compatible managers and backed by public RSVP email delivery', () => {
        expect(scheduleServiceSource).toContain('function isPublicRsvpReminderManager');
        expect(scheduleServiceSource).toContain('function assertStaffRsvpReminderEvent');
        expect(scheduleServiceSource).toContain('if (!event.isTeamRsvpReminderManager)');
        expect(scheduleServiceSource).toContain('export async function loadStaffRsvpReminderPreview');
        expect(scheduleServiceSource).toContain('export function createStaffRsvpAvailabilityLoader');
        expect(scheduleServiceSource).toContain('export function createStaffRsvpReminderPreviewLoader');
        expect(scheduleServiceSource).toContain('export async function sendStaffRsvpReminder');
        expect(scheduleServiceSource).toContain('const emailResult = await sendPublicRsvpReminderEmailsNativeSafe(event);');
        expect(scheduleServiceSource).toContain('const rsvpPushMetrics = normalizeStaffRsvpReminderPushMetrics(emailResult);');
        expect(scheduleServiceSource).toContain('await updateRsvpReminderMetadata(event, user, preview.missingPlayerCount, emailSentCount, rsvpPushMetrics);');
    });

    it('keeps mobile schedule and team screens exposing the manager-only reminder action', () => {
        expect(scheduleEventDetailSource).toContain("import { StaffRsvpReminderPanel } from '../components/schedule/StaffRsvpReminderPanel';");
        expect(scheduleEventDetailSource).toContain('<StaffRsvpReminderPanel refreshToken={staffRsvp.refreshToken} staffRsvpLoader={staffRsvpLoader} />');
        expect(staffRsvpReminderPanelSource).toContain('export function StaffRsvpReminderPanel');
        expect(staffRsvpReminderPanelSource).toContain('event.isTeamRsvpReminderManager && event.isDbGame && !event.isCancelled');
        expect(staffRsvpReminderPanelSource).toContain('staffRsvpLoader.loadReminderPreview(event, auth.user)');
        expect(staffRsvpReminderPanelSource).toContain('await sendStaffRsvpReminder(event, auth.user, auth.profile || {});');
        expect(teamDetailSource).toContain('function TeamEventReminderAction');
        expect(teamDetailSource).toContain('createStaffRsvpReminderPreviewLoader');
        expect(teamDetailSource).toContain('await reminderPreviewLoader.loadPreview(scheduleEvent, auth.user);');
        expect(teamDetailSource).toContain('await sendStaffRsvpReminder(scheduleEvent, auth.user, auth.profile || {});');
        expect(teamDetailIntegrationTestSource).toContain('loads RSVP reminder previews only when a manager opens a specific schedule row action');
    });

    it('keeps Cloud Functions sending RSVP reminder emails and push notifications with summary metrics', () => {
        expect(functionsSource).toContain('exports.sendPublicRsvpEmails = functions.https.onRequest');
        expect(functionsSource).toContain('async function buildPublicRsvpSummary(teamId, gameId)');
        expect(functionsSource).toContain('async function sendRsvpReminderPushNotifications({ teamId, gameId, event = {}, recipientUserIds = [], recipientTargets = [] } = {})');
        expect(functionsSource).toContain('function buildRsvpReminderPushPayload(event)');
        expect(functionsSource).toContain('rsvpPushResult = await sendRsvpReminderPushNotifications({');
        expect(notificationContractTestSource).toContain('sends RSVP reminder pushes through the rsvp category with per-recipient child deep links');
        expect(publicRsvpFunctionsTestSource).toContain('allows platform admins to send public RSVP reminders');
        expect(appScheduleContractsTestSource).toContain('reuses the team roster across staff RSVP reminder preview loads');
    });
});
