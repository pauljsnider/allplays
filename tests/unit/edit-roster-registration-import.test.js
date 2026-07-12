import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    formatRegistrationRosterImportResults,
    getRegistrationRosterPlayers,
    hasConfiguredRegistrationProviderMetadata,
    isExternallyLinkedRosterTeam,
    planRegistrationRosterImport
} from '../../js/edit-roster-registration-import.js';

function readEditRoster() {
    return readFileSync(new URL('../../edit-roster.html', import.meta.url), 'utf8');
}

describe('registration roster import planning', () => {
    it('distinguishes configured provider metadata from stored import snapshots', () => {
        expect(hasConfiguredRegistrationProviderMetadata({})).toBe(false);
        expect(hasConfiguredRegistrationProviderMetadata({ registrationSourceId: 'sports-connect' })).toBe(true);
        expect(hasConfiguredRegistrationProviderMetadata({ registrationSource: { provider: 'Sports Connect', externalTeamId: 'team-123' } })).toBe(true);
        expect(hasConfiguredRegistrationProviderMetadata({ registrationProvider: { providerName: 'Sports Connect', externalTeamId: 'team-legacy' } })).toBe(true);
        expect(isExternallyLinkedRosterTeam({})).toBe(false);
        expect(isExternallyLinkedRosterTeam({ registrationSourceId: 'sports-connect' })).toBe(false);
        expect(isExternallyLinkedRosterTeam({ registrationSource: { rosterPlayers: [{ id: 'p1' }] } })).toBe(true);
        expect(isExternallyLinkedRosterTeam({ registrationSource: { players: [{ id: 'p1' }] } })).toBe(true);
        expect(isExternallyLinkedRosterTeam({ registrationSource: { roster: [{ id: 'p1' }] } })).toBe(true);
        expect(isExternallyLinkedRosterTeam({ externalRosterPlayers: [{ id: 'p1' }] })).toBe(true);
        expect(getRegistrationRosterPlayers({ registrationRosterSnapshot: { players: [{ id: 'p0' }] } })).toEqual([{ id: 'p0' }]);
        expect(getRegistrationRosterPlayers({ registrationSourceSnapshot: { rosterPlayers: [{ id: 'p1' }] } })).toEqual([{ id: 'p1' }]);
        expect(getRegistrationRosterPlayers({ registrationSource: { rosterPlayers: [{ id: 'p2' }] } })).toEqual([{ id: 'p2' }]);
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
            unchanged: 0,
            skipped: 1,
            conflicted: 1
        });
        expect(plan.results.conflicts).toEqual([{ externalPlayerId: 'ext-2', existingPlayerId: 'player-2', conflictType: 'name-number' }]);
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
            id: 'source-ext-3',
            type: 'add',
            payload: {
                name: 'Jordan Smith',
                number: '7',
                sourceMetadata: {
                    externalPlayerId: 'ext-3'
                }
            }
        });
        expect(plan.previewRows.map((row) => row.status)).toEqual(['update', 'conflict', 'add']);
    });

    it('labels exact source matches as unchanged and avoids unnecessary writes', () => {
        const plan = planRegistrationRosterImport({
            source: { type: 'sports-connect', id: 'league-1' },
            sourcePlayers: [
                {
                    externalPlayerId: 'ext-1',
                    name: 'Avery Lee',
                    number: '4',
                    guardians: [{ name: 'Pat Lee', email: 'pat@example.com', relation: 'Parent' }]
                }
            ],
            existingPlayers: [
                {
                    id: 'player-1',
                    name: 'Avery Lee',
                    number: '4',
                    active: true,
                    guardians: [{ name: 'Pat Lee', email: 'pat@example.com', phone: '', relation: 'Parent' }],
                    sourceMetadata: { sourceType: 'sports-connect', sourceId: 'league-1', externalPlayerId: 'ext-1', importedAt: '2026-01-01T00:00:00.000Z' }
                }
            ]
        });

        expect(plan.results).toMatchObject({ added: 0, updated: 0, unchanged: 1, skipped: 0, conflicted: 0 });
        expect(plan.operations).toHaveLength(0);
        expect(plan.previewRows).toMatchObject([
            {
                status: 'unchanged',
                externalPlayerId: 'ext-1',
                playerName: 'Avery Lee',
                existingPlayerId: 'player-1',
                sourceMetadata: { sourceType: 'sports-connect', sourceId: 'league-1', externalPlayerId: 'ext-1' }
            }
        ]);
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

    it('allows new sibling imports to reuse an existing parent contact without flagging a conflict', () => {
        const plan = planRegistrationRosterImport({
            source: { type: 'sports-connect', id: 'league-1' },
            sourcePlayers: [
                {
                    externalPlayerId: 'ext-2',
                    name: 'New Player',
                    guardians: [{ name: 'Pat Lee', email: 'pat@example.com', relation: 'Parent' }]
                }
            ],
            existingPlayers: [
                {
                    id: 'player-1',
                    name: 'Avery Lee',
                    guardians: [{ name: 'Pat Lee', email: 'PAT@example.com', relation: 'Parent' }]
                }
            ]
        });

        expect(plan.results).toMatchObject({ added: 1, updated: 0, skipped: 0, conflicted: 0 });
        expect(plan.results.conflicts).toEqual([]);
        expect(plan.operations).toHaveLength(1);
        expect(plan.operations[0]).toMatchObject({
            id: 'source-ext-2',
            type: 'add',
            payload: {
                name: 'New Player',
                guardians: [{ name: 'Pat Lee', email: 'pat@example.com', phone: '', relation: 'Parent' }]
            }
        });
        expect(plan.previewRows.map((row) => row.status)).toEqual(['add']);
    });

    it('preserves full roster family contacts on add operations for invite workflows', () => {
        const plan = planRegistrationRosterImport({
            source: { type: 'sports-connect', id: 'league-1' },
            sourcePlayers: [
                {
                    externalPlayerId: 'ext-4',
                    firstName: 'Taylor',
                    lastName: 'Reed',
                    jerseyNumber: '22',
                    guardians: [
                        { fullName: 'Pat Reed', email: 'PAT@example.com', phoneNumber: '555-1000', relationship: 'Mother' },
                        { displayName: 'Chris Reed', emailAddress: 'CHRIS@example.com', mobilePhone: '555-2000', type: 'Father' }
                    ],
                    contacts: [
                        { name: 'Dana Reed', email: 'DANA@example.com', phone: '555-3000', relation: 'Emergency Contact' }
                    ]
                }
            ]
        });

        const guardians = [
            { name: 'Pat Reed', email: 'pat@example.com', phone: '555-1000', relation: 'Mother' },
            { name: 'Chris Reed', email: 'chris@example.com', phone: '555-2000', relation: 'Father' }
        ];
        const contacts = [
            { name: 'Dana Reed', email: 'dana@example.com', phone: '555-3000', relation: 'Emergency Contact' }
        ];

        expect(plan.results).toMatchObject({ added: 1, updated: 0, skipped: 0, conflicted: 0 });
        expect(plan.operations).toHaveLength(1);
        expect(plan.operations[0]).toMatchObject({
            id: 'source-ext-4',
            type: 'add',
            payload: {
                name: 'Taylor Reed',
                number: '22',
                guardians,
                contacts,
                sourceMetadata: {
                    sourceType: 'sports-connect',
                    sourceId: 'league-1',
                    externalPlayerId: 'ext-4'
                }
            }
        });
        expect(plan.previewRows[0]).toMatchObject({
            status: 'add',
            playerName: 'Taylor Reed',
            number: '22',
            guardians,
            contacts
        });
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
        expect(plan.operations[0].payload.profile).toBeUndefined();
        expect(plan.operations[0].privateRosterFields).toEqual({
            grade: '6',
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
        expect(plan.operations[0].payload.profile).toBeUndefined();
        expect(plan.operations[0].privateRosterFields).toEqual({ grade: '7' });
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
        expect(formatRegistrationRosterImportResults({ added: 2, updated: 1, unchanged: 4, skipped: 0, conflicted: 3 }))
            .toBe('2 added, 1 updated, 4 unchanged, 0 skipped, 3 conflicted');
        expect(formatRegistrationRosterImportResults({ added: 1, updated: 0, unchanged: 0, skipped: 0, conflicted: 0, fieldsImported: 2, fieldsSkipped: 1, fieldSkipReasons: { invalid: 1 } }))
            .toBe('1 added, 0 updated, 0 unchanged, 0 skipped, 0 conflicted, 2 configured field values imported, 1 configured field value skipped, skipped: 1 invalid option/date/checkbox');
    });
});

describe('bulk AI roster update wiring', () => {
    it('instructs AI roster parsing to update likely existing players instead of duplicating them', () => {
        const source = readEditRoster();

        expect(source).toContain('Current player records: ${JSON.stringify(playersContext)}');
        expect(source).toContain('Compare each extracted player to the current player records before choosing an action');
        expect(source).toContain('Use action="update" with playerId and changes when an extracted player matches an existing player by the same number, same normalized name, or a likely name/number correction');
        expect(source).toContain('Use action="add" with player object only when no reasonable current player match exists');
        expect(source).toContain('Never add a second active player for a likely update to an existing player');
        expect(source).not.toContain('For each player, create an operation with action="add"');
    });

    it('supports text-only AI roster imports with a structured add/update response contract', () => {
        const source = readEditRoster();

        expect(source).toContain('Upload roster image (optional)');
        expect(source).toContain('id="bulk-text-input"');
        expect(source).toContain("if (!textInput && !imageFile)");
        expect(source).toContain("alert('Please upload an image or paste roster text')");
        expect(source).toContain("const imageFile = document.getElementById('roster-image-input').files[0];");
        expect(source).toContain("Extract ALL players ${imageFile ? 'from the image' : 'from the text'}");
        expect(source).toContain('let promptParts = [promptText];');
        expect(source).toContain('if (imageFile) {');
        expect(source).toContain('promptParts.push(imagePart);');
        expect(source).toContain('operations: Schema.array({');
        expect(source).toContain('action: Schema.string()');
        expect(source).toContain('playerId: Schema.string()');
        expect(source).toContain('const changesSchema = buildBulkAiPlayerSchema(Schema, { requireName: false });');
        expect(source).toContain('changes: changesSchema');
        expect(source).toContain('responseMimeType: "application/json"');
        expect(source).toContain('responseSchema: jsonSchema');
    });
});

describe('registration roster import wiring', () => {
    it('shows the manual re-import action and routes through the shared helper', () => {
        const source = readEditRoster();

        expect(source).toContain('id="registration-roster-import"');
        expect(source).toContain('id="registration-roster-import-title"');
        expect(source).toContain('Import stored registration roster');
        expect(source).toContain('Preview Import');
        expect(source).toContain("import { formatRegistrationRosterImportResults, getRegistrationRosterPlayers, hasConfiguredRegistrationProviderMetadata, isExternallyLinkedRosterTeam, planRegistrationRosterImport } from './js/edit-roster-registration-import.js?v=2';");
        expect(source).toContain('hasConfiguredRegistrationProviderMetadata(team)');
        expect(source).toContain('Registration provider metadata saved');
        expect(source).toContain('Use Edit Team to re-import from Sports Connect when the snapshot needs a refresh.');
        expect(source).toContain('Sports Connect metadata is saved for this team, but provider-based roster import requires a stored roster snapshot.');
        expect(source).toContain('Run Re-import from Sports Connect on Edit Team, then return here to preview it.');
        expect(source).toContain('Provider-based roster import requires an existing registration roster snapshot before import can proceed.');
        expect(source).toContain('Run Re-import from Sports Connect on Edit Team, then return here to preview and import the saved roster.');
        expect(source).toContain('Load or save a registration roster snapshot for this team before importing.');
        expect(source).not.toContain('provider connector stores a roster snapshot');
        expect(source).not.toContain('A live connector must create a stored roster snapshot');
        expect(source).not.toContain('Sports Connect live import requires a provider connector');
        expect(source).toContain('const hasImportableSnapshot = hasStoredSnapshot && sourcePlayers.length > 0;');
        expect(source).toContain("previewButton.classList.toggle('hidden', !hasImportableSnapshot);");
        expect(source).toContain("importButton.classList.toggle('hidden', !hasImportableSnapshot);");
        expect(source).toContain('previewButton.disabled = !hasImportableSnapshot;');
        expect(source).toContain('previewButton.setAttribute(\'aria-disabled\', String(previewButton.disabled));');
        expect(source).toContain('importButton.setAttribute(\'aria-disabled\', \'true\');');
        expect(source).toContain('importButton.setAttribute(\'aria-disabled\', String(importButton.disabled));');
        expect(source).toContain('button.setAttribute(\'aria-disabled\', String(button.disabled));');
        expect(source).toContain('No stored registration roster snapshot is available yet.');
        expect(source).toContain('planRegistrationRosterImport({');
        expect(source).toContain('renderRegistrationRosterImportPreview');
        expect(source).toContain('registration-roster-import-row');
        expect(source).toContain('selectedOperationIds');
        expect(source).toContain('Conflicted rows are skipped automatically');
        expect(source).toContain('fields: rosterFieldDefinitions');
        expect(source).toContain('setPlayerPrivateRosterProfileFields(currentTeamId, playerId, operation.privateRosterFields || {}, operation.privateFamilyContacts || {})');
        expect(source).toContain('function getPlayerImportSourceType');
        expect(source).toContain('player.registrationSource?.externalPlayerId');
        expect(source).toContain('player.externalPlayerId');
        expect(source).toContain('Local-only');
    });

    it('surfaces delegated household contacts on roster rows', () => {
        const source = readEditRoster();

        expect(source).toContain('Household Contacts');
        expect(source).toContain("parent?.source === 'household'");
        expect(source).toContain('invited by');
        expect(source).toContain("contact.status || 'active'");
    });
});
