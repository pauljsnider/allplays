// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { useMemo, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { buildChatMentionSuggestions, getChatMentionInsertion, hasChatMentionTrigger, type ChatRecipientOption } from '../../../lib/chatLogic';
import { Composer } from './ChatComposer';

const recipientOptions: ChatRecipientOption[] = [
    { id: '1', name: 'Alice Adams', detail: 'Coach' },
    { id: '2', name: 'Bob Brown', detail: 'Player' }
];

function ComposerHarness({ initialText, initialCursorPosition }: { initialText: string; initialCursorPosition?: number }) {
    const [text, setText] = useState(initialText);
    const [cursorPosition, setCursorPosition] = useState<number | undefined>(initialCursorPosition);
    const [submitCount, setSubmitCount] = useState(0);
    const mentionSuggestions = useMemo(
        () => buildChatMentionSuggestions(recipientOptions, text, 5, cursorPosition),
        [cursorPosition, text]
    );
    const mentionTriggerActive = hasChatMentionTrigger(text, cursorPosition);

    return (
        <>
            <Composer
                teamName="Bears"
                text={text}
                filePreviews={[]}
                sending={false}
                composerNotice=""
                aiThinking={false}
                voiceListening={false}
                voiceSupported={false}
                canModerate={true}
                canSendTeamEmail={false}
                mentionSuggestions={mentionSuggestions}
                mentionSuggestionsLoading={false}
                mentionTriggerActive={mentionTriggerActive}
                audienceSummary="Full team"
                onCursorChange={setCursorPosition}
                onTextChange={setText}
                onSubmit={() => setSubmitCount((current) => current + 1)}
                onAttach={vi.fn()}
                onRemoveFile={vi.fn()}
                onVoice={vi.fn()}
                onAudience={vi.fn()}
                onTeamEmail={vi.fn()}
                onMention={vi.fn()}
                onRecipientMention={(mentionLabel, nextCursorPosition) => {
                    setText((current) => getChatMentionInsertion(current, mentionLabel, nextCursorPosition).text);
                }}
            />
            <div data-testid="submit-count">{submitCount}</div>
        </>
    );
}

describe('Composer mention autocomplete', () => {
    it('does not open teammate suggestions for a bare at-sign', () => {
        render(<ComposerHarness initialText="@" initialCursorPosition={1} />);

        expect(screen.queryByLabelText('Mention suggestions')).toBeNull();
    });

    it('supports keyboard selection and inserts the mention at the cursor', () => {
        render(<ComposerHarness initialText="Hi @a team" initialCursorPosition={5} />);

        const textarea = screen.getByPlaceholderText('Message Bears') as HTMLTextAreaElement;
        textarea.focus();
        textarea.setSelectionRange(5, 5);
        fireEvent.select(textarea);

        expect(screen.getByLabelText('Mention suggestions')).toBeTruthy();

        fireEvent.keyDown(textarea, { key: 'ArrowDown' });
        fireEvent.keyDown(textarea, { key: 'Enter' });

        expect(screen.getByDisplayValue('Hi @Bob Brown team')).toBeTruthy();
        expect(screen.getByTestId('submit-count').textContent).toBe('0');
    });
});
