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

describe('useChatSheets', () => {
    it('opens and closes each extracted sheet without leaking state', () => {
        render(<HookProbe />);

        expect(screen.getByTestId('conversation')).toHaveTextContent('false');
        expect(screen.getByTestId('audience')).toHaveTextContent('false');
        expect(screen.getByTestId('media')).toHaveTextContent('false');
        expect(screen.getByTestId('attach')).toHaveTextContent('false');
        expect(screen.getByTestId('link')).toHaveTextContent('false');
        expect(screen.getByTestId('email')).toHaveTextContent('false');

        fireEvent.click(screen.getByRole('button', { name: 'Open conversation' }));
        expect(screen.getByTestId('conversation')).toHaveTextContent('true');
        fireEvent.click(screen.getByRole('button', { name: 'Close conversation' }));
        expect(screen.getByTestId('conversation')).toHaveTextContent('false');

        fireEvent.click(screen.getByRole('button', { name: 'Open audience' }));
        expect(screen.getByTestId('audience')).toHaveTextContent('true');
        fireEvent.click(screen.getByRole('button', { name: 'Close audience' }));
        expect(screen.getByTestId('audience')).toHaveTextContent('false');

        fireEvent.click(screen.getByRole('button', { name: 'Open media' }));
        expect(screen.getByTestId('media')).toHaveTextContent('true');
        fireEvent.click(screen.getByRole('button', { name: 'Close media' }));
        expect(screen.getByTestId('media')).toHaveTextContent('false');

        fireEvent.click(screen.getByRole('button', { name: 'Open attach' }));
        expect(screen.getByTestId('attach')).toHaveTextContent('true');
        fireEvent.click(screen.getByRole('button', { name: 'Open link' }));
        expect(screen.getByTestId('attach')).toHaveTextContent('false');
        expect(screen.getByTestId('link')).toHaveTextContent('true');
        fireEvent.click(screen.getByRole('button', { name: 'Close link' }));
        expect(screen.getByTestId('link')).toHaveTextContent('false');

        fireEvent.click(screen.getByRole('button', { name: 'Open email' }));
        expect(screen.getByTestId('email')).toHaveTextContent('true');
        fireEvent.click(screen.getByRole('button', { name: 'Close email' }));
        expect(screen.getByTestId('email')).toHaveTextContent('false');
    });
});
