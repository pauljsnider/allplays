import { describe, expect, it } from 'vitest';
import {
    buildTeamPassMarkup,
    getTeamPassAccess,
    normalizeTeamPassStatus,
    readTeamPassStatus,
    selectTeamPassRecord
} from '../../js/team-pass.js';

const TEAM = {
    id: 'team-1',
    name: 'Blue Jays',
    ownerId: 'owner-1',
    adminEmails: ['admin@example.com']
};

function mockFirebaseForDocs(docs) {
    return {
        db: {},
        collection: (_db, path) => ({ path }),
        getDocs: async () => ({
            docs: docs.map((data) => ({ data: () => data }))
        })
    };
}

describe('team pass UI helpers', () => {
    it('treats coaches and admins as staff for the management panel', () => {
        expect(getTeamPassAccess({ uid: 'coach-1', coachOf: ['team-1'] }, TEAM)).toMatchObject({
            isStaff: true,
            canReadStatus: true,
            label: 'Coach/Admin access',
            mode: 'staff'
        });

        expect(getTeamPassAccess({ uid: 'admin-1', email: 'admin@example.com' }, TEAM)).toMatchObject({
            isStaff: true,
            canReadStatus: true,
            label: 'Coach/Admin access',
            mode: 'staff'
        });
    });

    it('keeps parents and fans in read-only mode without staff metadata controls', () => {
        expect(getTeamPassAccess({ uid: 'parent-1', parentOf: [{ teamId: 'team-1', playerId: 'p1' }] }, TEAM)).toMatchObject({
            isStaff: false,
            canReadStatus: false,
            label: 'Team member access',
            mode: 'readonly'
        });

        expect(getTeamPassAccess({ uid: 'fan-1', email: 'fan@example.com' }, TEAM)).toMatchObject({
            isStaff: false,
            canReadStatus: false,
            label: 'Read-only preview',
            mode: 'readonly'
        });
    });

    it('normalizes active, expired, revoked, and missing team pass states', () => {
        const now = new Date('2026-05-05T00:00:00.000Z');

        expect(normalizeTeamPassStatus({
            status: 'active',
            tier: 'team-pass',
            teamId: 'team-1',
            expiresAt: '2026-12-31T00:00:00.000Z'
        }, { team: TEAM, now })).toMatchObject({ status: 'active', label: 'Active' });

        expect(normalizeTeamPassStatus({
            status: 'active',
            tier: 'team-pass',
            teamId: 'team-1',
            expiresAt: '2026-01-01T00:00:00.000Z'
        }, { team: TEAM, now })).toMatchObject({ status: 'expired', label: 'Expired' });

        expect(normalizeTeamPassStatus({
            status: 'active',
            tier: 'team-pass',
            teamId: 'team-1',
            revokedAt: '2026-04-01T00:00:00.000Z'
        }, { team: TEAM, now })).toMatchObject({ status: 'revoked', label: 'Revoked' });

        expect(normalizeTeamPassStatus(null, { team: TEAM, now })).toMatchObject({ status: 'missing', label: 'Missing' });
    });

    it('selects an active Team Pass before older expired or revoked records', () => {
        const pass = selectTeamPassRecord([
            { status: 'revoked', tier: 'team-pass', teamId: 'team-1', updatedAt: '2026-05-04T00:00:00.000Z' },
            { status: 'active', tier: 'team-pass', teamId: 'team-1', expiresAt: '2026-12-31T00:00:00.000Z', updatedAt: '2026-05-01T00:00:00.000Z' },
            { status: 'active', tier: 'family-plan', teamId: 'team-1', updatedAt: '2026-05-05T00:00:00.000Z' }
        ], { team: TEAM, now: new Date('2026-05-05T00:00:00.000Z') });

        expect(pass).toMatchObject({ status: 'active', label: 'Active' });
    });

    it('reads raw team entitlement status only for staff access', async () => {
        await expect(readTeamPassStatus({
            team: TEAM,
            access: { canReadStatus: true },
            deps: { firebase: mockFirebaseForDocs([{ status: 'active', tier: 'team-pass', teamId: 'team-1' }]) }
        })).resolves.toMatchObject({ status: 'active' });

        await expect(readTeamPassStatus({
            team: TEAM,
            access: { canReadStatus: false },
            deps: { firebase: mockFirebaseForDocs([{ status: 'active', tier: 'team-pass', teamId: 'team-1' }]) }
        })).resolves.toMatchObject({ status: 'readonly' });
    });

    it('renders staff status metadata and missing checkout callout without checkout controls', () => {
        const markup = buildTeamPassMarkup({
            team: TEAM,
            access: { isStaff: true, label: 'Coach/Admin access' },
            pass: { status: 'missing', label: 'Missing', expiresAt: null, updatedAt: null }
        });

        expect(markup).toContain('Team Pass management');
        expect(markup).toContain('Current status');
        expect(markup).toContain('Missing');
        expect(markup).toContain('Covered team');
        expect(markup).toContain('Blue Jays');
        expect(markup).toContain('Expiration');
        expect(markup).toContain('Last updated');
        expect(markup).toContain('Checkout is not available yet');
        expect(markup).not.toContain('Buy Team Pass');
    });

    it('renders read-only team access without staff metadata controls', () => {
        const markup = buildTeamPassMarkup({
            team: TEAM,
            access: { isStaff: false, label: 'Team member access' },
            pass: { status: 'readonly', label: 'Read-only' }
        });

        expect(markup).toContain('Read-only');
        expect(markup).toContain('Team Pass access is managed by team staff');
        expect(markup).not.toContain('Expiration');
        expect(markup).not.toContain('Last updated');
        expect(markup).not.toContain('Checkout is not available yet');
    });
});
