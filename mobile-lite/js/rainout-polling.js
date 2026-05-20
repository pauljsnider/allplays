const DEFAULT_POLL_INTERVAL_MINUTES = 30;

function normalizeZip(zip) {
    if (zip === null || zip === undefined) {
        return '';
    }

    const digitsOnly = String(zip).replace(/\D/g, '');
    if (digitsOnly.length >= 5) {
        return digitsOnly.slice(0, 5);
    }

    return '';
}

function buildUniqueZipPollPlan(subscriptions) {
    const buckets = new Map();

    (subscriptions || []).forEach((subscription) => {
        const tenantId = String(subscription?.tenantId || '').trim();
        const zip = normalizeZip(subscription?.zip);

        if (!tenantId || !zip) {
            return;
        }

        const key = `${tenantId}::${zip}`;
        if (!buckets.has(key)) {
            buckets.set(key, {
                tenantId,
                zip,
                subscriberCount: 0,
                subscriptionIds: []
            });
        }

        const bucket = buckets.get(key);
        bucket.subscriberCount += 1;

        if (subscription?.id) {
            bucket.subscriptionIds.push(String(subscription.id));
        }
    });

    return [...buckets.values()].sort((a, b) => {
        if (a.tenantId === b.tenantId) {
            return a.zip.localeCompare(b.zip);
        }
        return a.tenantId.localeCompare(b.tenantId);
    });
}

function getNextPollTimeMs(nowMs, intervalMinutes = DEFAULT_POLL_INTERVAL_MINUTES) {
    const now = Number.isFinite(nowMs) ? nowMs : Date.now();
    const intervalMs = Math.max(1, intervalMinutes) * 60 * 1000;
    return Math.ceil(now / intervalMs) * intervalMs;
}

function hasRainoutStatusChanged(previousEvent, nextEvent) {
    if (!nextEvent) {
        return false;
    }

    if (!previousEvent) {
        return true;
    }

    const previousStatus = String(previousEvent.status || '').toLowerCase();
    const nextStatus = String(nextEvent.status || '').toLowerCase();
    const previousUpdatedAt = Number(previousEvent.updatedAt || 0);
    const nextUpdatedAt = Number(nextEvent.updatedAt || 0);

    if (previousStatus !== nextStatus) {
        return true;
    }

    return nextUpdatedAt > previousUpdatedAt;
}

function matchEventToSubscribers(event, subscriptions) {
    if (!event) {
        return [];
    }

    const tenantId = String(event.tenantId || '').trim();
    const eventZip = normalizeZip(event.zip);
    const eventFacilityId = String(event.facilityId || '').trim();

    if (!tenantId || !eventZip) {
        return [];
    }

    return (subscriptions || []).filter((subscription) => {
        const subscriptionTenant = String(subscription?.tenantId || '').trim();
        const subscriptionZip = normalizeZip(subscription?.zip);

        if (subscriptionTenant !== tenantId || subscriptionZip !== eventZip) {
            return false;
        }

        const subscriptionFacilityId = String(subscription?.facilityId || '').trim();
        if (!subscriptionFacilityId) {
            return true;
        }

        return subscriptionFacilityId === eventFacilityId;
    });
}

export {
    DEFAULT_POLL_INTERVAL_MINUTES,
    normalizeZip,
    buildUniqueZipPollPlan,
    getNextPollTimeMs,
    hasRainoutStatusChanged,
    matchEventToSubscribers
};
