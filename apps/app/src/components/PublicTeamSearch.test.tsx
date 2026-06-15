// @vitest-environment jsdom

import type { ComponentProps } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { PublicTeamSearch } from './PublicTeamSearch';
import { getPublicTeamsPage } from '../lib/publicTeamsService';
import { openPublicUrl } from '../lib/publicActions';
import { ParentHomeTeam } from '../lib/homeLogic';

vi.mock('../lib/publicTeamsService', () => ({
    getPublicTeamsPage: vi.fn() as MockInstance<(args?: { searchText?: string; cursor?: unknown | null; pageSize?: number }) => Promise<{ teams: ParentHomeTeam[]; nextCursor: unknown | null }>>,
}));

vi.mock('../lib/publicActions', () => ({
    openPublicUrl: vi.fn(),
}));

const mockTeams: ParentHomeTeam[] = [
    {
        teamId: 'team-atl-1',
        teamName: 'Atlanta United',
        photoUrl: '',
        role: 'Fan',
        sport: 'Soccer',
        location: 'Atlanta, GA',
        players: [],
        eventCount: 0,
        unreadCount: 0,
        openActions: 0,
        nextEvent: null,
        appAccess: true,
        webAccess: true,
        isPublic: true,
    },
    {
        teamId: 'team-nyc-1',
        teamName: 'New York Knicks',
        photoUrl: '',
        role: 'Fan',
        sport: 'Basketball',
        location: 'New York, NY',
        players: [],
        eventCount: 0,
        unreadCount: 0,
        openActions: 0,
        nextEvent: null,
        appAccess: false,
        webAccess: true,
        isPublic: true,
    },
];

function LocationProbe() {
    const location = useLocation();
    return <div data-testid="location-probe">{location.pathname}</div>;
}

function renderSearch(props: ComponentProps<typeof PublicTeamSearch> = {}, initialEntry = '/teams') {
    return render(
        <MemoryRouter initialEntries={[initialEntry]}>
            <PublicTeamSearch {...props} />
            <LocationProbe />
        </MemoryRouter>
    );
}

