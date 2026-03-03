import { describe, it, expect } from 'vitest';
import { normalizeHelpRole, getHelpSectionsForRole, searchHelpSections } from '../../js/help-center.js';

describe('help center role-aware content', () => {
    it('normalizes unknown roles to member', () => {
        expect(normalizeHelpRole('something-random')).toBe('member');
    });

    it('returns role-aware section metadata for parents', () => {
        const sections = getHelpSectionsForRole('parent');
        expect(sections.length).toBeGreaterThan(0);
        expect(sections.some((section) => section.roles.includes('parent'))).toBe(true);
    });

    it('filters sections by search query across content text', () => {
        const sections = getHelpSectionsForRole('coach');
        const results = searchHelpSections(sections, 'permissions');
        expect(results.length).toBeGreaterThan(0);
    });
});
