// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useChatSheets } from './useChatSheets';

function HookProbe() {
    const sheets = useChatSheets();

    return (
        <div>
            <div data-testid="conversation">{String(sheets.showConversationSheet)}</div>
            <div data-testid="audience">{String(sheets.showAudienceSheet)}</div>
            <div data-testid="media">{String(sheets.showMediaGallery)}</div>
            <div data-testid="attach">{String(sheets.showAttachSheet)}</div>
            <div data-testid="link">{String(sheets.showLinkSheet)}</div>
            <div data-testid="email">{String(sheets.showEmailSheet)}</div>
            <button type="button" onClick={sheets.openConversationSheet}>Open conversation</button>
            <button type="button" onClick={sheets.closeConversationSheet}>Close conversation</button>
            <button type="button" onClick={sheets.openAudienceSheet}>Open audience</button>
            <button type="button" onClick={sheets.closeAudienceSheet}>Close audience</button>
            <button type="button" onClick={sheets.openMediaGallery}>Open media</button>
            <button type="button" onClick={sheets.closeMediaGallery}>Close media</button>
            <button type="button" onClick={sheets.openAttachSheet}>Open attach</button>
            <button type="button" onClick={sheets.closeAttachSheet}>Close attach</button>
            <button type="button" onClick={sheets.openLinkSheet}>Open link</button>
            <button type="button" onClick={sheets.closeLinkSheet}>Close link</button>
            <button type="button" onClick={sheets.openEmailSheet}>Open email</button>
            <button type="button" onClick={sheets.closeEmailSheet}>Close email</button>
        </div>
    );
}

function expectSheetState(testId: string, state: boolean) {
    expect(screen.getByTestId(testId).textContent).toBe(String(state));
}

describe('useChatSheets', () => {
    it('opens and closes each extracted sheet without leaking state', () => {
        render(<HookProbe />);

        expectSheetState('conversation', false);
        expectSheetState('audience', false);
        expectSheetState('media', false);
        expectSheetState('attach', false);
        expectSheetState('link', false);
        expectSheetState('email', false);

        fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }));
        expectSheetState('conversation', true);
        fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
        expectSheetState('conversation', false);

        fireEvent.click(screen.getByRole('button', { name: 'Open audience' }));
        expectSheetState('audience', true);
        fireEvent.click(screen.getByRole('button', { name: 'Close audience' }));
        expectSheetState('audience', false);

        fireEvent.click(screen.getByRole('button', { name: 'Open media' }));
        expectSheetState('media', true);
        fireEvent.click(screen.getByRole('button', { name: 'Close media' }));
        expectSheetState('media', false);

        fireEvent.click(screen.getByRole('button', { name: 'Open attach' }));
        expectSheetState('attach', true);
        fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
        expectSheetState('attach', false);
        expectSheetState('link', true);
        fireEvent.click(screen.getByRole('button', { name: 'Close link' }));
        expectSheetState('link', false);

        fireEvent.click(screen.getByRole('button', { name: 'Open email' }));
        expectSheetState('email', true);
        fireEvent.click(screen.getByRole('button', { name: 'Close email' }));
        expectSheetState('email', false);
    });

    it('keeps unrelated sheet state intact when closing the email composer', () => {
        render(<HookProbe />);

        fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }));
        fireEvent.click(screen.getByRole('button', { name: 'Open email' }));
        expect(screen.getByTestId('conversation')).toHaveTextContent('true');
        expect(screen.getByTestId('email')).toHaveTextContent('true');

        fireEvent.click(screen.getByRole('button', { name: 'Close email' }));
        expect(screen.getByTestId('conversation')).toHaveTextContent('true');
        expect(screen.getByTestId('email')).toHaveTextContent('false');
    });
});
