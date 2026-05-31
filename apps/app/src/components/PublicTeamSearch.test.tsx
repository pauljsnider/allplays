import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { PublicTeamSearch } from './PublicTeamSearch';
import { getPublicTeamsByLocation } from '../lib/publicTeamsService';
import { ParentHomeTeam } from '../lib/homeLogic';

// Mock the service call
vi.mock('../lib/publicTeamsService', () => ({
  getPublicTeamsByLocation: vi.fn() as MockInstance<(locationFilter?: string) => Promise<ParentHomeTeam[]>>,
}));

// Mock team data
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
    appAccess: true,
    webAccess: true,
    isPublic: true,
  },
];

describe('PublicTeamSearch', () => {
  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks();
    // Default mock for tests that don't specify mockResolvedValueOnce
    (getPublicTeamsByLocation as import('vitest').Mock).mockResolvedValue(mockTeams);
  });

  it('renders the search input and buttons', async () => {
    // Ensure initial render also uses the default mock
    (getPublicTeamsByLocation as import('vitest').Mock).mockResolvedValueOnce(mockTeams);
    render(<PublicTeamSearch />);
    expect(screen.getByPlaceholderText('Search by city, state, or zip')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Search/i })).toBeInTheDocument();
    // Clear button only appears after a search or query is entered
    expect(screen.queryByRole('button', { name: /Clear/i })).not.toBeInTheDocument();

    // Wait for initial load to complete
    await waitFor(() => expect(screen.queryByText('Loading public teams')).not.toBeInTheDocument());
  });

  it('loads all public teams on initial render', async () => {
    // Mock for this specific test's initial render
    (getPublicTeamsByLocation as import('vitest').Mock).mockResolvedValueOnce(mockTeams);
    render(<PublicTeamSearch />);
    expect(screen.getByText('Loading public teams')).toBeInTheDocument();
    await waitFor(() => expect(getPublicTeamsByLocation).toHaveBeenCalledWith(undefined));
    await waitFor(() => expect(screen.getByText('Atlanta United')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('New York Knicks')).toBeInTheDocument());
  });

  it('filters teams by location when search button is clicked', async () => {
    // Mock initial load to return all teams
    (getPublicTeamsByLocation as import('vitest').Mock).mockResolvedValueOnce(mockTeams);
    render(<PublicTeamSearch />);

    // Wait for initial load and assert all teams are present
    await waitFor(() => expect(getPublicTeamsByLocation).toHaveBeenCalledWith(undefined));
    await waitFor(() => expect(screen.getByText('Atlanta United')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('New York Knicks')).toBeInTheDocument());

    const searchInput = screen.getByPlaceholderText('Search by city, state, or zip');
    fireEvent.change(searchInput, { target: { value: 'atlanta' } });

    // Mock the next call (the search call) to return only Atlanta teams
    (getPublicTeamsByLocation as import('vitest').Mock).mockResolvedValueOnce([mockTeams[0]]);
    fireEvent.click(screen.getByRole('button', { name: /Search/i }));

    // After search, assert only Atlanta team is present
    await waitFor(() => expect(getPublicTeamsByLocation).toHaveBeenCalledWith('atlanta'));
    await waitFor(() => expect(screen.getByText('Atlanta United')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('New York Knicks')).not.toBeInTheDocument());
  });

  it('clears the search and shows all teams when clear button is clicked', async () => {
    // Mock initial load to return all teams
    (getPublicTeamsByLocation as import('vitest').Mock).mockResolvedValueOnce(mockTeams);
    render(<PublicTeamSearch />);

    // Initial load confirmation
    await waitFor(() => expect(getPublicTeamsByLocation).toHaveBeenCalledWith(undefined));
    await waitFor(() => expect(screen.getByText('Atlanta United')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByText('New York Knicks')).toBeInTheDocument());

    const searchInput = screen.getByPlaceholderText('Search by city, state, or zip');
    fireEvent.change(searchInput, { target: { value: 'atlanta' } });

    // Mock search call to return only Atlanta teams
    (getPublicTeamsByLocation as import('vitest').Mock).mockResolvedValueOnce([mockTeams[0]]);
    fireEvent.click(screen.getByRole('button', { name: /Search/i }));

    // After search, only Atlanta should be visible
    await waitFor(() => expect(getPublicTeamsByLocation).toHaveBeenCalledWith('atlanta'));
    await waitFor(() => expect(screen.getByText('Atlanta United')).toBeInTheDocument());
    await waitFor(() => expect(screen.queryByText('New York Knicks')).not.toBeInTheDocument());

    // Now, mock the service to return all teams when clear is called
    (getPublicTeamsByLocation as import('vitest').Mock).mockResolvedValueOnce(mockTeams);

    // Click clear button
    fireEvent.click(screen.getByRole('button', { name: /Clear/i }));

    // After clear, all teams should be visible
    await waitFor(() => expect(getPublicTeamsByLocation).toHaveBeenCalledWith(undefined));
    await waitFor(() => {
      expect(screen.getByText('Atlanta United')).toBeInTheDocument();
      expect(screen.getByText('New York Knicks')).toBeInTheDocument();
    });
    expect(searchInput).toHaveValue(''); // Verify input is cleared
  });

  it('displays an error message if fetching teams fails', async () => {
    (getPublicTeamsByLocation as import('vitest').Mock).mockRejectedValueOnce(new Error('Network error'));
    render(<PublicTeamSearch />);

    await waitFor(() => expect(screen.getByText('Network error')).toBeInTheDocument());
    expect(screen.queryByText('Atlanta United')).not.toBeInTheDocument();
  });

  it('displays no teams found message when no results', async () => {
    (getPublicTeamsByLocation as import('vitest').Mock).mockResolvedValueOnce([]);
    render(<PublicTeamSearch />);

    await waitFor(() => expect(screen.getByText(/No public teams found/i)).toBeInTheDocument());
    expect(screen.queryByText('Atlanta United')).not.toBeInTheDocument();
  });

  it('groups teams by resolved location', async () => {
    // Mock for this specific test's initial render
    (getPublicTeamsByLocation as import('vitest').Mock).mockResolvedValueOnce(mockTeams);
    render(<PublicTeamSearch />);
    await waitFor(() => expect(screen.queryByText('Loading public teams')).not.toBeInTheDocument());

    expect(screen.getByText('Atlanta, GA')).toBeInTheDocument();
    expect(screen.getByText('New York, NY')).toBeInTheDocument();
    expect(screen.getAllByText(/player/).length).toBe(2); // One for each team card
  });
});