import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

function getHelper(name, nextMarker) {
    const start = functionsSource.indexOf(`function ${name}(`);
    const end = functionsSource.indexOf(`\n${nextMarker}`);
    const slice = functionsSource.slice(start, end);
    return new Function(`${slice}; return ${name};`)();
}

const getFeeReminderPlayerKey = getHelper('getFeeReminderPlayerKey', 'function buildFeeReminderCandidateUserIds');
const buildFeeReminderCandidateUserIds = getHelper('buildFeeReminderCandidateUserIds', 'function resolveFeeReminderThresholdHours');
const resolveFeeReminderThresholdHours = getHelper('resolveFeeReminderThresholdHours', 'function wasFeeReminderSentForThreshold');
const wasFeeReminderSentForThreshold = getHelper('wasFeeReminderSentForThreshold', 'function formatFeeReminderWindowLabel');
const formatFeeReminderWindowLabel = getHelper('formatFeeReminderWindowLabel', 'async function resolveFeeReminderCandidateUserIds');

describe('fee due reminder helper logic', () => {
    it('builds a player key from team and player ids when the recipient does not store one', () => {
        expect(getFeeReminderPlayerKey({ playerId: 'player-1' }, 'team-1')).toBe('team-1::player-1');
        expect(getFeeReminderPlayerKey({ childId: 'player-2', teamId: 'team-2' }, '')).toBe('team-2::player-2');
    });

    it('preserves an explicit playerKey when present', () => {
        expect(getFeeReminderPlayerKey({ playerKey: 'team-9::player-9', playerId: 'ignored' }, 'team-1')).toBe('team-9::player-9');
    });

    it('does not invent player-linked lookup keys when team or player context is missing', () => {
        expect(getFeeReminderPlayerKey({ playerId: 'player-1' }, '')).toBe('');
        expect(getFeeReminderPlayerKey({ teamId: 'team-1' }, 'team-1')).toBe('');
        expect(getFeeReminderPlayerKey({}, 'team-1')).toBe('');
    });

    it('merges only parent-linked ids and removes blanks or duplicates', () => {
        expect(buildFeeReminderCandidateUserIds({
            parentUserId: 'user-1'
        }, ['user-3', '', 'user-1'])).toEqual(['user-1', 'user-3']);
    });

    it('uses team reminder defaults when configured and falls back to the existing three-day threshold', () => {
        expect(resolveFeeReminderThresholdHours({ scheduleNotifications: { reminderHours: 48 } })).toBe(48);
        expect(resolveFeeReminderThresholdHours({ scheduleNotifications: { reminderHours: 24 } })).toBe(24);
        expect(resolveFeeReminderThresholdHours({ scheduleNotifications: { reminderHours: 12 } })).toBe(72);
        expect(resolveFeeReminderThresholdHours({})).toBe(72);
    });

    it('deduplicates reminders by threshold and treats legacy sent flags as the default three-day send', () => {
        expect(wasFeeReminderSentForThreshold({ reminderSentAt: { seconds: 1 }, reminderThresholdHours: 48 }, 48)).toBe(true);
        expect(wasFeeReminderSentForThreshold({ reminderSentAt: { seconds: 1 }, reminderThresholdHours: 48 }, 72)).toBe(false);
        expect(wasFeeReminderSentForThreshold({ reminderSentAt: { seconds: 1 } }, 72)).toBe(true);
        expect(wasFeeReminderSentForThreshold({ reminderSentAt: { seconds: 1 } }, 24)).toBe(false);
        expect(wasFeeReminderSentForThreshold({}, 72)).toBe(false);
    });

    it('formats reminder copy from the configured day window', () => {
        expect(formatFeeReminderWindowLabel(24)).toBe('1 day or less');
        expect(formatFeeReminderWindowLabel(48)).toBe('2 days or less');
        expect(formatFeeReminderWindowLabel(72)).toBe('3 days or less');
    });
});

describe('fee due reminder source wiring', () => {
    it('queries fee recipients using the stored status and dueDate fields', () => {
        expect(functionsSource).toContain(".where('status', 'in', ['unpaid', 'pending'])");
        expect(functionsSource).toContain(".where('dueDate', '>=', now)");
        expect(functionsSource).toContain(".where('dueDate', '<=', maxReminderThresholdLater)");
    });

    it('resolves player-linked parents and team reminder thresholds before deciding whether to mark the reminder as sent', () => {
        expect(functionsSource).toContain(".where('parentPlayerKeys', 'array-contains', playerKey)");
        expect(functionsSource).toContain("const teamSnap = await firestore.collection('teams').doc(teamId).get();");
        expect(functionsSource).toContain('reminderThresholdHours = resolveFeeReminderThresholdHours(teamSnap.exists ? teamSnap.data() : {});');
        expect(functionsSource).toContain('const candidateUserIds = await resolveFeeReminderCandidateUserIds(teamId, data);');
        expect(functionsSource).toContain('const candidateUserIdSet = new Set(candidateUserIds);');
        expect(functionsSource).toContain('if (wasFeeReminderSentForThreshold(data, reminderThresholdHours)) return null;');
        expect(functionsSource).toContain('reminderThresholdHours');
    });

    it('leaves reminders unmarked when no payer targets can receive them', () => {
        const candidateGuardIndex = functionsSource.indexOf('if (!candidateUserIds.length) return null;');
        const targetGuardIndex = functionsSource.indexOf('if (!payerTargets.length) return null;');
        const markSentIndex = functionsSource.indexOf('await doc.ref.update({');

        expect(candidateGuardIndex).toBeGreaterThan(-1);
        expect(targetGuardIndex).toBeGreaterThan(candidateGuardIndex);
        expect(markSentIndex).toBeGreaterThan(targetGuardIndex);
    });

    it('formats the reminder amount and attaches fee-specific routing identifiers', () => {
        expect(functionsSource).toContain("const batchId = pathParts[3];");
        expect(functionsSource).toContain("const recipientId = pathParts[5];");
        expect(functionsSource).toContain("const amountLabel = formatMoneyFromCents(getTeamFeeBalanceCents(data), data.currency || 'USD');");
        expect(functionsSource).toContain('const reminderWindowLabel = formatFeeReminderWindowLabel(reminderThresholdHours);');
        expect(functionsSource).toContain('body: `${amountLabel} is due in ${reminderWindowLabel}.`,');
        expect(functionsSource).toContain('batchId,');
        expect(functionsSource).toContain('recipientId,');
    });
});
