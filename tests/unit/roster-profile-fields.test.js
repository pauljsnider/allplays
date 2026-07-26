import { describe, expect, it } from 'vitest';
import {
    buildRosterFieldDefinitionPayload,
    collectRosterParentContacts,
    getStandardRosterFieldDefinitions,
    getRosterProfileValues,
    mergeRosterParentContacts,
    mergeStandardRosterFieldDefinitions,
    normalizeRosterFieldDefinitions,
    planRosterAiImport,
    splitRosterProfileValuesByVisibility,
    validateRosterProfileValues
} from '../../js/roster-profile-fields.js';

describe('roster profile fields', () => {
    it('normalizes supported configured field shapes in display order', () => {
        const fields = normalizeRosterFieldDefinitions([
            { id: 'gradYear', label: 'Graduation Year', type: 'select', options: ['2028', { value: '2029', label: 'Class of 2029' }], sortOrder: 2 },
            { key: 'waiver', name: 'Waiver Complete', type: 'boolean', required: true, order: 1 },
            { title: 'Birth Date', type: 'date', required: true, order: 3 }
        ]);

        expect(fields).toEqual([
            expect.objectContaining({ key: 'waiver', label: 'Waiver Complete', type: 'checkbox', required: true }),
            expect.objectContaining({ key: 'gradYear', label: 'Graduation Year', type: 'menu', options: [
                { value: '2028', label: '2028' },
                { value: '2029', label: 'Class of 2029' }
            ] }),
            expect.objectContaining({ key: 'birth-date', label: 'Birth Date', type: 'date', required: true })
        ]);
    });

    it('validates required text, menu, date, and checkbox values', () => {
        const fields = normalizeRosterFieldDefinitions([
            { key: 'nickname', label: 'Nickname', type: 'text', required: true },
            { key: 'position', label: 'Position', type: 'menu', required: true },
            { key: 'birthDate', label: 'Birth Date', type: 'date', required: true },
            { key: 'waiver', label: 'Waiver Complete', type: 'checkbox', required: true }
        ]);

        expect(validateRosterProfileValues(fields, {
            nickname: 'Sam',
            position: 'Guard',
            birthDate: '2012-04-30',
            waiver: true
        })).toEqual([]);

        expect(validateRosterProfileValues(fields, {
            nickname: ' ',
            position: '',
            birthDate: null,
            waiver: false
        })).toEqual([
            'Nickname is required.',
            'Position is required.',
            'Birth Date is required.',
            'Waiver Complete is required.'
        ]);
    });

    it('loads existing custom field values from all persisted roster profile shapes', () => {
        expect(getRosterProfileValues({ profile: { customFields: { position: 'Guard' } } })).toEqual({ position: 'Guard' });
        expect(getRosterProfileValues({ customFields: { position: 'Forward' } })).toEqual({ position: 'Forward' });
        expect(getRosterProfileValues({ rosterFieldValues: { grade: '6' } })).toEqual({ grade: '6' });
        expect(getRosterProfileValues({ privateProfileRosterFields: { birthDate: '2014-02-03' } })).toEqual({ birthDate: '2014-02-03' });
    });

    it('uses editable profile custom fields over imported roster field values', () => {
        expect(getRosterProfileValues({
            rosterFieldValues: { grade: '6', position: 'Forward' },
            profile: { customFields: { position: 'Guard' } }
        })).toEqual({ grade: '6', position: 'Guard' });
    });

    it('builds persisted roster field definitions with visibility and menu options', () => {
        expect(buildRosterFieldDefinitionPayload({
            label: 'Jersey Size',
            type: 'menu',
            options: ['Youth M', 'Adult S'],
            section: 'Uniform',
            required: true,
            defaultVisibility: 'parents',
            sortOrder: 3
        })).toEqual({
            key: 'jersey-size',
            label: 'Jersey Size',
            type: 'menu',
            section: 'Uniform',
            required: true,
            options: [
                { value: 'Youth M', label: 'Youth M' },
                { value: 'Adult S', label: 'Adult S' }
            ],
            description: '',
            visibility: 'parents',
            active: true,
            sortOrder: 3
        });
    });

    it('stores public roster field values separately from all restricted private roster field values', () => {
        const fields = normalizeRosterFieldDefinitions([
            { key: 'nickname', label: 'Nickname', visibility: 'public' },
            { key: 'birthDate', label: 'Birth Date', type: 'date', visibility: 'team' },
            { key: 'jerseySize', label: 'Jersey Size', visibility: 'parents' },
            { key: 'medicalNote', label: 'Medical Note', visibility: 'admins' }
        ]);

        expect(splitRosterProfileValuesByVisibility(fields, {
            nickname: 'Rocket',
            birthDate: '2014-02-03',
            jerseySize: 'YM',
            medicalNote: 'Peanut allergy'
        })).toEqual({
            publicValues: { nickname: 'Rocket' },
            privateValues: {
                birthDate: '2014-02-03',
                jerseySize: 'YM',
                medicalNote: 'Peanut allergy'
            }
        });
    });

    it('defaults unspecified roster field visibility to private team storage', () => {
        const fields = normalizeRosterFieldDefinitions([
            { key: 'grade', label: 'Grade' }
        ]);

        expect(splitRosterProfileValuesByVisibility(fields, { grade: '6' })).toEqual({
            publicValues: {},
            privateValues: { grade: '6' }
        });
    });

    it('keeps protected built-ins private when legacy definitions mark them public', () => {
        const fields = normalizeRosterFieldDefinitions([
            { key: 'nickname', label: 'Nickname', visibility: 'public' },
            { key: 'grade', label: 'Grade', visibility: 'public' },
            { key: 'memberId', label: 'Member ID', visibility: 'public' }
        ]);

        expect(splitRosterProfileValuesByVisibility(fields, {
            nickname: 'Rocket',
            grade: '6',
            memberId: 'AAU-42'
        })).toEqual({
            publicValues: { nickname: 'Rocket' },
            privateValues: { grade: '6', memberId: 'AAU-42' }
        });
    });

    it('excludes disabled definitions from player forms unless requested', () => {
        const fields = [
            { key: 'active', label: 'Active Field', type: 'text', active: true, sortOrder: 1 },
            { key: 'disabled', label: 'Disabled Field', type: 'text', active: false, sortOrder: 2 }
        ];

        expect(normalizeRosterFieldDefinitions(fields).map((field) => field.key)).toEqual(['active']);
        expect(normalizeRosterFieldDefinitions(fields, { includeInactive: true }).map((field) => field.key)).toEqual(['active', 'disabled']);
    });

    it('provides standard optional roster fields and lets team definitions override them', () => {
        expect(getStandardRosterFieldDefinitions().map((field) => field.key)).toEqual(expect.arrayContaining([
            'preferredName',
            'position',
            'birthDate',
            'gender',
            'grade',
            'school',
            'jerseySize',
            'memberId'
        ]));

        const merged = mergeStandardRosterFieldDefinitions([
            { key: 'position', label: 'Primary Position', type: 'text', visibility: 'team', sortOrder: 2 },
            { key: 'favoriteSnack', label: 'Favorite Snack', type: 'text', visibility: 'parents', sortOrder: 3 }
        ]);

        expect(merged.find((field) => field.key === 'position')).toMatchObject({ label: 'Primary Position', visibility: 'team' });
        expect(merged.find((field) => field.key === 'favoriteSnack')).toMatchObject({ label: 'Favorite Snack', visibility: 'parents' });
    });

    it('preserves inactive overrides for standard roster fields', () => {
        const merged = mergeStandardRosterFieldDefinitions([
            { key: 'position', label: 'Position', type: 'text', visibility: 'public', active: false }
        ]);

        expect(merged.some((field) => field.key === 'position')).toBe(false);
    });

    it('collects linked and private roster parent contacts without treating imports as accepted links', () => {
        const player = {
            parents: [{ userId: 'parent-1', name: 'Pat Parent', email: 'pat@example.com', relation: 'Dad', source: 'parent_invite' }],
            privateProfileParents: [
                { userId: 'parent-1', email: 'pat@example.com', relation: 'Dad' },
                { name: 'Robin Import', email: 'robin@example.com', relation: 'Guardian', source: 'roster-csv' }
            ],
            privateProfileContacts: [{ name: 'Aunt Kim', phone: '555-0101', relation: 'Emergency Contact', source: 'roster-ai' }]
        };

        expect(collectRosterParentContacts(player, { includeImported: false })).toEqual([
            expect.objectContaining({ userId: 'parent-1', name: 'Pat Parent', email: 'pat@example.com', relation: 'Dad' })
        ]);
        expect(collectRosterParentContacts(player, { includeFamilyContacts: true }).map((contact) => contact.email || contact.phone)).toEqual([
            'pat@example.com',
            'robin@example.com',
            '555-0101'
        ]);
    });

    it('merges imported parent contacts without dropping existing private metadata', () => {
        const merged = mergeRosterParentContacts(
            [
                { name: 'Pat Parent', email: 'Pat@Example.com', relation: 'Parent', source: 'registration', registrationId: 'reg-1' },
                { name: 'Robin Lee', phone: '555-0102', relation: 'Guardian', source: 'registration' }
            ],
            [
                { name: 'Pat AI', email: 'pat@example.com', phone: '555-9999', relation: 'Parent', source: 'roster-ai' },
                { name: 'Dana Lee', email: 'dana@example.com', relation: 'Parent', source: 'roster-ai' }
            ],
            { defaultRelation: 'Parent' }
        );

        expect(merged).toEqual([
            expect.objectContaining({ name: 'Pat Parent', email: 'pat@example.com', relation: 'Parent', source: 'registration', registrationId: 'reg-1' }),
            expect.objectContaining({ name: 'Robin Lee', phone: '555-0102', relation: 'Guardian', source: 'registration' }),
            expect.objectContaining({ name: 'Dana Lee', email: 'dana@example.com', relation: 'Parent', source: 'roster-ai' })
        ]);
    });

    it('plans sparse AI updates from property presence, including false values and intentional clears', () => {
        const fields = [
            { key: 'callSign', label: 'Call Sign', type: 'text', visibility: 'public', active: true },
            { key: 'waiver', label: 'Waiver', type: 'checkbox', visibility: 'team', active: true }
        ];
        const plan = planRosterAiImport({
            fields,
            existingPlayers: [{
                id: 'p1',
                name: 'Avery Ace',
                number: '10',
                profile: { customFields: { callSign: 'Ace' } },
                privateProfileRosterFields: { waiver: true }
            }],
            aiOperations: [{
                action: 'update',
                playerId: 'p1',
                changes: {
                    callSign: '',
                    waiver: false,
                    familyContacts: [{ email: 'parent@example.com' }]
                }
            }]
        });

        expect(plan.errors).toEqual([]);
        expect(plan.operations[0].providedFields).toEqual([
            expect.objectContaining({ key: 'callSign', value: '' }),
            expect.objectContaining({ key: 'waiver', value: false })
        ]);
        expect(plan.operations[0].providedFields.map((field) => field.key)).not.toContain('number');
        expect(plan.operations[0].providedContacts).toEqual([
            expect.objectContaining({ email: 'parent@example.com', providedKeys: ['email'] })
        ]);
        expect(plan.operations[0].inviteRequests).toEqual([
            expect.objectContaining({ email: 'parent@example.com' })
        ]);
    });

    it('keeps unknown AI fields and invalid values visible as review errors', () => {
        const plan = planRosterAiImport({
            fields: [{ key: 'level', label: 'Level', type: 'menu', visibility: 'public', options: [{ value: 'A', label: 'A' }], active: true }],
            aiOperations: [{
                action: 'add',
                player: { name: 'Sam Starter', level: 'Z', mysteryField: 'keep visible' }
            }]
        });

        expect(plan.operations[0].errors).toEqual(expect.arrayContaining([
            expect.stringContaining('Level must be one of'),
            expect.stringContaining('unknown roster field "mysteryField"')
        ]));
        expect(plan.operations[0].providedFields).toEqual(expect.arrayContaining([
            expect.objectContaining({ key: 'level', value: 'Z' })
        ]));
    });

    it('does not render empty contact properties in sparse AI review metadata', () => {
        const plan = planRosterAiImport({
            fields: [],
            aiOperations: [{
                action: 'add',
                player: {
                    name: 'Sam Starter',
                    familyContacts: [{ name: 'Pat Starter', email: '', phone: '' }]
                }
            }]
        });

        expect(plan.operations[0].providedContacts).toEqual([
            expect.objectContaining({
                name: 'Pat Starter',
                providedKeys: ['name']
            })
        ]);
        expect(plan.operations[0].inviteRequests).toEqual([]);
    });

    it('reports a blocking plan error instead of silently accepting the first 200 AI rows', () => {
        const aiOperations = Array.from({ length: 201 }, (_, index) => ({
            action: 'add',
            player: {
                name: `Player ${index + 1}`,
                number: String(index + 1)
            }
        }));

        const plan = planRosterAiImport({ aiOperations });

        expect(plan.operations).toHaveLength(200);
        expect(plan.errors).toEqual(['Import at most 200 roster rows at a time.']);
    });
});
