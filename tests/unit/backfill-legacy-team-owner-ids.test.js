import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { planLegacyTeamOwnerBackfill } from '../../_migration/backfill-legacy-team-owner-ids.js';

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
        expect(result.unresolvedTeamIds).toEqual(['abandoned']);
        expect(auth.getUserByEmail).not.toHaveBeenCalledWith('stale@example.com');
    });

    it('fails before migration when conflicting aliases resolve to different principals', async () => {
        const auth = {
            getUserByEmail: vi.fn(async (email) => ({
                uid: email.startsWith('first') ? 'owner-1' : 'owner-2',
                email
            }))
        };

        await expect(planLegacyTeamOwnerBackfill([
            teamDoc('ambiguous', {
                ownerEmail: 'first@example.com',
                ownerEmailLower: 'second@example.com'
            })
        ], auth)).rejects.toThrow(/different Firebase Auth users/);
    });

    it('runs from the trusted deploy handoff before stricter Firestore rules activate', () => {
        const workflow = readFileSync(new URL('../../.github/workflows/deploy-prod.yml', import.meta.url), 'utf8');
        const migrationCommand = workflow.indexOf('backfill-legacy-team-owner-ids.mjs" --apply');
        const storageRulesDeploy = workflow.indexOf('- name: Deploy Firebase Storage rules when available');
        const rulesBranch = workflow.indexOf('if [[ "$FIRESTORE_CONFIG_CHANGED" == "true" ]]');

        expect(workflow).toContain('cp _migration/backfill-legacy-team-owner-ids.js');
        expect(workflow).toContain('test ! -L "$bundle/_migration/backfill-legacy-team-owner-ids.mjs"');
        expect(migrationCommand).toBeGreaterThan(-1);
        expect(storageRulesDeploy).toBeGreaterThan(migrationCommand);
        expect(rulesBranch).toBeGreaterThan(migrationCommand);
    });
});
