import { describe, it, expect } from 'vitest';
import {
    normalizeHelpRole,
    getHelpGuidesForRole,
    searchHelpGuides,
    getRequiredGuideIds,
    getGuideById,
    resolveGuideLinks,
    getHelpCategoriesForRole
} from '../../js/help-center.js';

describe('help center deep workflow coverage', () => {
    it('normalizes role aliases and defaults unknown to member', () => {
        expect(normalizeHelpRole('admins')).toBe('administrator');
        expect(normalizeHelpRole('coaches')).toBe('coach');
        expect(normalizeHelpRole('something-random')).toBe('member');
    });

    it('contains all required workflow guides', () => {
        const required = getRequiredGuideIds();
        const allGuideIds = new Set(getHelpGuidesForRole('administrator').map((guide) => guide.id));
        required.forEach((id) => {
            expect(allGuideIds.has(id)).toBe(true);
        });
    });

    it('excludes coach-only setup guides from parent role results', () => {
        const parentGuideIds = getHelpGuidesForRole('parent').map((guide) => guide.id);
        expect(parentGuideIds.includes('create-team')).toBe(false);
        expect(parentGuideIds.includes('manage-roster')).toBe(false);
        expect(parentGuideIds.includes('team-chat-basics')).toBe(true);
    });

    it('searches across workflow steps and error text', () => {
        const coachGuides = getHelpGuidesForRole('coach');
        const byKeyword = searchHelpGuides(coachGuides, 'activation code');
        expect(byKeyword.some((guide) => guide.id === 'sign-up-activation')).toBe(true);

        const byErrorPhrase = searchHelpGuides(coachGuides, 'invalid credentials');
        expect(byErrorPhrase.some((guide) => guide.id === 'login')).toBe(true);
    });

    it('supports category scoping and lookup by id', () => {
        const coachGuides = getHelpGuidesForRole('coach');
        const onlyPlanning = searchHelpGuides(coachGuides, '', 'planning');
        expect(onlyPlanning.length).toBeGreaterThan(0);
        expect(onlyPlanning.every((guide) => guide.category === 'planning')).toBe(true);

        const trackGuide = getGuideById('coach', 'track-game');
        expect(trackGuide?.title).toContain('Track a game');
    });

    it('resolves quick-link templates using context values', () => {
        const rosterGuide = getGuideById('coach', 'manage-roster');
        const links = resolveGuideLinks(rosterGuide, { teamId: 'TEAM 123', gameId: 'GAME/456' });
        expect(links.some((link) => link.url.includes('teamId=TEAM%20123'))).toBe(true);
    });

    it('returns role-aware categories only for visible guides', () => {
        const parentCategories = getHelpCategoriesForRole('parent').map((category) => category.id);
        expect(parentCategories.includes('team-setup')).toBe(false);
        expect(parentCategories.includes('watch-chat')).toBe(true);
    });
});