describe('PublicTeamSearch', () => {
    afterEach(() => {
        cleanup();
    });

    beforeEach(() => {
        vi.clearAllMocks();
        (getPublicTeamsPage as import('vitest').Mock).mockResolvedValue({ teams: mockTeams, nextCursor: null });
    });

    it('renders an empty search-first state without loading teams on mount', () => {
        renderSearch();

        expect(screen.getByPlaceholderText('Search by team, city, state, or zip')).toBeTruthy();
        expect(screen.getByRole('button', { name: /Search/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Browse all public teams/i })).toBeTruthy();
        expect(screen.getByText('Search for public teams near you')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Clear/i })).toBeNull();
        expect(screen.queryByText('Atlanta United')).toBeNull();
        expect(getPublicTeamsPage).not.toHaveBeenCalled();
    });

    it('filters teams by search text when search is submitted', async () => {
        (getPublicTeamsPage as import('vitest').Mock).mockResolvedValueOnce({ teams: [mockTeams[0]], nextCursor: null });
        renderSearch();

        const searchInput = screen.getByPlaceholderText('Search by team, city, state, or zip') as HTMLInputElement;
        fireEvent.change(searchInput, { target: { value: 'atlanta' } });
        fireEvent.click(screen.getByRole('button', { name: /Search/i }));

        await waitFor(() => expect(getPublicTeamsPage).toHaveBeenCalledWith({ searchText: 'atlanta', cursor: null }));
        expect(screen.getByText('Atlanta United')).toBeTruthy();
        expect(screen.queryByText('New York Knicks')).toBeNull();
        expect(screen.getByRole('button', { name: /Clear/i })).toBeTruthy();
    });

    it('loads all public teams only when browse all is used and can load the next page', async () => {
        (getPublicTeamsPage as import('vitest').Mock)
            .mockResolvedValueOnce({ teams: [mockTeams[0]], nextCursor: 'cursor-2' })
            .mockResolvedValueOnce({ teams: [mockTeams[1]], nextCursor: null });
        renderSearch();

        fireEvent.click(screen.getByRole('button', { name: /Browse all public teams/i }));

        await waitFor(() => expect(getPublicTeamsPage).toHaveBeenCalledWith({ searchText: undefined, cursor: null }));
        expect(screen.getByText('Atlanta United')).toBeTruthy();
        expect(screen.queryByText('New York Knicks')).toBeNull();
        fireEvent.click(screen.getByRole('button', { name: /Load more teams/i }));

        await waitFor(() => expect(getPublicTeamsPage).toHaveBeenLastCalledWith({ searchText: undefined, cursor: 'cursor-2' }));
        expect(screen.getByText('New York Knicks')).toBeTruthy();
    });

    it('paginates searched public teams with the active query and preserves grouped results', async () => {
        const atlantaSearchResult = {
            ...mockTeams[0],
            teamId: 'team-atl-search-1',
            teamName: 'Atlanta Fire',
        };
        const atlantaSecondPageResult = {
            ...mockTeams[0],
            teamId: 'team-atl-search-2',
            teamName: 'Atlanta United 2',
        };
        const kansasSearchResult = {
            ...mockTeams[1],
            teamId: 'team-kc-search-1',
            teamName: 'Kansas City Current',
            location: 'Kansas City, MO',
        };

        (getPublicTeamsPage as import('vitest').Mock)
            .mockResolvedValueOnce({ teams: [atlantaSearchResult], nextCursor: 'search-cursor-2' })
            .mockResolvedValueOnce({ teams: [atlantaSecondPageResult, kansasSearchResult], nextCursor: null });

        renderSearch();

        const searchInput = screen.getByPlaceholderText('Search by team, city, state, or zip') as HTMLInputElement;
        fireEvent.change(searchInput, { target: { value: 'atlanta' } });
        fireEvent.click(screen.getByRole('button', { name: /Search/i }));

        await waitFor(() => expect(getPublicTeamsPage).toHaveBeenCalledWith({ searchText: 'atlanta', cursor: null }));
        expect(screen.getByText('Atlanta Fire')).toBeTruthy();
        expect(screen.getByRole('button', { name: /Load more teams/i })).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /Load more teams/i }));

        await waitFor(() => expect(getPublicTeamsPage).toHaveBeenLastCalledWith({ searchText: 'atlanta', cursor: 'search-cursor-2' }));
        expect(searchInput.value).toBe('atlanta');
        expect(screen.getByText('Atlanta Fire')).toBeTruthy();
        expect(screen.getByText('Atlanta United 2')).toBeTruthy();
        expect(screen.getByText('Kansas City Current')).toBeTruthy();
        expect(screen.getAllByRole('heading', { level: 3 }).length).toBe(2);
        expect(screen.queryByRole('button', { name: /Load more teams/i })).toBeNull();
    });

    it('clears a filtered search back to the empty state without browsing all', async () => {
        (getPublicTeamsPage as import('vitest').Mock).mockResolvedValueOnce({ teams: [mockTeams[0]], nextCursor: null });
        renderSearch();

        const searchInput = screen.getByPlaceholderText('Search by team, city, state, or zip') as HTMLInputElement;
        fireEvent.change(searchInput, { target: { value: 'atlanta' } });
        fireEvent.click(screen.getByRole('button', { name: /Search/i }));

        await waitFor(() => expect(getPublicTeamsPage).toHaveBeenCalledTimes(1));
        expect(screen.getByText('Atlanta United')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /Clear/i }));

        expect(searchInput.value).toBe('');
        expect(screen.getByText('Search for public teams near you')).toBeTruthy();
        expect(screen.queryByText('Atlanta United')).toBeNull();
        expect(getPublicTeamsPage).toHaveBeenCalledTimes(1);
    });

    it('displays an error message if fetching teams fails', async () => {
        (getPublicTeamsPage as import('vitest').Mock).mockRejectedValueOnce(new Error('Network error'));
        renderSearch();

        fireEvent.click(screen.getByRole('button', { name: /Browse all public teams/i }));

        await waitFor(() => expect(screen.getByText('Network error')).toBeTruthy());
        expect(screen.queryByText('Atlanta United')).toBeNull();
    });

    it('displays no teams found message when no results are returned', async () => {
        (getPublicTeamsPage as import('vitest').Mock).mockResolvedValueOnce({ teams: [], nextCursor: null });
        renderSearch();

        fireEvent.change(screen.getByPlaceholderText('Search by team, city, state, or zip'), { target: { value: 'boston' } });
        fireEvent.click(screen.getByRole('button', { name: /Search/i }));

        await waitFor(() => {
            const message = screen.getByText(/No public teams found/i);
            expect(message.textContent).toContain('for "boston"');
        });
        expect(screen.queryByText('Atlanta United')).toBeNull();
    });

    it('groups teams into separate location sections after browsing all', async () => {
        renderSearch();

        fireEvent.click(screen.getByRole('button', { name: /Browse all public teams/i }));

        await waitFor(() => expect(screen.getByText('Atlanta United')).toBeTruthy());
        expect(screen.getByText('New York Knicks')).toBeTruthy();
        expect(screen.getAllByRole('heading', { level: 3 }).length).toBe(2);
    });

    it('routes to the native team page when app access is available', async () => {
        renderSearch();

        fireEvent.click(screen.getByRole('button', { name: /Browse all public teams/i }));

        await waitFor(() => expect(screen.getByText('Atlanta United')).toBeTruthy());
        const atlantaCard = screen.getByText('Atlanta United').closest('article');
        expect(atlantaCard).toBeTruthy();

        fireEvent.click(within(atlantaCard as HTMLElement).getByRole('button', { name: 'View team' }));

        expect(screen.getByTestId('location-probe').textContent).toBe('/teams/team-atl-1');
        expect(openPublicUrl).not.toHaveBeenCalled();
    });

    it('routes to the app team page when only web access is available', async () => {
        renderSearch();

        fireEvent.click(screen.getByRole('button', { name: /Browse all public teams/i }));

        await waitFor(() => expect(screen.getByText('New York Knicks')).toBeTruthy());
        const newYorkCard = screen.getByText('New York Knicks').closest('article');
        expect(newYorkCard).toBeTruthy();

        fireEvent.click(within(newYorkCard as HTMLElement).getByRole('button', { name: 'View team' }));

        expect(openPublicUrl).not.toHaveBeenCalled();
        expect(screen.getByTestId('location-probe').textContent).toBe('/teams/team-nyc-1');
    });

    it('renders an unavailable state when neither app nor web access exists', async () => {
        (getPublicTeamsPage as import('vitest').Mock).mockResolvedValueOnce({
            teams: [
                {
                    ...mockTeams[0],
                    teamId: 'team-private-1',
                    teamName: 'Hidden Club',
                    appAccess: false,
                    webAccess: false,
                },
            ],
            nextCursor: null
        });
        renderSearch();

        fireEvent.click(screen.getByRole('button', { name: /Browse all public teams/i }));

        await waitFor(() => expect(screen.getByText('Hidden Club')).toBeTruthy());
        const hiddenCard = screen.getByText('Hidden Club').closest('article');
        expect(hiddenCard).toBeTruthy();
        expect(within(hiddenCard as HTMLElement).queryByRole('button', { name: /View team/i })).toBeNull();
        expect(within(hiddenCard as HTMLElement).getByText('Team page is not available in the app yet.')).toBeTruthy();
    });

    it('preserves a typed search when the initial auto-browse request resolves later', async () => {
        const atlantaSearchResult = {
            ...mockTeams[0],
            teamId: 'team-atl-search-1',
            teamName: 'Atlanta Fire',
        };

        let resolveBrowseAll: ((value: { teams: ParentHomeTeam[]; nextCursor: unknown | null }) => void) | null = null;
        let resolveSearch: ((value: { teams: ParentHomeTeam[]; nextCursor: unknown | null }) => void) | null = null;
        (getPublicTeamsPage as import('vitest').Mock).mockImplementation(({ searchText }: { searchText?: string; cursor?: unknown | null; pageSize?: number } = {}) => {
            if (searchText === 'atlanta') {
                return new Promise((resolve) => {
                    resolveSearch = resolve;
                });
            }
            return new Promise((resolve) => {
                resolveBrowseAll = resolve;
            });
        });

        renderSearch({ autoBrowseOnMount: true }, '/teams/browse');

        await waitFor(() => expect(getPublicTeamsPage).toHaveBeenNthCalledWith(1, { searchText: undefined, cursor: null }));

        expect(screen.getByRole('button', { name: 'Search public teams' })).toBeTruthy();

        const searchInput = screen.getByPlaceholderText('Search by team, city, state, or zip') as HTMLInputElement;
        fireEvent.change(searchInput, { target: { value: 'atlanta' } });
        fireEvent.click(screen.getByRole('button', { name: 'Search public teams' }));

        await waitFor(() => expect(getPublicTeamsPage).toHaveBeenNthCalledWith(2, { searchText: 'atlanta', cursor: null }));

        if (!resolveSearch || !resolveBrowseAll) {
            throw new Error('Expected both public team requests to be captured before resolving them.');
        }

        (resolveSearch as (value: { teams: ParentHomeTeam[]; nextCursor: unknown | null }) => void)({ teams: [atlantaSearchResult], nextCursor: 'search-cursor-2' });
        await waitFor(() => expect(screen.getByText('Atlanta Fire')).toBeTruthy());
        expect(screen.getByRole('button', { name: /Load more teams/i })).toBeTruthy();

        (resolveBrowseAll as (value: { teams: ParentHomeTeam[]; nextCursor: unknown | null }) => void)({ teams: [], nextCursor: null });
        await waitFor(() => expect(screen.getByText('Atlanta Fire')).toBeTruthy());
        expect(searchInput.value).toBe('atlanta');
    });

    it('can auto-browse on mount for the dedicated discovery route', async () => {
        renderSearch({ autoBrowseOnMount: true }, '/teams/browse');

        await waitFor(() => expect(getPublicTeamsPage).toHaveBeenCalledWith({ searchText: undefined, cursor: null }));
        expect(screen.getByText('Atlanta United')).toBeTruthy();
    });
});
