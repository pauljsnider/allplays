import { describe, expect, it, vi } from 'vitest';
import {
    buildStaffTeamIndexes,
    processBackfillUsers,
    resolveBackfillExitCode,
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

    it('combines parent, owner, and coach memberships for an existing user', () => {
        const indexes = buildStaffTeamIndexes([
            team('team-coach', { adminEmails: ['tim@example.com'] }),
            team('team-owned', { ownerId: 'user-1' })
        ]);

        expect(resolveProjectionTeamIds(
            'user-1',
            { parentTeamIds: ['team-parent'], email: 'old@example.com' },
            { email: 'Tim@Example.com' },
            indexes
        )).toEqual(['team-parent', 'team-owned', 'team-coach']);
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
});
