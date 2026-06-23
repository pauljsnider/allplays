import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const currentDir = dirname(fileURLToPath(import.meta.url));

const migratedParentToolFiles = [
    'AccessTool.tsx',
    'CalendarTool.tsx',
    'FamilyShareTool.tsx',
    'HouseholdInviteTool.tsx',
    'FeesTool.tsx'
];

describe('parent tool async pattern regression', () => {
    it.each(migratedParentToolFiles)('%s uses the shared parent async helper', (fileName) => {
        const source = readFileSync(resolve(currentDir, fileName), 'utf8');

        expect(source).toContain('useParentToolAsyncOperation');
        expect(source).not.toContain("../../lib/useAsyncOperation");
    });
});
