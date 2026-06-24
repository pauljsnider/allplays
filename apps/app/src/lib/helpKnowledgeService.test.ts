import { beforeEach, describe, expect, it } from 'vitest';
import { resetHelpKnowledgeCachesForTests, searchHelpKnowledge } from './helpKnowledgeService';

describe('helpKnowledgeService search relevance', () => {
    beforeEach(() => {
        resetHelpKnowledgeCachesForTests();
    });

    it('returns no help results for impossible non-empty queries even when roles match', () => {
        const results = searchHelpKnowledge({
            query: 'qzxqzxqzx123456789',
            roles: ['parent'],
            limit: 5
        });

        expect(results).toEqual([]);
    });

    it('keeps genuinely matching help results for non-empty queries', () => {
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
