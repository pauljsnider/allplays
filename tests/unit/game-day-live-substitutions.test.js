import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildRotationPlanFromGamePlan } from '../../js/game-plan-interop.js';
import {
    buildOnFieldMap,
    getSubstitutionOptions,
    applyLiveSubstitution
} from '../../js/game-day-live-substitutions.js';

const players = [
    { id: 'p1', name: 'Avery', number: '1' },
    { id: 'p2', name: 'Blake', number: '2' },
    { id: 'p3', name: 'Casey', number: '3' }
];

function createSavedGamePlan() {
    return {
        formationId: 'soccer-9v9',
        numPeriods: 2,
        lineups: {
            'H1-keeper': 'p1',
            'H1-striker': 'p2'
        },
        isPublished: true,
        publishedLineups: {
            'H1-keeper': 'p1',
            'H1-striker': 'p2'
        }
    };
}

describe('game day live substitutions', () => {
    it('keeps the substituted player on the field after reload and updates the next sub options', () => {
        const initialRotationPlan = buildRotationPlanFromGamePlan(createSavedGamePlan());
        const subResult = applyLiveSubstitution({
            period: 'H1',
            outId: 'p2',
            inId: 'p3',
            rotationPlan: initialRotationPlan,
            rotationActual: {},
            players,
            now: new Date('2026-04-14T19:25:00.000Z')
        });

        expect(subResult.rotationPlan.H1).toEqual({ keeper: 'p1', striker: 'p3' });
        expect(subResult.rotationActual.H1['sub-1776194700000']).toEqual([
            {
                position: 'striker',
                out: 'Blake',
                in: 'Casey',
                appliedAt: '2026-04-14T19:25:00.000Z'
            }
        ]);

        const reloadedRotationPlan = buildRotationPlanFromGamePlan(createSavedGamePlan());
        expect(buildOnFieldMap({
            period: 'H1',
            rotationPlan: reloadedRotationPlan,
            rotationActual: subResult.rotationActual,
            players
        })).toEqual({ keeper: 'p1', striker: 'p3' });

        const options = getSubstitutionOptions({
            period: 'H1',
            rotationPlan: reloadedRotationPlan,
            rotationActual: subResult.rotationActual,
            players
        });

        expect(options.onFieldPlayers.map((player) => player.id)).toEqual(['p1', 'p3']);
        expect(options.offFieldPlayers.map((player) => player.id)).toEqual(['p2']);
    });

    it('finds the substituted-in player position from persisted live data after reload', () => {
        const firstSub = applyLiveSubstitution({
            period: 'H1',
            outId: 'p2',
            inId: 'p3',
            rotationPlan: buildRotationPlanFromGamePlan(createSavedGamePlan()),
            rotationActual: {},
            players,
            now: new Date('2026-04-14T19:25:00.000Z')
        });

        const secondSub = applyLiveSubstitution({
            period: 'H1',
            outId: 'p3',
            inId: 'p2',
            rotationPlan: buildRotationPlanFromGamePlan(createSavedGamePlan()),
            rotationActual: firstSub.rotationActual,
            players,
            now: new Date('2026-04-14T19:26:00.000Z')
        });

        expect(secondSub.position).toBe('striker');
        expect(secondSub.rotationPlan.H1).toEqual({ keeper: 'p1', striker: 'p2' });
        expect(secondSub.rotationActual.H1['sub-1776194760000']).toEqual([
            {
                position: 'striker',
                out: 'Casey',
                in: 'Blake',
                appliedAt: '2026-04-14T19:26:00.000Z'
            }
        ]);
    });
});

describe('game day live substitution wiring', () => {
    it('routes on-field reconstruction and apply-sub behavior through the shared helper module', () => {
        const source = readFileSync(resolve(process.cwd(), 'game-day.html'), 'utf8');

        expect(source).toContain("from './js/game-day-live-substitutions.js?v=1'");
        expect(source).toContain('return buildLiveOnFieldMap({');
        expect(source).toContain('const { onFieldPlayers, offFieldPlayers } = getSubstitutionOptions({');
        expect(source).toContain('const subResult = applyLiveSubstitution({');
        expect(source).toContain('populateSubDropdowns();');
    });
});
