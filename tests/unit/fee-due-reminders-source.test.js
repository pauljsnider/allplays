import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');

function getHelper(name, nextMarker) {
    const start = functionsSource.indexOf(`function ${name}(`);
    const end = functionsSource.indexOf(`\n${nextMarker}`);
    const slice = functionsSource.slice(start, end);
    return new Function(`${slice}; return ${name};`)();
}

function getEligibilityHelpers() {
    const start = functionsSource.indexOf('function wasFeeReminderSentForThreshold(');
    const end = functionsSource.indexOf('\nasync function resolveFeeReminderCandidateUserIds');
    const slice = functionsSource.slice(start, end);
    const coerceDate = (value) => {
        if (!value) return null;
        if (typeof value?.toDate === 'function') return value.toDate();
        const date = value instanceof Date ? value : new Date(value);
        return Number.isNaN(date.getTime()) ? null : date;
    };
    const getTeamFeeBalanceCents = (recipient = {}) => {
        if (recipient.balanceDueCents != null) return Number(recipient.balanceDueCents);
        return Math.max(0, Number(recipient.amountCents || 0) - Number(recipient.amountPaidCents || 0));
    };
    return new Function('coerceDate', 'getTeamFeeBalanceCents', `${slice}; return { getFeeReminderDueDateMillis, isFeeDueReminderCandidateEligible };`)(
        coerceDate,
        getTeamFeeBalanceCents
    );
}

const getFeeReminderPlayerKey = getHelper('getFeeReminderPlayerKey', 'function buildFeeReminderCandidateUserIds');
const buildFeeReminderCandidateUserIds = getHelper('buildFeeReminderCandidateUserIds', 'function resolveFeeReminderThresholdHours');
const resolveFeeReminderThresholdHours = getHelper('resolveFeeReminderThresholdHours', 'function wasFeeReminderSentForThreshold');
const wasFeeReminderSentForThreshold = getHelper('wasFeeReminderSentForThreshold', 'function formatFeeReminderWindowLabel');
const formatFeeReminderWindowLabel = getHelper('formatFeeReminderWindowLabel', 'async function resolveFeeReminderCandidateUserIds');
const { getFeeReminderDueDateMillis, isFeeDueReminderCandidateEligible } = getEligibilityHelpers();

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

    it('identifies unpaid due-window fee reminder candidates', () => {
        const nowMillis = Date.parse('2026-06-28T12:00:00.000Z');

        expect(getFeeReminderDueDateMillis({ dueDate: '2026-06-30T12:00:00.000Z' })).toBe(Date.parse('2026-06-30T12:00:00.000Z'));
        expect(isFeeDueReminderCandidateEligible({
            status: 'unpaid',
            amountCents: 4500,
            dueDate: '2026-06-30T12:00:00.000Z'
        }, { nowMillis, reminderThresholdHours: 72 })).toBe(true);
        expect(isFeeDueReminderCandidateEligible({
            status: 'pending',
            amountCents: 4500,
            dueDate: '2026-07-02T12:00:00.000Z'
        }, { nowMillis, reminderThresholdHours: 72 })).toBe(false);
        expect(isFeeDueReminderCandidateEligible({
            status: 'paid',
            amountCents: 4500,
            dueDate: '2026-06-30T12:00:00.000Z'
        }, { nowMillis, reminderThresholdHours: 72 })).toBe(false);
        expect(isFeeDueReminderCandidateEligible({
            status: 'unpaid',
            amountCents: 4500,
            amountPaidCents: 4500,
            dueDate: '2026-06-30T12:00:00.000Z'
        }, { nowMillis, reminderThresholdHours: 72 })).toBe(false);
        expect(isFeeDueReminderCandidateEligible({
            status: 'unpaid',
            amountCents: 4500,
            dueDate: '2026-06-30T12:00:00.000Z',
            reminderSentAt: { seconds: 1 },
            reminderThresholdHours: 72
        }, { nowMillis, reminderThresholdHours: 72 })).toBe(false);
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
        expect(functionsSource).toContain('const candidateUserIds = await resolveFeeReminderCandidateUserIds(teamId, recipient);');
        expect(functionsSource).toContain('const candidateUserIdSet = new Set(candidateUserIds);');
        expect(functionsSource).toContain('async function resolveEligibleFeeReminderRecipient({');
        expect(functionsSource).toContain('if (!isFeeDueReminderCandidateEligible(recipient, { nowMillis, reminderThresholdHours })) {');
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
        expect(functionsSource).toContain('const body = buildFeeReminderNotificationBody(data, amountLabel, reminderThresholdHours);');
        expect(functionsSource).toContain('return `${amountLabel} is due ${dueDateDisplay} (${reminderWindowLabel}).`;');
        expect(functionsSource).toContain('body,');
        expect(functionsSource).toContain('batchId,');
        expect(functionsSource).toContain('recipientId,');
    });
});
