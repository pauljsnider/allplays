import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
    buildCompletedGamePlayerStatsPayload,
    buildCompletedGameTeamStatsPayload,
    getPostGameEditorNextIndex,
    resolvePostGameEditorDidNotPlay,
    resolvePostGameStatFields,
    resolvePostGameTeamStatFields
} from '../../js/post-game-stat-editor.js';
import { resolveLiveStatConfig } from '../../js/live-game-state.js';
import { hasPlayerProfileParticipation } from '../../js/player-profile-stats.js';

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

    it('uses canonical default box-score fields when a completed game has no config or saved stats', () => {
        const statFields = resolvePostGameStatFields({
            resolvedConfig: null,
            statsMap: {}
        });

        expect(statFields).toEqual([
            { fieldName: 'pts', label: 'PTS' },
            { fieldName: 'reb', label: 'REB' },
            { fieldName: 'ast', label: 'AST' },
            { fieldName: 'fouls', label: 'FOULS' }
        ]);
        expect(buildCompletedGamePlayerStatsPayload({
            player: { name: 'Ava Cole', number: '3' },
            statFields,
            values: { pts: '10', reb: '6', ast: '2', fouls: '1' }
        }).stats).toEqual({
            pts: 10,
            reb: 6,
            ast: 2,
            fouls: 1
        });
    });

    it('adds private player stat definitions to the manager editor fields', () => {
        expect(resolvePostGameStatFields({
            resolvedConfig: {
                columns: ['PTS'],
                statDefinitions: [
                    { label: 'Coach Effort', acronym: 'EFFORT', id: 'effort', visibility: 'private', scope: 'player' },
                    { label: 'Team Deflections', acronym: 'DEFL', id: 'deflections', visibility: 'private', scope: 'team' }
                ]
            },
            statsMap: { p1: { pts: 10, effort: 4 } }
        })).toEqual([
            { fieldName: 'pts', label: 'PTS' },
            { fieldName: 'effort', label: 'Coach Effort' },
            { fieldName: 'fouls', label: 'FOULS' }
        ]);
    });

    it('keeps manager-only team and player definitions from an assigned columns-free config', () => {
        const gameHtml = readFileSync(new URL('../../game.html', import.meta.url), 'utf8');
        const resolvedConfig = resolveLiveStatConfig({
            configs: [{
                id: 'cfg-manager-only',
                baseType: 'Basketball',
                columns: [],
                statDefinitions: [
                    { id: 'deflections', label: 'Deflections', visibility: 'private', scope: 'team', type: 'base' },
                    { id: 'coachEffort', label: 'Coach Effort', visibility: 'private', scope: 'player', type: 'base' }
                ]
            }],
            game: { statTrackerConfigId: 'cfg-manager-only' },
            team: { sport: 'Basketball' }
        });

        expect(resolvePostGameTeamStatFields({ resolvedConfig, teamStats: {} })).toEqual([
            { fieldName: 'deflections', label: 'Deflections' }
        ]);
        expect(resolvePostGameStatFields({ resolvedConfig, statsMap: {} })).toEqual(expect.arrayContaining([
            { fieldName: 'coacheffort', label: 'Coach Effort' },
            { fieldName: 'fouls', label: 'FOULS' }
        ]));
        expect(gameHtml).toContain("import { resolveLiveStatConfig } from './js/live-game-state.js?v=4';");
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
            timeMs: 0,
            participated: false,
            participationStatus: 'did-not-appear',
            participationSource: ''
        });
    });

    it('marks zero-stat completed-game editor saves as player history appearances', () => {
        const payload = buildCompletedGamePlayerStatsPayload({
            player: { name: 'Ava Cole', number: '3' },
            statFields: [
                { fieldName: 'pts', label: 'PTS' },
                { fieldName: 'reb', label: 'REB' },
                { fieldName: 'fouls', label: 'FOULS' }
            ],
            values: { pts: '0', reb: '0', fouls: '0' },
            didNotPlay: false,
            existingTimeMs: 0
        });

        expect(payload).toMatchObject({
            didNotPlay: false,
            timeMs: 0,
            stats: { pts: 0, reb: 0, fouls: 0 },
            participated: true,
            participationStatus: 'appeared',
            participationSource: 'post-game-stat-editor'
        });
        expect(hasPlayerProfileParticipation(payload)).toBe(true);
    });

    it('keeps DNP-to-appeared zero-stat completed-game editor saves visible in player history', () => {
        const payload = buildCompletedGamePlayerStatsPayload({
            player: { name: 'Ava Cole', number: '3' },
            statFields: [{ fieldName: 'pts', label: 'PTS' }],
            values: { pts: '0' },
            didNotPlay: false,
            existingTimeMs: 0
        });

        expect(hasPlayerProfileParticipation({
            didNotPlay: true,
            participated: false,
            participationStatus: 'did-not-appear',
            timeMs: 0,
            stats: { pts: 0 }
        })).toBe(false);
        expect(hasPlayerProfileParticipation(payload)).toBe(true);
    });

    it('normalizes configured custom stat keys so editor inputs and payloads stay aligned', () => {
        // Regression for issue #2196: configured columns like "3-Pt" rendered raw data-stat-field keys
        // while completed-game saves normalized to "3pt", dropping edited values on submit.
        const statFields = resolvePostGameStatFields({
            resolvedConfig: {
                columns: ['3-Pt', 'FG%', 'Reb.']
            },
            statsMap: {
                p1: { '3pt': 8, fg: 5, reb: 4 }
            }
        });

        expect(statFields).toEqual([
            { fieldName: '3pt', label: '3-Pt' },
            { fieldName: 'fg', label: 'FG%' },
            { fieldName: 'reb', label: 'Reb.' },
            { fieldName: 'fouls', label: 'FOULS' }
        ]);

        expect(buildCompletedGamePlayerStatsPayload({
            player: { name: 'Ava Cole', number: '3' },
            statFields,
            values: { '3pt': '8', fg: '5', reb: '4', fouls: '1' }
        }).stats).toEqual({
            '3pt': 8,
            fg: 5,
            reb: 4,
            fouls: 1
        });
    });

    it('resolves and builds manager-only team stat payloads from team-scoped definitions', () => {
        const statFields = resolvePostGameTeamStatFields({
            resolvedConfig: {
                statDefinitions: [
                    { id: 'turnovers', label: 'Turnovers', scope: 'team', visibility: 'private', type: 'base' },
                    { id: 'possessionwins', label: 'Possession Wins', scope: 'team', visibility: 'private', type: 'base' },
                    { id: 'pts', label: 'PTS', scope: 'player', visibility: 'public', type: 'base' }
                ]
            },
            teamStats: { deflections: 4 }
        });

        expect(statFields).toEqual([
            { fieldName: 'turnovers', label: 'Turnovers' },
            { fieldName: 'possessionwins', label: 'Possession Wins' },
            { fieldName: 'deflections', label: 'DEFLECTIONS' }
        ]);
        expect(buildCompletedGameTeamStatsPayload({
            statFields,
            values: { turnovers: '8', possessionwins: ' 11 ', deflections: '-2' }
        })).toEqual({
            stats: {
                turnovers: 8,
                possessionwins: 11,
                deflections: 0
            }
        });
    });

    it('keeps an unsaved DNP checkbox change ahead of the persisted row value', () => {
        expect(resolvePostGameEditorDidNotPlay({
            playerId: 'p1',
            didNotPlayMap: { p1: true },
            pendingDidNotPlayMap: { p1: false }
        })).toBe(false);

        expect(resolvePostGameEditorDidNotPlay({
            playerId: 'p2',
            didNotPlayMap: { p2: false },
            pendingDidNotPlayMap: { p2: true }
        })).toBe(true);
    });

    it('steps through the roster for save and next or previous actions', () => {
        expect(getPostGameEditorNextIndex(0, 'previous', 4)).toBe(0);
        expect(getPostGameEditorNextIndex(0, 'next', 4)).toBe(1);
        expect(getPostGameEditorNextIndex(2, 'previous', 4)).toBe(1);
        expect(getPostGameEditorNextIndex(3, 'next', 4)).toBe(3);
    });

    it('wires completed-game edit controls into the match report page', () => {
        const pageSource = readFileSync(new URL('../../game.html', import.meta.url), 'utf8');
        const dbSource = readFileSync(new URL('../../js/db.js', import.meta.url), 'utf8');

        expect(pageSource).toContain('id="edit-stats-btn"');
        expect(pageSource).toContain('id="stats-save-next-btn"');
        expect(pageSource).toContain('resolvePostGameEditorDidNotPlay');
        expect(pageSource).toContain('setCompletedGamePlayerStats');
        expect(pageSource).toContain("from './js/db.js?v=91'");
        expect(dbSource).toContain('participated: !didNotPlay');
        expect(dbSource).toContain("participationStatus: didNotPlay ? 'did-not-appear' : (statsPayload.participationStatus || 'appeared')");
        expect(dbSource).toContain('await deleteDoc(privateDocRef);');
        expect(pageSource).toContain('id="team-stats-section"');
        expect(pageSource).toContain('setCompletedGameTeamStats');
        expect(pageSource).toContain('getTeamStatsForGame');
    });

    it('keeps completed-game player save updates scoped to injected stat maps', () => {
        const pageSource = readFileSync(new URL('../../game.html', import.meta.url), 'utf8');
        const setupStart = pageSource.indexOf('function setupPostGameStatEditor({');
        const setupEnd = pageSource.indexOf('function setupStatSheetControls', setupStart);
        const setupSource = pageSource.slice(setupStart, setupEnd);

        expect(setupSource).toContain('tableStatsMap = statsMap');
        expect(setupSource).toContain('tableStatsMap[player.id] = publicStats;');
        expect(setupSource).toContain('statsMap[player.id] = { ...(payload.stats || {}) };');
        expect(setupSource).not.toContain('editorStatsMap[player.id]');
        expect(pageSource).toContain('tableStatsMap: statsMap');
    });

    it('renders missing configured stats as blank cells instead of forced zeros', () => {
        const pageSource = readFileSync(new URL('../../game.html', import.meta.url), 'utf8');

        expect(pageSource).toContain("function hasRecordedStatValue(stats, key)");
        expect(pageSource).toContain("hasRecordedStatValue(pStats, key) ? pStats[key] : '&mdash;'");
        expect(pageSource).toContain("hasRecordedStatValue(p.stats, key) ? p.stats[key] : '&mdash;'");
    });

    it('uses normalizeStatKey for form input keys so custom stat names round-trip correctly', () => {
        // Regression for issue #2196: form inputs were rendered with raw fieldName (e.g. "3-pt")
        // but buildCompletedGamePlayerStatsPayload reads back using normalizeStatKey (e.g. "3pt"),
        // causing a key mismatch that wiped custom stat values on save.
        const pageSource = readFileSync(new URL('../../game.html', import.meta.url), 'utf8');

        // The team stat editor comes first in the file, then the player stat editor
        const teamEditorStart = pageSource.indexOf('function setupPostGameTeamStatEditor({');
        const playerEditorStart = pageSource.indexOf('function setupPostGameStatEditor({');

        // The team stat editor renderEditor function must normalize field keys before use
        const teamEditorEnd = playerEditorStart;
        const teamEditorSource = pageSource.slice(teamEditorStart, teamEditorEnd);
        expect(teamEditorSource).toContain('normalizeStatKey(field.fieldName)');
        expect(teamEditorSource).toContain('data-team-stat-field=');

        // The player stat editor renderEditor function must also normalize field keys
        const playerEditorSource = pageSource.slice(playerEditorStart);
        expect(playerEditorSource).toContain('normalizeStatKey(field.fieldName)');
        expect(playerEditorSource).toContain('data-stat-field=');
    });
});
