import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';

function loadTelemetryCollectorHelpers() {
    const source = readFileSync('functions/index.js', 'utf8');
    const start = source.indexOf('function normalizeTelemetryString');
    const end = source.indexOf('const calendarServiceAccount');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return new Function('admin', 'crypto', `${source.slice(start, end)}
        return { normalizeTelemetryEvent, commitTelemetryEvents };
    `);
}

function createFirestoreHarness() {
    const created = [];
    const sets = [];
    const db = {
        collection(collectionName) {
            return { doc(id) { return { collectionName, id }; } };
        },
        async runTransaction(handler) {
            return handler({
                get: async () => ({ exists: false }),
                create: (ref, data) => created.push({ ref, data }),
                set: (ref, data, options) => sets.push({ ref, data, options })
            });
        }
    };
    function firestore() { return db; }
    firestore.FieldValue = {
        serverTimestamp: () => ({ serverTimestamp: true }),
        increment: (value) => ({ increment: value })
    };
    firestore.Timestamp = { fromDate: (value) => ({ timestamp: value.toISOString() }) };
    return { admin: { firestore }, db, created, sets };
}

function rawEvent(overrides = {}) {
    return {
        id: 'parent-core-workflow-1',
        name: 'app_workflow_timing',
        version: '2.0.0',
        sessionId: 'session-parent-1',
        visitorId: 'persistent-visitor-must-not-survive',
        userId: 'spoofed-user',
        signedIn: true,
        clientTimestamp: '2030-06-01T11:59:59.000Z',
        pagePath: '/app/',
        appRoute: '/players/team-1/player-1?private=yes',
        queryKeys: ['private'],
        pageTitle: 'Taylor private dashboard',
        userAgent: 'exact fingerprint',
        properties: {
            workflowName: 'parent core workflow drill in',
            durationMs: 1234,
            outcome: 'success',
            source: 'parent_core',
            targetRoute: '/players/team-1/player-1',
            teamId: 'team-1',
            playerId: 'player-1',
            targetXPercent: 61,
            screenY: 744,
            message: 'Taylor private note',
            arbitrary: 'unclassified user content'
        },
        ...overrides
    };
}

