import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertAuthenticatedAppRoute, closeAuthenticatedAppSession } from '../../tests/smoke/helpers/app-auth.js';

const mockState = vi.hoisted(() => ({ pollTimeouts: [] }));

// The helper's Playwright assertions run against a fake page in these tests;
// only the polling budgets are under test, so `expect` is stubbed to record
// poll timeouts and resolve the polling predicates against the fake page.
vi.mock('@playwright/test', () => {
    const expectMock = vi.fn(() => ({
        toBe: vi.fn(),
        toBeVisible: vi.fn(() => Promise.resolve()),
        toEqual: vi.fn(),
        not: { toMatch: vi.fn(), toContainText: vi.fn() }
    }));
    expectMock.poll = vi.fn((fn, options = {}) => {
        mockState.pollTimeouts.push(options.timeout);
        return {
            toBe: async (expected) => {
                const startedAt = Date.now();
                const timeout = options.timeout ?? 5000;
                for (;;) {
                    const value = await fn();
                    if (Object.is(value, expected)) return;
                    if (Date.now() - startedAt >= timeout) {
                        throw new Error(options.message || `Timed out waiting for ${String(expected)}`);
                    }
                    await new Promise((resolve) => setTimeout(resolve, 100));
                }
            }
        };
    });
    return { expect: expectMock };
});

describe('authenticated smoke session cleanup', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('does not let a pending browser-context close hide the authentication failure', async () => {
        vi.useFakeTimers();
        const context = {
            close: vi.fn(() => new Promise(() => {}))
        };
        let settled = false;
        const cleanup = closeAuthenticatedAppSession({ context }).then(() => {
            settled = true;
        });

        await vi.advanceTimersByTimeAsync(4_999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        await cleanup;

        expect(settled).toBe(true);
        expect(context.close).toHaveBeenCalledOnce();
    });

    it('still awaits a context that closes normally', async () => {
        const context = {
            close: vi.fn().mockResolvedValue(undefined)
        };

        await closeAuthenticatedAppSession({ context });

        expect(context.close).toHaveBeenCalledOnce();
    });
});

describe('assertAuthenticatedAppRoute fixture-link budget', () => {
    beforeEach(() => {
        mockState.pollTimeouts.length = 0;
        vi.useFakeTimers();
    });

    it('gives the fixture-link poll its own 60s budget instead of the leftover navigation budget', async () => {
        // Regression test for issue #5272: the parent smoke test flaked in
        // post-deploy-smoke #2423 because the fixture link waits on the
        // parent schedule cold load, which can take longer than the shared
        // 25s navigation budget. A link that appears at 30s must still pass.
        const startedAt = Date.now();
        const linkAppearsAt = startedAt + 30_000;
        const fixtureHref = '#/players/team-v1/player-v1';
        const page = {
            url: () => 'https://allplays.ai/app/#/home?section=players',
            locator: (selector) => {
                if (selector === 'body') return { innerText: async () => '' };
                if (selector === 'a') {
                    return {
                        evaluateAll: async (callback, expected) => {
                            const links = Date.now() >= linkAppearsAt
                                ? [{ getAttribute: (name) => (name === 'href' ? fixtureHref : null) }]
                                : [];
                            return callback(links, expected);
                        }
                    };
                }
                return {};
            },
            getByRole: () => ({ first: () => ({}) })
        };

        const assertion = assertAuthenticatedAppRoute(page, '/home?section=players', {
            heading: 'Your day',
            requiredHref: '/players/team-v1/player-v1',
            deadline: startedAt + 25_000
        });
        await vi.advanceTimersByTimeAsync(31_000);
        await assertion;

        // The navigation/hash poll uses the shared 25s deadline; the
        // fixture-link poll gets its own 60s budget.
        expect(mockState.pollTimeouts).toContain(60_000);
    });
});
