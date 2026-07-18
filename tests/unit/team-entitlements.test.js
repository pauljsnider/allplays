import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    TEAM_PASS_FEATURES,
    buildTeamEntitlementId,
    canAccessPremiumFanFeature,
    isRecordedReplayTeamPassGateEnabled,
    isTeamEntitlementActive,
    resolveTeamEntitlementSeasonId
} from '../../js/team-entitlements-core.js';

function readRepoFile(path) {
    return readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

describe('team entitlement helpers', () => {
    it('resolves the team pass entitlement document id by season and tier', () => {
        expect(buildTeamEntitlementId('2026')).toBe('2026_team-pass');
        expect(buildTeamEntitlementId('2026', 'team-pass')).toBe('2026_team-pass');
    });

    it('uses explicit season fields before falling back to the game year', () => {
        expect(resolveTeamEntitlementSeasonId({ game: { seasonId: 'spring-2026' } })).toBe('spring-2026');
        expect(resolveTeamEntitlementSeasonId({ game: { date: '2026-05-01T12:00:00Z' } })).toBe('2026');
        expect(resolveTeamEntitlementSeasonId({ team: { currentSeasonId: 'summer-2026' } })).toBe('summer-2026');
    });

    it('only unlocks premium fan features for an active same-season entitlement', () => {
        const active = {
            status: 'active',
            seasonId: '2026',
            tier: 'team-pass',
            expiresAt: '2026-12-31T23:59:59Z'
        };

        expect(isTeamEntitlementActive(active, { seasonId: '2026', now: '2026-05-05T00:00:00Z' })).toBe(true);
        expect(canAccessPremiumFanFeature(TEAM_PASS_FEATURES.RECORDED_REPLAY, { active: true })).toBe(true);
        expect(isTeamEntitlementActive({ ...active, seasonId: '2025' }, { seasonId: '2026' })).toBe(false);
        expect(isTeamEntitlementActive({ ...active, status: 'cancelled' }, { seasonId: '2026' })).toBe(false);
        expect(isTeamEntitlementActive(active, { seasonId: '2026', now: '2027-01-01T00:00:00Z' })).toBe(false);
    });

    it('keeps the recorded replay Team Pass gate off unless config enables it', () => {
        expect(isRecordedReplayTeamPassGateEnabled({ team: {} })).toBe(false);
        expect(isRecordedReplayTeamPassGateEnabled({
            team: { teamPassConfig: { recordedReplayPaywallEnabled: true } }
        })).toBe(true);
        expect(isRecordedReplayTeamPassGateEnabled({
            team: { teamPassConfig: { recordedReplayPaywallEnabled: true } },
            game: { teamPassConfig: { recordedReplayPaywallEnabled: false } }
        })).toBe(false);
    });

    it('wires live replay video behind the team entitlement helper', () => {
        const liveGame = readRepoFile('js/live-game.js');
        const html = readRepoFile('live-game.html');

        expect(liveGame).toContain('isRecordedReplayTeamPassGateEnabled');
        expect(liveGame).toContain('getTeamEntitlementStatus');
        expect(liveGame).toContain("TEAM_PASS_FEATURES.RECORDED_REPLAY");
        expect(html).toContain('id="video-paywall"');
        expect(html).toContain('id="recorded-replay-video"');
        expect(html).toMatch(/id="recorded-replay-video"[\s\S]*?class="hidden /);
        expect(html).toMatch(/id="video-paywall" class="hidden /);
        expect(html).toContain('Team Pass required');
    });

    it('routes active entitlement writes through trusted server paths', () => {
        const rules = readRepoFile('firestore.rules');

        expect(rules).toContain('match /entitlements/{entitlementId}');
        expect(rules).toContain('allow create, update: if isTeamOwnerOrAdmin(teamId)');
        expect(rules).toContain("request.resource.data.tier == 'team-pass'");
        expect(rules).toContain("request.resource.data.status in ['inactive', 'expired', 'cancelled']");
        expect(rules).not.toContain("request.resource.data.status in ['active', 'inactive', 'expired', 'cancelled']");
        expect(rules).toContain('allow delete: if isTeamOwnerOrAdmin(teamId);');
    });
});
