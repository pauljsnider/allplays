import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function loadTelemetryCollectorHelpers() {
    const source = readFileSync('functions/index.js', 'utf8');
    const start = source.indexOf('function normalizeTelemetryString');
    const end = source.indexOf('const calendarServiceAccount');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const helperSource = `${source.slice(start, end)}
        return { normalizeTelemetryEvent, commitTelemetryEvents };
    `;
    return new Function('admin', helperSource);
}

function createFirestoreHarness() {
    const created = [];
    const sets = [];

    const db = {
        collection(collectionName) {
            return {
                doc(id) {
                    return { collectionName, id };
                }
            };
        },
        async runTransaction(handler) {
            return handler({
                get: async () => ({ exists: false }),
                create: (ref, data) => {
                    created.push({ ref, data });
                },
                set: (ref, data, options) => {
                    sets.push({ ref, data, options });
                }
            });
        }
    };

    function firestore() {
        return db;
    }
    firestore.FieldValue = {
        serverTimestamp: () => ({ serverTimestamp: true }),
        increment: (value) => ({ increment: value })
    };

    return {
        admin: { firestore },
        db,
        created,
        sets
    };
}

describe('telemetry workflow DB storage', () => {
    it('stores parent workflow timer events in telemetryEvents with aggregate Firestore writes', async () => {
        const harness = createFirestoreHarness();
        const { normalizeTelemetryEvent, commitTelemetryEvents } = loadTelemetryCollectorHelpers()(harness.admin);
        const receivedAt = new Date('2030-06-01T12:00:00.000Z');

        const event = normalizeTelemetryEvent({
            id: 'parent-core-workflow-1',
            name: 'app_workflow_timing',
            version: '1.0.0',
            sessionId: 'session-parent-1',
            visitorId: 'visitor-parent-1',
            signedIn: true,
            clientTimestamp: '2030-06-01T11:59:59.000Z',
            pagePath: '/',
            appRouteQueryKeys: ['teamId', 'playerId'],
            pageTitle: 'ALL PLAYS',
            properties: {
                workflowName: 'parent core workflow drill in',
                durationMs: 1234,
                outcome: 'success',
                source: 'parent_core',
                sourcePage: 'home',
                targetPage: 'player',
                targetRoute: '/players/team-1/player-1',
                completedPage: 'player',
                completedRoute: '/players/team-1/player-1',
                trigger: 'player_card',
                actionKind: 'player',
                teamId: 'team-1',
                playerId: 'player-1'
            }
        }, receivedAt, 'user-1');

        const result = await commitTelemetryEvents(harness.db, [event], '2030-06-01');

        expect(result).toEqual({ stored: 1, duplicates: 0 });
        expect(harness.created).toHaveLength(1);
        expect(harness.created[0].ref).toEqual({ collectionName: 'telemetryEvents', id: 'parent-core-workflow-1' });
        expect(harness.created[0].data).toMatchObject({
            name: 'app_workflow_timing',
            sessionId: 'session-parent-1',
            visitorId: 'visitor-parent-1',
            userId: 'user-1',
            signedIn: true,
            pagePath: '/',
            appRoute: '/players/team-1/player-1',
            appRouteQueryKeys: ['teamId', 'playerId'],
            properties: expect.objectContaining({
                workflowName: 'parent core workflow drill in',
                durationMs: 1234,
                outcome: 'success',
                source: 'parent_core',
                sourcePage: 'home',
                targetPage: 'player',
                targetRoute: '/players/team-1/player-1',
                completedPage: 'player',
                completedRoute: '/players/team-1/player-1'
            })
        });
        expect(harness.sets.map((write) => write.ref.collectionName)).toEqual(expect.arrayContaining([
            'telemetryDaily',
            'telemetryPagesDaily',
            'telemetryRoutesDaily',
            'telemetryEventsDaily',
            'telemetrySessions'
        ]));
        expect(harness.sets).toEqual(expect.arrayContaining([
            expect.objectContaining({
                ref: { collectionName: 'telemetryEventsDaily', id: '2030-06-01_app_workflow_timing' },
                data: expect.objectContaining({ name: 'app_workflow_timing' }),
                options: { merge: true }
            }),
            expect.objectContaining({
                ref: { collectionName: 'telemetryRoutesDaily', id: '2030-06-01_players_team-1_player-1' },
                data: expect.objectContaining({ appRoute: '/players/team-1/player-1' }),
                options: { merge: true }
            }),
            expect.objectContaining({
                ref: { collectionName: 'telemetrySessions', id: 'session-parent-1' },
                data: expect.objectContaining({
                    sessionId: 'session-parent-1',
                    lastRoute: '/players/team-1/player-1',
                    lastEventName: 'app_workflow_timing'
                }),
                options: { merge: true }
            })
        ]));
    });

    it('stores frontend view-load timer events for dashboard reads', async () => {
        const harness = createFirestoreHarness();
        const { normalizeTelemetryEvent, commitTelemetryEvents } = loadTelemetryCollectorHelpers()(harness.admin);
        const receivedAt = new Date('2030-06-01T12:00:00.000Z');

        const event = normalizeTelemetryEvent({
            id: 'home-today-load-1',
            name: 'app_ux_timing',
            version: '1.0.0',
            sessionId: 'session-view-load-1',
            visitorId: 'visitor-view-load-1',
            signedIn: true,
            clientTimestamp: '2030-06-01T11:59:59.000Z',
            pagePath: '/',
            appRoute: '/home',
            appRouteQueryKeys: [],
            pageTitle: 'ALL PLAYS',
            properties: {
                label: 'home today load',
                category: 'view_load',
                viewName: 'home today',
                route: '/home',
                durationMs: 248,
                outcome: 'success',
                playerCount: 1,
                teamCount: 1
            }
        }, receivedAt, 'user-1');

        const result = await commitTelemetryEvents(harness.db, [event], '2030-06-01');

        expect(result).toEqual({ stored: 1, duplicates: 0 });
        expect(harness.created).toHaveLength(1);
        expect(harness.created[0].ref).toEqual({ collectionName: 'telemetryEvents', id: 'home-today-load-1' });
        expect(harness.created[0].data).toMatchObject({
            name: 'app_ux_timing',
            sessionId: 'session-view-load-1',
            visitorId: 'visitor-view-load-1',
            userId: 'user-1',
            signedIn: true,
            pagePath: '/',
            appRoute: '/home',
            properties: expect.objectContaining({
                label: 'home today load',
                category: 'view_load',
                viewName: 'home today',
                route: '/home',
                durationMs: 248,
                outcome: 'success'
            })
        });
        expect(harness.sets).toEqual(expect.arrayContaining([
            expect.objectContaining({
                ref: { collectionName: 'telemetryEventsDaily', id: '2030-06-01_app_ux_timing' },
                data: expect.objectContaining({ name: 'app_ux_timing' }),
                options: { merge: true }
            }),
            expect.objectContaining({
                ref: { collectionName: 'telemetryRoutesDaily', id: '2030-06-01_home' },
                data: expect.objectContaining({ appRoute: '/home' }),
                options: { merge: true }
            }),
            expect.objectContaining({
                ref: { collectionName: 'telemetrySessions', id: 'session-view-load-1' },
                data: expect.objectContaining({
                    sessionId: 'session-view-load-1',
                    lastRoute: '/home',
                    lastEventName: 'app_ux_timing'
                }),
                options: { merge: true }
            })
        ]));
    });
});
