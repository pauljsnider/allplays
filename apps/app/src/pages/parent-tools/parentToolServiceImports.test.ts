import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const pageContracts = [
    { file: 'CalendarTool.tsx', focusedImport: "../../lib/parentCalendarService" },
    { file: 'FeesTool.tsx', focusedImport: "../../lib/parentFeesService" },
    { file: 'FamilyShareTool.tsx', focusedImport: "../../lib/parentFamilyShareService" },
    { file: 'HouseholdInviteTool.tsx', focusedImport: "../../lib/parentHouseholdService" },
    { file: 'RegistrationsTool.tsx', focusedImport: "../../lib/parentRegistrationsService" },
    { file: 'CertificatesTool.tsx', focusedImport: "../../lib/parentCertificatesService" }
] as const;

describe('Parent Tools focused service imports', () => {
    it.each(pageContracts)('%s imports only its focused service module', ({ file, focusedImport }) => {
        const source = readFileSync(resolve(__dirname, file), 'utf8');

        expect(source).toContain(focusedImport);
        expect(source).not.toContain("../../lib/parentToolsService");
    });

    it('RegistrationDetail imports only the focused registrations service module', () => {
        const source = readFileSync(resolve(__dirname, '..', 'RegistrationDetail.tsx'), 'utf8');

        expect(source).toContain("../lib/parentRegistrationsService");
        expect(source).not.toContain("../lib/parentToolsService");
    });

    it('keeps staff registration review imports out of the parent registration detail module', () => {
        const parentSource = readFileSync(resolve(__dirname, '..', 'RegistrationDetail.tsx'), 'utf8');
        const staffSource = readFileSync(resolve(__dirname, '..', 'TeamRegistrationReview.tsx'), 'utf8');
        const staffOnlyImports = [
            'loadStaffRegistrationDetail',
            'loadTeamRegistrationQueuePage',
            'loadTeamRegistrationRosterPlayers',
            'approveTeamRegistrationForApp',
            'rejectTeamRegistrationForApp',
            'extendTeamRegistrationOfferForApp'
        ];

        staffOnlyImports.forEach((staffOnlyImport) => {
            expect(parentSource).not.toContain(staffOnlyImport);
            expect(staffSource).toContain(staffOnlyImport);
        });
    });

    it('lazy-loads staff registration review from a distinct route module', () => {
        const source = readFileSync(resolve(__dirname, '..', '..', 'App.tsx'), 'utf8');

        expect(source).toContain("import('./pages/RegistrationDetail')");
        expect(source).toContain("import('./pages/TeamRegistrationReview')");
        expect(source.indexOf("import('./pages/RegistrationDetail')")).not.toBe(source.indexOf("import('./pages/TeamRegistrationReview')"));
    });
});
