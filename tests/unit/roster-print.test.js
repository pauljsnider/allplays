import { describe, expect, it } from 'vitest';
import { buildRosterPrintHtml, buildRosterPrintViewModel } from '../../js/roster-print.js';

describe('roster print helpers', () => {
    const fields = [
        { key: 'grade', label: 'Grade', type: 'menu', options: [{ value: '6', label: 'Sixth' }], visibility: 'team', active: true },
        { key: 'throwsRight', label: 'Throws Right', type: 'checkbox', visibility: 'public', active: true },
        { key: 'medicalNote', label: 'Medical Note', type: 'text', visibility: 'admins', active: true }
    ];

    it('sorts active players by jersey number then name and excludes inactive players', () => {
        const model = buildRosterPrintViewModel({
            team: { name: 'Falcons' },
            fields,
            players: [
                { id: 'p3', name: 'Zoe Reed', number: '11', active: true },
                { id: 'p2', name: 'Avery Lee', number: '2', active: true },
                { id: 'p4', name: 'Inactive Player', number: '1', active: false },
                { id: 'p1', name: 'Sam Jones', number: '2', active: true }
            ],
            generatedAt: new Date('2026-05-26T20:00:00Z')
        });

        expect(model.activeCount).toBe(3);
        expect(model.players.map((player) => player.name)).toEqual(['Avery Lee', 'Sam Jones', 'Zoe Reed']);
    });

    it('formats printable fields and parent/contact summaries without admin-only fields', () => {
        const { html, model } = buildRosterPrintHtml({
            team: { name: 'Falcons' },
            fields,
            contactsByPlayerId: new Map([
                ['p1', [{ name: 'Pat Parent', relation: 'Mother', email: 'pat@example.com' }]]
            ]),
            players: [{
                id: 'p1',
                name: '<Sam Jones>',
                number: '7',
                profile: { customFields: { grade: '6', throwsRight: true, medicalNote: 'Private allergy' } },
                parents: [{ name: 'Casey Contact', relation: 'Guardian', email: 'casey@example.com' }]
            }],
            generatedAt: new Date('2026-05-26T20:00:00Z')
        });

        expect(model.fields.map((field) => field.label)).toEqual(['Grade', 'Throws Right']);
        expect(model.players[0].fields).toEqual([
            { key: 'grade', label: 'Grade', value: 'Sixth' },
            { key: 'throwsRight', label: 'Throws Right', value: 'Yes' }
        ]);
        expect(model.players[0].contactSummary).toContain('Pat Parent (Mother) pat@example.com');
        expect(model.players[0].contactSummary).toContain('Casey Contact (Guardian) casey@example.com');
        expect(html).toContain('&lt;Sam Jones&gt;');
        expect(html).not.toContain('Private allergy');
        expect(html).not.toContain('Medical Note');
    });

    it('includes optional staff entries without changing player sorting', () => {
        const { html, model } = buildRosterPrintHtml({
            team: { name: 'Falcons' },
            includeStaff: true,
            staff: [
                { name: 'Coach Jamie', roleLabel: 'Admin', detail: 'coach@example.com' },
                { name: 'Alex Smith', roleLabel: 'Scorekeeper · Videographer', detail: 'alex@example.com' }
            ],
            players: [
                { id: 'p2', name: 'Avery Lee', number: '2', active: true },
                { id: 'p1', name: 'Sam Jones', number: '11', active: true }
            ],
            generatedAt: new Date('2026-05-26T20:00:00Z')
        });

        expect(model.players.map((player) => player.name)).toEqual(['Avery Lee', 'Sam Jones']);
        expect(model.staffCount).toBe(2);
        expect(model.staff).toEqual([
            { name: 'Alex Smith', role: 'Scorekeeper · Videographer', detail: 'alex@example.com' },
            { name: 'Coach Jamie', role: 'Admin', detail: 'coach@example.com' }
        ]);
        expect(html).toContain('<h2>Staff</h2>');
        expect(html).toContain('Coach Jamie');
        expect(html).toContain('Scorekeeper · Videographer');
    });
});
