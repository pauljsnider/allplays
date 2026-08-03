import { describe, expect, it, vi } from 'vitest';
import {
    backfillLegacyTeamOwnerIds,
    planLegacyTeamOwnerBackfill
} from '../../_migration/backfill-legacy-team-owner-ids.js';

function teamDoc(id, data) {
    return { id, data: () => data };
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

});
