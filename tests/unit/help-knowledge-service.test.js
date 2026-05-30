import { describe, expect, it } from 'vitest';
import { getSearchHelpRoles } from '../../apps/app/src/lib/helpKnowledgeService.ts';

describe('help knowledge service role filters', () => {
    const allSearchableRoles = ['admin', 'coach', 'member', 'parent'];

    it('returns all searchable help roles for all or empty filter values', () => {
        expect(getSearchHelpRoles()).toEqual(allSearchableRoles);
        expect(getSearchHelpRoles(null)).toEqual(allSearchableRoles);
        expect(getSearchHelpRoles('')).toEqual(allSearchableRoles);
        expect(getSearchHelpRoles('All')).toEqual(allSearchableRoles);
    });

    it('returns only the selected supported help role filter', () => {
        expect(getSearchHelpRoles('parent')).toEqual(['parent']);
        expect(getSearchHelpRoles('Coaches')).toEqual(['coach']);
        expect(getSearchHelpRoles('administrator')).toEqual(['admin']);
        expect(getSearchHelpRoles('member')).toEqual(['member']);
    });
});
