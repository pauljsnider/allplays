// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
        cleanup();
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

    it('keeps applications from closed or unpublished forms visible alongside published form cards', async () => {
        registrationMocks.loadParentRegistrations.mockResolvedValue([
            {
                id: 'published-form',
                teamId: 'team-1',
                teamName: 'Falcons',
                programName: 'Spring League',
                description: 'Published registration',
                season: '2026',
                feeLabel: '$100.00',
                paymentNotice: '',
                onlineCheckout: true,
                options: [],
                url: 'https://allplays.ai/register/published-form'
            }
        ]);
        registrationMocks.loadParentRegistrationApplicationsPage.mockResolvedValue({
            applications: [application({
                id: 'closed-application',
                registrationKey: 'registration-closed',
                playerName: 'Closed Form Player',
                formStatus: 'closed',
                formPublished: false
            })],
            nextCursor: null,
            retryCursor: null,
            hasMore: false,
            errors: []
        });

        renderTool();

        expect(await screen.findByText('Closed Form Player')).toBeTruthy();
        const publishedCard = screen.getByText('Published registration').closest('section');
        expect(publishedCard).toBeTruthy();
        expect(within(publishedCard as HTMLElement).getByRole('link', { name: 'Review' })).toBeTruthy();
        expect(within(publishedCard as HTMLElement).getByRole('button', { name: 'Legacy form' })).toBeTruthy();
        expect(within(publishedCard as HTMLElement).getByRole('button', { name: 'Share' })).toBeTruthy();

        const closedApplicationCard = screen.getByText('Closed Form Player').closest('section');
        expect(closedApplicationCard).toBeTruthy();
        expect(within(closedApplicationCard as HTMLElement).queryByRole('link', { name: 'Review' })).toBeNull();
        expect(within(closedApplicationCard as HTMLElement).queryByRole('button', { name: 'Legacy form' })).toBeNull();
        expect(within(closedApplicationCard as HTMLElement).queryByRole('button', { name: 'Share' })).toBeNull();
    });

    it('loads older submitted applications with the returned pagination cursor', async () => {
        const nextCursor = { guardianEmail: { id: 'guardian-page-1' }, submittedByUserId: { id: 'submitter-page-1' } };
        registrationMocks.loadParentRegistrationApplicationsPage
            .mockResolvedValueOnce({
                applications: [application({ id: 'application-1', registrationKey: 'registration-1', playerName: 'Player One' })],
                nextCursor,
                retryCursor: null,
                hasMore: true,
                errors: []
            })
            .mockResolvedValueOnce({
                applications: [application({ id: 'application-2', registrationKey: 'registration-2', playerName: 'Player Two' })],
                nextCursor: null,
                retryCursor: null,
                hasMore: false,
                errors: []
            });

        renderTool();
        fireEvent.click(await screen.findByRole('button', { name: 'Load more applications' }));

        await waitFor(() => expect(registrationMocks.loadParentRegistrationApplicationsPage).toHaveBeenLastCalledWith(auth.user, { cursor: nextCursor }));
        expect(await screen.findByText('Player Two')).toBeTruthy();
        expect(screen.getAllByText('Player One')).toHaveLength(1);
        expect(screen.queryByRole('button', { name: 'Load more applications' })).toBeNull();
    });

    it('does not duplicate applications when a later page overlaps the loaded history', async () => {
        const nextCursor = { guardianEmail: { id: 'guardian-page-1' }, submittedByUserId: null };
        registrationMocks.loadParentRegistrationApplicationsPage
            .mockResolvedValueOnce({
                applications: [application({ id: 'application-1', registrationKey: 'registration-1', playerName: 'Player One' })],
                nextCursor,
                retryCursor: null,
                hasMore: true,
                errors: []
            })
            .mockResolvedValueOnce({
                applications: [
                    application({ id: 'application-1', registrationKey: 'registration-1', playerName: 'Player One (updated)' }),
                    application({ id: 'application-2', registrationKey: 'registration-2', playerName: 'Player Two' })
                ],
                nextCursor: null,
                retryCursor: null,
                hasMore: false,
                errors: []
            });

        renderTool();
        fireEvent.click(await screen.findByRole('button', { name: 'Load more applications' }));

        expect(await screen.findByText('Player One (updated)')).toBeTruthy();
        expect(screen.getAllByText('Player One (updated)')).toHaveLength(1);
        expect(screen.getByText('Player Two')).toBeTruthy();
    });

    it('retries a failed pagination request without removing loaded cards', async () => {
        const nextCursor = { guardianEmail: { id: 'guardian-page-1' }, submittedByUserId: null };
        registrationMocks.loadParentRegistrationApplicationsPage
            .mockResolvedValueOnce({
                applications: [application({ id: 'application-1', registrationKey: 'registration-1', playerName: 'Player One' })],
                nextCursor,
                retryCursor: null,
                hasMore: true,
                errors: []
            })
            .mockRejectedValueOnce(new Error('The next application page is temporarily unavailable.'))
            .mockResolvedValueOnce({
                applications: [application({ id: 'application-2', registrationKey: 'registration-2', playerName: 'Player Two' })],
                nextCursor: null,
                retryCursor: null,
                hasMore: false,
                errors: []
            });

        renderTool();
        fireEvent.click(await screen.findByRole('button', { name: 'Load more applications' }));
        expect(await screen.findByText('The next application page is temporarily unavailable.')).toBeTruthy();
        expect(screen.getByText('Player One')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

        await waitFor(() => expect(registrationMocks.loadParentRegistrationApplicationsPage).toHaveBeenLastCalledWith(auth.user, { cursor: nextCursor }));
        expect(await screen.findByText('Player Two')).toBeTruthy();
        expect(screen.getByText('Player One')).toBeTruthy();
    });

    it('retries an initial application-load failure', async () => {
        registrationMocks.loadParentRegistrationApplicationsPage
            .mockRejectedValueOnce(new Error('The application history is temporarily unavailable.'))
            .mockResolvedValueOnce({ applications: [application()], nextCursor: null, retryCursor: null, hasMore: false, errors: [] });

        renderTool();
        expect(await screen.findByText('The application history is temporarily unavailable.')).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

        await waitFor(() => expect(registrationMocks.loadParentRegistrationApplicationsPage).toHaveBeenLastCalledWith(auth.user, { cursor: null }));
        expect(await screen.findByText('Player One')).toBeTruthy();
    });

    it('keeps partial results visible and retries the incomplete page from its retry cursor', async () => {
        const retryCursor = { guardianEmail: { id: 'guardian-retry' }, submittedByUserId: null };
        registrationMocks.loadParentRegistrationApplicationsPage
            .mockResolvedValueOnce({
                applications: [application({ id: 'application-1', registrationKey: 'registration-1', playerName: 'Player One' })],
                nextCursor: { guardianEmail: { id: 'guardian-next' }, submittedByUserId: null },
                retryCursor,
                hasMore: true,
                errors: [{ code: 'parent-registration-query-failed', identity: 'submitter-uid', retryable: true, message: 'The submitter history is temporarily unavailable.' }]
            })
            .mockResolvedValueOnce({
                applications: [
                    application({ id: 'application-1', registrationKey: 'registration-1', playerName: 'Player One' }),
                    application({ id: 'application-2', registrationKey: 'registration-2', playerName: 'Player Two' })
                ],
                nextCursor: null,
                retryCursor: null,
                hasMore: false,
                errors: []
            });

        renderTool();
        expect(await screen.findByText('Player One')).toBeTruthy();
        expect(screen.getByRole('alert').textContent).toContain('Some submitted applications could not be loaded.');
        expect(screen.getByRole('alert').textContent).toContain('The submitter history is temporarily unavailable.');
        expect(screen.queryByRole('button', { name: 'Load more applications' })).toBeNull();

        fireEvent.click(screen.getByRole('button', { name: 'Retry incomplete page' }));

        await waitFor(() => expect(registrationMocks.loadParentRegistrationApplicationsPage).toHaveBeenLastCalledWith(auth.user, { cursor: retryCursor }));
        expect(await screen.findByText('Player Two')).toBeTruthy();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(screen.getAllByText('Player One')).toHaveLength(1);
    });
});

