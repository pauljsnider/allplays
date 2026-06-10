import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function rulesSource() {
    return readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
}

describe('team drill Firestore rules', () => {
    it('lets custom drill deletes authorize from the existing document instead of request.resource', () => {
        const source = rulesSource();
        const drillLibraryBlock = source.slice(
            source.indexOf('match /drillLibrary/{drillId} {'),
            source.indexOf('match /teams/{teamId}/drillFavorites/{favoriteId} {')
        );

        expect(drillLibraryBlock).toContain("allow update: if isSignedIn() &&");
        expect(drillLibraryBlock).toContain("allow delete: if isSignedIn() &&");
        expect(drillLibraryBlock).toContain("resource.data.source == 'custom' &&");
        expect(drillLibraryBlock).toContain("resource.data.teamId != null &&");
        expect(drillLibraryBlock).toContain("isTeamOwnerOrAdmin(resource.data.teamId)");

        const deleteBlock = drillLibraryBlock.slice(
            drillLibraryBlock.indexOf('allow delete: if isSignedIn() &&'),
            drillLibraryBlock.indexOf('    }', drillLibraryBlock.indexOf('allow delete: if isSignedIn() &&'))
        );

        expect(deleteBlock).not.toContain('request.resource.data');
    });
});
