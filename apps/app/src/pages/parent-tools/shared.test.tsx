// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InviteResultCard } from './shared';

const publicActionMocks = vi.hoisted(() => ({
    copyPublicText: vi.fn(),
    sharePublicUrl: vi.fn()
}));

vi.mock('../../lib/publicActions', () => publicActionMocks);
vi.mock('lucide-react', () => {
    const Icon = () => null;
    return {
        AlertCircle: Icon,
        CheckCircle2: Icon,
        Copy: Icon,
        Link2: Icon,
        Loader2: Icon,
        RefreshCw: Icon,
        Share2: Icon
    };
});

describe('InviteResultCard', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        publicActionMocks.copyPublicText.mockResolvedValue('copied');
        Object.assign(navigator, {
            clipboard: {
                writeText: vi.fn().mockResolvedValue(undefined)
            }
        });
    });

    afterEach(() => cleanup());

    it('prioritizes share, then copy link, with copy code available as fallback', async () => {
        const onStatus = vi.fn();
        publicActionMocks.sharePublicUrl.mockResolvedValue('shared');

        render(
            <InviteResultCard
                code="home5678"
                inviteUrl="https://allplays.ai/app#/accept-invite?code=HOME5678&type=household"
                recipientEmail="aunt@example.com"
                emailSent
                shareTitle="ALL PLAYS parent invite"
                shareText="Join this player."
                onStatus={onStatus}
            />
        );

        expect(screen.getByRole('button', { name: 'Share invite' }).className).toContain('primary-button');
        expect(screen.getByRole('button', { name: 'Copy link' }).className).toContain('secondary-button');
        expect(screen.getByRole('button', { name: 'Copy code' }).className).toContain('ghost-button');
        expect(screen.getByText('HOME5678')).toBeTruthy();
        expect(screen.getByText('Email queued for aunt@example.com.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Share invite' }));
        await waitFor(() => expect(publicActionMocks.sharePublicUrl).toHaveBeenCalledWith({
            title: 'ALL PLAYS parent invite',
            text: 'Join this player.',
            url: 'https://allplays.ai/app#/accept-invite?code=HOME5678&type=household',
            clipboardText: 'https://allplays.ai/app#/accept-invite?code=HOME5678&type=household'
        }));
        await waitFor(() => expect(onStatus).toHaveBeenCalledWith('Invite shared.'));

        fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
        await waitFor(() => expect(publicActionMocks.copyPublicText).toHaveBeenCalledWith('https://allplays.ai/app#/accept-invite?code=HOME5678&type=household'));
        await waitFor(() => expect(onStatus).toHaveBeenCalledWith('Invite link copied.'));

        fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
        await waitFor(() => expect(publicActionMocks.copyPublicText).toHaveBeenCalledWith('HOME5678'));
        await waitFor(() => expect(onStatus).toHaveBeenCalledWith('Invite code copied.'));
    });

    it('uses the invite code as the share fallback when no link exists', async () => {
        const onStatus = vi.fn();
        publicActionMocks.sharePublicUrl.mockResolvedValue('copied');

        render(<InviteResultCard code="CODE1234" recipientEmail="coach@example.com" emailSent={false} onStatus={onStatus} />);

        expect(screen.queryByRole('button', { name: 'Copy link' })).toBeNull();
        expect(screen.getByText('Copy and share this invite with coach@example.com.')).toBeTruthy();

        fireEvent.click(screen.getByRole('button', { name: 'Share invite' }));

        await waitFor(() => expect(publicActionMocks.sharePublicUrl).toHaveBeenCalledWith({
            title: 'ALL PLAYS invite',
            text: 'Join ALL PLAYS with invite code CODE1234.',
            url: undefined,
            clipboardText: 'CODE1234'
        }));
        await waitFor(() => expect(onStatus).toHaveBeenCalledWith('Invite code copied.'));
    });

    it('reports copy failures after the public copy fallback fails', async () => {
        const onStatus = vi.fn();
        publicActionMocks.copyPublicText.mockResolvedValue('failed');

        render(<InviteResultCard code="CODE1234" inviteUrl="https://allplays.ai/app#/accept-invite?code=CODE1234" onStatus={onStatus} />);

        fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

        await waitFor(() => expect(publicActionMocks.copyPublicText).toHaveBeenCalledWith('https://allplays.ai/app#/accept-invite?code=CODE1234'));
        await waitFor(() => expect(onStatus).toHaveBeenCalledWith('Unable to copy invite link.'));
    });
});
