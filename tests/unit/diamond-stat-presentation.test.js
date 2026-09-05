import { describe, expect, it } from 'vitest';

import {
    DIAMOND_PLAYER_STAT_CATALOG,
    aggregateCoverageAwareSeasonStats,
    getCoverageAwareStatValue,
    getPublicDiamondStatCatalog,
    readCoverageAwareOpponentStats,
    readCoverageAwareStatDocument,
    resolveDiamondProjectionState
} from '../../js/diamond-stat-presentation.js';

const game = {
    trackingEngine: 'diamond-v2',
    diamondProjectionStatus: 'current',
    diamondProjectionRevision: 12,
    rulesProfileId: 'baseball-youth',
    status: 'completed'
};

describe('Diamond stat presentation', () => {
    it('catalogs the complete projected traditional raw and derived field set', () => {
        const ids = DIAMOND_PLAYER_STAT_CATALOG.map(({ id }) => id);
        expect(ids).toEqual(expect.arrayContaining([
            'pa', 'ab', '1b', '2b', '3b', 'hr', 'rbi', 'gidp',
            'avg', 'obp', 'slg', 'ops', 'sb', 'cs', 'stolen_base_rate',
            'p_app', 'ip_outs', 'p_so', 'wp', 'innings_pitched', 'era', 'whip',
            'po', 'a', 'e', 'dp', 'tp', 'pb', 'fpct', 'chances'
        ]));
        expect(new Set(ids).size).toBe(ids.length);
    });

    it('removes configured manager-private fields from public player and team catalogs', () => {
        const config = {
            statDefinitions: [
                { id: 'pitches', scope: 'player', visibility: 'private' },
                { id: 'avg', label: 'Batting Average', scope: 'player', visibility: 'public', precision: 4 },
                { id: 'risp_hits', scope: 'team', visibility: 'private' }
            ]
        };
        const playerCatalog = getPublicDiamondStatCatalog(config, 'player');
        const teamCatalog = getPublicDiamondStatCatalog(config, 'team');

        expect(playerCatalog.some(({ id }) => id === 'pitches')).toBe(false);
        expect(playerCatalog.find(({ id }) => id === 'avg')).toMatchObject({ label: 'Batting Average', precision: 4, visibility: 'public' });
        expect(teamCatalog.some(({ id }) => id === 'risp_hits')).toBe(false);
        expect(teamCatalog.some(({ id }) => id === 'r')).toBe(true);
    });

    it('keeps complete, observed, and unavailable values distinct without turning omissions into zero', () => {
        const view = readCoverageAwareStatDocument({
            trackingEngine: 'diamond-v2',
            sourceRevision: 12,
            complete: true,
            stats: { ab: 4, h: 0 },
            observedStats: { sb: 1 },
            derivedStats: { avg: 0 },
            observedDerivedStats: { era: 2.5 },
            statCoverage: {
                ab: 'complete',
                h: 'complete',
                avg: 'complete',
                sb: 'partial',
                era: 'partial',
                whip: 'not_collected'
            },
            unavailableDerivedStats: ['whip']
        }, game);

        expect(view.values).toEqual({ ab: 4, h: 0, avg: 0, sb: 1, era: 2.5 });
        expect(view.completeValues).toEqual({ ab: 4, h: 0, avg: 0 });
        expect(view.observedStatKeys).toEqual(['era', 'sb']);
        expect(getCoverageAwareStatValue(view, view.values, 'h')).toMatchObject({ text: '0', status: 'complete', observed: false });
        expect(getCoverageAwareStatValue(view, view.values, 'sb')).toMatchObject({ text: '1', status: 'partial', observed: true });
        expect(getCoverageAwareStatValue(view, view.values, 'whip', { precision: 2 })).toMatchObject({ text: '—', status: 'not_collected', available: false });
    });

    it('fails closed for a v2 game carrying a legacy or stale stat document', () => {
        const legacyDocument = readCoverageAwareStatDocument({ stats: { h: 9 } }, game);
        expect(legacyDocument.values).toEqual({});
        expect(legacyDocument.projection.pending).toBe(true);

        const staleDocument = readCoverageAwareStatDocument({
            trackingEngine: 'diamond-v2',
            sourceRevision: 11,
            complete: true,
            stats: { h: 2 },
            statCoverage: { h: 'complete' }
        }, game);
        expect(staleDocument.values).toEqual({ h: 2 });
        expect(staleDocument.completeValues).toEqual({});
        expect(staleDocument.projection.pending).toBe(true);

        expect(resolveDiamondProjectionState(game, [11])).toMatchObject({
            status: 'pending',
            pending: true,
            authoritativeRevision: 12,
            sourceRevisions: [11]
        });
        expect(resolveDiamondProjectionState({ ...game, trackingEngine: 'standard' }, [11])).toMatchObject({
            status: 'legacy',
            pending: false
        });
    });

    it('infers opponent per-stat coverage from the family map and strips metadata', () => {
        const view = readCoverageAwareOpponentStats({
            name: 'Visitor',
            number: '8',
            h: 2,
            sb: 1,
            era: 0,
            diamondCoverage: { batting: 'complete', baserunning: 'partial', pitching: 'not_collected', fielding: 'not_collected', pitches: 'not_collected' },
            diamondSourceRevision: 12
        }, game);
        expect(view.values).toMatchObject({ h: 2, sb: 1 });
        expect(view.values).not.toHaveProperty('era');
        expect(view.statCoverage).toMatchObject({ h: 'complete', sb: 'partial', era: 'not_collected' });
        expect(view.observedStatKeys).toContain('sb');
        expect(view.values).not.toHaveProperty('diamondcoverage');
    });

    it('builds season lower bounds from partial capture and derives rates only from complete families', () => {
        const result = aggregateCoverageAwareSeasonStats({
            legacyStatsByPlayerId: { legacy: { h: 3 } },
            diamondGames: [{
                game,
                documents: [{
                    id: 'p1',
                    data: {
                        trackingEngine: 'diamond-v2',
                        sourceRevision: 12,
                        complete: true,
                        stats: { pa: 4, ab: 3, h: 1, bb: 1, ibb: 0, hbp: 0, sf: 0, tb: 2, ip_outs: 6, er: 1, p_bb: 1, p_ibb: 0, p_h: 2 },
                        observedStats: { sb: 2 },
                        statCoverage: {
                            pa: 'complete', ab: 'complete', h: 'complete', bb: 'complete', ibb: 'complete', hbp: 'complete', sf: 'complete', tb: 'complete',
                            ip_outs: 'complete', er: 'complete', p_bb: 'complete', p_ibb: 'complete', p_h: 'complete', sb: 'partial'
                        },
                        coverage: { batting: 'complete', baserunning: 'partial', pitching: 'complete', fielding: 'not_collected', pitches: 'not_collected' }
                    }
                }]
            }]
        });

        expect(result.statsByPlayerId.legacy).toEqual({ h: 3 });
        expect(result.statsByPlayerId.p1).toMatchObject({ h: 1, sb: 2, avg: 1 / 3, innings_pitched: '2.0', era: 3, whip: 1.5 });
        expect(result.completeStatsByPlayerId.p1).toMatchObject({ h: 1, avg: 1 / 3, era: 3 });
        expect(result.completeStatsByPlayerId.p1).not.toHaveProperty('sb');
        expect(result.presentationByPlayerId.p1.statCoverage).toMatchObject({ avg: 'complete', sb: 'partial', fpct: 'not_collected' });
        expect(getCoverageAwareStatValue(result.presentationByPlayerId.p1, result.statsByPlayerId.p1, 'avg', { precision: 3 }).text).toBe('.333');
        expect(getCoverageAwareStatValue(result.presentationByPlayerId.p1, result.statsByPlayerId.p1, 'fpct', { precision: 3 }).text).toBe('—');
    });

    it('treats mixed legacy and Diamond season totals as observed lower bounds instead of complete zeros', () => {
        const result = aggregateCoverageAwareSeasonStats({
            legacyStatsByPlayerId: { p1: { h: 2, hr: 0 } },
            diamondGames: [{
                game: { ...game, rulesProfileId: 'baseball-youth@1' },
                documents: [{
                    id: 'p1',
                    data: {
                        trackingEngine: 'diamond-v2',
                        sourceRevision: 12,
                        complete: true,
                        stats: { h: 1, hr: 0 },
                        statCoverage: { h: 'complete', hr: 'complete' },
                        coverage: { batting: 'complete' }
                    }
                }]
            }]
        });

        expect(result.statsByPlayerId.p1).toMatchObject({ h: 3, hr: 0 });
        expect(result.presentationByPlayerId.p1.statCoverage).toMatchObject({ h: 'partial', hr: 'partial' });
        expect(result.completeStatsByPlayerId.p1).toEqual({});
        expect(getCoverageAwareStatValue(result.presentationByPlayerId.p1, result.statsByPlayerId.p1, 'hr')).toMatchObject({
            text: '0',
            status: 'partial',
            observed: true
        });
    });

    it('downgrades loaded season values when another expected Diamond projection is pending', () => {
        const result = aggregateCoverageAwareSeasonStats({
            diamondGames: [
                {
                    game,
                    documents: [{
                        id: 'p1',
                        data: {
                            trackingEngine: 'diamond-v2',
                            sourceRevision: 12,
                            complete: true,
                            stats: { ab: 3, h: 1 },
                            statCoverage: { ab: 'complete', h: 'complete' },
                            coverage: { batting: 'complete' }
                        }
                    }]
                },
                {
                    game: { ...game, diamondProjectionRevision: 4, diamondProjectionStatus: 'pending' },
                    documents: []
                }
            ]
        });

        expect(result.projection.pending).toBe(true);
        expect(result.statsByPlayerId.p1).toMatchObject({ ab: 3, h: 1 });
        expect(result.presentationByPlayerId.p1.statCoverage).toMatchObject({ ab: 'partial', h: 'partial', avg: 'partial' });
        expect(result.completeStatsByPlayerId.p1).toEqual({});
        expect(getCoverageAwareStatValue(result.presentationByPlayerId.p1, result.statsByPlayerId.p1, 'h')).toMatchObject({
            text: '1',
            status: 'partial',
            observed: true
        });
    });
});
