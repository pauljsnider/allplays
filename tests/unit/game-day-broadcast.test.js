import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    BROADCAST_STREAM_HEARTBEAT_MS,
    BROADCAST_STREAM_LEASE_MS,
    buildBroadcastRuntimeSession,
    buildGameDayBroadcastSetupUrl,
    canOpenGameDayBroadcastSetup,
    resolveGameDayBroadcastStatus
} from '../../js/game-day-broadcast.js';

describe('Game Day broadcast entry', () => {
    it('deep-links eligible games into the shared Broadcast Setup panel', () => {
        expect(buildGameDayBroadcastSetupUrl({
            teamId: 'team/one',
            gameId: 'game two',
            game: { status: 'scheduled' }
        })).toBe('live-game.html#teamId=team%2Fone&gameId=game+two&broadcast=setup');

        expect(canOpenGameDayBroadcastSetup({ liveStatus: 'live', status: 'scheduled' })).toBe(true);
        expect(buildGameDayBroadcastSetupUrl({
            teamId: 'team-1',
            gameId: 'game-1',
            game: { status: 'completed' }
        })).toBe('');
        expect(canOpenGameDayBroadcastSetup({ status: 'scheduled', liveStatus: 'final' })).toBe(false);
    });

    it('distinguishes setup-required, setup-ready, leased-live, stale, retry, and ended states', () => {
        const now = new Date('2026-07-11T20:00:00.000Z');
        expect(resolveGameDayBroadcastStatus({ status: 'scheduled' })).toEqual({
            state: 'setup_required',
            label: 'Broadcast setup is required before streaming can begin.'
        });
        expect(resolveGameDayBroadcastStatus({
            status: 'scheduled',
            broadcastSession: { managedStreamReady: true }
        })).toMatchObject({ state: 'ready' });
        expect(resolveGameDayBroadcastStatus({
            status: 'scheduled',
            broadcastSession: {
                managedStreamReady: true,
                localStreamStatus: 'live',
                localStreamLeaseExpiresAt: new Date('2026-07-11T20:00:30.000Z')
            }
        }, { now })).toEqual({ state: 'live', label: 'Live device streaming is active.' });
        expect(resolveGameDayBroadcastStatus({
            status: 'scheduled',
            broadcastSession: {
                managedStreamReady: true,
                localStreamStatus: 'live',
                localStreamLeaseExpiresAt: new Date('2026-07-11T19:59:59.000Z')
            }
        }, { now })).toEqual({
            state: 'stale',
            label: 'The last live device signal expired. Open setup to resume streaming.'
        });
        expect(resolveGameDayBroadcastStatus({
            status: 'scheduled',
            broadcastSession: { managedStreamReady: true, localStreamStatus: 'failed' }
        })).toEqual({ state: 'failed', label: 'Device streaming needs attention. Open setup to retry.' });
        expect(resolveGameDayBroadcastStatus({
            status: 'scheduled',
            broadcastSession: { status: 'permission_failed' }
        })).toEqual({ state: 'failed', label: 'Device streaming needs attention. Open setup to retry.' });
        expect(resolveGameDayBroadcastStatus({ status: 'completed' })).toMatchObject({ state: 'unavailable' });
    });

    it('records local runtime state without replacing setup or provider metadata', () => {
        expect(buildBroadcastRuntimeSession({
            existingSession: {
                id: 'broadcast-1',
                name: 'Game broadcast setup',
                status: 'ready_for_managed_stream',
                provider: { type: 'external_provider', name: 'Provider' },
                permissions: { camera: true, microphone: true },
                createdAt: '2026-07-11T19:00:00.000Z'
            },
            status: 'live',
            user: { uid: 'streamer-1', email: 'Streamer@Example.com' },
            now: new Date('2026-07-11T20:00:00.000Z')
        })).toEqual({
            id: 'broadcast-1',
            name: 'Game broadcast setup',
            status: 'ready_for_managed_stream',
            provider: { type: 'external_provider', name: 'Provider' },
            permissions: { camera: true, microphone: true },
            createdAt: '2026-07-11T19:00:00.000Z',
            localStreamStatus: 'live',
            localStreamActive: true,
            localStreamUpdatedAt: new Date('2026-07-11T20:00:00.000Z'),
            localStreamLeaseExpiresAt: new Date('2026-07-11T20:00:45.000Z'),
            updatedAt: new Date('2026-07-11T20:00:00.000Z'),
            updatedBy: 'streamer-1'
        });
        expect(BROADCAST_STREAM_LEASE_MS).toBeLessThanOrEqual(60_000);
        expect(BROADCAST_STREAM_HEARTBEAT_MS).toBeLessThan(BROADCAST_STREAM_LEASE_MS);
        expect(buildBroadcastRuntimeSession({
            existingSession: {
                id: 'broadcast-1',
                name: 'Game broadcast setup',
                status: 'ready_for_managed_stream',
                provider: { type: 'managed_setup', name: 'ALL PLAYS managed setup' },
                permissions: { camera: true, microphone: true },
                createdAt: '2026-07-11T19:00:00.000Z',
                localStreamLeaseExpiresAt: new Date()
            },
            status: 'ready',
            user: { uid: 'streamer-1' },
            now: new Date('2026-07-11T20:01:00.000Z')
        })).not.toHaveProperty('localStreamLeaseExpiresAt');
        expect(buildBroadcastRuntimeSession({ existingSession: {}, status: 'external-live' })).toBeNull();
    });
});

describe('Game Day broadcast wiring', () => {
    it('uses the shared deep link for coaches, videographers, and Stream & Score helpers', () => {
        const gameDaySource = readFileSync(resolve(process.cwd(), 'game-day.html'), 'utf8');

        expect(gameDaySource).toContain("from './js/game-day-broadcast.js?v=3'");
        expect(gameDaySource.match(/data-game-day-broadcast-card/g)?.length).toBeGreaterThanOrEqual(2);
        expect(gameDaySource).toContain('renderLimitedVideographerAccess(accessInfo)');
        expect(gameDaySource).toContain('renderLimitedStreamAndScoreAccess(accessInfo)');
        expect(gameDaySource).toContain('buildGameDayBroadcastSetupUrl({ teamId: state.teamId, gameId: state.gameId, game: state.game })');
        expect(gameDaySource).not.toContain('const liveGameUrl = `live-game.html#teamId=');
    });

    it('opens the existing live-game video controls for Broadcast Setup deep links', () => {
        const liveGameSource = readFileSync(resolve(process.cwd(), 'js/live-game.js'), 'utf8');

        expect(liveGameSource).toContain("state.broadcastSetupRequested = params.broadcast === 'setup';");
        expect(liveGameSource).toContain("state.activeTab = 'video';");
        expect(liveGameSource).toContain("els.nativeCameraPanel?.scrollIntoView({ block: 'start' })");
        expect(liveGameSource).toContain('els.nativeCameraBeginStreamBtn.addEventListener(\'click\', beginNativeBroadcastStream)');
        expect(liveGameSource).toContain('await saveBroadcastRuntimeStatus(BROADCAST_STREAM_STATUSES.LIVE)');
        expect(liveGameSource).toContain('startBroadcastHeartbeat();');
        expect(liveGameSource).toContain('Failed to renew device stream lease:');
        expect(liveGameSource.match(/async function beginNativeBroadcastStream\(\)/g)).toHaveLength(1);
    });
});
