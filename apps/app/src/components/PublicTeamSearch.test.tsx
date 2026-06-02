// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { PublicTeamSearch } from './PublicTeamSearch';
import { getPublicTeamsByLocation } from '../lib/publicTeamsService';
import { openPublicUrl } from '../lib/publicActions';
import { ParentHomeTeam } from '../lib/homeLogic';

vi.mock('../lib/publicTeamsService', () => ({
    getPublicTeamsByLocation: vi.fn() as MockInstance<(locationFilter?: string) => Promise<ParentHomeTeam[]>>,
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

function renderSearch() {
    return render(
        <MemoryRouter initialEntries={['/teams']}>
            <PublicTeamSearch />
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
        (getPublicTeamsByLocation as import('vitest').Mock).mockResolvedValue(mockTeams);
    });

    it('renders an empty search-first state without loading teams on mount', () => {
        renderSearch();

        expect(screen.getByPlaceholderText('Search by city, state, or zip')).toBeTruthy();
        expect(screen.getByRole('button', { name: /Search/i })).toBeTruthy();
        expect(screen.getByRole('button', { name: /Browse all public teams/i })).toBeTruthy();
        expect(screen.getByText('Search for public teams near you')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Clear/i })).toBeNull();
        expect(screen.queryByText('Atlanta United')).toBeNull();
        expect(getPublicTeamsByLocation).not.toHaveBeenCalled();
    });

    it('filters teams by location when search is submitted', async () => {
        (getPublicTeamsByLocation as import('vitest').Mock).mockResolvedValueOnce([mockTeams[0]]);
        renderSearch();

        const searchInput = screen.getByPlaceholderText('Search by city, state, or zip') as HTMLInputElement;
        fireEvent.change(searchInput, { target: { value: 'atlanta' } });
        fireEvent.click(screen.getByRole('button', { name: /Search/i }));

        await waitFor(() => expect(getPublicTeamsByLocation).toHaveBeenCalledWith('atlanta'));
        expect(screen.getByText('Atlanta United')).toBeTruthy();
        expect(screen.queryByText('New York Knicks')).toBeNull();
        expect(screen.getByRole('button', { name: /Clear/i })).toBeTruthy();
    });

    it('loads all public teams only when browse all is used', async () => {
        renderSearch();

        fireEvent.click(screen.getByRole('button', { name: /Browse all public teams/i }));

        await waitFor(() => expect(getPublicTeamsByLocation).toHaveBeenCalledWith(undefined));
        expect(screen.getByText('Atlanta United')).toBeTruthy();
        expect(screen.getByText('New York Knicks')).toBeTruthy();
    });

    it('clears a filtered search back to the empty state without browsing all', async () => {
        (getPublicTeamsByLocation as import('vitest').Mock).mockResolvedValueOnce([mockTeams[0]]);
        renderSearch();

        const searchInput = screen.getByPlaceholderText('Search by city, state, or zip') as HTMLInputElement;
        fireEvent.change(searchInput, { target: { value: 'atlanta' } });
        fireEvent.click(screen.getByRole('button', { name: /Search/i }));

        await waitFor(() => expect(getPublicTeamsByLocation).toHaveBeenCalledTimes(1));
        expect(screen.getByText('Atlanta United')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: /Clear/i }));

        expect(searchInput.value).toBe('');
        expect(screen.getByText('Search for public teams near you')).toBeTruthy();
        expect(screen.queryByText('Atlanta United')).toBeNull();
        expect(getPublicTeamsByLocation).toHaveBeenCalledTimes(1);
    });

    it('displays an error message if fetching teams fails', async () => {
        (getPublicTeamsByLocation as import('vitest').Mock).mockRejectedValueOnce(new Error('Network error'));
        renderSearch();

        fireEvent.click(screen.getByRole('button', { name: /Browse all public teams/i }));

        await waitFor(() => expect(screen.getByText('Network error')).toBeTruthy());
        expect(screen.queryByText('Atlanta United')).toBeNull();
    });

    it('displays no teams found message when no results are returned', async () => {
        (getPublicTeamsByLocation as import('vitest').Mock).mockResolvedValueOnce([]);
        renderSearch();

        fireEvent.change(screen.getByPlaceholderText('Search by city, state, or zip'), { target: { value: 'boston' } });
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

    it('opens the website team page when only web access is available', async () => {
        renderSearch();

        fireEvent.click(screen.getByRole('button', { name: /Browse all public teams/i }));

        await waitFor(() => expect(screen.getByText('New York Knicks')).toBeTruthy());
        const newYorkCard = screen.getByText('New York Knicks').closest('article');
        expect(newYorkCard).toBeTruthy();

        fireEvent.click(within(newYorkCard as HTMLElement).getByRole('button', { name: 'View team on website' }));

        expect(openPublicUrl).toHaveBeenCalledWith('https://allplays.ai/team.html#teamId=team-nyc-1');
        expect(screen.getByTestId('location-probe').textContent).toBe('/teams');
    });

    it('renders an unavailable state when neither app nor web access exists', async () => {
        (getPublicTeamsByLocation as import('vitest').Mock).mockResolvedValueOnce([
            {
                ...mockTeams[0],
                teamId: 'team-private-1',
                teamName: 'Hidden Club',
                appAccess: false,
                webAccess: false,
            },
        ]);
        renderSearch();

        fireEvent.click(screen.getByRole('button', { name: /Browse all public teams/i }));

        await waitFor(() => expect(screen.getByText('Hidden Club')).toBeTruthy());
        const hiddenCard = screen.getByText('Hidden Club').closest('article');
        expect(hiddenCard).toBeTruthy();
        expect(within(hiddenCard as HTMLElement).queryByRole('button', { name: /View team/i })).toBeNull();
        expect(within(hiddenCard as HTMLElement).getByText('Team page is not available in the app yet.')).toBeTruthy();
    });
});
