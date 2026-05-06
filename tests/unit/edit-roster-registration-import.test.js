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

    it('plans add and update operations by source plus external player ID while preserving local-only conflicts', () => {
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
                    sourceMetadata: { sourceType: 'sports-connect', sourceId: 'league-1', externalPlayerId: 'ext-1' }
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

    it('does not update an existing player from a different known source with the same external player ID', () => {
        const plan = planRegistrationRosterImport({
            source: { type: 'sports-connect', id: 'league-2' },
            sourcePlayers: [{ externalPlayerId: 'ext-1', name: 'New Source Player', number: '9' }],
            existingPlayers: [
                {
                    id: 'player-1',
                    name: 'Old Source Player',
                    number: '4',
                    sourceMetadata: { sourceType: 'sports-connect', sourceId: 'league-1', externalPlayerId: 'ext-1' }
                }
            ]
        });

        expect(plan.results).toMatchObject({ added: 1, updated: 0, skipped: 0, conflicted: 0 });
        expect(plan.operations).toHaveLength(1);
        expect(plan.operations[0]).toMatchObject({ type: 'add', payload: { name: 'New Source Player' } });
    });

    it('continues to update legacy imported players that have no source identity fields', () => {
        const plan = planRegistrationRosterImport({
            source: { type: 'sports-connect', id: 'league-1' },
            sourcePlayers: [{ externalPlayerId: 'ext-legacy', name: 'Legacy Player', number: '11' }],
            existingPlayers: [
                {
                    id: 'player-legacy',
                    name: 'Legacy Player',
                    number: '10',
                    registrationSource: { externalPlayerId: 'ext-legacy' }
                }
            ]
        });

        expect(plan.results).toMatchObject({ added: 0, updated: 1, skipped: 0, conflicted: 0 });
        expect(plan.operations[0]).toMatchObject({ type: 'update', playerId: 'player-legacy' });
    });

    it('maps configured roster profile fields from matching registration answer keys and labels', () => {
        const plan = planRegistrationRosterImport({
            source: { type: 'sports-connect', id: 'league-1' },
            fields: [
                { key: 'grade', label: 'Grade', type: 'text', visibility: 'team' },
                { key: 'position', label: 'Primary Position', type: 'menu', visibility: 'team', options: [{ value: 'pg', label: 'Point Guard' }] },
                { key: 'throwsRight', label: 'Throws Right?', type: 'checkbox', visibility: 'team' },
                { key: 'birthDate', label: 'Birth Date', type: 'date', visibility: 'team' }
            ],
            sourcePlayers: [
                {
                    externalPlayerId: 'ext-1',
                    name: 'Avery Lee',
                    number: '4',
                    answers: {
                        Grade: '6',
                        'Primary Position': 'Point Guard',
                        throwsRight: 'yes',
                        birthDate: '2014-02-03'
                    }
                }
            ],
            existingPlayers: [
                {
                    id: 'player-1',
                    name: 'Avery Lee',
                    number: '3',
                    profile: { customFields: { grade: '5', note: 'keep' } },
                    sourceMetadata: { sourceType: 'sports-connect', sourceId: 'league-1', externalPlayerId: 'ext-1' }
                }
            ]
        });

        expect(plan.results).toMatchObject({ updated: 1, fieldsImported: 4, fieldsSkipped: 0 });
        expect(plan.operations[0].payload.profile.customFields).toEqual({
            grade: '6',
            note: 'keep',
            position: 'pg',
            throwsRight: true,
            birthDate: '2014-02-03'
        });
    });

    it('falls back past empty registration wrappers when mapping configured roster fields', () => {
        const plan = planRegistrationRosterImport({
            source: { type: 'sports-connect', id: 'league-1' },
            fields: [{ key: 'grade', label: 'Grade', type: 'text', visibility: 'team' }],
            sourcePlayers: [
                {
                    externalPlayerId: 'ext-1',
                    name: 'Avery Lee',
                    submittedData: {},
                    player: {},
                    payload: {
                        athlete: {
                            customFields: { Grade: '7' }
                        }
                    }
                }
            ],
            existingPlayers: [
                {
                    id: 'player-1',
                    name: 'Avery Lee',
                    profile: { customFields: { note: 'keep' } },
                    sourceMetadata: { sourceType: 'sports-connect', sourceId: 'league-1', externalPlayerId: 'ext-1' }
                }
            ]
        });

        expect(plan.results).toMatchObject({ updated: 1, fieldsImported: 1, fieldsSkipped: 0 });
        expect(plan.operations[0].payload.profile.customFields).toEqual({
            grade: '7',
            note: 'keep'
        });
    });

    it('skips blank, unsupported, and invalid configured roster field answers without failing import', () => {
        const plan = planRegistrationRosterImport({
            source: { type: 'sports-connect', id: 'league-1' },
            fields: [
                { key: 'grade', label: 'Grade', type: 'text', visibility: 'team' },
                { key: 'position', label: 'Position', type: 'menu', visibility: 'team', options: [{ value: 'pg', label: 'Point Guard' }] },
                { key: 'height', label: 'Height', type: 'number', visibility: 'team' }
            ],
            sourcePlayers: [
                {
                    externalPlayerId: 'ext-1',
                    name: 'Avery Lee',
                    answers: { grade: '', position: 'Center', height: '60' }
                }
            ],
            existingPlayers: [
                {
                    id: 'player-1',
                    name: 'Avery Lee',
                    profile: { customFields: { grade: '5', position: 'pg' } },
                    sourceMetadata: { sourceType: 'sports-connect', sourceId: 'league-1', externalPlayerId: 'ext-1' }
                }
            ]
        });

        expect(plan.results).toMatchObject({ updated: 1, fieldsImported: 0, fieldsSkipped: 3 });
        expect(plan.results.fieldSkipReasons).toEqual({ blank: 1, invalid: 1, unsupported: 1 });
        expect(plan.operations[0].payload.profile).toBeUndefined();
    });

    it('keeps admin-only roster field imports out of the public player profile payload', () => {
        const plan = planRegistrationRosterImport({
            source: { type: 'sports-connect', id: 'league-1' },
            fields: [{ key: 'lockerCode', label: 'Locker Code', type: 'text', visibility: 'admins' }],
            sourcePlayers: [{ externalPlayerId: 'ext-1', name: 'Avery Lee', answers: { 'Locker Code': 'A-12' } }]
        });

        expect(plan.results).toMatchObject({ added: 1, fieldsImported: 1, fieldsSkipped: 0 });
        expect(plan.operations[0].payload.profile).toBeUndefined();
        expect(plan.operations[0].privateRosterFields).toEqual({ lockerCode: 'A-12' });
    });

    it('formats import result counts for the UI', () => {
        expect(formatRegistrationRosterImportResults({ added: 2, updated: 1, skipped: 0, conflicted: 3 }))
            .toBe('2 added, 1 updated, 0 skipped, 3 conflicted');
        expect(formatRegistrationRosterImportResults({ added: 1, updated: 0, skipped: 0, conflicted: 0, fieldsImported: 2, fieldsSkipped: 1, fieldSkipReasons: { invalid: 1 } }))
            .toBe('1 added, 0 updated, 0 skipped, 0 conflicted, 2 configured field values imported, 1 configured field value skipped, skipped: 1 invalid option/date/checkbox');
    });
});

describe('registration roster import wiring', () => {
    it('shows the manual re-import action and routes through the shared helper', () => {
        const source = readEditRoster();

        expect(source).toContain('id="registration-roster-import"');
        expect(source).toContain('Re-import Roster');
        expect(source).toContain("import { formatRegistrationRosterImportResults, getRegistrationRosterPlayers, isExternallyLinkedRosterTeam, planRegistrationRosterImport } from './js/edit-roster-registration-import.js?v=1';");
        expect(source).toContain('planRegistrationRosterImport({');
        expect(source).toContain('fields: rosterFieldDefinitions');
        expect(source).toContain('setPlayerPrivateRosterProfileFields(currentTeamId, playerId, operation.privateRosterFields)');
        expect(source).toContain('function getPlayerImportSourceType');
        expect(source).toContain('player.registrationSource?.externalPlayerId');
        expect(source).toContain('player.externalPlayerId');
        expect(source).toContain('Local-only');
    });
});