describe('telemetry workflow DB storage', () => {
    it('stores only hashed, route-templated, privacy-reduced events with expiry', async () => {
        const harness = createFirestoreHarness();
        const { normalizeTelemetryEvent, commitTelemetryEvents } = loadTelemetryCollectorHelpers()(harness.admin, crypto);
        const receivedAt = new Date('2030-06-01T12:00:00.000Z');
        const event = normalizeTelemetryEvent(rawEvent(), receivedAt);

        expect(await commitTelemetryEvents(harness.db, [event], '2030-06-01'))
            .toEqual({ stored: 1, duplicates: 0 });
        expect(harness.created).toHaveLength(1);
        expect(harness.created[0].ref).toEqual({
            collectionName: 'telemetryEvents', id: expect.stringMatching(/^[0-9a-f]{40}$/)
        });
        expect(harness.created[0].data).toMatchObject({
            privacyVersion: 2,
            sessionId: expect.stringMatching(/^[0-9a-f]{40}$/),
            visitorId: null,
            userId: null,
            pagePath: '/app',
            appRoute: '/players/:id/:id',
            pageTitle: '',
            queryKeys: [],
            userAgent: '',
            expiresAt: { timestamp: '2030-07-01T12:00:00.000Z' },
            properties: expect.objectContaining({
                workflowName: 'parent core workflow drill in',
                durationMs: 1234,
                targetRoute: '/players/:id/:id',
                teamId: '[id]',
                playerId: '[id]',
                targetXPercent: '[redacted-text]',
                screenY: '[redacted-text]',
                message: '[redacted-text]',
                arbitrary: '[redacted-text]'
            })
        });
        expect(harness.sets.map((write) => write.ref.collectionName)).toEqual(expect.arrayContaining([
            'telemetryDaily', 'telemetryPagesDaily', 'telemetryRoutesDaily',
            'telemetryEventsDaily', 'telemetrySessions'
        ]));
        expect(harness.sets).toEqual(expect.arrayContaining([
            expect.objectContaining({
                ref: { collectionName: 'telemetryEventsDaily', id: '2030-06-01_app_workflow_timing' },
                data: expect.objectContaining({
                    name: 'app_workflow_timing',
                    expiresAt: { timestamp: '2030-11-28T12:00:00.000Z' }
                }),
                options: { merge: true }
            }),
            expect.objectContaining({
                ref: { collectionName: 'telemetryRoutesDaily', id: '2030-06-01_players_:id_:id' },
                data: expect.objectContaining({ appRoute: '/players/:id/:id' }),
                options: { merge: true }
            })
        ]));
    });

    it('writes weighted aggregates and short-lived anonymous sessions', async () => {
        const harness = createFirestoreHarness();
        const { normalizeTelemetryEvent, commitTelemetryEvents } = loadTelemetryCollectorHelpers()(harness.admin, crypto);
        const event = normalizeTelemetryEvent(rawEvent({
            name: 'page_view', sampleRate: 0.01, sampleWeight: 99
        }), new Date('2030-06-01T12:00:00.000Z'));
        expect(event).toMatchObject({ sampleRate: 0.25, sampleWeight: 4 });
        await commitTelemetryEvents(harness.db, [event], '2030-06-01');

        const daily = harness.sets.find((write) => write.ref.collectionName === 'telemetryDaily');
        expect(daily.data).toMatchObject({
            totalEvents: { increment: 4 },
            pageViews: { increment: 4 },
            expiresAt: { timestamp: '2030-11-28T12:00:00.000Z' }
        });
        const session = harness.sets.find((write) => write.ref.collectionName === 'telemetrySessions');
        expect(session.ref.id).toMatch(/^[0-9a-f]{40}$/);
        expect(session.data).toMatchObject({
            visitorId: null,
            userId: null,
            eventCount: { increment: 1 },
            pageViews: { increment: 1 },
            expiresAt: { timestamp: '2030-06-02T12:00:00.000Z' }
        });
    });

    it('forces critical telemetry to full sampling and ignores client multipliers', () => {
        const harness = createFirestoreHarness();
        const { normalizeTelemetryEvent } = loadTelemetryCollectorHelpers()(harness.admin, crypto);
        const event = normalizeTelemetryEvent(rawEvent({
            name: 'app_load_error', sampleRate: 0.01, sampleWeight: 100, signedIn: true
        }), new Date('2030-06-01T12:00:00.000Z'));

        expect(event).toMatchObject({ sampleRate: 1, sampleWeight: 1, signedIn: false });
    });

    it('keeps explicit workflow telemetry unsampled regardless of client input', () => {
        const harness = createFirestoreHarness();
        const { normalizeTelemetryEvent } = loadTelemetryCollectorHelpers()(harness.admin, crypto);
        const event = normalizeTelemetryEvent(rawEvent({
            name: 'app_workflow_timing', sampleRate: 0.01, sampleWeight: 100
        }), new Date('2030-06-01T12:00:00.000Z'));

        expect(event).toMatchObject({ sampleRate: 1, sampleWeight: 1 });
    });

    it('derives a deterministic daily deduplication hash without storing the client id', () => {
        const harness = createFirestoreHarness();
        const { normalizeTelemetryEvent } = loadTelemetryCollectorHelpers()(harness.admin, crypto);
        const receivedAt = new Date('2030-06-01T12:00:00.000Z');
        const first = normalizeTelemetryEvent(rawEvent(), receivedAt);
        const duplicate = normalizeTelemetryEvent(rawEvent(), receivedAt);
        expect(first.id).toBe(duplicate.id);
        expect(first.id).not.toContain('parent-core-workflow-1');
    });
});
