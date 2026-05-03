import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    formatRegistrationRosterImportResults,
    getRegistrationRosterPlayers,
    isExternallyLinkedRosterTeam,
    planRegistrationRosterImport
} from '../../js/edit-roster-registration-import.js';

function readEditRoster() {
    return readFileSync(new URL('../../edit-roster.html', import.meta.url), 'utf8');
}

describe('registration roster import planning', () => {
    it('detects linked roster teams and source roster snapshots', () => {
        expect(isExternallyLinkedRosterTeam({})).toBe(false);
        expect(isExternallyLinkedRosterTeam({ registrationSourceId: 'sports-connect' })).toBe(true);
        expect(getRegistrationRosterPlayers({ registrationSourceSnapshot: { rosterPlayers: [{ id: 'p1' }] } })).toEqual([{ id: 'p1' }]);
    });

    it('plans add and update operations by external player ID while preserving local-only conflicts', () => {
        const plan = planRegistrationRosterImport({
            source: { type: 'sports-connect', id: 'league-1' },
            sourcePlayers: [
                {
                    externalPlayerId: 'ext-1',
                    name: 'Avery Lee',
                    jerseyNumber: '4',
                    guardians: [{ name: 'Pat Lee', email: 'PAT@example.com', relation: 'Parent' }]
                },
                {
                    externalPlayerId: 'ext-2',
                    name: 'Sam Jones',
                    number: '12'
                },
                {
                    externalPlayerId: 'ext-3',
                    name: 'Jordan Smith',
                    number: '7'
                },
                {
                    externalPlayerId: 'ext-3',
                    name: 'Jordan Smith',
                    number: '7'
                }
            ],
            existingPlayers: [
                {
                    id: 'player-1',
                    name: 'Avery Lee',
                    number: '3',
                    sourceMetadata: { externalPlayerId: 'ext-1' }
                },
                {
                    id: 'player-2',
                    name: 'Sam Jones',
                    number: '12'
                }
            ]
        });

        expect(plan.results).toMatchObject({
            added: 1,
            updated: 1,
            skipped: 1,
            conflicted: 1
        });
        expect(plan.results.conflicts).toEqual([{ externalPlayerId: 'ext-2', existingPlayerId: 'player-2' }]);
        expect(plan.operations).toHaveLength(2);
        expect(plan.operations[0]).toMatchObject({
            type: 'update',
            playerId: 'player-1',
            payload: {
                name: 'Avery Lee',
                number: '4',
                guardians: [{ name: 'Pat Lee', email: 'pat@example.com', phone: '', relation: 'Parent' }],
                sourceMetadata: {
                    sourceType: 'sports-connect',
                    sourceId: 'league-1',
                    externalPlayerId: 'ext-1'
                }
            }
        });
        expect(plan.operations[1]).toMatchObject({
            type: 'add',
            payload: {
                name: 'Jordan Smith',
                number: '7',
                sourceMetadata: {
                    externalPlayerId: 'ext-3'
                }
            }
        });
    });

    it('formats import result counts for the UI', () => {
        expect(formatRegistrationRosterImportResults({ added: 2, updated: 1, skipped: 0, conflicted: 3 }))
            .toBe('2 added, 1 updated, 0 skipped, 3 conflicted');
    });
});

describe('registration roster import wiring', () => {
    it('shows the manual re-import action and routes through the shared helper', () => {
        const source = readEditRoster();

        expect(source).toContain('id="registration-roster-import"');
        expect(source).toContain('Re-import Roster');
        expect(source).toContain("import { formatRegistrationRosterImportResults, getRegistrationRosterPlayers, isExternallyLinkedRosterTeam, planRegistrationRosterImport } from './js/edit-roster-registration-import.js?v=1';");
        expect(source).toContain('planRegistrationRosterImport({');
        expect(source).toContain('sourceMetadata?.externalPlayerId');
        expect(source).toContain('Local-only');
    });
});
