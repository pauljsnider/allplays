import { describe, expect, it } from 'vitest';
import {
    buildDiamondTrackerUrl,
    buildDiamondViewerUrl,
    hasMeaningfulLegacyTracking,
    normalizeDiamondPolicy,
    normalizeDiamondSport,
    resolveDiamondGameRoute
} from '../../js/diamond-scorebook-routing.js';

const eligible = {
    team: { id: 'team-1', sport: 'Baseball', active: true },
    game: { id: 'game-1', isDbGame: true },
    policy: { mode: 'pilot', revision: 1, teamIds: ['team-1'] },
    teamSettings: { enabled: true },
    canManage: true,
    canScore: true
};

describe('diamond scorebook routing', () => {
    it('normalizes Baseball and Fastpitch without accepting other sports', () => {
        expect(normalizeDiamondSport('Baseball')).toBe('baseball');
        expect(normalizeDiamondSport('Fastpitch Softball')).toBe('softball');
        expect(normalizeDiamondSport('Basketball')).toBe('');
    });

    it('fails closed for missing and malformed policies', () => {
        expect(normalizeDiamondPolicy(null)).toMatchObject({ mode: 'disabled', reason: 'missing-policy' });
        expect(normalizeDiamondPolicy({ mode: 'enabled', revision: 0 })).toMatchObject({ mode: 'disabled', reason: 'invalid-policy' });
    });

    it('offers activation only to an eligible opted-in pilot game', () => {
        expect(resolveDiamondGameRoute(eligible)).toMatchObject({
            engine: 'legacy',
            scorer: 'legacy',
            viewer: 'classic',
            canActivate: true,
            reason: null
        });
    });

    it('keeps meaningful legacy games on the legacy engine', () => {
        const game = { ...eligible.game, hasLegacyEvents: true };
        expect(hasMeaningfulLegacyTracking(game)).toBe(true);
        expect(resolveDiamondGameRoute({ ...eligible, game })).toMatchObject({
            canActivate: false,
            reason: 'legacy-data-present'
        });
    });

    it('continues routing an owned diamond game while rollout is disabled', () => {
        expect(resolveDiamondGameRoute({
            ...eligible,
            game: { ...eligible.game, trackingEngine: 'diamond-v2' },
            policy: null
        })).toMatchObject({ engine: 'diamond-v2', scorer: 'diamond', viewer: 'diamond' });
    });

    it('blocks scoring for unknown nonempty engines', () => {
        expect(resolveDiamondGameRoute({
            ...eligible,
            game: { ...eligible.game, trackingEngine: 'future-engine' }
        })).toMatchObject({ scorer: 'blocked', viewer: 'classic', reason: 'unknown-engine' });
    });

    it('rejects inactive, shared, and non-diamond activation', () => {
        expect(resolveDiamondGameRoute({ ...eligible, team: { ...eligible.team, active: false } }).reason).toBe('inactive-team');
        expect(resolveDiamondGameRoute({ ...eligible, game: { ...eligible.game, isSharedGame: true } }).reason).toBe('shared-game-not-eligible');
        expect(resolveDiamondGameRoute({ ...eligible, team: { ...eligible.team, sport: 'Soccer' } }).reason).toBe('unsupported-sport');
    });

    it('builds stable encoded scorer and viewer links', () => {
        expect(buildDiamondTrackerUrl('team one', 'game/one')).toBe('/app/#/schedule/team%20one/game%2Fone/diamond-v2');
        expect(buildDiamondViewerUrl({ teamId: 'team one', gameId: 'game/one', replay: true, clipStart: 10, clipEnd: 20 }))
            .toBe('/live-game-diamond-v2.html?teamId=team+one&gameId=game%2Fone&replay=true&clipStart=10&clipEnd=20');
    });
});
