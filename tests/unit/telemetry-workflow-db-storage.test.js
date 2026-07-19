import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
    canonicalizeTelemetryAppRoute,
    canonicalizeTelemetryEventName,
    canonicalizeTelemetryPagePath,
    getTelemetryAggregateShard,
    MAX_ATTESTED_EVENTS_PER_REQUEST,
    MAX_TELEMETRY_WRITES_PER_REQUEST,
    ORDINARY_TELEMETRY_WRITES_PER_REQUEST
} = require('../../functions/telemetry-ingress-core.cjs');

function loadTelemetryCollectorHelpers() {
    const source = readFileSync('functions/index.js', 'utf8');
    const start = source.indexOf('function normalizeTelemetryString');
    const end = source.indexOf('const calendarServiceAccount');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return new Function(
        'admin',
        'crypto',
        'canonicalizeTelemetryAppRoute',
        'canonicalizeTelemetryEventName',
        'canonicalizeTelemetryPagePath',
        'getTelemetryAggregateShard',
        'MAX_ATTESTED_EVENTS_PER_REQUEST',
        `${source.slice(start, end)}
        return { normalizeTelemetryEvent, commitTelemetryEvents };
    `);
}

function loadHelpers(harness) {
    return loadTelemetryCollectorHelpers()(
        harness.admin,
        crypto,
        canonicalizeTelemetryAppRoute,
        canonicalizeTelemetryEventName,
        canonicalizeTelemetryPagePath,
        getTelemetryAggregateShard,
        MAX_ATTESTED_EVENTS_PER_REQUEST
    );
}

