// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

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
});
