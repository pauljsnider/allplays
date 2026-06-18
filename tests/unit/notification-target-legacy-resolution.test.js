import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { loadNotificationInternals } = require('../../functions/test/send-category-notification-test-helpers');
const {
    LEGACY_CATEGORY_RESOLUTION_FIXTURES,
    normalizeResolvedTargets,
    buildIndexedTargetsFromExpected
} = require('./notification-target-resolution-fixtures.cjs');

describe('legacy category notification target resolution fixtures', () => {
    for (const fixture of LEGACY_CATEGORY_RESOLUTION_FIXTURES) {
        it(fixture.name, async () => {
            const { internals, env, cleanup } = loadNotificationInternals({
                ...fixture.options,
                indexedTargets: []
            });

            try {
                const targets = await internals.getTargetsForCategory(
                    fixture.request.teamId,
                    fixture.request.category,
                    fixture.request.actorUid || null,
                    fixture.request.audienceContext || {}
                );

                expect(normalizeResolvedTargets(targets)).toEqual(
                    normalizeResolvedTargets(fixture.expectedTargets)
                );
                expect({
                    targetQueries: env.counts.recipientQueries ?? env.counts.targetQueries,
                    parentQueries: env.counts.parentQueries,
                    preferenceGets: env.counts.preferenceGets,
                    deviceGets: env.counts.deviceGets
                }).toEqual(fixture.expectedCounts);
            } finally {
                cleanup();
            }
        });

        it(`${fixture.name} parity fixtures can seed indexed-resolution tests later`, async () => {
            const { internals, env, cleanup } = loadNotificationInternals({
                ...fixture.options,
                indexedTargets: buildIndexedTargetsFromExpected(
                    fixture.request.category,
                    fixture.expectedTargets
                )
            });

            try {
                const targets = await internals.getTargetsForCategory(
                    fixture.request.teamId,
                    fixture.request.category,
                    fixture.request.actorUid || null,
                    fixture.request.audienceContext || {}
                );

                expect(normalizeResolvedTargets(targets)).toEqual(
                    normalizeResolvedTargets(fixture.expectedTargets)
                );
                expect(env.counts.preferenceGets).toBe(fixture.expectedIndexedCounts.preferenceGets);
                expect(env.counts.deviceGets).toBe(fixture.expectedIndexedCounts.deviceGets);
            } finally {
                cleanup();
            }
        });
    }
});
