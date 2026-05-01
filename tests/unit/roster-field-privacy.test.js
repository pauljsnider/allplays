import { describe, expect, it } from 'vitest';
import { getRosterFieldDefinitions, getVisibleRosterFieldValues } from '../../js/roster-field-privacy.js';

const team = {
    rosterFields: [
        { id: 'school', label: 'School', visibility: 'public' },
        { id: 'jerseySize', label: 'Jersey Size', visibility: 'team' },
        { id: 'doctorNotes', label: 'Doctor Notes', visibility: 'private' },
        { id: 'medicalInfo', label: 'Medical Info', visibility: 'public' }
    ]
};

const player = {
    rosterFieldValues: {
        school: 'Lincoln',
        jerseySize: 'YM',
        doctorNotes: 'Needs admin follow-up',
        medicalInfo: 'Allergy'
    }
};

describe('roster field privacy', () => {
    it('uses populated fallback schema definitions when the primary roster field array is empty', () => {
        const migratedTeam = {
            rosterFields: [],
            rosterProfileFields: [
                { id: 'school', label: 'School', visibility: 'public' }
            ]
        };

        expect(getRosterFieldDefinitions(migratedTeam).map((field) => field.id)).toEqual(['school']);
    });

    it('shows only public configured fields to anonymous roster/profile viewers', () => {
        expect(getVisibleRosterFieldValues(team, player, {}).map(({ field }) => field.id)).toEqual(['school']);
    });

    it('shows team-visible fields to allowed parents without exposing private fields', () => {
        expect(getVisibleRosterFieldValues(team, player, { isTeamMember: true, isLinkedParent: true }).map(({ field }) => field.id)).toEqual([
            'school',
            'jerseySize'
        ]);
    });

    it('shows all configured field values to admins, including private fields', () => {
        expect(getVisibleRosterFieldValues(team, player, { isAdmin: true }).map(({ field }) => field.id)).toEqual([
            'school',
            'jerseySize',
            'doctorNotes',
            'medicalInfo'
        ]);
    });
});
