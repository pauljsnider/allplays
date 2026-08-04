import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import {
    backfillLegacyTeamOwnerIds,
    planLegacyTeamOwnerBackfill
} from '../../_migration/backfill-legacy-team-owner-ids.js';

function teamDoc(id, data) {
    return { id, data: () => data };
}

function createAtomicBackfillDb({ teams, users, failOwnerBindingCommit = false }) {
    const teamState = new Map(Object.entries(teams).map(([id, data]) => [id, structuredClone(data)]));
    const userState = new Map(Object.entries(users).map(([id, data]) => [id, structuredClone(data)]));
    const refFor = (path) => ({ path });
    const applyPatch = (target, patch) => {
        for (const [key, value] of Object.entries(patch)) {
            if (value?.constructor?.name === 'ArrayUnionTransform') {
                target[key] = [...new Set([...(Array.isArray(target[key]) ? target[key] : []), ...value.elements])];
            } else if (value?.constructor?.name === 'ServerTimestampTransform') {
                target[key] = 'server-timestamp';
            } else {
                target[key] = value;
            }
        }
    };
    const teamSnapshot = (id, state = teamState) => ({
        id,
        ref: refFor(`teams/${id}`),
        updateTime: { seconds: 1 },
        exists: state.has(id),
        data: () => structuredClone(state.get(id))
    });
    const userSnapshot = (id, state = userState) => ({
        id,
        ref: refFor(`users/${id}`),
        exists: state.has(id),
        data: () => structuredClone(state.get(id))
    });

    const db = {
        doc: vi.fn(refFor),
        collection: vi.fn(() => ({
            select: vi.fn(() => ({
                get: vi.fn(async () => ({ docs: [...teamState.keys()].map((id) => teamSnapshot(id)) }))
            }))
        })),
        batch: vi.fn(() => {
            const operations = [];
            return {
                update: vi.fn((ref, patch) => operations.push({ kind: 'update', ref, patch })),
                set: vi.fn((ref, patch, options) => operations.push({ kind: 'set', ref, patch, options })),
                commit: vi.fn(async () => {
                    const isOwnerBinding = operations.some(({ patch }) => Object.hasOwn(patch, 'ownerId'));
                    if (failOwnerBindingCommit && isOwnerBinding) {
                        throw new Error('simulated atomic owner binding failure');
                    }

                    const nextTeams = new Map([...teamState].map(([id, data]) => [id, structuredClone(data)]));
                    const nextUsers = new Map([...userState].map(([id, data]) => [id, structuredClone(data)]));
                    for (const operation of operations) {
                        const [collection, id] = operation.ref.path.split('/');
                        const state = collection === 'teams' ? nextTeams : nextUsers;
                        const target = operation.kind === 'set' && operation.options?.merge !== true
                            ? {}
                            : structuredClone(state.get(id) || {});
                        applyPatch(target, operation.patch);
                        state.set(id, target);
                    }
                    teamState.clear();
                    nextTeams.forEach((data, id) => teamState.set(id, data));
                    userState.clear();
                    nextUsers.forEach((data, id) => userState.set(id, data));
                })
            };
        }),
        getAll: vi.fn(async (...refs) => refs.map((ref) => {
            const [collection, id] = ref.path.split('/');
            return collection === 'teams' ? teamSnapshot(id) : userSnapshot(id);
        }))
    };

    return {
        db,
        getTeam: (id) => structuredClone(teamState.get(id)),
        getUser: (id) => structuredClone(userState.get(id))
    };
}

