import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    FEE_REMINDER_QUERY_PAGE_SIZE,
    drainFeeReminderQueryPages
} = require('../../functions/fee-due-reminder-dispatcher-core.cjs');

const functionsSource = readFileSync(new URL('../../functions/index.js', import.meta.url), 'utf8');
const firestoreIndexes = JSON.parse(readFileSync(new URL('../../firestore.indexes.json', import.meta.url), 'utf8'));

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

function createReminderDoc(path) {
    return {
        id: path.split('/').pop(),
        ref: { path }
    };
}

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
    it('queries both fee-recipient populations with ordered bounded pages and cursors', () => {
        const start = functionsSource.indexOf('async function sendFeeUnpaidDueReminders()');
        const end = functionsSource.indexOf('\nexports.sendFeeUnpaidDueReminders', start);
        const source = functionsSource.slice(start, end);

        expect(source).toContain(".where('status', 'in', ['unpaid', 'pending'])");
        expect(source).toContain(".where('dueDate', '>=', upcomingScanStart)");
        expect(source).toContain(".where('dueDate', '<=', upcomingScanEnd)");
        expect(source).toContain(".orderBy('dueDate', 'asc')");
        expect(source).toContain(".where('reminderDeliveryClaimExpiresAtMillis', '>', 0)");
        expect(source).toContain(".orderBy('reminderDeliveryClaimExpiresAtMillis', 'asc')");
        expect(source).toContain('.startAfter(cursorValue, cursorPath)');
        expect(source).toContain('.limit(FEE_REMINDER_QUERY_PAGE_SIZE)');
        expect(source).toContain('drainFeeReminderQueryPages({');
        expect(source).toContain('initialCursors: persistedCursors');
        expect(source).toContain('saveCursor');
        expect(source).toContain('upcomingScan: persistedUpcomingScan');
        expect(source).toContain('}, { merge: true });');
        expect(source).toContain('overdueEligibilityFloorMillis');
        expect(source).toContain("firestore.doc(FEE_REMINDER_DISPATCH_STATE_PATH)");
        expect(source).toContain('FEE_REMINDER_MAX_PAGES_PER_QUERY');
        expect(source).toContain('FEE_REMINDER_MAX_RUNTIME_MS');
        expect(source).toContain('FEE_REMINDER_WORKER_CONCURRENCY');
        expect(source).not.toMatch(/\.where\('dueDate',[\s\S]+?\.get\(\),/);
    });

    it('declares collection-group indexes for upcoming and leased reminder queries', () => {
        expect(firestoreIndexes.indexes).toContainEqual({
            collectionGroup: 'feeRecipients',
            queryScope: 'COLLECTION_GROUP',
            fields: [
                { fieldPath: 'status', order: 'ASCENDING' },
                { fieldPath: 'dueDate', order: 'ASCENDING' }
            ]
        });
        expect(firestoreIndexes.fieldOverrides).toContainEqual({
            collectionGroup: 'feeRecipients',
            fieldPath: 'reminderDeliveryClaimExpiresAtMillis',
            indexes: [
                { order: 'ASCENDING', queryScope: 'COLLECTION_GROUP' }
            ]
        });
    });

    it('resolves player-linked parents and team reminder thresholds before deciding whether to mark the reminder as sent', () => {
        expect(functionsSource).toContain(".where('parentPlayerKeys', 'array-contains', playerKey)");
        expect(functionsSource).toContain("const teamSnap = await firestore.collection('teams').doc(teamId).get();");
        expect(functionsSource).toContain('reminderThresholdHours = resolveFeeReminderThresholdHours(teamSnap.exists ? teamSnap.data() : {});');
        expect(functionsSource).toContain('const candidateUserIds = await resolveFeeReminderCandidateUserIds(teamId, recipient);');
        expect(functionsSource).toContain('const candidateUserIdSet = new Set(candidateUserIds);');
        expect(functionsSource).toContain('async function resolveEligibleFeeReminderRecipient({');
        expect(functionsSource).toContain('if (!isFeeDueReminderCandidateEligible(recipient, {');
        expect(functionsSource).toContain('allowRecentlyOverdueRecovery');
        expect(functionsSource).toContain('reminderThresholdHours');
    });

    it('leaves reminders unmarked when no payer targets can receive them', () => {
        const candidateGuardIndex = functionsSource.indexOf('if (!candidateUserIds.length) return null;');
        const targetGuardIndex = functionsSource.indexOf('if (!payerTargets.length) return null;');
        const markSentIndex = functionsSource.indexOf('const claimId = await claimFeeDueReminder(doc.ref, {');

        expect(candidateGuardIndex).toBeGreaterThan(-1);
        expect(targetGuardIndex).toBeGreaterThan(candidateGuardIndex);
        expect(markSentIndex).toBeGreaterThan(targetGuardIndex);
        expect(functionsSource).toContain('recipient.reminderDeliveryClaimId !== claimId');
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

describe('fee due reminder bounded dispatcher', () => {
    it('drains more than two pages and deduplicates paths across upcoming and leased queries', async () => {
        const upcomingDocs = Array.from({ length: 120 }, (_, index) => createReminderDoc(
            `teams/team-1/feeBatches/batch-1/feeRecipients/upcoming-${String(index + 1).padStart(3, '0')}`
        ));
        const leasedDocs = [
            upcomingDocs[75],
            createReminderDoc('teams/team-1/feeBatches/batch-1/feeRecipients/leased-only')
        ];
        const processedPaths = [];
        const pageCalls = [];

        const summary = await drainFeeReminderQueryPages({
            queryNames: ['upcoming', 'leased'],
            loadPage: async ({ queryName, cursor, limit }) => {
                pageCalls.push({ queryName, cursor: cursor?.ref?.path || null, limit });
                const docs = queryName === 'upcoming' ? upcomingDocs : leasedDocs;
                const startIndex = cursor
                    ? docs.findIndex((doc) => doc.ref.path === cursor.ref.path) + 1
                    : 0;
                return docs.slice(startIndex, startIndex + limit);
            },
            processRecipient: async (doc) => {
                processedPaths.push(doc.ref.path);
                return { sent: true };
            }
        });

        expect(pageCalls.filter((call) => call.queryName === 'upcoming')).toHaveLength(3);
        expect(pageCalls.every((call) => call.limit === FEE_REMINDER_QUERY_PAGE_SIZE)).toBe(true);
        expect(processedPaths).toHaveLength(121);
        expect(new Set(processedPaths).size).toBe(121);
        expect(processedPaths).toContain(upcomingDocs[119].ref.path);
        expect(summary).toMatchObject({
            examined: 122,
            sent: 121,
            failed: 0,
            deduplicated: 1,
            stoppedBecause: 'drained'
        });
    });

    it('never exceeds the configured recipient worker concurrency', async () => {
        const docs = Array.from({ length: 20 }, (_, index) => createReminderDoc(
            `teams/team-1/feeBatches/batch-1/feeRecipients/recipient-${index + 1}`
        ));
        let activeWorkers = 0;
        let maximumWorkers = 0;

        await drainFeeReminderQueryPages({
            queryNames: ['upcoming'],
            concurrency: 3,
            loadPage: async () => docs,
            processRecipient: async () => {
                activeWorkers += 1;
                maximumWorkers = Math.max(maximumWorkers, activeWorkers);
                await new Promise((resolve) => setTimeout(resolve, 1));
                activeWorkers -= 1;
                return { sent: true };
            }
        });

        expect(maximumWorkers).toBe(3);
    });

    it('does not checkpoint a rejected recipient or later concurrent successes', async () => {
        const docs = [
            createReminderDoc('teams/team-1/feeBatches/batch-1/feeRecipients/fails'),
            createReminderDoc('teams/team-1/feeBatches/batch-1/feeRecipients/sends')
        ];
        const savedCursors = [];

        const summary = await drainFeeReminderQueryPages({
            queryNames: ['upcoming'],
            loadPage: async () => docs,
            saveCursor: async ({ cursor, drained }) => {
                savedCursors.push({ path: cursor?.ref?.path || null, drained });
            },
            processRecipient: async (doc) => {
                if (doc.id === 'fails') throw new Error('delivery failed');
                return { sent: true };
            }
        });

        expect(summary).toMatchObject({
            examined: 2,
            sent: 1,
            failed: 1,
            stoppedBecause: 'recipientFailure'
        });
        expect(savedCursors).toEqual([{ path: null, drained: false }]);
    });

    it('checkpoints only the contiguous handled prefix before a returned failure', async () => {
        const docs = ['first', 'fails', 'later'].map((id) => createReminderDoc(
            `teams/team-1/feeBatches/batch-1/feeRecipients/${id}`
        ));
        let savedCursor = null;

        const summary = await drainFeeReminderQueryPages({
            queryNames: ['upcoming'],
            concurrency: 3,
            loadPage: async () => docs,
            saveCursor: async ({ cursor }) => {
                savedCursor = cursor;
            },
            processRecipient: async (doc) => (
                doc.id === 'fails' ? { failed: true } : { sent: true }
            )
        });

        expect(summary).toMatchObject({ sent: 2, failed: 1, stoppedBecause: 'recipientFailure' });
        expect(savedCursor).toBe(docs[0]);
    });

    it('persists thrown and returned failures while continuing through later pages', async () => {
        const docs = ['throws', 'returned', 'later-1', 'later-2', 'later-3'].map((id) => createReminderDoc(
            `teams/team-1/feeBatches/batch-1/feeRecipients/${id}`
        ));
        const processedIds = [];
        const retryIds = [];

        const summary = await drainFeeReminderQueryPages({
            queryNames: ['upcoming'],
            pageSize: 2,
            loadPage: async ({ cursor, limit }) => {
                const startIndex = cursor ? docs.indexOf(cursor) + 1 : 0;
                return docs.slice(startIndex, startIndex + limit);
            },
            processRecipient: async (doc) => {
                processedIds.push(doc.id);
                if (doc.id === 'throws') throw new Error('retry thrown failure');
                if (doc.id === 'returned') return { failed: true };
                return { sent: true };
            },
            onRecipientFailure: async (doc) => {
                retryIds.push(doc.id);
            }
        });

        expect(processedIds).toEqual(docs.map((doc) => doc.id));
        expect(retryIds).toEqual(['throws', 'returned']);
        expect(summary).toMatchObject({
            examined: 5,
            sent: 3,
            failed: 2,
            stoppedBecause: 'drained'
        });
    });

    it('returns explicit page and runtime stopping reasons with counts', async () => {
        const fullPage = Array.from({ length: FEE_REMINDER_QUERY_PAGE_SIZE }, (_, index) => createReminderDoc(
            `teams/team-1/feeBatches/batch-1/feeRecipients/page-${index + 1}`
        ));
        const pageCapped = await drainFeeReminderQueryPages({
            queryNames: ['upcoming'],
            maxPagesPerQuery: 1,
            loadPage: async () => fullPage,
            processRecipient: async () => null
        });

        let clock = 0;
        const runtimeCapped = await drainFeeReminderQueryPages({
            queryNames: ['upcoming'],
            maxRuntimeMs: 10,
            getNowMs: () => {
                clock += 10;
                return clock;
            },
            loadPage: async () => fullPage,
            processRecipient: async () => ({ sent: true })
        });

        expect(pageCapped).toMatchObject({
            examined: FEE_REMINDER_QUERY_PAGE_SIZE,
            sent: 0,
            failed: 0,
            stoppedBecause: 'maxPages'
        });
        expect(runtimeCapped).toMatchObject({
            examined: 0,
            sent: 0,
            failed: 0,
            stoppedBecause: 'maxRuntimeMs'
        });
    });

    it('resumes after page-capped invocations instead of rescanning the first recipients', async () => {
        const docs = Array.from({ length: 7 }, (_, index) => createReminderDoc(
            `teams/team-1/feeBatches/batch-1/feeRecipients/capped-${index + 1}`
        ));
        const processedPaths = [];
        const persistedCursors = {};
        const loadPage = async ({ cursor, limit }) => {
            const startIndex = cursor
                ? docs.findIndex((doc) => doc.ref.path === cursor.ref.path) + 1
                : 0;
            return docs.slice(startIndex, startIndex + limit);
        };
        const saveCursor = async ({ queryName, cursor }) => {
            persistedCursors[queryName] = cursor;
        };
        const processRecipient = async (doc) => {
            processedPaths.push(doc.ref.path);
            return { sent: true };
        };

        const firstSummary = await drainFeeReminderQueryPages({
            queryNames: ['upcoming'],
            pageSize: 2,
            maxPagesPerQuery: 2,
            loadPage,
            saveCursor,
            processRecipient
        });
        const secondSummary = await drainFeeReminderQueryPages({
            queryNames: ['upcoming'],
            pageSize: 2,
            maxPagesPerQuery: 2,
            initialCursors: persistedCursors,
            loadPage,
            saveCursor,
            processRecipient
        });

        expect(firstSummary).toMatchObject({ examined: 4, stoppedBecause: 'maxPages' });
        expect(secondSummary).toMatchObject({ examined: 3, stoppedBecause: 'drained' });
        expect(processedPaths).toEqual(docs.map((doc) => doc.ref.path));
        expect(persistedCursors.upcoming).toBeNull();
    });

    it('checkpoints the processed prefix when runtime expires within a page', async () => {
        const docs = Array.from({ length: 5 }, (_, index) => createReminderDoc(
            `teams/team-1/feeBatches/batch-1/feeRecipients/runtime-${index + 1}`
        ));
        const processedPaths = [];
        const persistedCursors = {};
        let clock = 0;
        const loadPage = async ({ cursor, limit }) => {
            const startIndex = cursor
                ? docs.findIndex((doc) => doc.ref.path === cursor.ref.path) + 1
                : 0;
            return docs.slice(startIndex, startIndex + limit);
        };
        const saveCursor = async ({ queryName, cursor }) => {
            persistedCursors[queryName] = cursor;
        };
        const processRecipient = async (doc) => {
            processedPaths.push(doc.ref.path);
            clock += 4;
            return { sent: true };
        };

        const firstSummary = await drainFeeReminderQueryPages({
            queryNames: ['upcoming'],
            pageSize: 5,
            concurrency: 1,
            maxRuntimeMs: 10,
            getNowMs: () => clock,
            loadPage,
            saveCursor,
            processRecipient
        });
        clock = 0;
        const secondSummary = await drainFeeReminderQueryPages({
            queryNames: ['upcoming'],
            pageSize: 5,
            initialCursors: persistedCursors,
            loadPage,
            saveCursor,
            processRecipient
        });

        expect(firstSummary).toMatchObject({ sent: 3, stoppedBecause: 'maxRuntimeMs' });
        expect(secondSummary).toMatchObject({ sent: 2, stoppedBecause: 'drained' });
        expect(processedPaths).toEqual(docs.map((doc) => doc.ref.path));
    });
});
