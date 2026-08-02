import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    assertUnprivilegedParentFixture,
    buildActivePlayerPatch,
    buildActiveTeamPatch,
    buildParentMembershipPatch,
    inspectParentFixture
} from '../../scripts/maintain-production-smoke-parent-fixture.mjs';

const workflowSource = readFileSync('.github/workflows/production-smoke-fixture.yml', 'utf8');
const authenticatedCoreSource = readFileSync('tests/smoke/app-authenticated-core.spec.js', 'utf8');

function mapValue(fields) {
    return { mapValue: { fields } };
}

function stringArray(values) {
    return {
        arrayValue: {
            values: values.map((value) => ({ stringValue: value }))
        }
    };
}

function buildParentDocument({
    parentOf = [],
    parentTeamIds = [],
    parentPlayerKeys = []
} = {}) {
    return {
        updateTime: '2026-07-29T18:00:00.000Z',
        fields: {
            parentOf: { arrayValue: { values: parentOf } },
            parentTeamIds: stringArray(parentTeamIds),
            parentPlayerKeys: stringArray(parentPlayerKeys)
        }
    };
}

function buildPlayerDocument({
    active = true,
    archived = false,
    status = 'active'
} = {}) {
    return {
        updateTime: '2026-07-29T18:00:00.000Z',
        fields: {
            active: { booleanValue: active },
            archived: { booleanValue: archived },
            status: { stringValue: status }
        }
    };
}

function buildTeamDocument({
    active = true,
    archived = false,
    status = 'active'
} = {}) {
    return {
        updateTime: '2026-07-29T18:00:00.000Z',
        fields: {
            active: { booleanValue: active },
            archived: { booleanValue: archived },
            status: { stringValue: status }
        }
    };
}

const teamId = 'allplays-smoke-team-v1';
const playerId = 'allplays-smoke-player-v1';