function createFirestoreHarness(existingDocumentPaths = new Set()) {
    const created = [];
    const sets = [];
    let transactionCount = 0;
    const db = {
        collection(collectionName) {
            return { doc(id) { return { collectionName, id }; } };
        },
        async runTransaction(handler) {
            transactionCount += 1;
            return handler({
                get: async (ref) => ({
                    exists: existingDocumentPaths.has(`${ref.collectionName}/${ref.id}`),
                    data: () => undefined
                }),
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
    return {
        admin: { firestore },
        db,
        created,
        sets,
        get transactionCount() { return transactionCount; }
    };
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
            label: 'Paul Snider',
            durationMs: 1234,
            outcome: 'success',
            source: 'parent_core',
            targetRoute: '/players/team-1/player-1',
            sourceRoute: '/private/paul',
            teamId: 'team-1',
            playerId: 'player-1',
            team_id: 1234,
            player_ids: [12, 34],
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
        const { normalizeTelemetryEvent, commitTelemetryEvents } = loadHelpers(harness);
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
                label: '[redacted-text]',
                durationMs: 1234,
                targetRoute: '/players/:id/:id',
                sourceRoute: '/:redacted/:redacted',
                teamId: '[id]',
                playerId: '[id]',
                team_id: '[id]',
                player_ids: '[id]',
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
        const shard = getTelemetryAggregateShard([event]);
        expect(harness.sets).toEqual(expect.arrayContaining([
            expect.objectContaining({
                ref: { collectionName: 'telemetryEventsDaily', id: `2030-06-01_app_workflow_timing_${shard}` },
                data: expect.objectContaining({
                    shard,
                    name: 'app_workflow_timing',
                    expiresAt: { timestamp: '2030-11-28T12:00:00.000Z' }
                }),
                options: { merge: true }
            }),
            expect.objectContaining({
                ref: { collectionName: 'telemetryRoutesDaily', id: `2030-06-01_players_:id_:id_${shard}` },
                data: expect.objectContaining({ shard, appRoute: '/players/:id/:id' }),
                options: { merge: true }
            })
        ]));
    });

    it('writes weighted aggregates and short-lived anonymous sessions', async () => {
        const harness = createFirestoreHarness();
        const { normalizeTelemetryEvent, commitTelemetryEvents } = loadHelpers(harness);
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
        const { normalizeTelemetryEvent } = loadHelpers(harness);
        const event = normalizeTelemetryEvent(rawEvent({
            name: 'app_load_error', sampleRate: 0.01, sampleWeight: 100, signedIn: true
        }), new Date('2030-06-01T12:00:00.000Z'));

        expect(event).toMatchObject({ sampleRate: 1, sampleWeight: 1, signedIn: false });
    });

    it('keeps explicit workflow telemetry unsampled regardless of client input', () => {
        const harness = createFirestoreHarness();
        const { normalizeTelemetryEvent } = loadHelpers(harness);
        const event = normalizeTelemetryEvent(rawEvent({
            name: 'app_workflow_timing', sampleRate: 0.01, sampleWeight: 100
        }), new Date('2030-06-01T12:00:00.000Z'));

        expect(event).toMatchObject({ sampleRate: 1, sampleWeight: 1 });
    });

    it('derives a deterministic daily deduplication hash without storing the client id', () => {
        const harness = createFirestoreHarness();
        const { normalizeTelemetryEvent } = loadHelpers(harness);
        const receivedAt = new Date('2030-06-01T12:00:00.000Z');
        const first = normalizeTelemetryEvent(rawEvent(), receivedAt);
        const duplicate = normalizeTelemetryEvent(rawEvent(), receivedAt);
        expect(first.id).toBe(duplicate.id);
        expect(first.id).not.toContain('parent-core-workflow-1');
    });

    it('serializes an ordinary 15-event batch into one bounded grouped transaction', async () => {
        const harness = createFirestoreHarness();
        const { normalizeTelemetryEvent, commitTelemetryEvents } = loadHelpers(harness);
        const receivedAt = new Date('2030-06-01T12:00:00.000Z');
        const events = Array.from({ length: 15 }, (_, index) => normalizeTelemetryEvent(rawEvent({
            id: `ordinary-event-${index}`,
            name: 'page_view',
            clientTimestamp: new Date(receivedAt.getTime() + index).toISOString()
        }), receivedAt));

        await expect(commitTelemetryEvents(harness.db, events, '2030-06-01'))
            .resolves.toEqual({ stored: 15, duplicates: 0 });
        expect(harness.transactionCount).toBe(1);
        expect(harness.created).toHaveLength(15);
        expect(harness.sets).toHaveLength(5);
        expect(harness.created.length + harness.sets.length).toBe(ORDINARY_TELEMETRY_WRITES_PER_REQUEST);

        const session = harness.sets.find((write) => write.ref.collectionName === 'telemetrySessions');
        expect(session.data.eventCount).toEqual({ increment: 15 });
        expect(session.data.pageViews).toEqual({ increment: 15 });
    });

    it('keeps a maximum-dimension batch within the declared Firestore write budget', async () => {
        const harness = createFirestoreHarness();
        const { normalizeTelemetryEvent, commitTelemetryEvents } = loadHelpers(harness);
        const receivedAt = new Date('2030-06-01T12:00:00.000Z');
        const eventNames = [
            'app_initial_load', 'app_load_error', 'app_ux_timing', 'app_web_vital',
            'app_workflow_timing', 'interaction_change', 'interaction_click',
            'interaction_rage_click', 'interaction_submit', 'js_error',
            'js_unhandled_rejection', 'page_leave', 'page_performance', 'page_view',
            'scroll_depth'
        ];
        const pagePaths = [
            '/', '/app', '/admin.html', '/calendar.html', '/dashboard.html',
            '/drills.html', '/family.html', '/game.html', '/help.html', '/index.html',
            '/login.html', '/officials.html', '/profile.html', '/schedule.html', '/teams.html'
        ];
        const appRoutes = [
            '/', '/ai', '/auth', '/discover', '/discover/manage', '/discover/new',
            '/help', '/home', '/messages', '/officials', '/parent-tools', '/profile',
            '/registration', '/schedule', '/teams'
        ];
        const events = Array.from({ length: MAX_ATTESTED_EVENTS_PER_REQUEST }, (_, index) => (
            normalizeTelemetryEvent(rawEvent({
                id: `maximum-event-${index}`,
                name: eventNames[index],
                sessionId: `maximum-session-${index}`,
                pagePath: pagePaths[index],
                appRoute: appRoutes[index],
                clientTimestamp: new Date(receivedAt.getTime() + index).toISOString()
            }), receivedAt)
        ));

        await commitTelemetryEvents(harness.db, events, '2030-06-01');

        expect(harness.transactionCount).toBe(1);
        expect(harness.created.length + harness.sets.length).toBe(MAX_TELEMETRY_WRITES_PER_REQUEST);
        expect(harness.created.length + harness.sets.length).toBeLessThan(450);
    });

    it('does not increment aggregates or sessions for a persisted duplicate', async () => {
        const existingDocumentPaths = new Set();
        const harness = createFirestoreHarness(existingDocumentPaths);
        const { normalizeTelemetryEvent, commitTelemetryEvents } = loadHelpers(harness);
        const event = normalizeTelemetryEvent(rawEvent(), new Date('2030-06-01T12:00:00.000Z'));
        existingDocumentPaths.add(`telemetryEvents/${event.id}`);

        await expect(commitTelemetryEvents(harness.db, [event], '2030-06-01'))
            .resolves.toEqual({ stored: 0, duplicates: 1 });
        expect(harness.created).toHaveLength(0);
        expect(harness.sets).toHaveLength(0);
    });

    it('maps attacker-selected event and route dimensions into fixed aggregate buckets', () => {
        const harness = createFirestoreHarness();
        const { normalizeTelemetryEvent } = loadHelpers(harness);
        const event = normalizeTelemetryEvent(rawEvent({
            name: 'attacker_created_metric_123',
            pagePath: '/attacker-created-page',
            appRoute: '/attacker-created-route'
        }), new Date('2030-06-01T12:00:00.000Z'));

        expect(event).toMatchObject({
            name: 'other_event',
            pagePath: '/other',
            appRoute: '/other'
        });
    });
});