function application(overrides: Partial<{
    id: string;
    registrationKey: string;
    playerName: string;
    formStatus: string;
    formPublished: boolean;
}> = {}) {
    return {
        id: 'application-1',
        registrationKey: 'registration-1',
        teamId: 'team-1',
        formId: 'form-1',
        teamName: 'Falcons',
        programName: 'Spring League',
        playerName: 'Player One',
        guardianEmail: 'parent@example.com',
        status: 'pending',
        statusLabel: 'Pending Review',
        selectedOptionLabel: 'Standard',
        submittedAt: null,
        ...overrides
    };
}

describe('RegistrationsTool account isolation', () => {
    const nextAuth: AuthState = { ...auth, user: { ...auth.user!, uid: 'parent-2', email: 'other@example.com' } };
    const pageFor = (playerName: string) => ({ applications: [{ id: playerName, registrationKey: playerName, teamId: 'team-1', formId: 'form-1', teamName: 'Team', programName: 'Program', playerName, statusLabel: 'Pending' }], nextCursor: null, retryCursor: null, hasMore: false, errors: [] });
    beforeEach(() => {
        cleanup();
        vi.resetAllMocks();
        registrationMocks.loadParentRegistrations.mockResolvedValue([]);
    });

    it('removes the previous account history while the next account loads', async () => {
        registrationMocks.loadParentRegistrationApplicationsPage.mockResolvedValueOnce(pageFor('Previous family')).mockReturnValueOnce(new Promise(() => {}));
        const view = renderTool();
        expect(await screen.findByText('Previous family')).toBeTruthy();
        view.rerender(<MemoryRouter><RegistrationsTool auth={nextAuth} refreshVersion={0} /></MemoryRouter>);
        expect(screen.queryByText('Previous family')).toBeNull();
        expect(await screen.findByText('Loading submitted applications')).toBeTruthy();
    });

    it('discards a previous account response that finishes after the current account', async () => {
        let finishPrevious!: (value: ReturnType<typeof pageFor>) => void;
        registrationMocks.loadParentRegistrationApplicationsPage.mockReturnValueOnce(new Promise((resolve) => { finishPrevious = resolve; })).mockResolvedValueOnce(pageFor('Current family'));
        const view = renderTool();
        view.rerender(<MemoryRouter><RegistrationsTool auth={nextAuth} refreshVersion={0} /></MemoryRouter>);
        expect(await screen.findByText('Current family')).toBeTruthy();
        await act(async () => { finishPrevious(pageFor('Previous family')); });
        expect(screen.queryByText('Previous family')).toBeNull();
        expect(screen.getByText('Current family')).toBeTruthy();
    });
    it.each([
        ['sign-out', { ...auth, user: null }],
        ['email change', { ...auth, user: { ...auth.user!, email: 'updated@example.com' } }],
        ['email verification change', { ...auth, user: { ...auth.user!, emailVerified: false } }]
    ])('clears retained history on %s', async (_name, changedAuth) => {
        registrationMocks.loadParentRegistrationApplicationsPage.mockResolvedValueOnce(pageFor('Previous family')).mockReturnValueOnce(new Promise(() => {}));
        const view = renderTool();
        await screen.findByText('Previous family');
        view.rerender(<MemoryRouter><RegistrationsTool auth={changedAuth as AuthState} refreshVersion={0} /></MemoryRouter>);
        expect(screen.queryByText('Previous family')).toBeNull();
    });

    it('discards a previous account error without replacing current history or retry state', async () => {
        let rejectPrevious!: (error: Error) => void;
        registrationMocks.loadParentRegistrationApplicationsPage.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectPrevious = reject; })).mockResolvedValueOnce(pageFor('Current family'));
        const view = renderTool();
        view.rerender(<MemoryRouter><RegistrationsTool auth={nextAuth} refreshVersion={0} /></MemoryRouter>);
        await screen.findByText('Current family');
        await act(async () => { rejectPrevious(new Error('Previous account load failed')); });
        expect(screen.queryByText('Previous account load failed')).toBeNull();
        expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
        expect(screen.getByText('Current family')).toBeTruthy();
    });

});
