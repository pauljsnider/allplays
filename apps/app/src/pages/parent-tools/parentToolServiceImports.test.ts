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
});
