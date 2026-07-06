import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
    buildTrackStatsheetApplyPlan,
    getTrackStatsheetPointsKey,
    validateTrackStatsheetApplyRows
} from '../../js/track-statsheet-apply.js';

const trackStatsheetSource = readFileSync(new URL('../../track-statsheet.html', import.meta.url), 'utf8');

describe('track statsheet apply helpers', () => {
    it('allows excluded unmatched home rows when included rows are mapped', () => {
        expect(validateTrackStatsheetApplyRows([
            { include: true, mappedPlayerId: 'p1' },
            { include: false, mappedPlayerId: '' }
        ])).toEqual({
            ok: true,
            includedHome: [
                { include: true, mappedPlayerId: 'p1' }
            ]
        });
    });

    it('re-includes an unmatched home row and refreshes derived scores when an admin maps it to a roster player', () => {
        expect(trackStatsheetSource).toMatch(/if \(field === 'mappedPlayerId'\) \{[\s\S]*homeRows\[index\]\[field\] = event\.target\.value;[\s\S]*if \(event\.target\.value\) \{[\s\S]*homeRows\[index\]\.include = true;[\s\S]*includeCheckbox\.checked = true;[\s\S]*updateScoreInputs\(\);/);
        expect(trackStatsheetSource).toMatch(/if \(homeScoreInputDerivedFromRows \|\| !homeScoreInput\.value \|\| Number\(homeScoreInput\.value\) === 0\) \{[\s\S]*homeScoreInput\.value = homeTotal;[\s\S]*homeScoreInputDerivedFromRows = true;/);
        expect(trackStatsheetSource).toContain("document.getElementById('home-score-input').addEventListener('input', () => {");
    });

    it('blocks apply when no home row is included for saving', () => {
        expect(validateTrackStatsheetApplyRows([
            { include: false, mappedPlayerId: '' }
        ])).toEqual({
            ok: false,
            alertMessage: 'Please review or map at least one home player before applying.'
        });
    });

    it('blocks apply when included home rows are still unmatched', () => {
        expect(validateTrackStatsheetApplyRows([
            { include: true, mappedPlayerId: 'p1' },
            { include: true, mappedPlayerId: '' }
        ])).toEqual({
            ok: false,
            alertMessage: 'Please map every included home row to a roster player or uncheck it.'
        });
    });

    it('blocks apply when the same roster player is selected twice', () => {
        expect(validateTrackStatsheetApplyRows([
            { include: true, mappedPlayerId: 'p1' },
            { include: true, mappedPlayerId: 'p1' }
        ])).toEqual({
            ok: false,
            alertMessage: 'A roster player is selected more than once. Please fix duplicates.'
        });
    });

    it('builds aggregated stat writes and game payloads that game.html can consume', () => {
        expect(getTrackStatsheetPointsKey(['GOALS', 'SHOTS'])).toBe('goals');

        expect(buildTrackStatsheetApplyPlan({
            includedHome: [
                { mappedPlayerId: 'p1', totalPoints: 4, fouls: 2 }
            ],
            includedVisitor: [
                { name: 'Opp One', number: '10', totalPoints: 3, fouls: 1 }
            ],
            roster: [
                { id: 'p1', name: 'Ava Cole', number: '3' }
            ],
            columns: ['GOALS', 'SHOTS'],
            homeScore: 4,
            awayScore: 3,
            statSheetPhotoUrl: 'https://img.test/statsheet.png'
        })).toEqual({
            aggregatedStatsWrites: [
                {
                    playerId: 'p1',
                    data: {
                        playerName: 'Ava Cole',
                        playerNumber: '3',
                        participated: true,
                        participationStatus: 'appeared',
                        participationSource: 'statsheet-import',
                        stats: {
                            goals: 4,
                            fouls: 2
                        }
                    }
                }
            ],
            gameUpdate: {
                homeScore: 4,
                awayScore: 3,
                opponentStats: {
                    statsheet_1: {
                        name: 'Opp One',
                        number: '10',
                        goals: 3,
                        fouls: 1
                    }
                },
                status: 'completed',
                liveStatus: 'completed',
                liveHasData: false,
                liveClockMs: 0,
                liveClockRunning: false,
                liveClockPeriod: 'Q1',
                liveLineup: {
                    onCourt: [],
                    bench: []
                },
                statSheetPhotoUrl: 'https://img.test/statsheet.png'
            }
        });
    });

    it('does not fabricate unsupported configured stats during statsheet replacement', () => {
        expect(buildTrackStatsheetApplyPlan({
            includedHome: [
                { mappedPlayerId: 'p1', totalPoints: 12, fouls: 2 }
            ],
            includedVisitor: [
                { name: 'Opp One', number: '10', totalPoints: 3, fouls: 1 }
            ],
            roster: [
                { id: 'p1', name: 'Ava Cole', number: '3' }
            ],
            columns: ['PTS', 'REB', 'AST']
        })).toEqual({
            aggregatedStatsWrites: [
                {
                    playerId: 'p1',
                    data: {
                        playerName: 'Ava Cole',
                        playerNumber: '3',
                        participated: true,
                        participationStatus: 'appeared',
                        participationSource: 'statsheet-import',
                        stats: {
                            pts: 12,
                            fouls: 2
                        }
                    }
                }
            ],
            gameUpdate: {
                homeScore: 0,
                awayScore: 0,
                opponentStats: {
                    statsheet_1: {
                        name: 'Opp One',
                        number: '10',
                        pts: 3,
                        fouls: 1
                    }
                },
                status: 'completed',
                liveStatus: 'completed',
                liveHasData: false,
                liveClockMs: 0,
                liveClockRunning: false,
                liveClockPeriod: 'Q1',
                liveLineup: {
                    onCourt: [],
                    bench: []
                },
                statSheetPhotoUrl: null
            }
        });
    });

    it('marks included zero-stat home rows as player profile appearances', () => {
        expect(buildTrackStatsheetApplyPlan({
            includedHome: [
                { mappedPlayerId: 'p1', totalPoints: 0, fouls: 0 }
            ],
            roster: [
                { id: 'p1', name: 'Ava Cole', number: '3' }
            ],
            columns: ['PTS'],
            homeScore: 0,
            awayScore: 0
        }).aggregatedStatsWrites).toEqual([
            {
                playerId: 'p1',
                data: {
                    playerName: 'Ava Cole',
                    playerNumber: '3',
                    participated: true,
                    participationStatus: 'appeared',
                    participationSource: 'statsheet-import',
                    stats: {
                        pts: 0,
                        fouls: 0
                    }
                }
            }
        ]);
    });

    it('clears all tracked and live state when replacing previously tracked game data', () => {
        expect(trackStatsheetSource).toContain("const privateStatsSnap = await getDocs(collection(db, `teams/${currentTeamId}/games/${currentGameId}/privatePlayerStats`));");
        expect(trackStatsheetSource).toContain("const liveEventsSnap = await getDocs(collection(db, `teams/${currentTeamId}/games/${currentGameId}/liveEvents`));");
        expect(trackStatsheetSource).toMatch(/if \(eventsSnap\.size > 0 \|\| statsSnap\.size > 0 \|\| liveEventsSnap\.size > 0 \|\| privateStatsSnap\.size > 0\) \{[\s\S]*await Promise\.all\(liveEventsSnap\.docs\.map\(docItem => deleteDoc\(docItem\.ref\)\)\);[\s\S]*await Promise\.all\(privateStatsSnap\.docs\.map\(docItem => deleteDoc\(docItem\.ref\)\)\);/);
        expect(buildTrackStatsheetApplyPlan().gameUpdate).toMatchObject({
            liveStatus: 'completed',
            liveHasData: false,
            liveClockMs: 0,
            liveClockRunning: false,
            liveClockPeriod: 'Q1',
            liveLineup: {
                onCourt: [],
                bench: []
            }
        });
    });
});