describe('production parent smoke fixture maintenance', () => {
    it('rejects global and team-level privileges for parent-only coverage', () => {
        const teamDocument = buildTeamDocument();
        teamDocument.fields.ownerId = { stringValue: 'owner-1' };
        teamDocument.fields.adminEmails = stringArray(['team-admin@example.com']);

        expect(assertUnprivilegedParentFixture(
            buildParentDocument(),
            teamDocument,
            { uid: 'parent-1', email: 'parent@example.com' }
        )).toBe(true);
        expect(() => assertUnprivilegedParentFixture(
            {
                ...buildParentDocument(),
                fields: { ...buildParentDocument().fields, isAdmin: { booleanValue: true } }
            },
            teamDocument,
            { uid: 'parent-1', email: 'parent@example.com' }
        )).toThrow(/privileged access/);
        expect(() => assertUnprivilegedParentFixture(
            buildParentDocument(),
            teamDocument,
            { uid: 'parent-1', email: 'team-admin@example.com' }
        )).toThrow(/privileged access/);
    });

    it('requires the complete parent membership chain and an active player', () => {
        const parentDocument = buildParentDocument({
            parentOf: [
                mapValue({
                    teamId: { stringValue: teamId },
                    playerId: { stringValue: playerId }
                })
            ],
            parentTeamIds: [teamId],
            parentPlayerKeys: [`${teamId}::${playerId}`]
        });

        expect(
            inspectParentFixture(
                parentDocument,
                buildTeamDocument(),
                buildPlayerDocument(),
                teamId,
                playerId
            )
        ).toEqual({
            ready: true,
            hasParentOf: true,
            hasParentTeamId: true,
            hasParentPlayerKey: true,
            teamActive: true,
            playerExists: true,
            playerActive: true
        });
        expect(
            inspectParentFixture(
                parentDocument,
                buildTeamDocument(),
                null,
                teamId,
                playerId
            )
        ).toMatchObject({
            ready: false,
            playerExists: false,
            playerActive: false
        });
    });

    it('builds a deterministic membership repair while preserving unrelated links', () => {
        const unrelatedLink = mapValue({
            teamId: { stringValue: 'other-team' },
            playerId: { stringValue: 'other-player' }
        });
        const staleSmokeLink = mapValue({
            teamId: { stringValue: teamId },
            playerId: { stringValue: playerId },
            playerName: { stringValue: 'Stale name' }
        });
        const patch = buildParentMembershipPatch(
            buildParentDocument({
                parentOf: [unrelatedLink, staleSmokeLink],
                parentTeamIds: ['other-team'],
                parentPlayerKeys: ['other-team::other-player']
            }),
            {
                teamId,
                playerId,
                teamName: 'Smoke Team',
                playerName: 'Smoke Player'
            }
        );

        expect(patch.fields.parentOf.arrayValue.values).toEqual([
            unrelatedLink,
            mapValue({
                teamId: { stringValue: teamId },
                teamName: { stringValue: 'Smoke Team' },
                playerId: { stringValue: playerId },
                playerName: { stringValue: 'Smoke Player' }
            })
        ]);
        expect(patch.fields.parentTeamIds).toEqual(
            stringArray(['other-team', teamId])
        );
        expect(patch.fields.parentPlayerKeys).toEqual(
            stringArray(['other-team::other-player', `${teamId}::${playerId}`])
        );
    });

    it('repairs only roster lifecycle fields when the player is inactive', () => {
        expect(buildActivePlayerPatch()).toEqual({
            fields: {
                active: { booleanValue: true },
                archived: { booleanValue: false },
                status: { stringValue: 'active' }
            }
        });
        expect(
            inspectParentFixture(
                buildParentDocument({
                    parentOf: [
                        mapValue({
                            teamId: { stringValue: teamId },
                            playerId: { stringValue: playerId }
                        })
                    ],
                    parentTeamIds: [teamId],
                    parentPlayerKeys: [`${teamId}::${playerId}`]
                }),
                buildTeamDocument(),
                buildPlayerDocument({ active: false }),
                teamId,
                playerId
            )
        ).toMatchObject({
            ready: false,
            playerActive: false
        });
        expect(
            inspectParentFixture(
                buildParentDocument({
                    parentOf: [
                        mapValue({
                            teamId: { stringValue: teamId },
                            playerId: { stringValue: playerId }
                        })
                    ],
                    parentTeamIds: [teamId],
                    parentPlayerKeys: [`${teamId}::${playerId}`]
                }),
                buildTeamDocument(),
                buildPlayerDocument({ status: 'Active' }),
                teamId,
                playerId
            )
        ).toMatchObject({
            ready: false,
            playerActive: false
        });
    });

    it('matches the app team lifecycle predicate and repairs only those fields', () => {
        const parentDocument = buildParentDocument({
            parentOf: [
                mapValue({
                    teamId: { stringValue: teamId },
                    playerId: { stringValue: playerId }
                })
            ],
            parentTeamIds: [teamId],
            parentPlayerKeys: [`${teamId}::${playerId}`]
        });
        expect(
            inspectParentFixture(
                parentDocument,
                buildTeamDocument({ status: ' Disabled ' }),
                buildPlayerDocument(),
                teamId,
                playerId
            )
        ).toMatchObject({
            ready: false,
            teamActive: false
        });
        expect(buildActiveTeamPatch()).toEqual({
            fields: {
                active: { booleanValue: true },
                archived: { booleanValue: false },
                status: { stringValue: 'active' }
            }
        });
    });

    it('keeps parent repair credentials in the protected exact-SHA workflow', () => {
        expect(workflowSource).toContain('Audit or repair parent smoke fixture');
        expect(workflowSource).toContain('SMOKE_ADMIN_EMAIL: ${{ secrets.SMOKE_ADMIN_EMAIL }}');
        expect(workflowSource).toContain('SMOKE_PARENT_EMAIL: ${{ secrets.SMOKE_PARENT_EMAIL }}');
        expect(workflowSource).toContain('environment:\n      name: production-smoke');
        expect(workflowSource).toContain('ref: ${{ github.sha }}');
        expect(workflowSource).not.toContain('pull_request:');
    });

    it('uses an unambiguous semantic locator for the household invite heading', () => {
        expect(authenticatedCoreSource).toContain(
            "page.getByRole('heading', { name: 'Create invite' })"
        );
        expect(authenticatedCoreSource).not.toContain(
            "page.getByText('Create invite', { exact: true })"
        );
    });
});
