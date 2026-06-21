import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

function readSource(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

describe('registration review pagination query', () => {
    it('orders paged registration reviews by submittedAt so live registrations are included', () => {
        const source = readSource('js/db.js');
        const start = source.indexOf('export async function listTeamRegistrationReviewsPage');
        const nextExport = source.indexOf('\nexport async function ', start + 1);
        const fnSource = source.slice(start, nextExport === -1 ? source.length : nextExport);

        expect(fnSource).toContain("orderBy('submittedAt', 'desc')");
        expect(fnSource).not.toContain("orderBy('createdAt', 'desc')");
    });

    it('keeps Firestore indexes aligned with submittedAt pagination', () => {
        const { indexes } = JSON.parse(readSource('firestore.indexes.json'));
        const registrationIndexes = indexes.filter((index) => index.collectionGroup === 'registrations');
        const registrationFieldPaths = registrationIndexes.flatMap((index) =>
            index.fields.map((field) => `${field.fieldPath}:${field.order ?? field.arrayConfig ?? 'none'}`)
        );

        expect(registrationFieldPaths).toContain('submittedAt:DESCENDING');
        expect(registrationFieldPaths).not.toContain('createdAt:DESCENDING');
    });
});
