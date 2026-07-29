import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    assertSmokeFixtureIdentifier,
    buildOfficialFixturePatch,
    inspectOfficialFixture,
    officialFixtureDate,
    officialFixtureSlotId
} from '../../scripts/maintain-production-smoke-official-fixture.mjs';
import {
    createFirebaseRestSession,
    patchFirestoreDocumentFields
} from '../smoke/helpers/firebase-rest.js';

const workflowSource = readFileSync('.github/workflows/production-smoke-fixture.yml', 'utf8');

function buildDocument({
    date = '2025-01-01T18:00:00.000Z',
    enabled = false,
    slots = [],
    status = 'cancelled'
} = {}) {
    return {
        updateTime: '2026-07-29T18:00:00.000Z',
        fields: {
            date: { timestampValue: date },
            officiatingSelfAssignmentEnabled: { booleanValue: enabled },
            officiatingSlots: { arrayValue: { values: slots } },
            status: { stringValue: status }
        }
    };
}

describe('production officials smoke fixture maintenance', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('rejects identifiers outside the dedicated smoke namespace', () => {
        expect(() => assertSmokeFixtureIdentifier('allplays-smoke-team-v1', 'Team ID')).not.toThrow();
        expect(() => assertSmokeFixtureIdentifier('real-team', 'Team ID')).toThrow(
            'Team ID must identify a dedicated AllPlays smoke fixture'
        );
    });

    it('builds a deterministic repair without replacing unrelated game fields', () => {
        const document = buildDocument();
        const patch = buildOfficialFixturePatch(document, new Date('2026-07-29T18:00:00.000Z'));

        expect(patch.fields).toEqual({
            date: { timestampValue: officialFixtureDate },
            officiatingSelfAssignmentEnabled: { booleanValue: true },
            officiatingSlots: {
                arrayValue: {
                    values: [
                        {
                            mapValue: {
                                fields: {
                                    id: { stringValue: officialFixtureSlotId },
                                    position: { stringValue: 'Smoke official' },
                                    scheduleReviewRequired: { booleanValue: false },
                                    status: { stringValue: 'open' }
                                }
                            }
                        }
                    ]
                }
            },
            status: { stringValue: 'scheduled' }
        });
        expect(Object.keys(patch.fields)).not.toContain('opponent');
    });

    it('recognizes an upcoming self-assignable unclaimed official slot as ready', () => {
        const document = buildDocument({
            date: officialFixtureDate,
            enabled: true,
            status: 'scheduled',
            slots: [
                {
                    mapValue: {
                        fields: {
                            id: { stringValue: officialFixtureSlotId },
                            position: { stringValue: 'Smoke official' },
                            status: { stringValue: 'open' }
                        }
                    }
                }
            ]
        });

        expect(inspectOfficialFixture(document, new Date('2026-07-29T18:00:00.000Z'))).toEqual({
            ready: true,
            isUpcoming: true,
            isCancelled: false,
            openSlotCount: 1,
            selfAssignmentEnabled: true
        });
        expect(buildOfficialFixturePatch(document).fields).toEqual({
            officiatingSelfAssignmentEnabled: { booleanValue: true },
            officiatingSlots: document.fields.officiatingSlots
        });
    });

    it('does not count an assigned open-looking slot as claimable', () => {
        const document = buildDocument({
            date: officialFixtureDate,
            enabled: true,
            status: 'scheduled',
            slots: [
                {
                    mapValue: {
                        fields: {
                            id: { stringValue: 'assigned-slot' },
                            officialUserId: { stringValue: 'assigned-user' },
                            status: { stringValue: 'open' }
                        }
                    }
                }
            ]
        });

        expect(inspectOfficialFixture(document).openSlotCount).toBe(0);
        const slots = buildOfficialFixturePatch(document).fields.officiatingSlots.arrayValue.values;
        expect(slots).toHaveLength(2);
        expect(slots[1].mapValue.fields.id.stringValue).toBe(officialFixtureSlotId);
    });

    it('repairs an open-looking slot that application normalization drops without a position', () => {
        const document = buildDocument({
            date: officialFixtureDate,
            enabled: true,
            status: 'scheduled',
            slots: [
                {
                    mapValue: {
                        fields: {
                            id: { stringValue: 'malformed-slot' },
                            position: { stringValue: '   ' },
                            status: { stringValue: 'open' }
                        }
                    }
                }
            ]
        });

        expect(inspectOfficialFixture(document).openSlotCount).toBe(0);
        const slots = buildOfficialFixturePatch(document).fields.officiatingSlots.arrayValue.values;
        expect(slots).toHaveLength(2);
        expect(slots[1].mapValue.fields.position.stringValue).toBe('Smoke official');
    });

    it('patches only the named fields with an optimistic concurrency precondition', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
            ok: true,
            json: vi.fn().mockResolvedValue({ fields: {} })
        });

        await patchFirestoreDocumentFields(
            {
                projectId: 'smoke-project',
                idToken: 'redacted-token'
            },
            'teams/allplays-smoke-team-v1/games/allplays-smoke-game-v1',
            {
                officiatingSlots: { arrayValue: { values: [] } },
                officiatingSelfAssignmentEnabled: { booleanValue: true }
            },
            { updateTime: '2026-07-29T18:00:00.000Z' }
        );

        expect(fetchMock).toHaveBeenCalledOnce();
        const [requestUrl, request] = fetchMock.mock.calls[0];
        const url = new URL(requestUrl);
        expect(url.searchParams.getAll('updateMask.fieldPaths')).toEqual([
            'officiatingSelfAssignmentEnabled',
            'officiatingSlots'
        ]);
        expect(url.searchParams.get('currentDocument.updateTime')).toBe(
            '2026-07-29T18:00:00.000Z'
        );
        expect(request).toMatchObject({
            method: 'PATCH',
            headers: {
                authorization: 'Bearer redacted-token',
                'content-type': 'application/json'
            }
        });
        expect(JSON.parse(request.body)).toEqual({
            fields: {
                officiatingSlots: { arrayValue: { values: [] } },
                officiatingSelfAssignmentEnabled: { booleanValue: true }
            }
        });
    });

    it('loads canonical-host Firebase configuration from the AllPlays runtime fallback', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce({
                ok: false,
                status: 404
            })
            .mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValue({
                    firebase: {
                        apiKey: 'runtime-api-key',
                        projectId: 'runtime-project',
                        storageBucket: 'runtime-bucket'
                    }
                })
            })
            .mockResolvedValueOnce({
                ok: true,
                json: vi.fn().mockResolvedValue({
                    idToken: 'redacted-token',
                    localId: 'smoke-user'
                })
            });

        await expect(createFirebaseRestSession({
            appBaseUrl: 'https://allplays.ai/app/',
            email: 'smoke@example.com',
            password: 'exact password'
        })).resolves.toEqual({
            projectId: 'runtime-project',
            storageBucket: 'runtime-bucket',
            idToken: 'redacted-token',
            localId: 'smoke-user'
        });

        expect(fetchMock.mock.calls[0][0]).toBe('https://allplays.ai/__/firebase/init.json');
        expect(fetchMock.mock.calls[1][0]).toBe(
            'https://allplays.ai/.well-known/allplays-runtime-config.json'
        );
        expect(fetchMock.mock.calls[2][0]).toBe(
            'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=runtime-api-key'
        );
        expect(fetchMock.mock.calls[2][1].headers).toEqual({
            'content-type': 'application/json',
            referer: 'https://allplays.ai/'
        });
        expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({
            email: 'smoke@example.com',
            password: 'exact password',
            returnSecureToken: true
        });
    });

    it('keeps production fixture credentials on an exact default-branch manual workflow', () => {
        expect(workflowSource).toContain('workflow_dispatch:');
        expect(workflowSource).not.toContain('pull_request:');
        expect(workflowSource).toContain("if: github.ref == 'refs/heads/master'");
        expect(workflowSource).toContain('ref: ${{ github.sha }}');
        expect(workflowSource).toContain('persist-credentials: false');
        expect(workflowSource).toContain('permissions:\n  contents: read');
        expect(workflowSource).toContain('environment:\n      name: production-smoke');
        expect(workflowSource).toContain('SMOKE_FIXTURE_MODE: ${{ inputs.mode }}');
        expect(workflowSource).not.toContain('run: ${{ inputs.mode }}');
    });
});
