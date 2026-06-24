// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';

beforeEach(async () => {
    const { resetHelpKnowledgeCachesForTests } = await import('../../apps/app/src/lib/helpKnowledgeService.ts');
    resetHelpKnowledgeCachesForTests();
});

describe('app help knowledge service', () => {
    it('indexes root help and workflow pages for private AI lookup', async () => {
        const { getHelpKnowledgeDocs } = await import('../../apps/app/src/lib/helpKnowledgeService.ts');
        const docs = getHelpKnowledgeDocs();

        expect(docs.length).toBeGreaterThanOrEqual(20);
        expect(docs.map((doc) => doc.file)).toEqual(expect.arrayContaining([
            'help.html',
            'help-account.html',
            'help-team-operations.html',
            'workflow-communication.html',
            'workflow-schedule.html',
            'workflow-live-watch-replay.html'
        ]));
    });

    it('filters functional workflow help by requested role', async () => {
        const { searchHelpKnowledge } = await import('../../apps/app/src/lib/helpKnowledgeService.ts');
        const results = searchHelpKnowledge({
            query: 'schedule',
            roles: ['member'],
            limit: 8
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results.every((result) => result.roles.includes('member') || result.roles.includes('all'))).toBe(true);
        expect(results.map((result) => result.id)).not.toContain('schedule');
    });

    it('includes admin workflow help for platform admin role lookups', async () => {
        const { searchHelpKnowledge } = await import('../../apps/app/src/lib/helpKnowledgeService.ts');
        const results = searchHelpKnowledge({
            query: 'platform admin controls',
            roles: ['platformAdmin'],
            limit: 5
        });

        expect(results.map((result) => result.id)).toContain('admin-ops');
    });

    it('maps platform admin aliases to the admin help role', async () => {
        const { getSearchHelpRoles } = await import('../../apps/app/src/lib/helpKnowledgeService.ts');

        expect(getSearchHelpRoles('platformAdmin')).toEqual(['admin']);
        expect(getSearchHelpRoles('platform admin')).toEqual(['admin']);
    });

    it('finds functional workflow help with source pages and snippets', async () => {
        const { searchHelpKnowledge } = await import('../../apps/app/src/lib/helpKnowledgeService.ts');
        const results = searchHelpKnowledge({
            query: 'How do I reset my password and verify email?',
            roles: ['parent'],
            limit: 4
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results[0]).toMatchObject({
            file: expect.stringMatching(/help-account|workflow-getting-started/),
            url: expect.stringContaining('https://allplays.ai/')
        });
        expect(results.map((result) => result.title).join(' ')).toMatch(/Account|Access|Create|Help/i);
        expect(results[0].snippet.length).toBeGreaterThan(40);
    });

    it('filters help search results by All and a specific help role', async () => {
        const { searchHelpKnowledge } = await import('../../apps/app/src/lib/helpKnowledgeService.ts');

        const allResults = searchHelpKnowledge({
            query: 'streaming access',
            roles: ['parent'],
            roleFilter: 'all',
            limit: 8
        });
        const parentResults = searchHelpKnowledge({
            query: 'streaming access',
            roles: ['parent'],
            roleFilter: 'parent',
            limit: 8
        });

        expect(allResults.some((result) => !result.roles.includes('parent') && !result.roles.includes('all'))).toBe(true);
        expect(parentResults.length).toBeGreaterThan(0);
        expect(parentResults.every((result) => result.roles.includes('parent') || result.roles.includes('all'))).toBe(true);
    });

    it('supports portal-sized result sets and role-filter narrowing for each portal role', async () => {
        const { getHelpKnowledgeDocs, searchHelpKnowledge } = await import('../../apps/app/src/lib/helpKnowledgeService.ts');
        const docs = getHelpKnowledgeDocs();

        expect(searchHelpKnowledge({
            query: '',
            roleFilter: 'all',
            limit: docs.length
        })).toHaveLength(docs.length);

        ['all', 'parent', 'coach', 'admin', 'member'].forEach((roleFilter) => {
            const results = searchHelpKnowledge({
                query: 'schedule',
                roleFilter,
                limit: docs.length
            });

            expect(results.length).toBeGreaterThan(0);
            expect(results.every((result) => roleFilter === 'all' || result.roles.includes('all') || result.roles.includes(roleFilter))).toBe(true);
        });
    });

    it('builds snippets only for the returned top matches and caches repeated searches', async () => {
        const {
            getHelpKnowledgeDebugStateForTests,
            getHelpKnowledgeDocs,
            searchHelpKnowledge
        } = await import('../../apps/app/src/lib/helpKnowledgeService.ts');
        const docs = getHelpKnowledgeDocs();
        const limit = 3;

        const results = searchHelpKnowledge({
            query: 'live tracker',
            roleFilter: 'all',
            limit
        });
        const debugAfterFirstSearch = getHelpKnowledgeDebugStateForTests();

        expect(results).toHaveLength(limit);
        expect(docs.length).toBeGreaterThan(limit);
        expect(debugAfterFirstSearch.snippetBuilds).toBe(limit);
        expect(debugAfterFirstSearch.sentenceSplits).toBe(docs.length);
        expect(debugAfterFirstSearch.queryCacheHits).toBe(0);

        const repeatedResults = searchHelpKnowledge({
            query: 'live tracker',
            roleFilter: 'all',
            limit
        });
        const debugAfterSecondSearch = getHelpKnowledgeDebugStateForTests();

        expect(repeatedResults).toEqual(results);
        expect(debugAfterSecondSearch.snippetBuilds).toBe(limit);
        expect(debugAfterSecondSearch.sentenceSplits).toBe(docs.length);
        expect(debugAfterSecondSearch.queryCacheHits).toBe(1);
    });

    it('returns no help results for impossible non-empty queries even when roles match', async () => {
        const { searchHelpKnowledge } = await import('../../apps/app/src/lib/helpKnowledgeService.ts');
        const results = searchHelpKnowledge({
            query: 'qzxqzxqzx123456789',
            roles: ['parent'],
            limit: 5
        });

        expect(results).toEqual([]);
    });

    it('does not treat non-empty zero-token queries as empty help searches', async () => {
        const { searchHelpKnowledge } = await import('../../apps/app/src/lib/helpKnowledgeService.ts');
        const results = searchHelpKnowledge({
            query: 'AI',
            roles: ['parent'],
            limit: 5
        });

        expect(results).toEqual([]);
    });

    it('keeps genuinely matching help results for non-empty queries', async () => {
        const { searchHelpKnowledge } = await import('../../apps/app/src/lib/helpKnowledgeService.ts');
        const results = searchHelpKnowledge({
            query: 'account access',
            roles: ['parent'],
            limit: 5
        });

        expect(results.length).toBeGreaterThan(0);
        expect(results).toEqual(expect.arrayContaining([
            expect.objectContaining({
                id: 'help-account',
                title: 'Account and Access'
            })
        ]));
    });
});
