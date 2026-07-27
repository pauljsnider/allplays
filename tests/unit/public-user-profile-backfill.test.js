import { describe, expect, it, vi } from 'vitest';
import {
    buildStaffTeamIndexes,
    cleanupIneligiblePublicProfile,
    loadEligibleBackfillAuthRecord,
    processBackfillUsers,
    reconcileBackfillAuthIdentity,
    reconcileBackfillStaffMemberships,
    resolveBackfillExitCode,
    resolveOrphanPublicProfileDocs,
    resolveProjectId,
    resolveUserDocs,
    resolveProjectionTeamIds
} from '../../_migration/backfill-public-user-profiles.js';

function team(id, data) {
    return { id, data: () => data };
}

describe('public user profile backfill', () => {
    it('requires an explicit Firebase project instead of defaulting to production', () => {
        expect(resolveProjectId(['node', 'script'], {})).toBe('');
        expect(resolveProjectId(
            ['node', 'script', '--project', 'project-from-arg'],
            { FIREBASE_PROJECT_ID: 'project-from-env' }
        )).toBe('project-from-arg');
        expect(resolveProjectId(
            ['node', 'script'],
            { FIREBASE_PROJECT_ID: 'project-from-env' }
        )).toBe('project-from-env');
    });

    it('returns a failing process status when any user could not be backfilled', () => {
        expect(resolveBackfillExitCode({ failed: 0 })).toBe(0);
        expect(resolveBackfillExitCode({ failed: 1 })).toBe(1);
        expect(resolveBackfillExitCode({ failed: 20 })).toBe(1);
    });

    it('indexes team owners and case-insensitive admin emails', () => {
        const indexes = buildStaffTeamIndexes([
            team('team-1', {
                ownerId: 'owner-1',
                adminEmails: ['Tim@Example.com']
            })
        ]);

        expect([...indexes.ownerTeamIds.get('owner-1')]).toEqual(['team-1']);
        expect([...indexes.adminTeamIds.get('tim@example.com')]).toEqual(['team-1']);
    });

    it('combines parent, coachOf, owner, and mixed-case admin memberships for an existing user', () => {
        const indexes = buildStaffTeamIndexes([
            team('team-coach', { adminEmails: ['Tim@Example.com'] }),
            team('team-owned', { ownerId: 'user-1' })
        ]);

        expect(resolveProjectionTeamIds(
            'user-1',
            {
                parentTeamIds: ['team-parent'],
                coachOf: ['team-coach-of'],
                email: 'old@example.com'
            },
            { email: 'tim@example.com' },
            indexes
        )).toEqual(['team-parent', 'team-coach-of', 'team-owned', 'team-coach']);
    });

    it('reports a failed users collection query with actionable context', async () => {
        const queryError = new Error('permission denied');
        const db = {
            collection: () => ({
                get: () => Promise.reject(queryError)
            })
        };

        await expect(resolveUserDocs(db, {})).rejects.toThrow(
            'Unable to query users collection: permission denied'
        );
    });

    it('continues processing users after an individual profile update fails', async () => {
        const processed = [];
        const logger = { error: vi.fn() };
        const failed = await processBackfillUsers([
            { id: 'user-1' },
            { id: 'user-2' }
        ], async (userDoc) => {
            processed.push(userDoc.id);
            if (userDoc.id === 'user-1') {
                throw new Error('write failed');
            }
        }, logger);

        expect(processed).toEqual(['user-1', 'user-2']);
        expect(failed).toBe(1);
        expect(logger.error).toHaveBeenCalledWith('FAILED user-1:', 'write failed');
    });

    it('reports stale profile cleanup without deleting in dry-run mode', async () => {
        const publicProfileRef = {
            path: 'publicUserProfiles/user-1',
            delete: vi.fn()
        };
        const logger = { warn: vi.fn() };

        await cleanupIneligiblePublicProfile(publicProfileRef, {
            apply: false,
            logger,
            reason: 'email is not verified.'
        });

        expect(publicProfileRef.delete).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
            'WOULD DELETE publicUserProfiles/user-1: email is not verified.'
        );
    });

    it('deletes stale profiles in apply mode and surfaces cleanup failures', async () => {
        const cleanupError = new Error('delete failed');
        const publicProfileRef = {
            path: 'publicUserProfiles/user-1',
            delete: vi.fn().mockRejectedValue(cleanupError)
        };

        await expect(cleanupIneligiblePublicProfile(publicProfileRef, {
            apply: true,
            logger: { warn: vi.fn() },
            reason: 'Firebase Auth user not found.'
        })).rejects.toBe(cleanupError);
        expect(publicProfileRef.delete).toHaveBeenCalledOnce();
    });

    it.each([
        {
            name: 'missing Auth users',
            getUser: vi.fn().mockRejectedValue(
                Object.assign(new Error('missing'), { code: 'auth/user-not-found' })
            ),
            expectedStatus: 'missing-auth',
            expectedReason: 'Firebase Auth user not found.'
        },
        {
            name: 'unverified users',
            getUser: vi.fn().mockResolvedValue({ emailVerified: false }),
            expectedStatus: 'unverified',
            expectedReason: 'email is not verified.'
        }
    ])('removes stale backfill projections for $name', async ({
        getUser,
        expectedStatus,
        expectedReason
    }) => {
        const publicProfileRef = {
            path: 'publicUserProfiles/user-1',
            delete: vi.fn().mockResolvedValue(undefined)
        };
        const logger = { warn: vi.fn() };

        await expect(loadEligibleBackfillAuthRecord(
            { getUser },
            'user-1',
            publicProfileRef,
            { apply: true, logger }
        )).resolves.toEqual({ authRecord: null, status: expectedStatus });

        expect(publicProfileRef.delete).toHaveBeenCalledOnce();
        expect(logger.warn).toHaveBeenCalledWith(
            `DELETE publicUserProfiles/user-1: ${expectedReason}`
        );
    });

    it('does not delete a profile when Firebase Auth has an operational failure', async () => {
        const authError = Object.assign(new Error('Auth service unavailable'), {
            code: 'auth/internal-error'
        });
        const publicProfileRef = {
            path: 'publicUserProfiles/user-1',
            delete: vi.fn()
        };

        await expect(loadEligibleBackfillAuthRecord(
            { getUser: vi.fn().mockRejectedValue(authError) },
            'user-1',
            publicProfileRef,
            { apply: true, logger: { warn: vi.fn() } }
        )).rejects.toBe(authError);
        expect(publicProfileRef.delete).not.toHaveBeenCalled();
    });

    it('finds orphaned public profiles that no longer have private user records', async () => {
        const activeProfile = { id: 'active-user' };
        const orphanedProfile = { id: 'orphaned-user' };
        const db = {
            collection: (collectionName) => {
                expect(collectionName).toBe('publicUserProfiles');
                return {
                    get: vi.fn().mockResolvedValue({
                        docs: [activeProfile, orphanedProfile]
                    })
                };
            }
        };

        await expect(resolveOrphanPublicProfileDocs(
            db,
            {},
            [{ id: 'active-user' }],
            { all: true }
        )).resolves.toEqual([orphanedProfile]);
    });

    it('finds a targeted orphaned public profile by uid', async () => {
        const orphanedProfile = { id: 'orphaned-user', exists: true };
        const db = {
            doc: vi.fn().mockReturnValue({
                get: vi.fn().mockResolvedValue(orphanedProfile)
            })
        };

        await expect(resolveOrphanPublicProfileDocs(
            db,
            {},
            [],
            { targetUid: 'orphaned-user' }
        )).resolves.toEqual([orphanedProfile]);
        expect(db.doc).toHaveBeenCalledWith('publicUserProfiles/orphaned-user');
    });

    it('reconciles normalized staff memberships by uid instead of email casing', async () => {
        const staleDelete = vi.fn().mockResolvedValue(undefined);
        const membershipSet = vi.fn().mockResolvedValue(undefined);
        const logger = { log: vi.fn(), warn: vi.fn() };
        const db = {
            collection: (collectionName) => {
                expect(collectionName).toBe('publicProfileStaffMemberships');
                return {
                    where: (field, operator, userId) => {
                        expect([field, operator, userId]).toEqual([
                            'userId',
                            '==',
                            'coach-user'
                        ]);
                        return {
                            get: vi.fn().mockResolvedValue({
                                docs: [{
                                    id: 'stale-membership',
                                    data: () => ({
                                        userId: 'coach-user',
                                        teamId: 'old-team'
                                    }),
                                    ref: {
                                        path: 'publicProfileStaffMemberships/stale-membership',
                                        delete: staleDelete
                                    }
                                }]
                            })
                        };
                    }
                };
            },
            doc: vi.fn().mockReturnValue({
                path: 'publicProfileStaffMemberships/normalized-membership',
                set: membershipSet
            })
        };

        await expect(reconcileBackfillStaffMemberships(
            db,
            'coach-user',
            ['mixed-case-admin-team'],
            { apply: true, logger, updatedAt: 'timestamp' }
        )).resolves.toBe(2);

        expect(staleDelete).toHaveBeenCalledOnce();
        expect(membershipSet).toHaveBeenCalledWith({
            teamId: 'mixed-case-admin-team',
            userId: 'coach-user',
            updatedAt: 'timestamp'
        });
    });

    it('writes the current Auth email identity and removes it when Auth is missing', async () => {
        const identity = {
            exists: false,
            data: () => ({}),
            get: vi.fn(),
            set: vi.fn(),
            delete: vi.fn(),
            path: 'publicProfileAuthIdentities/coach-user'
        };
        identity.get.mockImplementation(async () => identity);
        const db = {
            doc: vi.fn().mockReturnValue(identity)
        };

        await expect(reconcileBackfillAuthIdentity(
            db,
            'coach-user',
            { email: 'Coach@Example.com' },
            { apply: true, logger: { log: vi.fn(), warn: vi.fn() }, updatedAt: 'timestamp' }
        )).resolves.toBe(1);
        expect(identity.set).toHaveBeenCalledWith({
            email: 'coach@example.com',
            updatedAt: 'timestamp'
        });

        identity.exists = true;
        identity.data = () => ({ email: 'coach@example.com' });
        await expect(reconcileBackfillAuthIdentity(
            db,
            'coach-user',
            null,
            { apply: true, logger: { log: vi.fn(), warn: vi.fn() } }
        )).resolves.toBe(1);
        expect(identity.delete).toHaveBeenCalledOnce();
    });
});
