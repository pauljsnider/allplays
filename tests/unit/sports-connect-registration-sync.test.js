import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const {
    assertSportsConnectSyncConfig,
    buildSportsConnectRegistrationSnapshot,
    buildSportsConnectRegistrationUrl,
    buildSportsConnectSyncErrorUpdate,
    buildSportsConnectTeamUpdate,
    fetchSportsConnectRegistrationPayload,
    getTeamSportsConnectConfig
} = require('../../functions/sports-connect-registration-sync.cjs');

describe('Sports Connect registration sync core', () => {
    it('builds a configured endpoint URL and fetches a registration snapshot with credentials', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => ({
                externalTeamId: 'sc-team-1',
                teamName: 'Bears 12U',
                players: [
                    {
                        id: 'athlete-1',
                        firstName: 'Avery',
                        lastName: 'Lee',
                        jerseyNumber: '4',
                        guardians: [{ name: 'Pat Lee', email: 'PAT@example.com', relation: 'Parent' }],
                        customFields: { Grade: '6' }
                    }
                ]
            })
        });

        const payload = await fetchSportsConnectRegistrationPayload({
            endpointTemplate: 'https://sports.example.test/api/{externalTeamId}/snapshot',
            externalTeamId: 'sc-team-1',
            accessToken: 'secret-token',
            fetchImpl
        });
        const snapshot = buildSportsConnectRegistrationSnapshot(payload, {
            externalTeamId: 'sc-team-1',
            fetchedAt: '2026-06-20T12:00:00.000Z'
        });
        const update = buildSportsConnectTeamUpdate({
            existingSource: { provider: 'Sports Connect', externalTeamId: 'sc-team-1' },
            snapshot,
            nowIso: '2026-06-20T12:00:00.000Z'
        });

        expect(fetchImpl).toHaveBeenCalledWith('https://sports.example.test/api/sc-team-1/snapshot', expect.objectContaining({
            method: 'GET',
            headers: expect.objectContaining({
                Authorization: 'Bearer secret-token',
                Accept: 'application/json'
            })
        }));
        expect(snapshot).toMatchObject({
            provider: 'Sports Connect',
            providerId: 'sports-connect',
            externalTeamId: 'sc-team-1',
            externalTeamName: 'Bears 12U',
            playerCount: 1,
            players: [
                {
                    externalPlayerId: 'athlete-1',
                    name: 'Avery Lee',
                    number: '4',
                    guardians: [{ name: 'Pat Lee', email: 'pat@example.com', phone: '', relation: 'Parent' }],
                    answers: { Grade: '6' }
                }
            ]
        });
        expect(update).toMatchObject({
            registrationSource: {
                provider: 'Sports Connect',
                providerId: 'sports-connect',
                externalTeamId: 'sc-team-1',
                syncEnabled: true,
                lastSyncStatus: 'success',
                playerCount: 1
            },
            registrationRosterSnapshot: {
                players: [{ externalPlayerId: 'athlete-1' }]
            },
            registrationSourceSnapshot: {
                rosterPlayers: [{ externalPlayerId: 'athlete-1' }]
            }
        });
    });

    it('derives team config from saved Sports Connect metadata and requires backend credentials', () => {
        const config = getTeamSportsConnectConfig(
            { registrationSource: { provider: 'Sports Connect', externalTeamId: 'league-team-9' } },
            { baseUrl: 'https://sports.example.test/export', accessToken: '' }
        );

        expect(config).toMatchObject({
            provider: 'Sports Connect',
            providerId: 'sports-connect',
            externalTeamId: 'league-team-9',
            endpointTemplate: 'https://sports.example.test/export',
            accessToken: ''
        });
        expect(() => assertSportsConnectSyncConfig(config)).toThrow('credentials are not configured');
    });

    it('rejects invalid teams, failed network responses, and records concise error state', async () => {
        expect(() => assertSportsConnectSyncConfig({
            provider: 'League Apps',
            externalTeamId: 'team-1',
            endpointTemplate: 'https://sports.example.test/export',
            accessToken: 'token'
        })).toThrow('Sports Connect must be selected');

        await expect(fetchSportsConnectRegistrationPayload({
            endpointTemplate: 'https://sports.example.test/export',
            externalTeamId: 'team-1',
            accessToken: 'token',
            fetchImpl: vi.fn().mockResolvedValue({
                ok: false,
                status: 503,
                text: async () => 'maintenance'
            })
        })).rejects.toThrow('HTTP 503');

        expect(buildSportsConnectRegistrationUrl('https://sports.example.test/export', 'team 1'))
            .toBe('https://sports.example.test/export/teams/team%201/registration-snapshot');
        expect(buildSportsConnectSyncErrorUpdate({ provider: 'Sports Connect' }, 'Provider unavailable', '2026-06-20T12:00:00.000Z'))
            .toMatchObject({
                registrationSource: {
                    provider: 'Sports Connect',
                    syncEnabled: true,
                    lastSyncStatus: 'error',
                    lastSyncError: 'Provider unavailable'
                }
            });
    });

    it('ignores malformed payload and contact entries instead of crashing the sync snapshot builder', () => {
        expect(buildSportsConnectRegistrationSnapshot(null, {
            externalTeamId: 'sc-team-1',
            fetchedAt: '2026-06-20T12:00:00.000Z'
        })).toMatchObject({
            externalTeamId: 'sc-team-1',
            playerCount: 0,
            players: []
        });

        expect(buildSportsConnectRegistrationSnapshot({
            externalTeamId: 'sc-team-2',
            players: [
                null,
                {
                    id: 'athlete-2',
                    firstName: 'Jamie',
                    lastName: 'Fox',
                    guardians: [null, { emailAddress: 'guardian@example.com' }]
                }
            ]
        }, {
            externalTeamId: 'sc-team-2',
            fetchedAt: '2026-06-20T12:00:00.000Z'
        })).toMatchObject({
            externalTeamId: 'sc-team-2',
            playerCount: 1,
            players: [
                {
                    externalPlayerId: 'athlete-2',
                    name: 'Jamie Fox',
                    guardians: [{ name: '', email: 'guardian@example.com', phone: '', relation: '' }]
                }
            ]
        });
    });
});