describe('legacy team ownerId migration planning', () => {
    it('binds an ownerId only when Firebase Auth resolves the legacy alias', async () => {
        const auth = {
            getUserByEmail: vi.fn(async (email) => {
                if (email === 'owner@example.com') return { uid: 'owner-1', email };
                throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
            })
        };
        const canonical = teamDoc('canonical', { ownerId: 'owner-2', ownerEmail: 'stale@example.com' });
        const legacy = teamDoc('legacy', { ownerEmail: 'Owner@Example.com' });
        const abandoned = teamDoc('abandoned', { ownerEmailLower: 'gone@example.com' });

        const result = await planLegacyTeamOwnerBackfill([canonical, legacy, abandoned], auth);

        expect(result.plans).toEqual([{ teamDoc: legacy, ownerId: 'owner-1' }]);
        expect(result.aliasNormalizationPlans).toEqual([{
            teamDoc: legacy,
            ownerEmailLower: 'owner@example.com'
        }]);
        expect(result.unresolvedTeamIds).toEqual(['abandoned']);
        expect(auth.getUserByEmail).not.toHaveBeenCalledWith('stale@example.com');
    });

    it('normalizes unresolved mixed-case aliases before relying on the Auth create trigger', async () => {
        const legacy = teamDoc('legacy', { ownerEmail: 'Owner@Example.com' });
        const auth = {
            getUserByEmail: vi.fn(async () => {
                throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
            })
        };

        const result = await planLegacyTeamOwnerBackfill([legacy], auth);

        expect(result.plans).toEqual([]);
        expect(result.aliasNormalizationPlans).toEqual([{
            teamDoc: legacy,
            ownerEmailLower: 'owner@example.com'
        }]);
        expect(result.unresolvedTeamIds).toEqual(['legacy']);
    });

    it('leaves aliases owned by disabled Auth accounts unresolved', async () => {
        const legacy = teamDoc('disabled-owner', { ownerEmailLower: 'disabled@example.com' });
        const auth = {
            getUserByEmail: vi.fn(async (email) => ({
                uid: 'disabled-owner-1',
                email,
                disabled: true
            }))
        };

        const result = await planLegacyTeamOwnerBackfill([legacy], auth);

        expect(result.plans).toEqual([]);
        expect(result.unresolvedTeamIds).toEqual(['disabled-owner']);
    });

    it('rechecks Auth after alias normalization so signups during migration cannot be missed', async () => {
        const teamRef = { path: 'teams/legacy' };
        const userRef = { path: 'users/owner-1' };
        const teamData = { ownerEmail: 'Owner@Example.com' };
        const userData = {};
        const makeSnapshot = () => ({
            id: 'legacy',
            ref: teamRef,
            updateTime: { seconds: 1 },
            exists: true,
            data: () => ({ ...teamData })
        });
        const db = {
            doc: vi.fn((path) => path === userRef.path ? userRef : { path }),
            collection: vi.fn(() => ({
                select: vi.fn(() => ({ get: vi.fn(async () => ({ docs: [makeSnapshot()] })) }))
            })),
            batch: vi.fn(() => ({
                update: vi.fn((_ref, patch) => Object.assign(teamData, patch)),
                set: vi.fn((ref) => {
                    if (ref.path === userRef.path) {
                        userData.coachOf = ['legacy'];
                        userData.roles = ['coach'];
                    }
                }),
                commit: vi.fn(async () => {})
            })),
            getAll: vi.fn(async (...refs) => refs.map((ref) => (
                ref.path === userRef.path
                    ? { exists: true, data: () => ({ ...userData }) }
                    : makeSnapshot()
            )))
        };
        const auth = {
            getUserByEmail: vi.fn(async () => {
                if (!teamData.ownerEmailLower) {
                    throw Object.assign(new Error('missing'), { code: 'auth/user-not-found' });
                }
                return { uid: 'owner-1', email: teamData.ownerEmailLower };
            })
        };

        await expect(backfillLegacyTeamOwnerIds({
            db,
            auth,
            apply: true,
            log: { log: vi.fn() }
        })).resolves.toEqual({
            migrated: 1,
            normalizedAliases: 1,
            unresolvedTeamIds: []
        });
        expect(teamData.ownerEmailLower).toBe('owner@example.com');
        expect(teamData.ownerId).toBe('owner-1');
        expect(userData).toEqual({ coachOf: ['legacy'], roles: ['coach'] });
        expect(db.collection).toHaveBeenCalledTimes(2);
    });

    it('atomically preserves an existing owner while granting reciprocal access to every migrated team', async () => {
        const { db, getTeam, getUser } = createAtomicBackfillDb({
            teams: {
                first: { ownerEmailLower: 'owner@example.com', name: 'First' },
                second: { ownerEmailLower: 'owner@example.com', name: 'Second' }
            },
            users: {
                'owner-1': {
                    coachOf: ['existing-team'],
                    roles: ['parent'],
                    displayName: 'Existing Owner'
                }
            }
        });
        const auth = {
            getUserByEmail: vi.fn(async () => ({ uid: 'owner-1', email: 'owner@example.com' }))
        };

        await expect(backfillLegacyTeamOwnerIds({
            db,
            auth,
            apply: true,
            log: { log: vi.fn() }
        })).resolves.toEqual({
            migrated: 2,
            normalizedAliases: 0,
            unresolvedTeamIds: []
        });

        expect(getTeam('first')).toMatchObject({ ownerId: 'owner-1', name: 'First' });
        expect(getTeam('second')).toMatchObject({ ownerId: 'owner-1', name: 'Second' });
        expect(getUser('owner-1')).toEqual({
            coachOf: ['existing-team', 'first', 'second'],
            roles: ['parent', 'coach'],
            displayName: 'Existing Owner',
            updatedAt: 'server-timestamp'
        });
    });

    it('leaves both teams and the existing owner unchanged when the atomic binding commit fails', async () => {
        const { db, getTeam, getUser } = createAtomicBackfillDb({
            teams: {
                legacy: { ownerEmailLower: 'owner@example.com', name: 'Legacy' }
            },
            users: {
                'owner-1': { coachOf: ['existing-team'], roles: ['parent'], displayName: 'Existing Owner' }
            },
            failOwnerBindingCommit: true
        });
        const auth = {
            getUserByEmail: vi.fn(async () => ({ uid: 'owner-1', email: 'owner@example.com' }))
        };

        await expect(backfillLegacyTeamOwnerIds({
            db,
            auth,
            apply: true,
            log: { log: vi.fn() }
        })).rejects.toThrow('simulated atomic owner binding failure');

        expect(getTeam('legacy')).toEqual({ ownerEmailLower: 'owner@example.com', name: 'Legacy' });
        expect(getUser('owner-1')).toEqual({
            coachOf: ['existing-team'],
            roles: ['parent'],
            displayName: 'Existing Owner'
        });
    });

    it('fails before Auth lookup when normalized owner aliases conflict', async () => {
        const auth = {
            getUserByEmail: vi.fn(async (email) => (
                email === 'first@example.com'
                    ? { uid: 'owner-1', email }
                    : Promise.reject(Object.assign(new Error('missing'), { code: 'auth/user-not-found' }))
            ))
        };

        await expect(planLegacyTeamOwnerBackfill([
            teamDoc('ambiguous', {
                ownerEmail: 'first@example.com',
                ownerEmailLower: 'second@example.com'
            })
        ], auth)).rejects.toThrow(/conflicting normalized owner aliases/);
        expect(auth.getUserByEmail).not.toHaveBeenCalled();
    });

    it('runs from the trusted deploy handoff before stricter Firestore rules activate', () => {
        const workflow = readFileSync(new URL('../../.github/workflows/deploy-prod.yml', import.meta.url), 'utf8');
        const migrationCommand = workflow.indexOf('backfill-legacy-team-owner-ids.mjs" --apply');
        const storageRulesDeploy = workflow.indexOf('- name: Deploy Firebase Storage rules when available');
        const rulesBranch = workflow.indexOf('if [[ "$FIRESTORE_CONFIG_CHANGED" == "true" ]]');

        expect(workflow).toContain('cp _migration/backfill-legacy-team-owner-ids.js');
        expect(workflow).toContain('test ! -L "$bundle/_migration/backfill-legacy-team-owner-ids.mjs"');
        expect(migrationCommand).toBeGreaterThan(-1);
        expect(workflow).toMatch(
            /id: google_auth_owner_migration[\s\S]*?token_format: access_token[\s\S]*?GOOGLE_OAUTH_ACCESS_TOKEN: \$\{\{ steps\.google_auth_owner_migration\.outputs\.access_token \}\}/
        );
        expect(storageRulesDeploy).toBeGreaterThan(migrationCommand);
        expect(rulesBranch).toBeGreaterThan(migrationCommand);
    });
});
