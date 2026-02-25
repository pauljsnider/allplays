import {
    DEFAULT_POLL_INTERVAL_MINUTES,
    buildUniqueZipPollPlan,
    getNextPollTimeMs,
    hasRainoutStatusChanged,
    matchEventToSubscribers,
    normalizeZip
} from './rainout-polling.js';

const DEFAULT_MAX_ZIPS_PER_TENANT = 50;

function toFiniteNumber(value, fallback) {
    return Number.isFinite(value) ? Number(value) : fallback;
}

function getStateKey(event) {
    const tenantId = String(event?.tenantId || '').trim();
    const sourceEventId = String(event?.sourceEventId || event?.id || '').trim();
    const fallbackKey = [
        normalizeZip(event?.zip),
        String(event?.facilityId || '').trim()
    ].join('::');
    return `${tenantId}::${sourceEventId || fallbackKey}`;
}

function getIdempotencyKey(event) {
    return [
        String(event?.tenantId || '').trim(),
        normalizeZip(event?.zip),
        String(event?.facilityId || '').trim(),
        String(event?.sourceEventId || event?.id || '').trim(),
        String(event?.status || '').trim().toLowerCase(),
        String(toFiniteNumber(event?.updatedAt, 0))
    ].join('::');
}

function classifyError(error) {
    const raw = String(error?.code || error?.message || error?.name || 'unknown_error').trim();
    return raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown_error';
}

function applyZipGuardrail(targets, maxZipsPerTenant) {
    if (!Number.isFinite(maxZipsPerTenant) || maxZipsPerTenant <= 0) {
        return { targets, guardrailSkippedTargets: 0 };
    }

    const usageByTenant = new Map();
    const allowed = [];
    let guardrailSkippedTargets = 0;

    for (const target of targets) {
        const tenantId = String(target?.tenantId || '').trim();
        const used = usageByTenant.get(tenantId) || 0;
        if (used >= maxZipsPerTenant) {
            guardrailSkippedTargets += 1;
            continue;
        }

        usageByTenant.set(tenantId, used + 1);
        allowed.push(target);
    }

    return { targets: allowed, guardrailSkippedTargets };
}

function uniqueStrings(values) {
    return [...new Set((values || []).filter(Boolean).map((value) => String(value)))];
}

