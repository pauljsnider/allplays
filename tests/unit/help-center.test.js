import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    normalizeHelpRole,
    getHelpGuidesForRole,
    searchHelpGuides,
    getRequiredGuideIds,
    getGuideById,
    resolveGuideLinks,
    getHelpCategoriesForRole
} from '../../js/help-center.js';

function readRepoFile(relativePath) {
    return readFileSync(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}

function getHelpWatchChatContextLinks() {
    const helpPage = readRepoFile('help-watch-chat.html');
    return [...helpPage.matchAll(/<a\b[^>]*data-help-context-link[^>]*>/g)].map(([anchor]) => ({
        guideId: anchor.match(/\bdata-guide-id="([^"]+)"/)?.[1],
        quickLinkLabel: anchor.match(/\bdata-quick-link-label="([^"]+)"/)?.[1],
        routeTemplate: anchor.match(/\bdata-route-template="([^"]+)"/)?.[1]
    }));
}

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

    it('keeps team chat mention help aligned with supported assistant mentions', () => {
        const guide = getGuideById('coach', 'team-chat-tagging');
        const helpPage = readRepoFile('help-watch-chat.html');
        const guideText = [
            guide.title,
            guide.summary,
            ...guide.steps,
            ...guide.commonErrors
        ].join(' ');

        expect(guideText).toContain('@ALL PLAYS');
        expect(guideText).toContain('recipient picker');
        expect(guideText).toContain('person and group @ mentions are not supported');
        expect(guideText).not.toMatch(/Tag people in chat|Tag only the people|targeted mentions/i);
        expect(helpPage).toContain('@ALL PLAYS');
        expect(helpPage).toContain('Use the recipient picker, not @ mentions');
        expect(helpPage).not.toContain('Use targeted mentions');
    });

    it('keeps Help Watch Chat CTAs aligned with watch and team-chat quick links', () => {
        const pageLinksByGuideAndLabel = new Map(
            getHelpWatchChatContextLinks().map((link) => [`${link.guideId}:${link.quickLinkLabel}`, link.routeTemplate])
        );

        const requiredQuickLinks = [
            ['watch-game', 'Team Page'],
            ['watch-game', 'Game Viewer'],
            ['team-chat-basics', 'Open Team Chat']
        ];

        requiredQuickLinks.forEach(([guideId, label]) => {
            const guide = getGuideById('parent', guideId);
            const quickLink = guide.quickLinks.find((link) => link.label === label);

            expect(pageLinksByGuideAndLabel.get(`${guideId}:${label}`)).toBe(quickLink.url);
        });
    });
});
