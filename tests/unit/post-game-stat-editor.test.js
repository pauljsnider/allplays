import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
    buildCompletedGamePlayerStatsPayload,
    getPostGameEditorNextIndex,
    resolvePostGameStatFields
} from '../../js/post-game-stat-editor.js';

describe('post-game stat editor helpers', () => {
    it('resolves configured fields and keeps fouls editable for completed-game corrections', () => {
        expect(resolvePostGameStatFields({
            resolvedConfig: {
                columns: ['PTS', 'REB', 'AST']
            },
            statsMap: {
                p1: { pts: 12, reb: 4, ast: 3 }
            }
        })).toEqual([
            { fieldName: 'pts', label: 'PTS' },
            { fieldName: 'reb', label: 'REB' },
            { fieldName: 'ast', label: 'AST' },
            { fieldName: 'fouls', label: 'FOULS' }
        ]);
    });

    it('builds an absolute stat payload and zeroes the row when a player did not play', () => {
        expect(buildCompletedGamePlayerStatsPayload({
            player: { name: 'Ava Cole', number: '3' },
            statFields: [
                { fieldName: 'pts', label: 'PTS' },
                { fieldName: 'reb', label: 'REB' },
                { fieldName: 'fouls', label: 'FOULS' }
            ],
            values: { pts: '11', reb: ' 4 ', fouls: '2' },
            didNotPlay: true,
            existingTimeMs: 900000
        })).toEqual({
            playerName: 'Ava Cole',
            playerNumber: '3',
            stats: {
                pts: 0,
                reb: 0,
                fouls: 0
            },
            didNotPlay: true,
            timeMs: 0
        });
    });

    it('steps through the roster for save and next or previous actions', () => {
        expect(getPostGameEditorNextIndex(0, 'previous', 4)).toBe(0);
        expect(getPostGameEditorNextIndex(0, 'next', 4)).toBe(1);
        expect(getPostGameEditorNextIndex(2, 'previous', 4)).toBe(1);
        expect(getPostGameEditorNextIndex(3, 'next', 4)).toBe(3);
    });

    it('wires completed-game edit controls into the match report page', () => {
        const pageSource = readFileSync(new URL('../../game.html', import.meta.url), 'utf8');

        expect(pageSource).toContain('id="edit-stats-btn"');
        expect(pageSource).toContain('id="stats-save-next-btn"');
        expect(pageSource).toContain('setCompletedGamePlayerStats');
    });
});
