import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildFullRosterCsvTemplate, planRosterCsvImport, splitRosterProfileValuesByVisibility, summarizeRosterContactInviteResults } from '../../js/roster-profile-fields.js';

describe('roster CSV import planning', () => {
    const fields = [
        { key: 'grade', label: 'Grade', type: 'menu', visibility: 'public', options: ['5', '6', '7'].map((value) => ({ value, label: value })), active: true },
        { key: 'throwsRight', label: 'Throws Right', type: 'checkbox', visibility: 'public', active: true },
        { key: 'birthDate', label: 'Birth Date', type: 'date', visibility: 'team', active: true },
        { key: 'medicalNote', label: 'Medical Note', type: 'text', visibility: 'admins', active: true }
    ];

    it('creates and updates players from core and roster field columns', () => {
        const plan = planRosterCsvImport({
            fields,
            existingPlayers: [{ id: 'p1', name: 'Avery Lee', number: '3', profile: { customFields: { grade: '5', birthDate: '2011-01-01', medicalNote: 'Old note' } } }],
            csvText: 'Name,Number,Grade,Throws Right,Birth Date,Medical Note\nAvery Lee,4,6,yes,2014-02-03,Allergy\nSam Jones,12,7,no,2013-09-01,'
        });

        expect(plan.errors).toEqual([]);
        expect(plan.operations).toHaveLength(2);
        expect(plan.operations[0]).toMatchObject({
            type: 'update',
            playerId: 'p1',
            payload: {
                name: 'Avery Lee',
                number: '4',
                profile: { customFields: { grade: '6', throwsRight: true } }
            },
            privateRosterFields: { birthDate: '2014-02-03' }
        });
        expect(plan.operations[0].payload.profile.customFields).not.toHaveProperty('birthDate');
        expect(plan.operations[0].payload.profile.customFields).not.toHaveProperty('medicalNote');
        expect(JSON.stringify(plan.operations)).not.toContain('Allergy');

        expect(plan.operations[1]).toMatchObject({
            type: 'add',
            payload: {
                name: 'Sam Jones',
                number: '12',
                profile: { customFields: { grade: '7', throwsRight: false } }
            },
            privateRosterFields: { birthDate: '2013-09-01' }
        });
    });

    it('preserves existing jersey numbers when the CSV omits the number header', () => {
        const plan = planRosterCsvImport({
            fields,
            existingPlayers: [{ id: 'p1', name: 'Avery Lee', number: '3', profile: { customFields: { grade: '5' } } }],
            csvText: 'Name,Grade\nAvery Lee,6'
        });

        expect(plan.errors).toEqual([]);
        expect(plan.operations).toHaveLength(1);
        expect(plan.operations[0]).toMatchObject({
            type: 'update',
            playerId: 'p1',
            payload: {
                name: 'Avery Lee',
                profile: { customFields: { grade: '6' } }
            }
        });
        expect(plan.operations[0].payload).not.toHaveProperty('number');
    });

    it('accepts configured field keys as headers and rejects unknown headers', () => {
        const valid = planRosterCsvImport({ fields, csvText: 'playerName,jersey,throwsRight\nAvery Lee,4,true' });
        expect(valid.errors).toEqual([]);
        expect(valid.operations[0].payload.profile.customFields.throwsRight).toBe(true);

        const invalid = planRosterCsvImport({ fields, csvText: 'Name,Favorite Snack\nAvery Lee,Crackers' });
        expect(invalid.errors).toEqual([
            'Unknown CSV header "Favorite Snack". Use Name, Number, a supported player profile header, a supported parent/guardian contact header, or a configured roster field label/key.'
        ]);
        expect(invalid.operations).toEqual([]);
    });

    it('maps common unconfigured player profile columns into the import payload', () => {
        const plan = planRosterCsvImport({
            fields: [],
            existingPlayers: [{
                id: 'p1',
                name: 'Avery Lee',
                number: '3',
                profile: {
                    address: { city: 'Old City' },
                    customFields: { grade: '6' }
                }
            }],
            csvText: [
                'Name,Jersey,Position,Date of Birth,Gender,Street,Address1,Address Line 2,City,State,Zip,Roster Status',
                'Avery Lee,4,Forward,2014-02-03,Female,123 Main,PO Box 8,Apt 2,Kansas City,MO,64110,Player',
                'Coach Kim,,Coach,,Female,,,,,,,Staff'
            ].join('\n')
        });

        expect(plan.errors).toEqual([]);
        expect(plan.operations).toHaveLength(2);
        expect(plan.operations[0]).toMatchObject({
            type: 'update',
            playerId: 'p1',
            payload: {
                name: 'Avery Lee',
                number: '4',
                position: 'Forward',
                profile: {
                    position: 'Forward',
                    birthDate: '2014-02-03',
                    gender: 'Female',
                    address: {
                        street: '123 Main',
                        address1: 'PO Box 8',
                        address2: 'Apt 2',
                        city: 'Kansas City',
                        state: 'MO',
                        zip: '64110'
                    },
                    rosterStatus: 'player',
                    isStaff: false,
                    nonPlayer: false,
                    customFields: { grade: '6' }
                }
            }
        });
        expect(plan.operations[1]).toMatchObject({
            type: 'add',
            payload: {
                name: 'Coach Kim',
                position: 'Coach',
                profile: {
                    position: 'Coach',
                    gender: 'Female',
                    rosterStatus: 'staff',
                    isStaff: true,
                    nonPlayer: true
                }
            }
        });
    });

    it('keeps configured roster fields ahead of built-in profile aliases', () => {
        const plan = planRosterCsvImport({
            fields: [
                { key: 'position', label: 'Position', type: 'text', visibility: 'public', active: true },
                { key: 'gender', label: 'Gender', type: 'text', visibility: 'public', active: true }
            ],
            csvText: 'Name,Position,Gender\nAvery Lee,Forward,Female'
        });

        expect(plan.errors).toEqual([]);
        expect(plan.operations).toHaveLength(1);
        expect(plan.operations[0]).toMatchObject({
            payload: {
                name: 'Avery Lee',
                profile: {
                    customFields: {
                        position: 'Forward',
                        gender: 'Female'
                    }
                }
            }
        });
        expect(plan.operations[0].payload).not.toHaveProperty('position');
        expect(plan.operations[0].payload.profile).not.toHaveProperty('gender');
    });

    it('normalizes staff and non-player status flag aliases', () => {
        const staffPlan = planRosterCsvImport({
            fields: [],
            csvText: [
                'Name,Staff?',
                'Coach Kim,yes',
                'Avery Lee,no'
            ].join('\n')
        });

        expect(staffPlan.errors).toEqual([]);
        expect(staffPlan.operations.map((operation) => operation.payload.profile)).toEqual([
            expect.objectContaining({ rosterStatus: 'staff', isStaff: true, nonPlayer: true }),
            expect.objectContaining({ rosterStatus: 'player', isStaff: false, nonPlayer: false })
        ]);

        const nonPlayerPlan = planRosterCsvImport({
            fields: [],
            csvText: [
                'Name,Non Player',
                'Alex Manager,true',
                'Avery Lee,false'
            ].join('\n')
        });

        expect(nonPlayerPlan.errors).toEqual([]);
        expect(nonPlayerPlan.operations.map((operation) => operation.payload.profile)).toEqual([
            expect.objectContaining({ rosterStatus: 'non-player', isStaff: false, nonPlayer: true }),
            expect.objectContaining({ rosterStatus: 'player', isStaff: false, nonPlayer: false })
        ]);
    });

    it('rejects invalid built-in profile dates, status flags, and duplicate profile aliases', () => {
        const duplicate = planRosterCsvImport({
            fields: [],
            csvText: 'Name,DOB,Birthday\nAvery Lee,2014-02-03,2014-02-03'
        });
        expect(duplicate.errors).toEqual(['Duplicate player profile header for Birthday.']);
        expect(duplicate.operations).toEqual([]);

        const invalid = planRosterCsvImport({
            fields: [],
            csvText: 'Name,DOB,Staff?\nAvery Lee,02/03/2014,maybe'
        });

        expect(invalid.operations).toEqual([]);
        expect(invalid.errors).toEqual([
            'Row 2: DOB must use YYYY-MM-DD format.',
            'Row 2: Staff? must be yes/no or a supported roster status.'
        ]);
    });

    it('imports parent, guardian, and contact columns with invite metadata', () => {
        const plan = planRosterCsvImport({
            fields,
            csvText: [
                'Name,Number,Parent Name,Parent Email,Parent Phone,Parent Relation,Contact Name,Contact Email,Contact Phone',
                'Avery Lee,4,Pat Lee,PAT@example.com,555-0101,Mother,Aunt Kim,kim@example.com,555-0199'
            ].join('\n')
        });

        expect(plan.errors).toEqual([]);
        expect(plan.operations).toHaveLength(1);
        expect(plan.operations[0]).toMatchObject({
            type: 'add',
            payload: {
                name: 'Avery Lee',
                number: '4'
            },
            privateFamilyContacts: {
                parents: [{
                    name: 'Pat Lee',
                    email: 'pat@example.com',
                    phone: '555-0101',
                    relation: 'Mother',
                    source: 'roster-csv'
                }],
                contacts: [{
                    name: 'Aunt Kim',
                    email: 'kim@example.com',
                    phone: '555-0199',
                    relation: 'Contact',
                    source: 'roster-csv'
                }]
            },
            familyContacts: [
                expect.objectContaining({ email: 'pat@example.com', relation: 'Mother' }),
                expect.objectContaining({ email: 'kim@example.com', relation: 'Contact' })
            ],
            inviteRequests: [
                { email: 'pat@example.com', displayName: 'Pat Lee', relation: 'Mother', phone: '555-0101' },
                { email: 'kim@example.com', displayName: 'Aunt Kim', relation: 'Contact', phone: '555-0199' }
            ]
        });
        expect(plan.operations[0].payload).not.toHaveProperty('guardians');
        expect(plan.operations[0].payload).not.toHaveProperty('contacts');
    });

    it('accepts common contact header aliases and numbered suffix placement', () => {
        const plan = planRosterCsvImport({
            fields,
            csvText: [
                'Name,Parent First Name,Parent Last Name,Parent Email Address,Parent Mobile Phone,Guardian Full Name 2,Guardian Email 2,Emergency Contact Name,Emergency Contact Phone Number',
                'Avery Lee,Pat,Lee,PAT@example.com,555-0101,Robin Lee,robin@example.com,Dr Smith,555-0999'
            ].join('\n')
        });

        expect(plan.errors).toEqual([]);
        expect(plan.operations).toHaveLength(1);
        expect(plan.operations[0]).toMatchObject({
            privateFamilyContacts: {
                parents: [
                    {
                        name: 'Pat Lee',
                        email: 'pat@example.com',
                        phone: '555-0101',
                        relation: 'Parent',
                        source: 'roster-csv'
                    },
                    {
                        name: 'Robin Lee',
                        email: 'robin@example.com',
                        phone: '',
                        relation: 'Guardian',
                        source: 'roster-csv'
                    }
                ],
                contacts: [{
                    name: 'Dr Smith',
                    email: '',
                    phone: '555-0999',
                    relation: 'Emergency Contact',
                    source: 'roster-csv'
                }]
            },
            inviteRequests: [
                { email: 'pat@example.com', displayName: 'Pat Lee', relation: 'Parent', phone: '555-0101' },
                { email: 'robin@example.com', displayName: 'Robin Lee', relation: 'Guardian', phone: '' }
            ]
        });
    });

    it('rejects duplicate contact headers after alias normalization', () => {
        const plan = planRosterCsvImport({
            fields,
            csvText: 'Name,Parent Phone,Parent Phone Number\nAvery Lee,555-0101,555-0102'
        });

        expect(plan.errors).toEqual(['Duplicate contact header for Parent Phone Number.']);
        expect(plan.operations).toEqual([]);
    });

    it('rejects contact identity conflicts within a CSV row', () => {
        const plan = planRosterCsvImport({
            fields,
            csvText: [
                'Name,Parent Name,Parent Email,Guardian Name,Guardian Email,Contact Name,Contact Phone,Emergency Contact Name,Emergency Contact Phone',
                'Avery Lee,Pat Lee,family@example.com,Robin Lee,family@example.com,Aunt Kim,555-0101,Uncle Kim,555-0101'
            ].join('\n')
        });

        expect(plan.operations).toEqual([]);
        expect(plan.errors).toEqual([
            'Row 2: contact email family@example.com has conflicting name/relation values (Pat Lee (Parent) vs Robin Lee (Guardian)).',
            'Row 2: contact phone 555-0101 has conflicting name/relation values (Aunt Kim (Contact) vs Uncle Kim (Emergency Contact)).'
        ]);
    });

    it('compares populated duplicate contacts after a sparse duplicate identity', () => {
        const plan = planRosterCsvImport({
            fields,
            csvText: [
                'Name,Parent Email,Parent 2 Name,Parent 2 Email,Parent 3 Name,Parent 3 Email',
                'Avery Lee,family@example.com,Pat Lee,family@example.com,Robin Lee,family@example.com'
            ].join('\n')
        });

        expect(plan.operations).toEqual([]);
        expect(plan.errors).toEqual([
            'Row 2: contact email family@example.com has conflicting name values (Pat Lee (Parent) vs Robin Lee (Parent)).'
        ]);
    });

    it('merges imported guardian contacts onto existing player updates without duplicates', () => {
        const plan = planRosterCsvImport({
            fields,
            existingPlayers: [{
                id: 'p1',
                name: 'Avery Lee',
                number: '3',
                guardians: [{ name: 'Pat Lee', email: 'pat@example.com', phone: '', relation: 'Parent' }]
            }],
            csvText: [
                'Name,Parent Name,Parent Email,Guardian Name,Guardian Email',
                'Avery Lee,Pat Lee,pat@example.com,Robin Lee,robin@example.com'
            ].join('\n')
        });

        expect(plan.errors).toEqual([]);
        expect(plan.operations).toHaveLength(1);
        expect(plan.operations[0]).toMatchObject({
            type: 'update',
            playerId: 'p1',
            privateFamilyContacts: {
                parents: [
                    expect.objectContaining({ email: 'pat@example.com', relation: 'Parent' }),
                    expect.objectContaining({ email: 'robin@example.com', relation: 'Guardian' })
                ]
            },
            inviteRequests: [
                { email: 'pat@example.com', displayName: 'Pat Lee', relation: 'Parent', phone: '' },
                { email: 'robin@example.com', displayName: 'Robin Lee', relation: 'Guardian', phone: '' }
            ]
        });
        expect(plan.operations[0].payload).not.toHaveProperty('guardians');
    });

    it('deduplicates new contacts against the private roster contact projection', () => {
        const plan = planRosterCsvImport({
            fields,
            existingPlayers: [{
                id: 'p1',
                name: 'Avery Lee',
                privateProfileParents: [{ name: 'Pat Lee', email: 'pat@example.com', relation: 'Parent', source: 'roster-csv' }],
                privateProfileContacts: [{ name: 'Aunt Kim', email: 'kim@example.com', relation: 'Contact', source: 'roster-csv' }]
            }],
            csvText: [
                'Name,Parent Name,Parent Email,Contact Name,Contact Email',
                'Avery Lee,Pat Lee,pat@example.com,Aunt Kim,kim@example.com'
            ].join('\n')
        });

        expect(plan.errors).toEqual([]);
        expect(plan.operations[0].privateFamilyContacts).toEqual({
            parents: [{ name: 'Pat Lee', email: 'pat@example.com', phone: '', relation: 'Parent', source: 'roster-csv' }],
            contacts: [{ name: 'Aunt Kim', email: 'kim@example.com', phone: '', relation: 'Contact', source: 'roster-csv' }]
        });
    });

    it('returns actionable row validation errors without producing operations', () => {
        const plan = planRosterCsvImport({
            fields,
            csvText: 'Name,Grade,Throws Right,Birth Date\nAvery Lee,8,maybe,02/03/2014\n,6,yes,2014-02-03'
        });

        expect(plan.operations).toEqual([]);
        expect(plan.errors).toEqual([
            'Row 2: Grade must be one of: 5, 6, 7.',
            'Row 2: Throws Right must be yes/no.',
            'Row 2: Birth Date must use YYYY-MM-DD format.',
            'Row 3: player name is required.'
        ]);
    });

    it('splits parent-readable private field values away from public player payloads without storing admin-only values', () => {
        expect(splitRosterProfileValuesByVisibility(fields, { grade: '6', birthDate: '2014-02-03', medicalNote: 'private' }, { includeAdminPrivate: false })).toEqual({
            publicValues: { grade: '6' },
            privateValues: { birthDate: '2014-02-03' }
        });
    });

    it('describes parent and guardian contact columns in the roster CSV import UI', () => {
        const page = readFileSync('edit-roster.html', 'utf8');
        const dbSource = readFileSync('js/db.js', 'utf8');

        expect(page).toContain('profile columns such as Position, DOB, Gender, or Address');
        expect(page).toContain('parent/guardian/contact columns such as Parent Email or Guardian Phone');
        expect(page).toContain('Name,Number,Position,DOB,Parent Name,Parent Email,Grade');
        expect(page).toContain('download-roster-template-btn');
        expect(page).toContain('roster-csv-send-invites');
        expect(page).toContain('csv-import-preview');
        expect(page).toContain('renderRosterCsvReview(plan)');
        expect(page).toContain('sendImportedRosterContactInvite');
        expect(page).toContain('operation.inviteRequests || []');
        expect(page).toContain('Send / resend invite');
        expect(page).toContain('Linked account');
        expect(page).toContain('applyRosterCsvImportOperations(currentTeamId, plan.operations)');
        expect(dbSource).toContain('export async function applyRosterCsvImportOperations');
        expect(dbSource).toContain('export async function getPlayersWithPrivateRosterContacts');
        expect(page).toContain('getPlayersWithPrivateRosterContacts(currentTeamId, { includeInactive: true })');
        expect(dbSource).toContain("if (plannedOperations.length > 200)");
        expect(dbSource).toContain('await batch.commit();');
    });

    it('builds a full roster template with family contacts and configured fields', () => {
        const template = buildFullRosterCsvTemplate(fields);

        expect(template).toContain('Name,Number,Position,DOB,Gender,Address,City,State,Zip,Roster Status');
        expect(template).toContain('Parent Name,Parent Relation,Parent Email,Parent Phone');
        expect(template).toContain('Guardian 2 Name,Guardian 2 Relation,Guardian 2 Email,Guardian 2 Phone');
        expect(template).toContain('Grade,Throws Right,Birth Date,Medical Note');
        expect(template).toContain('Avery Lee,4,Forward,2014-02-03');
    });

    it('summarizes imported contact invitation outcomes for retry UX', () => {
        expect(summarizeRosterContactInviteResults([
            { status: 'sent' },
            { status: 'sent' },
            { status: 'linked' },
            { status: 'code-created' },
            { status: 'failed' }
        ])).toEqual({ sent: 2, linked: 1, codeCreated: 1, failed: 1 });
    });
});
