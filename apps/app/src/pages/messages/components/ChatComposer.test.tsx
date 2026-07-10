// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './ChatComposer';

vi.mock('lucide-react', () => {
    const Icon = () => null;
    return {
        Bot: Icon,
        Loader2: Icon,
        Mail: Icon,
        Mic: Icon,
        MoreHorizontal: Icon,
        Paperclip: Icon,
        Send: Icon,
        Users: Icon,
        X: Icon
    };
});

vi.mock('../../../lib/chatLogic', () => ({
    getChatMentionInsertion: vi.fn((_text: string, _mentionLabel: string, cursorPosition = 0) => ({ cursorPosition })),
    hasAllPlaysMention: vi.fn(() => false)
}));

function renderComposer(overrides: Partial<Parameters<typeof Composer>[0]> = {}) {
    const props: Parameters<typeof Composer>[0] = {
        teamName: 'Bears',
        text: 'draft',
        filePreviews: [],
        sending: false,
        composerNotice: '',
        aiThinking: false,
        voiceListening: false,
        voiceSupported: true,
        canModerate: true,
        canSendTeamEmail: true,
        mentionSuggestions: [],
        mentionSuggestionsLoading: false,
        mentionTriggerActive: false,
        audienceSummary: 'Everyone',
        onCursorChange: vi.fn(),
        onTextChange: vi.fn(),
        onSubmit: vi.fn(),
        onAttach: vi.fn(),
        onRemoveFile: vi.fn(),
        onVoice: vi.fn(),
        onAudience: vi.fn(),
        onTeamEmail: vi.fn(),
        onMention: vi.fn(),
        onRecipientMention: vi.fn(),
        ...overrides
    };
    render(<Composer {...props} />);
    return props;
}

describe('Chat Composer', () => {
    afterEach(() => {
        cleanup();
    });

    it('blocks typing and actions while a chat sheet is open', () => {
        const props = renderComposer({ disabled: true });
        const textarea = screen.getByPlaceholderText('Message Bears') as HTMLTextAreaElement;

        expect(textarea.disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Send message' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Add attachment' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Voice to text' }) as HTMLButtonElement).disabled).toBe(true);
        expect((screen.getByRole('button', { name: 'Open staff actions' }) as HTMLButtonElement).disabled).toBe(true);

        fireEvent.change(textarea, { target: { value: 'background edit' } });
        fireEvent.submit(textarea.closest('form')!);

        expect(props.onTextChange).not.toHaveBeenCalled();
        expect(props.onSubmit).not.toHaveBeenCalled();
    });

    it('defers moderator audience and email actions behind one staff action', () => {
        const props = renderComposer();

        expect(screen.queryByText('Audience: Everyone')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Open Team Email' })).not.toBeInTheDocument();
        expect(screen.queryByRole('menu', { name: 'Staff actions' })).not.toBeInTheDocument();

        const staffActions = screen.getByRole('button', { name: 'Open staff actions' });
        expect(staffActions).toHaveAttribute('aria-expanded', 'false');
        fireEvent.click(staffActions);

        expect(staffActions).toHaveAttribute('aria-expanded', 'true');
        expect(screen.getByRole('menu', { name: 'Staff actions' })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: /Message audience.*Current: Everyone/i })).toBeInTheDocument();
        expect(screen.getByRole('menuitem', { name: 'Team Email' })).toBeInTheDocument();

        fireEvent.click(screen.getByRole('menuitem', { name: /Message audience/i }));

        expect(props.onAudience).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('menu', { name: 'Staff actions' })).not.toBeInTheDocument();

        fireEvent.click(staffActions);
        fireEvent.click(screen.getByRole('menuitem', { name: 'Team Email' }));

        expect(props.onTeamEmail).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole('menu', { name: 'Staff actions' })).not.toBeInTheDocument();
    });

    it('does not expose staff actions without moderator permissions', () => {
        renderComposer({ canModerate: false, canSendTeamEmail: false });

        expect(screen.queryByRole('button', { name: 'Open staff actions' })).not.toBeInTheDocument();
        expect(screen.queryByRole('menu', { name: 'Staff actions' })).not.toBeInTheDocument();
    });
});
