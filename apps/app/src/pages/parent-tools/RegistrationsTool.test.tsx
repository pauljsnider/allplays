// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RegistrationsTool } from './RegistrationsTool';
import type { AuthState } from '../../lib/types';

const registrationMocks = vi.hoisted(() => ({
    loadParentRegistrations: vi.fn(),
    loadParentRegistrationApplicationsPage: vi.fn()
}));

vi.mock('../../lib/parentRegistrationsService', () => registrationMocks);
vi.mock('../../lib/publicActions', () => ({ openPublicUrl: vi.fn(), sharePublicUrl: vi.fn() }));
vi.mock('lucide-react', () => {
    const Icon = () => null;
    return { ExternalLink: Icon, RefreshCw: Icon, Share2: Icon, Ticket: Icon, Loader2: Icon, AlertCircle: Icon, CheckCircle2: Icon, Copy: Icon, Link2: Icon };
});

const auth: AuthState = {
    user: { uid: 'parent-1', email: 'parent@example.com', emailVerified: true, displayName: 'Parent', roles: ['parent'], parentOf: [] },
    profile: null,
    loading: false,
    error: null,
    roles: ['parent'],
    isParent: true,
    isCoach: false,
    isAdmin: false,
    isPlatformAdmin: false,
    refresh: vi.fn(),
    signOut: vi.fn()
};

function renderTool() {
    return render(<MemoryRouter><RegistrationsTool auth={auth} refreshVersion={0} /></MemoryRouter>);
}

describe('RegistrationsTool submitted applications', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        registrationMocks.loadParentRegistrations.mockResolvedValue([]);
    });

    it('renders a distinct loading state while submitted applications load', async () => {
        registrationMocks.loadParentRegistrationApplicationsPage.mockReturnValue(new Promise(() => {}));
        renderTool();
        expect(await screen.findByText('Loading submitted applications')).toBeTruthy();
    });

    it('renders a distinct empty state when there are no submitted applications', async () => {
        registrationMocks.loadParentRegistrationApplicationsPage.mockResolvedValue({ applications: [], nextCursor: null, retryCursor: null, hasMore: false, errors: [] });
        renderTool();
        expect(await screen.findByText('No submitted applications')).toBeTruthy();
    });

    it('renders all normalized read-only statuses and application fields', async () => {
        const statuses = ['Pending Review', 'Waitlisted', 'Offer Extended', 'Offer Accepted', 'Enrolled', 'Released', 'Rejected'];
        registrationMocks.loadParentRegistrationApplicationsPage.mockResolvedValue({
            applications: statuses.map((statusLabel, index) => ({
                id: `application-${index}`,
                registrationKey: `registration-${index}`,
                teamId: 'team-1',
                formId: 'form-1',
                teamName: 'Falcons',
                programName: 'Spring League',
                playerName: 'Player One',
                guardianEmail: 'parent@example.com',
                status: statusLabel.toLowerCase().replace(/ /g, '-'),
                statusLabel,
                selectedOptionLabel: index === 0 ? 'Standard' : '',
                submittedAt: null
            })),
            nextCursor: null,
            retryCursor: null,
            hasMore: false,
            errors: []
        });
        renderTool();
        for (const status of statuses) expect(await screen.findByText(status)).toBeTruthy();
        expect(screen.getAllByText('Player One')).toHaveLength(statuses.length);
        expect(screen.getAllByText('Spring League')).toHaveLength(statuses.length);
        expect(screen.getAllByText('Falcons')).toHaveLength(statuses.length);
        expect(screen.getByText('Standard')).toBeTruthy();
        await waitFor(() => expect(screen.queryByText('Review')).toBeNull());
    });
});