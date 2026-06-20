// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PullToRefresh } from '../../apps/app/src/components/PullToRefresh.tsx';

vi.mock('lucide-react', () => ({ Loader2: () => null, ArrowDown: () => null }));

function setScrollTop(value: number) {
    Object.defineProperty(window, 'scrollY', { value, configurable: true, writable: true });
}

afterEach(() => {
    cleanup();
    setScrollTop(0);
    vi.restoreAllMocks();
});

function pull(el: HTMLElement, deltaY: number) {
    fireEvent.touchStart(el, { touches: [{ clientY: 0 }] });
    fireEvent.touchMove(el, { touches: [{ clientY: deltaY }] });
    fireEvent.touchEnd(el, { changedTouches: [{ clientY: deltaY }] });
}

describe('PullToRefresh', () => {
    it('triggers onRefresh when pulled past the threshold at the top', async () => {
        const onRefresh = vi.fn().mockResolvedValue(undefined);
        render(<PullToRefresh onRefresh={onRefresh}><p>content</p></PullToRefresh>);
        pull(screen.getByTestId('pull-to-refresh'), 200);
        await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
    });

    it('does not trigger for a short pull below the threshold', () => {
        const onRefresh = vi.fn();
        render(<PullToRefresh onRefresh={onRefresh}><p>content</p></PullToRefresh>);
        pull(screen.getByTestId('pull-to-refresh'), 40);
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('does not trigger when the page is scrolled away from the top', () => {
        setScrollTop(250);
        const onRefresh = vi.fn();
        render(<PullToRefresh onRefresh={onRefresh}><p>content</p></PullToRefresh>);
        pull(screen.getByTestId('pull-to-refresh'), 200);
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('does not trigger when disabled', () => {
        const onRefresh = vi.fn();
        render(<PullToRefresh onRefresh={onRefresh} disabled><p>content</p></PullToRefresh>);
        pull(screen.getByTestId('pull-to-refresh'), 200);
        expect(onRefresh).not.toHaveBeenCalled();
    });

    it('suppresses native overscroll while tracking a downward pull', () => {
        const onRefresh = vi.fn();
        render(<PullToRefresh onRefresh={onRefresh}><p>content</p></PullToRefresh>);
        const element = screen.getByTestId('pull-to-refresh');

        fireEvent.touchStart(element, { touches: [{ clientY: 0 }] });
        const moveEvent = createEvent.touchMove(element, { touches: [{ clientY: 200 }] });
        Object.defineProperty(moveEvent, 'cancelable', { value: true, configurable: true });
        const preventDefault = vi.fn();
        Object.defineProperty(moveEvent, 'preventDefault', { value: preventDefault, configurable: true });

        fireEvent(element, moveEvent);

        expect(preventDefault).toHaveBeenCalledTimes(1);
    });

    it('handles refresh errors without leaving the spinner stuck', async () => {
        const onRefresh = vi.fn().mockRejectedValue(new Error('refresh failed'));
        render(<PullToRefresh onRefresh={onRefresh}><p>content</p></PullToRefresh>);

        pull(screen.getByTestId('pull-to-refresh'), 200);

        await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));
        await waitFor(() => expect(screen.queryByText('Refreshing')).toBeNull());
    });

    it('does not update state after unmounting during an in-flight refresh', async () => {
        let resolveRefresh: (() => void) | null = null;
        const onRefresh = vi.fn(() => new Promise<void>((resolve) => {
            resolveRefresh = resolve;
        }));
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const { unmount } = render(<PullToRefresh onRefresh={onRefresh}><p>content</p></PullToRefresh>);

        pull(screen.getByTestId('pull-to-refresh'), 200);
        await waitFor(() => expect(onRefresh).toHaveBeenCalledTimes(1));

        unmount();

        await act(async () => {
            resolveRefresh?.();
            await Promise.resolve();
        });

        expect(consoleError).not.toHaveBeenCalled();
    });
});
