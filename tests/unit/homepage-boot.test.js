import { describe, expect, it, vi } from 'vitest';

import { bootHomepage, showHomepageLoadFailure } from '../../js/homepage-boot.js';

function createDocument() {
    const containers = new Map([
        ['live-games-list', { textContent: 'Loading games...', innerHTML: '' }],
        ['past-games-list', { textContent: 'Loading replays...', innerHTML: '' }]
    ]);

    return {
        containers,
        getElementById: (id) => containers.get(id) || null
    };
}

describe('homepage boot failure state', () => {
    it('passes the resolved dependencies into homepage initialization', async () => {
        const document = createDocument();
        const dependencies = {
            checkAuth: vi.fn(),
            getRedirectUrl: vi.fn(),
            getPublicHomepageGames: vi.fn(),
            initHomepage: vi.fn().mockResolvedValue(undefined)
        };
        const initOptions = { renderHeader: vi.fn(), formatDate: vi.fn(), formatTime: vi.fn() };

        await expect(bootHomepage({
            document,
            loadDependencies: async () => dependencies,
            initOptions,
            logger: { error: vi.fn() }
        })).resolves.toBe(true);

        expect(dependencies.initHomepage).toHaveBeenCalledWith({
            ...initOptions,
            document,
            checkAuth: dependencies.checkAuth,
            getRedirectUrl: dependencies.getRedirectUrl,
            getHomepageGames: dependencies.getPublicHomepageGames
        });
    });

    it('replaces both loading placeholders when dependency loading rejects', async () => {
        const document = createDocument();
        const error = new Error('Firebase unavailable');
        const logger = { error: vi.fn() };

        await expect(bootHomepage({
            document,
            loadDependencies: () => Promise.reject(error),
            initOptions: {},
            logger
        })).resolves.toBe(false);

        for (const container of document.containers.values()) {
            expect(container.innerHTML).toContain('data-homepage-load-error');
            expect(container.innerHTML).toContain('temporarily unavailable');
            expect(container.innerHTML).toContain('role="alert"');
        }
        expect(logger.error).toHaveBeenCalledWith('Failed to initialize homepage:', error);
    });

    it('replaces both loading placeholders when homepage initialization rejects', async () => {
        const document = createDocument();
        const initHomepage = vi.fn().mockRejectedValue(new Error('initialization failed'));

        const result = await bootHomepage({
            document,
            loadDependencies: async () => ({
                checkAuth: vi.fn(),
                getRedirectUrl: vi.fn(),
                getPublicHomepageGames: vi.fn(),
                initHomepage
            }),
            initOptions: {},
            logger: { error: vi.fn() }
        });

        expect(result).toBe(false);
        expect(initHomepage).toHaveBeenCalledOnce();
        expect(document.containers.get('live-games-list').innerHTML).toContain('data-homepage-load-error');
        expect(document.containers.get('past-games-list').innerHTML).toContain('data-homepage-load-error');
    });

    it('preserves a section that already rendered successfully', () => {
        const document = createDocument();
        const live = document.containers.get('live-games-list');
        live.textContent = 'Rockets vs Hawks';
        live.innerHTML = '<a>Rockets vs Hawks</a>';

        showHomepageLoadFailure(document);

        expect(live.innerHTML).toBe('<a>Rockets vs Hawks</a>');
        expect(document.containers.get('past-games-list').innerHTML).toContain('data-homepage-load-error');
    });
});
