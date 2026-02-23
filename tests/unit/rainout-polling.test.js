import { describe, it, expect } from 'vitest';
import {
    DEFAULT_POLL_INTERVAL_MINUTES,
    normalizeZip,
    buildUniqueZipPollPlan,
    getNextPollTimeMs,
    hasRainoutStatusChanged,
    matchEventToSubscribers
} from '../../js/rainout-polling.js';

describe('rainout polling helpers', () => {
    it('normalizes zip values to five digits', () => {
        expect(normalizeZip('20176-1234')).toBe('20176');
        expect(normalizeZip(' 20176 ')).toBe('20176');
        expect(normalizeZip('abc')).toBe('');
    });

    it('builds a unique zip poll plan per tenant and zip', () => {
        const subscriptions = [
            { id: 's1', tenantId: 't1', zip: '20176' },
            { id: 's2', tenantId: 't1', zip: '20176-0033' },
            { id: 's3', tenantId: 't1', zip: '20175' },
            { id: 's4', tenantId: 't2', zip: '20176' },
            { id: 's5', tenantId: '', zip: '20176' }
        ];

        expect(buildUniqueZipPollPlan(subscriptions)).toEqual([
            {
                tenantId: 't1',
                zip: '20175',
                subscriberCount: 1,
                subscriptionIds: ['s3']
            },
            {
                tenantId: 't1',
                zip: '20176',
                subscriberCount: 2,
                subscriptionIds: ['s1', 's2']
            },
            {
                tenantId: 't2',
                zip: '20176',
                subscriberCount: 1,
                subscriptionIds: ['s4']
            }
        ]);
    });

    it('aligns next poll time to the next 30-minute boundary by default', () => {
        const now = Date.UTC(2026, 1, 23, 2, 40, 55);
        const next = getNextPollTimeMs(now);
        expect(next).toBe(Date.UTC(2026, 1, 23, 3, 0, 0));
        expect(DEFAULT_POLL_INTERVAL_MINUTES).toBe(30);
    });

    it('detects changed status or newer updates', () => {
        const previous = { status: 'open', updatedAt: 1000 };
        expect(hasRainoutStatusChanged(previous, { status: 'closed', updatedAt: 1000 })).toBe(true);
        expect(hasRainoutStatusChanged(previous, { status: 'open', updatedAt: 1500 })).toBe(true);
        expect(hasRainoutStatusChanged(previous, { status: 'open', updatedAt: 900 })).toBe(false);
        expect(hasRainoutStatusChanged(null, { status: 'open', updatedAt: 1 })).toBe(true);
    });

    it('matches event subscribers by tenant and zip with optional facility filter', () => {
        const event = { tenantId: 't1', zip: '20176', facilityId: 'f1' };
        const subscriptions = [
            { id: 'a', tenantId: 't1', zip: '20176' },
            { id: 'b', tenantId: 't1', zip: '20176', facilityId: 'f1' },
            { id: 'c', tenantId: 't1', zip: '20176', facilityId: 'f2' },
            { id: 'd', tenantId: 't2', zip: '20176' }
        ];

        expect(matchEventToSubscribers(event, subscriptions).map((item) => item.id)).toEqual(['a', 'b']);
    });
});
