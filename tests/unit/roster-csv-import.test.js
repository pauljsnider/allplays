import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { planRosterCsvImport, splitRosterProfileValuesByVisibility } from '../../js/roster-profile-fields.js';

describe('roster CSV import planning', () => {
    const fields = [
        { key: 'grade', label: 'Grade', type: 'menu', options: ['5', '6', '7'].map((value) => ({ value, label: value })), active: true },
        { key: 'throwsRight', label: 'Throws Right', type: 'checkbox', active: true },
        { key: 'birthDate', label: 'Birth Date', type: 'date', active: true },
        { key: 'medicalNote', label: 'Medical Note', type: 'text', visibility: 'admins', active: true }
    ];

    it('creates and updates players from core and roster field columns', () => {
        const plan = planRosterCsvImport({
            fields,
            existingPlayers: [{ id: 'p1', name: 'Avery Lee', number: '3', profile: { customFields: { grade: '5' } } }],
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
                profile: { customFields: { grade: '6', throwsRight: true, birthDate: '2014-02-03' } }
            },
            privateRosterFields: { medicalNote: 'Allergy' }
        });
        expect(plan.operations[1]).toMatchObject({
            type: 'add',
            payload: {
                name: 'Sam Jones',
                number: '12',
                profile: { customFields: { grade: '7', throwsRight: false, birthDate: '2013-09-01' } }
            }
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
            'Unknown CSV header "Favorite Snack". Use Name, Number, a supported parent/guardian contact header, or a configured roster field label/key.'
        ]);
        expect(invalid.operations).toEqual([]);
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
                number: '4',
                guardians: [{
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
            payload: {
                guardians: [
                    expect.objectContaining({ email: 'pat@example.com', relation: 'Parent' }),
                    expect.objectContaining({ email: 'robin@example.com', relation: 'Guardian' })
                ]
            },
            inviteRequests: [
                { email: 'pat@example.com', displayName: 'Pat Lee', relation: 'Parent', phone: '' },
                { email: 'robin@example.com', displayName: 'Robin Lee', relation: 'Guardian', phone: '' }
            ]
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

    it('splits admin-only field values away from public player payloads', () => {
        expect(splitRosterProfileValuesByVisibility(fields, { grade: '6', medicalNote: 'private' })).toEqual({
            publicValues: { grade: '6' },
            privateValues: { medicalNote: 'private' }
        });
    });

    it('describes parent and guardian contact columns in the roster CSV import UI', () => {
        const page = readFileSync('edit-roster.html', 'utf8');

        expect(page).toContain('parent/guardian/contact columns such as Parent Email or Guardian Phone');
        expect(page).toContain('Name,Number,Parent Name,Parent Email,Grade');
    });
});