export async function executeRainoutPollingRun(options = {}) {
    const nowMs = toFiniteNumber(options.nowMs, Date.now());
    const config = options.config || {};
    const intervalMinutes = Math.max(1, toFiniteNumber(config.intervalMinutes, DEFAULT_POLL_INTERVAL_MINUTES));
    const enabled = config.enabled !== false;
    const forceRun = config.forceRun === true;
    const maxZipsPerTenant = toFiniteNumber(config.maxZipsPerTenant, DEFAULT_MAX_ZIPS_PER_TENANT);
    const runId = String(options.runId || `rainout-run-${nowMs}`);
    const nextPollAtMs = getNextPollTimeMs(nowMs, intervalMinutes);
    const isOnBoundary = nowMs === nextPollAtMs;

    if (!enabled) {
        return {
            runId,
            intervalMinutes,
            nextPollAtMs,
            processedTargets: 0,
            guardrailSkippedTargets: 0,
            failedTargets: 0,
            changedEvents: 0,
            skippedUnchangedEvents: 0,
            notificationsSent: 0,
            errorClasses: [],
            skippedReason: 'feature_disabled'
        };
    }

    if (!isOnBoundary && !forceRun) {
        return {
            runId,
            intervalMinutes,
            nextPollAtMs,
            processedTargets: 0,
            guardrailSkippedTargets: 0,
            failedTargets: 0,
            changedEvents: 0,
            skippedUnchangedEvents: 0,
            notificationsSent: 0,
            errorClasses: [],
            skippedReason: 'not_on_boundary'
        };
    }

    const fetchSourceEvents = options.fetchSourceEvents || (async () => []);
    const readRainoutState = options.readRainoutState || (async () => null);
    const writeRainoutState = options.writeRainoutState || (async () => {});
    const hasProcessedIdempotencyKey = options.hasProcessedIdempotencyKey || (async () => false);
    const markProcessedIdempotencyKey = options.markProcessedIdempotencyKey || (async () => {});
    const writeRainoutEvent = options.writeRainoutEvent || (async () => {});
    const postChatUpdate = options.postChatUpdate || (async () => {});
    const upsertInAppStatus = options.upsertInAppStatus || (async () => {});
    const postNoChangeUpdate = options.postNoChangeUpdate || (async () => {});
    const writeAuditLog = options.writeAuditLog || (async () => {});

    const subscriptions = (options.subscriptions || []).filter((subscription) => subscription?.enabled !== false);
    const allTargets = buildUniqueZipPollPlan(subscriptions);
    const { targets, guardrailSkippedTargets } = applyZipGuardrail(allTargets, maxZipsPerTenant);

    const results = {
        runId,
        intervalMinutes,
        nextPollAtMs,
        processedTargets: 0,
        guardrailSkippedTargets,
        failedTargets: 0,
        changedEvents: 0,
        skippedUnchangedEvents: 0,
        notificationsSent: 0,
        errorClasses: [],
        skippedReason: null
    };

    const errorClassSet = new Set();

    for (const target of targets) {
        const targetStartedAt = nowMs;
        const targetCorrelationId = `${runId}:${target.tenantId}:${target.zip}`;
        try {
            const events = await fetchSourceEvents(target, {
                runId,
                correlationId: targetCorrelationId,
                nowMs
            });

            let targetChangedEvents = 0;
            let targetSkippedUnchanged = 0;
            const sourceEvents = Array.isArray(events) ? events : [];

            for (const event of sourceEvents) {
                const matchedSubscriptions = matchEventToSubscribers(event, subscriptions);
                if (matchedSubscriptions.length === 0) {
                    targetSkippedUnchanged += 1;
                    continue;
                }

                const stateKey = getStateKey(event);
                const priorState = await readRainoutState(stateKey, {
                    runId,
                    correlationId: targetCorrelationId,
                    nowMs
                });

                if (!hasRainoutStatusChanged(priorState, event)) {
                    targetSkippedUnchanged += 1;
                    continue;
                }

                const idempotencyKey = getIdempotencyKey(event);
                const alreadyProcessed = await hasProcessedIdempotencyKey(idempotencyKey, {
                    runId,
                    correlationId: targetCorrelationId,
                    nowMs
                });
                if (alreadyProcessed) {
                    targetSkippedUnchanged += 1;
                    continue;
                }

                const subscriptionIds = uniqueStrings(matchedSubscriptions.map((subscription) => subscription?.id));
                const userIds = uniqueStrings(matchedSubscriptions.map((subscription) => subscription?.userId));
                const normalizedEvent = {
                    tenantId: String(event.tenantId || '').trim(),
                    zip: normalizeZip(event.zip),
                    facilityId: String(event.facilityId || '').trim(),
                    sourceEventId: String(event.sourceEventId || event.id || '').trim(),
                    status: String(event.status || '').trim(),
                    updatedAt: toFiniteNumber(event.updatedAt, 0)
                };

                await writeRainoutEvent({
                    idempotencyKey,
                    runId,
                    correlationId: targetCorrelationId,
                    ...normalizedEvent,
                    subscriptionIds,
                    userIds,
                    matchedSubscriberCount: subscriptionIds.length,
                    createdAt: nowMs
                });

                await writeRainoutState(stateKey, {
                    ...normalizedEvent,
                    lastPollRunId: runId,
                    lastChangedAt: nowMs
                });

                await postChatUpdate({
                    runId,
                    correlationId: targetCorrelationId,
                    ...normalizedEvent,
                    subscriptionIds,
                    userIds
                });

                await upsertInAppStatus({
                    runId,
                    correlationId: targetCorrelationId,
                    ...normalizedEvent,
                    subscriptionIds,
                    userIds,
                    noChanges: false
                });

                await markProcessedIdempotencyKey(idempotencyKey, {
                    runId,
                    correlationId: targetCorrelationId,
                    nowMs
                });

                targetChangedEvents += 1;
                results.notificationsSent += 1;
            }

            if (targetChangedEvents === 0) {
                await postNoChangeUpdate({
                    runId,
                    correlationId: targetCorrelationId,
                    tenantId: target.tenantId,
                    zip: target.zip,
                    checkedAt: nowMs,
                    noChanges: true
                });
            }

            results.processedTargets += 1;
            results.changedEvents += targetChangedEvents;
            results.skippedUnchangedEvents += targetSkippedUnchanged;

            await writeAuditLog({
                runId,
                correlationId: targetCorrelationId,
                tenantId: target.tenantId,
                zip: target.zip,
                status: 'ok',
                resultCount: sourceEvents.length,
                changedEvents: targetChangedEvents,
                skippedUnchangedEvents: targetSkippedUnchanged,
                durationMs: nowMs - targetStartedAt,
                errorClass: null
            });
        } catch (error) {
            const errorClass = classifyError(error);
            errorClassSet.add(errorClass);
            results.failedTargets += 1;

            await writeAuditLog({
                runId,
                correlationId: targetCorrelationId,
                tenantId: target.tenantId,
                zip: target.zip,
                status: 'error',
                resultCount: 0,
                changedEvents: 0,
                skippedUnchangedEvents: 0,
                durationMs: nowMs - targetStartedAt,
                errorClass
            });
        }
    }

    results.errorClasses = [...errorClassSet].sort();
    return results;
}

export { DEFAULT_MAX_ZIPS_PER_TENANT };
